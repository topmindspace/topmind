#!/usr/bin/env node
/**
 * Write-path notes (2026-09-22 aligned):
 * - archive-topic goes through Kernel `executeArchive` — landing is
 *   `{archive}/{category}-{topic}-{stamp}/` + `archive-receipt.json` in dest
 *   (shared with `lib/writeback-engine.mjs`; recovery list/restore classifies
 *   that shape as archived-topic via `utr/core/safety-receipt-paths.mjs`).
 * - restore-safety-receipt does not use kernel executeWrite: restore is a
 *   mixed file/dir tree (binaries included); kernel has no executeRestore and
 *   executeWrite is text-note oriented.
 * Both still evaluate protection via the kernel write gate
 * (evaluateWritePermission + peekFrontmatter). Return evidence
 * (path + affected-files); no extra `99-归档/receipts/*.yaml` from this file.
 */
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

import {
  evaluateWritePermission,
  peekFrontmatter,
  loadContract,
  executeArchive,
  buildArchivedTopicName,
  resolveArchivePlaneRootRel,
  archiveStreamYear as kernelArchiveStreamYear,
  listStreamYears as kernelListStreamYears,
  resolveWorkspaceModel,
  findCategoryByRole,
  findStreamCategory,
} from "../../lib/kernel-api.mjs";
import {
  categoryRoot,
  topicRoot,
  isValidCategoryName,
  discoverCategories,
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs, resolveMode } from "../core/cli-args.mjs";
import { ensureDir, isDirectory } from "../core/topic-files.mjs";
import { auditWorkspace } from "../core/workspace-audit.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import {
  classifyRestoreTarget,
  stripBackupStampName,
  resolveArchivedTopicRestoreLabels,
} from "../core/safety-receipt-paths.mjs";

// ── doctor-workspace ────────────────────────────────────────────────────────

async function doctorWorkspace(ctxObj) {
  return await auditWorkspace(
    ctxObj.categoriesRoot,
    ctxObj.inboxRootPath,
    ctxObj.archiveRootPath,
  );
}

// ── kernel write-gate helpers ───────────────────────────────────────────────

function relPath(ctxObj, abs) {
  return path.relative(ctxObj.userWorkspaceRoot, abs).split(path.sep).join("/");
}

/** Directory protection source: topic.md first, else first .md one level deep. */
async function resolveDirGuardSource(dirAbs) {
  const topicMd = path.join(dirAbs, "topic.md");
  if (existsSync(topicMd)) return topicMd;
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) return path.join(dirAbs, entry.name);
  }
  return null;
}

// ── archive-topic ──────────────────────────────────────────────────────────

async function archiveTopic({ category, topic, reason, mode }, ctxObj) {
  if (!isValidCategoryName(category)) throw new Error(t("error.invalidCategory", { category }));
  if (!/^[\p{L}\p{N}._\- \u4e00-\u9fff]+$/u.test(topic)) throw new Error(t("error.invalidTopicName", { topic }));
  const topicDir = topicRoot(ctxObj, category, topic);
  if (!await isDirectory(topicDir)) throw new Error(t("error.topicNotFound", { category, topic }));

  const contract = loadContract(ctxObj.userWorkspaceRoot);
  const rel = relPath(ctxObj, topicDir);
  // Canonical landing (same constructor as Kernel executeArchive).
  const { name: archName } = buildArchivedTopicName({ relativePath: rel });
  const archiveRootRel = resolveArchivePlaneRootRel(ctxObj.userWorkspaceRoot, contract);
  let archiveTargetRel = `${archiveRootRel}/${archName}`;
  if (existsSync(path.join(ctxObj.userWorkspaceRoot, archiveTargetRel))) {
    archiveTargetRel = `${archiveRootRel}/${archName}-${Date.now().toString(36)}`;
  }
  const planned = [{ from: rel, to: archiveTargetRel }];

  // Lifecycle under confirm = planned (graded confirm). auto applies via executeArchive.
  if (mode !== "auto") {
    return {
      command: "archive-topic",
      mode,
      category,
      topic,
      reason,
      archiveTarget: archiveTargetRel,
      planned,
      applied: false,
      needsConfirm: true,
      pending: true,
    };
  }

  const ev = executeArchive({
    targetPath: topicDir,
    workspaceRoot: ctxObj.userWorkspaceRoot,
    contract,
    actor: "user",
    confirmed: true,
    reason,
    command: "archive-topic",
    role: "deep-work",
  });
  if (ev.pending || ev.needsConfirm) {
    return {
      command: "archive-topic",
      mode,
      category,
      topic,
      reason,
      archiveTarget: archiveTargetRel,
      planned,
      applied: false,
      needsConfirm: true,
      pending: true,
    };
  }

  return {
    command: "archive-topic",
    mode,
    category,
    topic,
    reason,
    archiveTarget: ev.backupPath || ev.backup_path || archiveTargetRel,
    planned,
    applied: true,
    protection: ev.protection,
    writebackMode: ev.writebackMode,
    receiptPath: ev.archiveReceiptPath || ev.archive_receipt_path || null,
    affected_files: ev.affectedFiles || ev.affected_files || [],
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

// ── restore-safety-receipt ────────────────────────────────────────────────

function restoreStamp() {
  return new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
}

/**
 * Non-overwrite destination: if `destAbs` exists, append `-restored-{stamp}` before extension.
 * @param {string} destAbs
 * @param {string} stamp
 */
function nonOverwriteDest(destAbs, stamp) {
  if (!existsSync(destAbs)) return destAbs;
  const ext = path.extname(destAbs);
  const base = ext ? destAbs.slice(0, -ext.length) : destAbs;
  return `${base}-restored-${stamp}${ext || ""}`;
}

function parseArchiveRelRoot(relNorm) {
  const norm = String(relNorm || "").replace(/\\/gu, "/");
  for (const root of ["99-归档", "99 归档", "99-Archive", "99 Archive", "99-Archive", "archive"]) {
    if (norm === root) return root;
    if (norm.startsWith(`${root}/`)) return root;
  }
  return null;
}

async function restoreSafetyReceipt({ receiptPath, reason, mode }, ctxObj) {
  if (!receiptPath) throw new Error(t("error.receiptPathRequired"));
  const relNorm = String(receiptPath).replace(/\\/gu, "/");
  const absSource = path.join(ctxObj.userWorkspaceRoot, relNorm);
  if (!existsSync(absSource)) throw new Error(t("error.receiptPathNotFound", { path: receiptPath }));

  const stat = await fs.stat(absSource);
  const isFile = stat.isFile();
  const isDirectory = stat.isDirectory();
  const classified = classifyRestoreTarget(relNorm, { isDirectory });
  const restorePlan = [];
  const stamp = restoreStamp();

  if (classified.kind === "archived-topic" || classified.isDirectory) {
    // Prefer archive-receipt.json labels over dirname parse (year-prefixed
    // topics glue onto the category under greedy split).
    const landingDirRel = (() => {
      const archRoot = parseArchiveRelRoot(relNorm);
      const rest = archRoot ? relNorm.slice(archRoot.length + 1) : relNorm;
      return rest.split("/")[0] || path.basename(classified.destRel);
    })();
    const landingAbs = path.join(ctxObj.userWorkspaceRoot, parseArchiveRelRoot(relNorm) || ".", landingDirRel);
    let receiptJsonText = null;
    try {
      receiptJsonText = await fs.readFile(path.join(landingAbs, "archive-receipt.json"), "utf8");
    } catch {
      receiptJsonText = null;
    }
    const labels = resolveArchivedTopicRestoreLabels({
      landingDirName: landingDirRel,
      receiptJsonText,
    });
    const idealRel = labels.destRel
      ? `${labels.destRel}-restored-${stamp}`
      : `${path.basename(classified.destRel)}-restored-${stamp}`;
    const destAbs = path.join(ctxObj.userWorkspaceRoot, idealRel);
    restorePlan.push({
      from: relNorm,
      to: idealRel.split(path.sep).join("/"),
      kind: "directory",
      category: labels.category || undefined,
      topic: labels.topic || undefined,
    });
    if (mode === "auto") {
      await ensureDir(path.dirname(destAbs));
      if (isDirectory) {
        await copyDir(absSource, destAbs);
      } else {
        // File nested under archived-topic: restore beside the landing labels.
        const fileDest = nonOverwriteDest(
          path.join(ctxObj.userWorkspaceRoot, stripBackupStampName(path.basename(relNorm))),
          stamp,
        );
        await fs.copyFile(absSource, fileDest);
        restorePlan[0].to = path.relative(ctxObj.userWorkspaceRoot, fileDest).split(path.sep).join("/");
        restorePlan[0].kind = "file";
      }
    }
  } else {
    const destAbsIdeal = path.join(ctxObj.userWorkspaceRoot, classified.destRel);
    const destAbs = mode === "auto" ? nonOverwriteDest(destAbsIdeal, stamp) : destAbsIdeal;
    restorePlan.push({
      from: relNorm,
      to: path.relative(ctxObj.userWorkspaceRoot, destAbsIdeal).split(path.sep).join("/"),
      kind: classified.kind,
    });
    if (mode === "auto") {
      await ensureDir(path.dirname(destAbs));
      await fs.copyFile(absSource, destAbs);
      restorePlan[0].to = path.relative(ctxObj.userWorkspaceRoot, destAbs).split(path.sep).join("/");
      restorePlan[0].appliedPath = restorePlan[0].to;
    }
  }

  // Restore is a create at a non-overwrite destination — evidence only,
  // no extra 99-归档/receipts YAML.
  const restoreReceiptPath = null;

  return {
    command: "restore-safety-receipt",
    mode,
    receiptPath: relNorm,
    reason,
    restorePlan,
    applied: mode === "auto",
    restoreReceiptPath,
    isFile,
  };
}

// ── archive-stream-year ──────────────────────────────────────────────────

async function archiveStreamYear({ year, mode }, ctxObj) {
  const yearStr = String(year || "").trim();
  if (!/^\d{4}$/u.test(yearStr)) {
    throw new Error(`Invalid year format: ${yearStr}`);
  }

  // Preview mode: return plan without executing
  if (mode !== "auto") {
    const years = await kernelListStreamYears({
      workspaceRoot: ctxObj.userWorkspaceRoot,
      engineRoot: ctxObj.engineRoot,
    });
    const yearInfo = years.find((y) => y.year === yearStr);
    let archiveDir = "99-归档";
    let streamDir = "10-动态";
    try {
      const model = resolveWorkspaceModel({
        workspaceRoot: ctxObj.userWorkspaceRoot,
        engineRoot: ctxObj.engineRoot,
      });
      archiveDir = findCategoryByRole(model, "system")?.directory || archiveDir;
      streamDir = findStreamCategory(model)?.directory || streamDir;
    } catch {
      /* keep defaults */
    }
    return {
      command: "archive-stream-year",
      mode,
      year: yearStr,
      periodCount: yearInfo?.periodCount || 0,
      archived: yearInfo?.archived || false,
      archiveTarget: `${archiveDir}/stream-archive/${yearStr}`,
      planned: yearInfo
        ? [{ from: `${streamDir}/${yearStr}`, to: `${archiveDir}/stream-archive/${yearStr}` }]
        : [],
      applied: false,
      note: yearInfo?.archived
        ? "Year already archived"
        : !yearInfo
          ? "Year directory not found"
          : "Preview only — set mode to auto to execute",
    };
  }

  // Auto mode: delegate to Kernel archiveStreamYear
  const result = await kernelArchiveStreamYear({
    workspaceRoot: ctxObj.userWorkspaceRoot,
    engineRoot: ctxObj.engineRoot,
    year: yearStr,
  });

  return {
    command: "archive-stream-year",
    mode,
    year: yearStr,
    ok: result.ok,
    archived: result.archived,
    movedCount: result.movedCount,
    archivePath: result.archivePath || ``,
    receiptPath: result.receiptPath || null,
    reason: result.reason || null,
    applied: result.ok && result.archived,
  };
}

// ── cleanup-empty-dirs ────────────────────────────────────────────────────

async function cleanupEmptyDirs({ mode }, ctxObj) {
  const emptyDirs = [];

  const categories = discoverCategories(
    ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot,
    ctxObj.engineRoot,
  );

  // Protected roots: category roots, inbox root, archive root, and workspace root
  // must NEVER be flagged as empty directories or removed, even when vacant.
  const protectedRoots = new Set([
    path.resolve(ctxObj.userWorkspaceRoot),
    path.resolve(ctxObj.inboxRootPath),
    path.resolve(ctxObj.archiveRootPath),
    ...categories.map((c) => path.resolve(ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot, c)),
  ]);

  async function scanDir(currentDir) {
    if (!await isDirectory(currentDir)) return false;
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }
    const visible = entries.filter((e) => !e.name.startsWith("."));
    if (visible.length === 0) {
      const abs = path.resolve(currentDir);
      if (!protectedRoots.has(abs)) {
        emptyDirs.push(path.relative(ctxObj.userWorkspaceRoot, currentDir).split(path.sep).join("/"));
        return true;
      }
      return false;
    }

    let allChildrenEmpty = true;
    let hasDirectFiles = false;

    for (const entry of visible) {
      const childPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const childEmpty = await scanDir(childPath);
        if (!childEmpty) {
          allChildrenEmpty = false;
        }
      } else {
        hasDirectFiles = true;
        allChildrenEmpty = false;
      }
    }

    if (!hasDirectFiles && allChildrenEmpty) {
      const abs = path.resolve(currentDir);
      if (!protectedRoots.has(abs)) {
        emptyDirs.push(path.relative(ctxObj.userWorkspaceRoot, currentDir).split(path.sep).join("/"));
        return true;
      }
    }
    return false;
  }

  for (const category of categories) {
    const categoryDir = path.join(ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot, category);
    await scanDir(categoryDir);
  }
  await scanDir(ctxObj.inboxRootPath);
  await scanDir(ctxObj.archiveRootPath);

  const removed = [];
  if (mode === "auto") {
    for (const relativeDir of emptyDirs) {
      const fullPath = path.join(ctxObj.userWorkspaceRoot, relativeDir);
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
      removed.push(relativeDir);
    }
  }

  return {
    command: "cleanup-empty-dirs",
    mode,
    emptyDirs,
    removed,
    applied: mode === "auto",
    found: emptyDirs.length,
  };
}

// ── dispatcher ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const roots = validateRequiredRoots(args);
  const ctxObj = buildCliContext(roots);
  const mode = resolveMode(args);

  let data;
  switch (args.command) {
    case "doctor-workspace":
      data = await doctorWorkspace(ctxObj);
      break;
    case "archive-topic":
      data = await archiveTopic({ category: args.category, topic: args.topic, reason: args.reason, mode }, ctxObj);
      break;
    case "restore-safety-receipt":
      data = await restoreSafetyReceipt({ receiptPath: args.receiptPath, reason: args.reason, mode }, ctxObj);
      break;
    case "archive-stream-year":
      data = await archiveStreamYear({ year: args.year, mode }, ctxObj);
      break;
    case "cleanup-empty-dirs":
      data = await cleanupEmptyDirs({ mode }, ctxObj);
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