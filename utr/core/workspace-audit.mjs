import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { t } from "./i18n-strings.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";
import { compareStrings, isDirectory, pathExists } from "./topic-files.mjs";
import {
  UNSUPPORTED_WORKSPACE_ROOTS,
  isValidCategoryName,
  discoverCategories,
  getWorkspaceModel,
} from "./workspace-context.mjs";
import { inspectContract } from "../../lib/kernel-api.mjs";

const V2_DEFAULT_ANCHOR_FILES = new Set(["outline.md", "setting.md", "style.md"]);
const FORBIDDEN_FILE_SUFFIXES = new Set([".tmp", ".clean"]);
const DEPRECATED_NOTE_FIELDS = new Set([
  "note_kind",
  "legacy_source",
  "parent_topic",
  "legacy_date_hint",
  "draft_kind",
  // v2.x 字段名 — v3.2 删除
  "project_type",
  "project_kind",
]);
const PLACEHOLDER_NOTE_DIRS = new Set(["_archive"]);

function pushIssue(issues, severity, code, message, extra = {}) {
  issues.push({ severity, code, message, ...extra });
}

function workspaceRootFromRoots(inboxRootPath, archiveRootPath) {
  const activeRoots = [inboxRootPath].map((entry) => path.resolve(entry));
  const activeParents = new Set(activeRoots.map((entry) => path.dirname(entry)));
  if (activeParents.size === 1) return Array.from(activeParents)[0];
  const roots = [inboxRootPath, archiveRootPath].map((entry) => path.resolve(entry));
  const parents = new Set(roots.map((entry) => path.dirname(entry)));
  if (parents.size === 1) return Array.from(parents)[0];
  return roots[0] ? path.dirname(roots[0]) : os.homedir();
}

async function listEntries(root) {
  try {
    return await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walk(root, visit) {
  const entries = await listEntries(root);
  entries.sort((left, right) => compareStrings(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    await visit(entryPath, entry);
    if (entry.isDirectory()) {
      await walk(entryPath, visit);
    }
  }
}

async function iterCategories(categoriesRoot) {
  const entries = await listEntries(categoriesRoot);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(categoriesRoot, entry.name),
      // Reserved = system / delivery / buffer roles (resolved later when model available)
      // + semantic-plane fixed name `memory/` (PROJECT-MODEL §1.4: 语义平面固化名，不随 locale 变化)
      isReserved:
        /^(00|88|99)[ -]/.test(entry.name) || entry.name === "memory",
    }))
    .sort((left, right) => compareStrings(left.name, right.name));
}

async function iterTopicsInCategory(categoryDir) {
  const entries = await listEntries(categoryDir);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(categoryDir, entry.name),
    }))
    .sort((left, right) => compareStrings(left.name, right.name));
}

export async function auditWorkspace(categoriesRoot, inboxRootPath, archiveRootPath) {
  const workspaceRoot = workspaceRootFromRoots(inboxRootPath, archiveRootPath);
  const items = [
    { label: "categoriesRoot", path: categoriesRoot },
    { label: "inboxRoot", path: inboxRootPath },
    { label: "archiveRoot", path: archiveRootPath },
  ];
  const issues = [];

  // 0. Contract health (shared Kernel inspect — honest on-disk status)
  let contractHealth = null;
  try {
    contractHealth = inspectContract(workspaceRoot);
    if (contractHealth.state === "missing") {
      pushIssue(
        issues,
        "error",
        "contract-missing",
        "Missing topmind.yaml — run contract.ensure or open workspace via Desktop/Obsidian to auto-create.",
        { path: contractHealth.path, recovery: "contract.ensure" },
      );
    } else if (contractHealth.state === "legacy_v3") {
      pushIssue(
        issues,
        "warning",
        "contract-legacy-v3",
        "Legacy .topmind-config.json present — run contract.ensure to migrate to topmind.yaml v4.",
        { path: contractHealth.path, recovery: "contract.ensure" },
      );
    } else if (contractHealth.state === "repairable") {
      pushIssue(
        issues,
        "warning",
        "contract-repairable",
        `topmind.yaml needs repair: ${(contractHealth.errors || []).join("; ") || "schema drift"}. Run contract.ensure.`,
        { path: contractHealth.path, recovery: "contract.ensure", warnings: contractHealth.warnings },
      );
    } else if (contractHealth.state === "corrupt" || contractHealth.state === "unreadable") {
      pushIssue(
        issues,
        "error",
        "contract-unrepairable",
        `topmind.yaml is ${contractHealth.state} — cannot safely auto-fix. Run contract.reseed (backs up bad file; content dirs kept) or repair manually.`,
        {
          path: contractHealth.path,
          recovery: "contract.reseed",
          parseError: contractHealth.parseError,
          errors: contractHealth.errors,
        },
      );
    }
  } catch (err) {
    pushIssue(
      issues,
      "warning",
      "contract-inspect-failed",
      `Could not inspect topmind.yaml: ${err?.message || err}`,
      { path: path.join(workspaceRoot, "topmind.yaml") },
    );
  }

  // 1. Top-level root check
  for (const item of items) {
    const ok = await pathExists(item.path);
    if (!ok) {
      pushIssue(issues, "error", "missing-path", t("error.missingRootDir", { label: item.label }), { path: item.path });
    }
  }

  // 2. workspaceRoot walk: check for v2.x forbidden roots + system files
  if (await pathExists(workspaceRoot)) {
    const children = await listEntries(workspaceRoot);
    children.sort((left, right) => compareStrings(left.name, right.name));
    for (const child of children) {
      if (UNSUPPORTED_WORKSPACE_ROOTS.has(child.name)) {
        const isV2xProjectRoot = child.name === "projects";
        const isV2xDeprecatedRoot = ["references", "sources", "library"].includes(child.name);
        pushIssue(
          issues,
          isV2xProjectRoot ? "error" : "error",
          isV2xProjectRoot
            ? "v2-legacy-projects-root"
            : isV2xDeprecatedRoot
              ? "v2-deprecated-workspace-root"
              : "unsupported-workspace-root",
          isV2xProjectRoot
            ? t("error.v2LegacyProjectsRoot", { name: child.name })
            : t("error.v2DeprecatedRoot", { name: child.name }),
          { path: path.join(workspaceRoot, child.name) },
        );
      }

      // v3.2: categories are dynamically discovered — no reserved slots
      const reservedSlot = ["06", "07", "08"].find(
        (slot) => child.name === `${slot} (reserved)` || child.name === slot,
      );
      if (reservedSlot) {
        pushIssue(
          issues,
          "error",
          "reserved-slot-activated",
          t("error.reservedSlotActivated", { slot: reservedSlot, name: child.name }),
          { path: path.join(workspaceRoot, child.name) },
        );
      }
    }

    await walk(workspaceRoot, async (entryPath, entry) => {
      if (entry.isFile() && entry.name === ".DS_Store") {
        pushIssue(
          issues,
          "error",
          "forbidden-workspace-entry",
          t("error.forbiddenSystemFile"),
          { path: entryPath },
        );
      }
      if (entry.isFile() && FORBIDDEN_FILE_SUFFIXES.has(path.extname(entry.name))) {
        pushIssue(
          issues,
          "error",
          "forbidden-workspace-entry",
          t("error.forbiddenTempFile", { name: entry.name }),
          { path: entryPath },
        );
      }
      if (entry.name === ".state") {
        pushIssue(
          issues,
          "error",
          "runtime-state-in-user-workspace",
          t("error.runtimeStateInWorkspace"),
          { path: entryPath },
        );
      }
      // v2.x default anchor files inside any topic: flag as drift
      if (entry.isFile() && V2_DEFAULT_ANCHOR_FILES.has(entry.name)) {
        // Only flag if the parent directory looks like a topic (has topic.md sibling)
        const parent = path.dirname(entryPath);
        const hasNotes = await pathExists(path.join(parent, "notes"));
        const hasTopicMd = await pathExists(path.join(parent, "topic.md"));
        if (hasTopicMd) {
          pushIssue(
            issues,
            "warning",
            "v2-default-anchor-drift",
            t("error.v2AnchorDrift", { topic: path.basename(parent), file: entry.name }),
            { path: entryPath, topic: path.basename(parent) },
          );
        }
      }
    });
  }

  // 3. Per-category walk + per-topic walk
  const categories = [];
  let topicsScanned = 0;
  let topicsWithIssues = 0;
  let metadataFilesChecked = 0;

  for (const category of await iterCategories(categoriesRoot)) {
    const categoryIssuesBefore = issues.length;
    const categoryName = category.name;

    // Valid categories match {NN}[- ]{Name}/. Custom slots (11-健康 etc.) are allowed.
    // Non-matching top-level dirs (e.g. knowledge/) are errors unless reserved system shape.
    if (!isValidCategoryName(categoryName) && !category.isReserved) {
      pushIssue(
        issues,
        "error",
        "invalid-category-name",
        t("error.invalidCategoryDirName", { name: categoryName }),
        { path: category.path },
      );
    }

    // Loose notes: count top-level .md files in the category directory
    let looseNoteCount = 0;
    for (const entry of await listEntries(category.path)) {
      if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        looseNoteCount += 1;
        metadataFilesChecked += 1;
        const notePath = path.join(category.path, entry.name);
        const { data } = parseFrontmatter(await fs.readFile(notePath, "utf8"));
        const deprecatedFields = Array.from(DEPRECATED_NOTE_FIELDS)
          .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
          .sort(compareStrings);
        for (const field of deprecatedFields) {
          pushIssue(
            issues,
            "error",
            "deprecated-note-field",
            t("error.deprecatedField", { field }),
            { path: notePath, category: categoryName, field },
          );
        }
      }
    }

    // Topic walk
    for (const topic of await iterTopicsInCategory(category.path)) {
      topicsScanned += 1;
      const topicIssuesBefore = issues.length;

      // v3.4: notes live at topic root; no notes/ subdirectory expected
      const topicFilePath = path.join(topic.path, "topic.md");
      const topicFileExists = await pathExists(topicFilePath);
      // topicFile is optional in v3.4 (渐进式专题解析), so just record, don't warn
      if (!topicFileExists) {
        // silent — missing topic.md is healthy in v3.4 progressive model
      }

      // Walk the topic root for placeholder directories (chapters/, articles/, entities/ that linger)
      if (await isDirectory(topic.path)) {
        await walk(topic.path, async (entryPath, entry) => {
          if (entry.isDirectory() && PLACEHOLDER_NOTE_DIRS.has(entry.name)) {
            pushIssue(
              issues,
              "warning",
              "topic-placeholder-dir",
              t("error.topicPlaceholderDir", { topic: topic.name }),
              { path: entryPath, category: categoryName, topic: topic.name },
            );
          }

          if (!entry.isFile() || path.extname(entry.name) !== ".md") return;
          if (isHiddenRelative(entryPath, topic.path)) return;
          // skip files inside the placeholder dirs themselves
          const relativeParts = path.relative(topic.path, entryPath).split(path.sep);
          if (relativeParts.some((part) => PLACEHOLDER_NOTE_DIRS.has(part))) return;

          metadataFilesChecked += 1;
          const { data } = parseFrontmatter(await fs.readFile(entryPath, "utf8"));
          const deprecatedFields = Array.from(DEPRECATED_NOTE_FIELDS)
            .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
            .sort(compareStrings);
          for (const field of deprecatedFields) {
            pushIssue(
              issues,
              "error",
              "deprecated-note-field",
              t("error.deprecatedField", { field }),
              { path: entryPath, category: categoryName, topic: topic.name, field },
            );
          }
        });
      }

      const topicIssues = issues.slice(topicIssuesBefore);
      const errorCount = topicIssues.filter((issue) => issue.severity === "error").length;
      const warningCount = topicIssues.filter((issue) => issue.severity === "warning").length;
      if (topicIssues.length > 0) topicsWithIssues += 1;
      categories.push({
        category: categoryName,
        topic: topic.name,
        path: topic.path,
        ok: errorCount === 0,
        looseNoteCount,
        errorCount,
        warningCount,
      });
    }

    const categoryIssues = issues.slice(categoryIssuesBefore);
    const categoryErrorCount = categoryIssues.filter((issue) => issue.severity === "error").length;
    const categoryWarningCount = categoryIssues.filter((issue) => issue.severity === "warning").length;
    if (categoryIssues.length > 0) topicsWithIssues += 1;
    if (!categories.find((c) => c.category === categoryName && c.topic === null)) {
      categories.push({
        category: categoryName,
        topic: null,
        path: category.path,
        ok: categoryErrorCount === 0,
        looseNoteCount,
        items: [],
        errorCount: categoryErrorCount,
        warningCount: categoryWarningCount,
      });
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    ok: errorCount === 0,
    workspaceRoot,
    items: await Promise.all(items.map(async (item) => ({
      ...item,
      ok: await pathExists(item.path),
    }))),
    issues,
    categories,
    contract: contractHealth
      ? {
          state: contractHealth.state,
          onDiskValid: contractHealth.onDiskValid,
          path: contractHealth.path,
          needsRewrite: contractHealth.needsRewrite,
          errors: contractHealth.errors,
          warnings: contractHealth.warnings,
        }
      : null,
    slots: await buildSlots(categoriesRoot),
    summary: {
      topicCount: topicsScanned,
      topicsWithIssues,
      metadataFilesChecked,
      errorCount,
      warningCount,
    },
  };
}

async function buildSlots(categoriesRoot) {
  // Prefer unified model when engine root is cwd (CLI); fall back to pure FS discovery.
  try {
    const engineRoot = process.cwd();
    const model = getWorkspaceModel(engineRoot, categoriesRoot);
    return model.categories.map((cat) => ({
      slot: cat.slot,
      name: cat.name,
      directory: cat.directory,
      path: cat.path,
      reserved: cat.role === "buffer" || cat.role === "delivery" || cat.role === "system",
      role: cat.role,
      source: cat.source,
      specialBehavior: cat.specialBehavior,
      ok: Boolean(cat.ok),
    }));
  } catch {
    const dirs = discoverCategories(categoriesRoot, null);
    const slots = [];
    for (const dir of dirs) {
      const fullPath = path.join(categoriesRoot, dir);
      slots.push({
        slot: dir.slice(0, 2),
        name: dir.slice(3),
        directory: dir,
        path: fullPath,
        reserved: /^(00|88|99)[ -]/.test(dir),
        role: "unknown",
        ok: await pathExists(fullPath),
      });
    }
    return slots;
  }
}

function isHiddenRelative(targetPath, root) {
  const relative = path.relative(root, targetPath);
  return relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part.startsWith("."));
}
