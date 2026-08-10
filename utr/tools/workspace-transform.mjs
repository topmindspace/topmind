#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  discoverCategories,
  getWorkspaceModel,
  topicRoot,
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs, resolveMode } from "../core/cli-args.mjs";
import { ensureDir, isDirectory, walkMarkdown } from "../core/topic-files.mjs";
import { parseFrontmatter, stringifyFrontmatter } from "../core/frontmatter.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import { executeWrite, loadContract } from "../../lib/kernel-api.mjs";

/** Durable .md body write via Kernel write-gate (auto mode callers pass confirmed). */
async function writeMarkdownDurable(fullPath, content, ctxObj) {
  const contract = loadContract(ctxObj.userWorkspaceRoot);
  executeWrite({
    targetPath: fullPath,
    content,
    workspaceRoot: ctxObj.userWorkspaceRoot,
    contract,
    operation: "update",
    actor: "user",
    confirmed: true,
    skipReceipt: true,
  });
}

// ── normalize-note-metadata ────────────────────────────────────────────────

async function normalizeNoteMetadata({ mode }, ctxObj) {
  const plan = [];

  const categories = discoverCategories(
    ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot,
    ctxObj.engineRoot,
  );
  for (const category of categories) {
    const categoryDir = path.join(ctxObj.categoriesRoot, category);
    if (!await isDirectory(categoryDir)) continue;
    const entries = await fs.readdir(categoryDir, { withFileTypes: true });

    for (const entry of entries) {
      // v3.4: notes live at topic root — collect *.md from topic dir itself
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const topicDir = path.join(categoryDir, entry.name);
        const files = await walkMarkdown(topicDir, ctxObj.userWorkspaceRoot, "note");
        for (const file of files) {
          if (file.name === "topic.md") continue;
          const fullPath = path.join(ctxObj.userWorkspaceRoot, file.relativePath);
          const original = await fs.readFile(fullPath, "utf8");
          const parsed = parseFrontmatter(original);
          const data = { ...parsed.data };
          let changed = false;
          if ("project_type" in data || "projectType" in data) {
            delete data.project_type;
            delete data.projectType;
            data.category = data.category || category;
            data.topic = data.topic || entry.name;
            changed = true;
          }
          if (data.status && !["active", "archived", "draft", "final"].includes(data.status)) {
            data.status = "active";
            changed = true;
          }
          if (data.category && data.category !== category) {
            plan.push({ file: file.relativePath, action: "category-mismatch", from: data.category, to: category });
            data.category = category;
            changed = true;
          }
          if (data.topic && data.topic !== entry.name) {
            plan.push({ file: file.relativePath, action: "topic-mismatch", from: data.topic, to: entry.name });
            data.topic = entry.name;
            changed = true;
          }
          if (changed && mode === "auto") {
            const updated = stringifyFrontmatter({ data, body: parsed.body });
            await writeMarkdownDurable(fullPath, updated, ctxObj);
          }
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // loose note at category root
        const fullPath = path.join(categoryDir, entry.name);
        const original = await fs.readFile(fullPath, "utf8");
        const parsed = parseFrontmatter(original);
        const data = { ...parsed.data };
        let changed = false;
        if ("project_type" in data || "projectType" in data) {
          delete data.project_type;
          delete data.projectType;
          changed = true;
        }
        if (changed && mode === "auto") {
          await writeMarkdownDurable(fullPath, stringifyFrontmatter({ data, body: parsed.body }), ctxObj);
        }
      }
    }
  }

  // inbox
  const inboxDir = ctxObj.inboxRootPath;
  if (await isDirectory(inboxDir)) {
    const inboxFiles = await walkMarkdown(inboxDir, ctxObj.userWorkspaceRoot, "inbox");
    for (const file of inboxFiles) {
      const fullPath = path.join(ctxObj.userWorkspaceRoot, file.relativePath);
      const original = await fs.readFile(fullPath, "utf8");
      const parsed = parseFrontmatter(original);
      const data = { ...parsed.data };
      let changed = false;
      if ("project_type" in data || "projectType" in data) {
        delete data.project_type;
        delete data.projectType;
        changed = true;
      }
      if (changed && mode === "auto") {
        await writeMarkdownDurable(fullPath, stringifyFrontmatter({ data, body: parsed.body }), ctxObj);
      }
    }
  }

  return {
    command: "normalize-note-metadata",
    mode,
    planned: plan,
    applied: mode === "auto",
    planCount: plan.length,
  };
}

// ── plan-inbox-routing ────────────────────────────────────────────────────

/** Role/keyword hints — resolved against live workspace directories (not hard-coded names). */
const KEYWORD_ROLE_HINTS = [
  { pattern: /(思考|日记|反思|情绪|周记|感想)/u, roles: ["loose-stream"], keywords: /日常|日记|笔记/u },
  { pattern: /(研究|实验|分析|论文|调研|系统|架构|模型|理论)/u, roles: ["deep-work"], keywords: /研究|调研/u },
  { pattern: /(读书|阅读|书|笔记摘抄|读书笔记|看书|翻阅)/u, roles: ["deep-work", "reference"], keywords: /阅读|读书|read/u },
  { pattern: /(创作|写文|稿件|草稿|故事|脚本|剧作|写作|随笔)/u, roles: ["deep-work"], keywords: /创作|写作/u },
  { pattern: /(临时|杂|未定|碎碎)/u, roles: ["fallback"], keywords: /其他|杂/u },
  { pattern: /(模板|资料|素材|引用|参考)/u, roles: ["reference"], keywords: /参考|资料|素材/u },
];

function resolveRoutingTargets(ctxObj) {
  const root = ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot;
  const engineRoot = ctxObj.engineRoot || process.cwd();
  let model;
  try {
    model = getWorkspaceModel(engineRoot, root);
  } catch {
    model = null;
  }
  const cats = (model?.categories || [])
    .filter((c) => c.ok && !c.hidden)
    .filter((c) => !["buffer", "delivery", "system"].includes(c.role));
  const byRole = (role) => cats.filter((c) => c.role === role).map((c) => c.directory);
  const fallbackLoose =
    byRole("loose-stream")[0] ||
    byRole("deep-work")[0] ||
    cats[0]?.directory ||
    null;
  return { cats, byRole, fallbackLoose };
}

async function planInboxRouting({ limit }, ctxObj) {
  const inboxDir = ctxObj.inboxRootPath;
  const plan = [];
  const { cats, byRole, fallbackLoose } = resolveRoutingTargets(ctxObj);

  const scoreCategory = (haystack) => {
    const scores = {};
    for (const hint of KEYWORD_ROLE_HINTS) {
      const matches = haystack.match(new RegExp(hint.pattern.source, "gu"));
      if (!matches) continue;
      // Prefer dirs matching role, then keyword in directory name
      const candidates = [
        ...hint.roles.flatMap((r) => byRole(r)),
        ...cats.filter((c) => hint.keywords.test(c.directory)).map((c) => c.directory),
      ];
      for (const dir of candidates) {
        scores[dir] = (scores[dir] || 0) + matches.length;
      }
    }
    return scores;
  };

  if (await isDirectory(inboxDir)) {
    const files = await walkMarkdown(inboxDir, ctxObj.userWorkspaceRoot, "inbox");
    for (const file of files.slice(0, limit)) {
      const fullPath = path.join(ctxObj.userWorkspaceRoot, file.relativePath);
      const text = await fs.readFile(fullPath, "utf8");
      const parsed = parseFrontmatter(text);
      const haystack = `${parsed.data.title || ""}\n${parsed.body || ""}`.slice(0, 2000);
      const scores = scoreCategory(haystack);
      const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      const suggested = sorted[0]?.[1] > 0 ? sorted[0][0] : fallbackLoose;
      plan.push({
        file: file.relativePath,
        title: parsed.data.title || file.name,
        suggestedCategory: suggested,
        scores: Object.fromEntries(sorted),
        confidence: sorted[0]?.[1] > 0 ? "medium" : "low",
      });
    }
  }
  return {
    command: "plan-inbox-routing",
    inboxRoot: ctxObj.inboxRootPath,
    planCount: plan.length,
    plan,
  };
}

// ── migrate-v4 (v2.x projects/ → v3.4 category/topic) ────────────────────

/**
 * Map v2 type token → live category directory via WorkspaceModel (hyphen-first).
 * Falls back to recommended knowledge-management names when workspace empty.
 */
function deriveMappingFromName(oldName, ctxObj) {
  // Old: YYYY-类型-项目名  e.g. 2026-个人成长-示例项目
  const m = oldName.match(/^(\d{4})-([^-]+)-(.+)$/u);
  if (!m) return null;
  const [, year, type, rest] = m;
  const TYPE_HINTS = {
    "个人成长": { roles: ["loose-stream"], keywords: /日常|日记|笔记/u },
    "研究": { roles: ["deep-work"], keywords: /研究|调研/u },
    "阅读": { roles: ["deep-work", "reference"], keywords: /阅读|读书/u },
    "创作": { roles: ["deep-work"], keywords: /创作|写作/u },
    "资料库": { roles: ["reference"], keywords: /参考|资料/u },
    "其他": { roles: ["fallback"], keywords: /其他|杂/u },
  };
  const hint = TYPE_HINTS[type];
  if (!hint) return null;

  const root = ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot;
  const engineRoot = ctxObj.engineRoot || process.cwd();
  let category = null;
  try {
    const model = getWorkspaceModel(engineRoot, root);
    const cats = (model.categories || []).filter((c) => c.ok && !c.hidden);
    for (const role of hint.roles) {
      const hit = cats.find((c) => c.role === role && hint.keywords.test(c.directory));
      if (hit) {
        category = hit.directory;
        break;
      }
    }
    if (!category) {
      for (const role of hint.roles) {
        const hit = cats.find((c) => c.role === role);
        if (hit) {
          category = hit.directory;
          break;
        }
      }
    }
    if (!category) {
      const byKw = cats.find((c) => hint.keywords.test(c.directory));
      if (byKw) category = byKw.directory;
    }
  } catch { /* fall through */ }

  if (!category) {
    // Template defaults (hyphen) when FS model unavailable
    const FALLBACK = {
      "个人成长": "10-动态",
      "研究": "20-研究",
      "阅读": "30-阅读",
      "创作": "40-创作",
      "资料库": "60-参考资料",
      "其他": "50-其他",
    };
    category = FALLBACK[type];
  }
  if (!category) return null;
  const topic = `${year}-${rest.replace(/\s+/gu, "-")}`;
  return { category, topic };
}

async function migrateV4({ mapping: mappingJson, mode }, ctxObj) {
  const projectsRoot = path.join(ctxObj.userWorkspaceRoot, "projects");
  const projectsExisted = await isDirectory(projectsRoot);

  if (!projectsExisted) {
    return {
      command: "migrate-v4",
      mode,
      skipped: true,
      reason: t("msg.migrateV4NoProjectsRoot"),
      migrated: [],
    };
  }

  let explicitMapping = null;
  if (mappingJson && mappingJson !== "undefined" && mappingJson !== "null") {
    try {
      explicitMapping = JSON.parse(mappingJson);
    } catch (error) {
      throw new Error(t("error.mappingJsonParse", { message: error.message }));
    }
  }

  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const plan = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const oldName = entry.name;
    let mapping;
    if (explicitMapping && explicitMapping[oldName]) {
      const [category, topic] = explicitMapping[oldName];
      mapping = { category, topic };
    } else {
      mapping = deriveMappingFromName(oldName, ctxObj);
    }
    if (!mapping) {
      plan.push({ oldName, skipped: true, reason: t("msg.migrateV4NameNotMatched") });
      continue;
    }
    const { category, topic } = mapping;
    const src = path.join(projectsRoot, oldName);
    const targetTopicRoot = topicRoot(ctxObj, category, topic);
    plan.push({
      oldName,
      category,
      topic,
      sourcePath: path.relative(ctxObj.userWorkspaceRoot, src),
      targetPath: path.relative(ctxObj.userWorkspaceRoot, targetTopicRoot),
    });
  }

  let appliedPlan = [];
  if (mode === "auto") {
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const archiveDir = path.join(ctxObj.archiveRootPath, `projects-migrated-${stamp}`);
    await ensureDir(archiveDir);

    for (const item of plan) {
      if (item.skipped) continue;
      const src = path.join(ctxObj.userWorkspaceRoot, item.sourcePath);
      const target = path.join(ctxObj.userWorkspaceRoot, item.targetPath);

      // capture inbox-trash marker for the original
      const trashDir = path.join(ctxObj.archiveRootPath, "trash", item.category, item.topic);
      await ensureDir(trashDir);
      await fs.writeFile(
        path.join(trashDir, "migrated-from-projects.json"),
        JSON.stringify({ ...item, migratedAt: new Date().toISOString() }, null, 2),
        "utf8",
      );

      // copy tree then archive original
      await ensureDir(target);
      await copyDir(src, target);
      const archiveTarget = path.join(archiveDir, item.oldName);
      await ensureDir(archiveTarget);
      await copyDir(src, archiveTarget);

      appliedPlan.push({ ...item, archivePath: path.relative(ctxObj.userWorkspaceRoot, archiveTarget) });
    }

    // write migration receipt
    await fs.writeFile(
      path.join(archiveDir, "migration-receipt.json"),
      JSON.stringify({
        command: "migrate-v4",
        mode,
        appliedAt: new Date().toISOString(),
        count: appliedPlan.length,
        plan: appliedPlan,
      }, null, 2),
      "utf8",
    );
  }

  return {
    command: "migrate-v4",
    mode,
    projectsRootExisted: projectsExisted,
    plan,
    appliedPlan,
    applied: mode === "auto",
    receiptWritten: mode === "auto" ? `{archive}/projects-migrated-*/migration-receipt.json` : null,
  };
}

async function copyDir(src, dst) {
  await ensureDir(dst);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

// ── dispatcher ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 兼容别名参数
  if (args.projectsRoot && !args.categoriesRoot) {
    args.categoriesRoot = args.projectsRoot;
  }
  if (args.projectRoot && !args.topicRoot) {
    args.topicRoot = args.projectRoot;
  }

  const roots = validateRequiredRoots(args);
  const ctxObj = buildCliContext(roots);
  const mode = resolveMode(args);

  let data;
  switch (args.command) {
    case "normalize-note-metadata":
      data = await normalizeNoteMetadata({ mode }, ctxObj);
      break;
    case "plan-inbox-routing":
      data = await planInboxRouting({ limit: args.limit ? Number(args.limit) : 50 }, ctxObj);
      break;
    case "migrate-v4":
      data = await migrateV4({ mapping: args.mapping, mode }, ctxObj);
      break;
    default:
      throw new Error(t("error.unknownCommand", { command: args.command || "(empty)" }));
  }

  emitResult(data, args.format);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});