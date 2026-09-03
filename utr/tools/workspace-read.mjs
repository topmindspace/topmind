#!/usr/bin/env node
import { existsSync, promises as fs, realpathSync } from "node:fs";
import path from "node:path";

import {
  discoverCategories,
  loadCategoryTemplate,
  getCategoryMap,
  getWorkspaceModel,
  inboxRoot,
  userWorkspaceCategoriesRoot,
  categoryRoot,
  topicRoot,
  topicFilePath,
  globalOutputsRoot,
  isValidCategoryName,
  createWorkspaceContext,
  resolveUtrWorkspaceContext,
} from "../core/workspace-context.mjs";
import {
  compareStrings,
  fileInfo,
  isDirectory,
  topicHomeFiles,
  walkMarkdown,
  workspaceRelative,
} from "../core/topic-files.mjs";
import { parseFrontmatter } from "../core/frontmatter.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { parseArgs } from "../core/cli-args.mjs";
import { t } from "../core/i18n-strings.mjs";
import {
  classifySafetyReceiptType,
  inferTopicFromSafetyPath,
} from "../core/safety-receipt-paths.mjs";

function requirePath(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(t("error.missingParam", { key: key.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`) }));
  }
  const resolved = path.resolve(String(value));
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function buildContext({ categoriesRoot, inboxRootPath, archiveRootPath }) {
  return createWorkspaceContext({
    engineRoot: process.cwd(),
    userWorkspaceRoot: categoriesRoot,
    inboxRootPath,
    archiveRootPath,
  });
}

// ── v4.x list-categories (unified WorkspaceModel) ─────────────────────────

async function listCategories(ctx) {
  const root = userWorkspaceCategoriesRoot(ctx);
  const engineRoot = ctx.engineRoot || process.cwd();
  const model = getWorkspaceModel(engineRoot, root);
  const items = model.categories.map((cat) => ({
    slot: cat.slot,
    name: cat.name,
    directory: cat.directory,
    path: cat.path,
    role: cat.role,
    specialBehavior: cat.specialBehavior,
    catchAll: cat.catchAll,
    referenceOnly: cat.referenceOnly,
    required: cat.required,
    hidden: cat.hidden || false,
    source: cat.source,
    ok: Boolean(cat.ok),
    pendingCreate: Boolean(cat.pendingCreate),
  }));

  return {
    workspaceRoot: root,
    templateId: model.templateId,
    separator: model.separator,
    contract_version: model.config?.contract_version || 4,
    generatedAt: model.generatedAt,
    slots: items,
    categories: items,
    missingRequired: model.missingRequired,
    metrics: {
      activeCategoryCount: items.filter((item) => item.ok && !item.hidden).length,
      totalCategoryCount: items.length,
      hiddenCount: items.filter((item) => item.hidden).length,
    },
  };
}

// ── v4.x list-topics (dynamic category discovery) ─────────────────────────

async function listTopics(ctx, categoryFilter) {
  const result = [];
  const engineRoot = ctx.engineRoot || process.cwd();
  const root = userWorkspaceCategoriesRoot(ctx);

  const categoriesToScan = categoryFilter && isValidCategoryName(categoryFilter)
    ? [categoryFilter]
    : discoverCategories(root, engineRoot);

  for (const category of categoriesToScan) {
    const categoryDir = categoryRoot(ctx, category);
    if (!await isDirectory(categoryDir)) continue;
    const entries = await fs.readdir(categoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const topicDirPath = path.join(categoryDir, entry.name);
      const topicFile = path.join(topicDirPath, "topic.md");
      const hasTopicFile = existsSync(topicFile);
      let title = entry.name;
      let status = "active";
      let updatedAt = null;
      if (hasTopicFile) {
        try {
          const text = await fs.readFile(topicFile, "utf8");
          const { data, body } = parseFrontmatter(text);
          title = data.title || body.match(/^#\s+(.+)$/mu)?.[1]?.trim() || entry.name;
          status = data.status || "active";
          updatedAt = data.updated || data.updated_at || null;
        } catch { /* fall through */ }
      }
      if (!updatedAt) {
        try {
          updatedAt = (await fs.stat(topicDirPath)).mtime.toISOString().replace(/\.\d{3}Z$/u, "+00:00");
        } catch { /* ignore */ }
      }
      result.push({
        category,
        topic: entry.name,
        path: workspaceRelative(topicDirPath, userWorkspaceCategoriesRoot(ctx)),
        title,
        status,
        hasTopicFile,
        updatedAt,
      });
    }
  }
  result.sort((left, right) => {
    const byCategory = compareStrings(left.category, right.category);
    if (byCategory !== 0) return byCategory;
    return compareStrings(left.topic, right.topic);
  });
  return {
    categoriesRoot: userWorkspaceCategoriesRoot(ctx),
    categoryFilter: categoryFilter || null,
    topicCount: result.length,
    topics: result,
  };
}

// ── inspect-topic ─────────────────────────────────────────────────────

async function inspectTopic(category, topic, ctx) {
  if (!isValidCategoryName(category)) {
    const root = userWorkspaceCategoriesRoot(ctx);
    const engineRoot = ctx.engineRoot || process.cwd();
    const available = discoverCategories(root, engineRoot).join(", ");
    throw new Error(t("error.invalidCategoryWithAvailable", { category, available: available || t("msg.noTopics") }));
  }
  const topicDir = topicRoot(ctx, category, topic);
  if (!await isDirectory(topicDir)) {
    throw new Error(t("error.topicNotFound", { category, topic }));
  }
  const workspaceRoot = userWorkspaceCategoriesRoot(ctx);
  const home = await topicHomeFiles(topicDir, workspaceRoot);
  const allTopicMd = await walkMarkdown(topicDir, workspaceRoot, "note");
  const notes = allTopicMd.filter((f) => f.name !== "topic.md");
  const allOutputs = await walkMarkdown(globalOutputsRoot(ctx), workspaceRoot, "output");
  const outputs = await filterOutputsByTopic(allOutputs, topic, workspaceRoot);

  return {
    category,
    topic,
    paths: {
      topicRoot: workspaceRelative(topicDir, workspaceRoot),
      topicFile: existsSync(path.join(topicDir, "topic.md"))
        ? workspaceRelative(path.join(topicDir, "topic.md"), workspaceRoot)
        : null,
    },
    metrics: {
      noteCount: notes.length,
      outputCount: outputs.length,
    },
    home,
    notes,
    outputs,
  };
}

/** Filter flat 88 Outputs/ entries whose frontmatter `topic` matches the given topic. */
async function filterOutputsByTopic(entries, topic, workspaceRoot) {
  const result = [];
  for (const entry of entries) {
    try {
      const abs = workspaceRoot
        ? path.resolve(workspaceRoot, entry.relativePath)
        : path.resolve(entry.relativePath);
      const content = await fs.readFile(abs, "utf8").catch(() => null);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (parsed.data.topic === topic) result.push(entry);
    } catch { /* ignore */ }
  }
  return result;
}

// ── list-topic-files ──────────────────────────────────────────────────────

async function listTopicFiles(category, topic, scope, ctx) {
  const topicDir = topicRoot(ctx, category, topic);
  const workspaceRoot = userWorkspaceCategoriesRoot(ctx);
  const kinds = {
    home: ["home"],
    notes: ["note"],
    outputs: ["output"],
    all: ["home", "note", "output"],
  }[scope || "all"];
  if (!kinds) {
    throw new Error(t("error.unknownFileScope", { scope }));
  }

  const files = [];
  if (kinds.includes("home")) files.push(...await topicHomeFiles(topicDir, workspaceRoot));
  if (kinds.includes("note")) {
    const all = await walkMarkdown(topicDir, workspaceRoot, "note");
    files.push(...all.filter((f) => f.name !== "topic.md"));
  }
  // outputs: flat under 88 Outputs/, filtered by topic frontmatter
  if (kinds.includes("output")) {
    const all = await walkMarkdown(globalOutputsRoot(ctx), workspaceRoot, "output");
    files.push(...await filterOutputsByTopic(all, topic, workspaceRoot));
  }
  files.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
  return { category, topic, scope, files };
}

// ── list-inbox ────────────────────────────────────────────────────────────

async function listInbox(inboxRootPath, limit, workspaceRoot) {
  const files = [];
  if (await isDirectory(inboxRootPath)) {
    async function walk(current) {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (entry.isFile()) {
          files.push(entryPath);
        }
      }
    }
    await walk(inboxRootPath);
  }
  files.sort(compareStrings);
  const sliced = files.slice(0, limit);
  return {
    rootPath: inboxRootPath,
    limit,
    files: await Promise.all(sliced.map((file) => fileInfo(file, workspaceRoot, "inbox"))),
  };
}

// ── v3.2 list-recent-captures ──────────────────────────────────────────────

async function listRecentCaptures(ctx, inboxRootPath, limit) {
  const candidates = [];
  const categoriesRoot = userWorkspaceCategoriesRoot(ctx);

  async function collectMarkdownFiles(root, { category = null, topic = null } = {}) {
    if (!await isDirectory(root)) return;
    async function walk(current) {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
          candidates.push({ path: entryPath, category, topic });
        }
      }
    }
    await walk(root);
  }

  await collectMarkdownFiles(inboxRootPath, { category: null, topic: null });

  const engineRoot = ctx.engineRoot || process.cwd();
  const discoveredCats = discoverCategories(userWorkspaceCategoriesRoot(ctx), engineRoot);
  for (const category of discoveredCats) {
    const categoryDir = categoryRoot(ctx, category);
    if (!await isDirectory(categoryDir)) continue;
    const entries = await fs.readdir(categoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        candidates.push({ path: path.join(categoryDir, entry.name), category, topic: null });
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        // v3.4: notes live at topic root — collect the whole topic dir
        await collectMarkdownFiles(path.join(categoryDir, entry.name), { category, topic: entry.name });
      }
    }
  }

  const captures = (
    await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const content = await fs.readFile(candidate.path, "utf8");
          const parsed = parseFrontmatter(content);
          const capturedAt = parsed.data.captured_at || parsed.data.created || parsed.data.created_at || null;
          if (!capturedAt) return null;
          const info = await fileInfo(candidate.path, categoriesRoot, candidate.topic ? "note" : "inbox");
          return {
            ...info,
            category: candidate.category,
            topic: candidate.topic,
            title: parsed.data.title || info.name,
            sourceType: parsed.data.source_type || null,
            capturedAt,
            route: {
              confidence: parsed.data.route_confidence || null,
              reason: parsed.data.route_reason || null,
            },
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  captures.sort((left, right) => {
    const byCapture = compareStrings(right.capturedAt || "", left.capturedAt || "");
    if (byCapture !== 0) return byCapture;
    return compareStrings(left.relativePath, right.relativePath);
  });

  return {
    limit,
    captures: captures.slice(0, limit),
  };
}

// ── v3.2 list-safety-receipts ──────────────────────────────────────────────

function inferTopicFromReceipt(relativePath, type) {
  return inferTopicFromSafetyPath(relativePath, type);
}

function classifySafetyReceipt(filePath, workspaceRoot) {
  const relativePath = workspaceRelative(filePath, workspaceRoot);
  const type = classifySafetyReceiptType(relativePath);
  if (!type) return null;
  const reasonKey = {
    backup: "msg.backupReason",
    trash: "msg.trashReason",
    "archived-topic": "msg.archivedTopicReason",
    revision: "msg.revisionReason",
  }[type];
  return { type, reason: t(reasonKey) };
}

async function collectSafetyReceiptCandidates(ctx, archiveRootPath) {
  const candidates = [];
  const workspaceRoot = userWorkspaceCategoriesRoot(ctx);

  async function collectFileTree(root) {
    if (!await isDirectory(root)) return;
    async function walk(current) {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
          continue;
        }
        if (entry.isFile()) candidates.push(entryPath);
      }
    }
    await walk(root);
  }

  // archive top-level: archive/{category}-{topic}-{timestamp}/ — these are directory entries
  if (await isDirectory(archiveRootPath)) {
    const topEntries = await fs.readdir(archiveRootPath, { withFileTypes: true });
    for (const entry of topEntries) {
      if (entry.isDirectory() && !["backups", "trash", "restore-receipts", "receipts"].includes(entry.name)) {
        candidates.push(path.join(archiveRootPath, entry.name));
      }
    }
  }

  await collectFileTree(path.join(archiveRootPath, "backups"));
  await collectFileTree(path.join(archiveRootPath, "trash"));
  await collectFileTree(userWorkspaceCategoriesRoot(ctx));
  return { candidates, workspaceRoot };
}

async function listSafetyReceipts(ctx, archiveRootPath, limit) {
  const { candidates, workspaceRoot } = await collectSafetyReceiptCandidates(ctx, archiveRootPath);
  const receipts = [];

  for (const candidate of candidates) {
    const classification = classifySafetyReceipt(candidate, workspaceRoot);
    if (!classification) continue;
    const stat = await fs.stat(candidate);
    const relativePath = workspaceRelative(candidate, workspaceRoot);
    const topicInfo = inferTopicFromReceipt(relativePath, classification.type);
    receipts.push({
      type: classification.type,
      relativePath,
      name: path.basename(candidate),
      category: topicInfo?.category || null,
      topic: topicInfo?.topic || null,
      sizeBytes: stat.isFile() ? stat.size : null,
      updatedAt: stat.mtime.toISOString().replace(/\.\d{3}Z$/u, "+00:00"),
      recoverable: true,
      reason: classification.reason,
      restoreAction: {
        kind: "workspace-maintain",
        command: "restore-safety-receipt",
        input: {
          receiptPath: relativePath,
          reason: `restore ${classification.type} receipt`,
          writebackMode: "confirm",
        },
      },
    });
  }

  receipts.sort((left, right) => {
    const byTime = compareStrings(right.updatedAt || "", left.updatedAt || "");
    if (byTime !== 0) return byTime;
    return compareStrings(left.relativePath, right.relativePath);
  });

  return {
    limit,
    receipts: receipts.slice(0, limit),
  };
}

// ── v3.2 main dispatcher ──────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2), { defaults: { limit: 100 }, coerceNumbers: ["limit"] });
  const categoriesRoot = requirePath(args, "categoriesRoot");
  const inboxRootPath = requirePath(args, "inboxRoot");
  const archiveRootPath = requirePath(args, "archiveRoot");

  const ctx = buildContext({ categoriesRoot, inboxRootPath, archiveRootPath });

  let data;
  if (args.command === "list-categories") {
    data = await listCategories(ctx);
  } else if (args.command === "list-topics") {
    data = await listTopics(ctx, args.category);
  } else if (args.command === "inspect-topic") {
    data = await inspectTopic(args.category, args.topic, ctx);
  } else if (args.command === "list-topic-files") {
    data = await listTopicFiles(args.category, args.topic, args.scope || "all", ctx);
  } else if (args.command === "list-inbox") {
    data = await listInbox(inboxRootPath, args.limit || 100, categoriesRoot);
  } else if (args.command === "list-recent-captures") {
    data = await listRecentCaptures(ctx, inboxRootPath, args.limit || 20);
  } else if (args.command === "list-safety-receipts") {
    data = await listSafetyReceipts(ctx, archiveRootPath, args.limit || 20);
  } else {
    throw new Error(t("error.unknownCommand", { command: args.command || "(empty)" }));
  }

  emitResult(data, args.format);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});