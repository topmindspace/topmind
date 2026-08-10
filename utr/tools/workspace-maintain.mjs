#!/usr/bin/env node
/**
 * Write-path exemption（对齐核实 2026-08，豁免理由）：
 * - archive-topic 不用 kernel executeArchive：kernel 落点为
 *   `{backup_to}/archived-topics/{stamp}__{relpath}`，会破坏 archived-topic 契约
 *   `{archive}/{category}-{topic}-{stamp}`（utr/core/safety-receipt-paths.mjs 的
 *   list/restore-safety-receipt 依赖该形状做分类与恢复）。
 * - restore-safety-receipt 不用 kernel executeWrite：恢复的是混合文件/目录树
 *   （含二进制），kernel 无 executeRestore，executeWrite 仅面向 .md 文本写。
 * 两命令仍经 kernel 写闸做 protection 求值（evaluateWritePermission + peekFrontmatter），
 * 并按 TOOLS.md §Write Evidence Format 写标准 YAML receipt 到
 * `{writeback.receipts || 99-归档/receipts}/`。
 */
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

import {
  evaluateWritePermission,
  peekFrontmatter,
  loadContract,
  archiveStreamYear as kernelArchiveStreamYear,
  listStreamYears as kernelListStreamYears,
} from "../../lib/kernel-api.mjs";
import { buildReceipt } from "../../lib/yaml-writer.mjs";
import {
  categoryRoot,
  topicRoot,
  isValidCategoryName,
  discoverCategories,
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs, resolveMode } from "../core/cli-args.mjs";
import { receiptId } from "../core/receipt.mjs";
import { ensureDir, isDirectory } from "../core/topic-files.mjs";
import { auditWorkspace } from "../core/workspace-audit.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import {
  classifyRestoreTarget,
  stripBackupStampName,
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

/** Write standard YAML receipt per TOOLS.md §Write Evidence Format. Returns relative path. */
async function writeStandardReceipt(ctxObj, contract, evidence) {
  const receiptsTo = contract?.writeback?.receipts || "99-归档/receipts";
  const receiptsDir = path.join(ctxObj.userWorkspaceRoot, receiptsTo);
  await ensureDir(receiptsDir);
  const receiptAbs = path.join(receiptsDir, `${receiptId("receipt")}.yaml`);
  const content = buildReceipt({ ...evidence, receipt_path: relPath(ctxObj, receiptAbs) });
  await fs.writeFile(receiptAbs, content, "utf8");
  return relPath(ctxObj, receiptAbs);
}

// ── archive-topic ──────────────────────────────────────────────────────────

async function archiveTopic({ category, topic, reason, mode }, ctxObj) {
  if (!isValidCategoryName(category)) throw new Error(t("error.invalidCategory", { category }));
  if (!/^[\p{L}\p{N}._\- \u4e00-\u9fff]+$/u.test(topic)) throw new Error(t("error.invalidTopicName", { topic }));
  const topicDir = topicRoot(ctxObj, category, topic);
  if (!await isDirectory(topicDir)) throw new Error(t("error.topicNotFound", { category, topic }));

  // Kernel write-gate: protection evaluation (locked topic.md denies non-user actors)
  const contract = loadContract(ctxObj.userWorkspaceRoot);
  const guardPath = await resolveDirGuardSource(topicDir);
  const frontmatter = guardPath ? peekFrontmatter(await fs.readFile(guardPath, "utf8")) : {};
  const permission = evaluateWritePermission({
    contract,
    targetPath: guardPath || topicDir,
    workspaceRoot: ctxObj.userWorkspaceRoot,
    role: "deep-work",
    frontmatter,
    actor: "user",
  });
  if (!permission.allowed) throw new Error(`Write denied: ${permission.reason}`);

  const stamp = new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
  // v3.4: archived-topic lives at 99 Archive/{category}-{topic}-{stamp}/ (matches inferTopicFromReceipt)
  const archiveTarget = path.join(ctxObj.archiveRootPath, `${category}-${topic}-${stamp}`);
  const planned = [{ from: relPath(ctxObj, topicDir), to: relPath(ctxObj, archiveTarget) }];

  let receiptPath = null;
  if (mode === "auto") {
    await ensureDir(path.dirname(archiveTarget));
    await ensureDir(archiveTarget);
    await copyDir(topicDir, archiveTarget);

    // remove original
    await fs.rm(topicDir, { recursive: true, force: true });

    // write archive-receipt
    await fs.writeFile(
      path.join(archiveTarget, "archive-receipt.json"),
      JSON.stringify({ command: "archive-topic", category, topic, reason, archivedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );

    // standard YAML receipt per TOOLS.md §Write Evidence Format
    receiptPath = await writeStandardReceipt(ctxObj, contract, {
      operation: "archive",
      writeback_mode: permission.writebackMode,
      target_path: relPath(ctxObj, topicDir),
      affected_files: [relPath(ctxObj, topicDir), relPath(ctxObj, archiveTarget)],
      wrote_files: true,
      protection: permission.protection,
      saved_at: new Date().toISOString(),
    });
  }

  return {
    command: "archive-topic",
    mode,
    category,
    topic,
    reason,
    archiveTarget: relPath(ctxObj, archiveTarget),
    planned,
    applied: mode === "auto",
    protection: permission.protection,
    writebackMode: permission.writebackMode,
    receiptPath,
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
    const destName = `${path.basename(classified.destRel)}-restored-${stamp}`;
    const destAbs = path.join(ctxObj.userWorkspaceRoot, destName);
    restorePlan.push({
      from: relNorm,
      to: path.relative(ctxObj.userWorkspaceRoot, destAbs).split(path.sep).join("/"),
      kind: "directory",
    });
    if (mode === "auto") {
      await ensureDir(path.dirname(destAbs));
      if (isDirectory) {
        await copyDir(absSource, destAbs);
      } else {
        // File nested under archived-topic: park next to a restored dir name is wrong —
        // copy as a single restored file at workspace root with stamped name.
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

  // write standard YAML receipt per TOOLS.md §Write Evidence Format
  let restoreReceiptPath = null;
  if (mode === "auto") {
    const contract = loadContract(ctxObj.userWorkspaceRoot);
    const appliedTargets = restorePlan.map((entry) => entry.to).filter(Boolean);
    restoreReceiptPath = await writeStandardReceipt(ctxObj, contract, {
      operation: "restore",
      writeback_mode: "auto",
      target_path: appliedTargets[0] || relNorm,
      affected_files: [relNorm, ...appliedTargets],
      wrote_files: true,
      protection: "open",
      saved_at: new Date().toISOString(),
    });
  }

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
    return {
      command: "archive-stream-year",
      mode,
      year: yearStr,
      periodCount: yearInfo?.periodCount || 0,
      archived: yearInfo?.archived || false,
      archiveTarget: `99-归档/stream-archive/${yearStr}`,
      planned: yearInfo
        ? [{ from: `10-动态/${yearStr}`, to: `99-归档/stream-archive/${yearStr}` }]
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

  async function scan(root) {
    if (!await isDirectory(root)) return;
    const entries = await fs.readdir(root, { withFileTypes: true });
    let hasContent = false;
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const subEmpty = await scan(entryPath);
        if (!subEmpty) hasContent = true;
      } else {
        hasContent = true;
      }
    }
    if (!hasContent && entries.length > 0) {
      emptyDirs.push(path.relative(ctxObj.userWorkspaceRoot, root));
      return true;
    }
    return false;
  }

  let hasEmpty = false;
  const categories = discoverCategories(
    ctxObj.categoriesRoot || ctxObj.userWorkspaceRoot,
    ctxObj.engineRoot,
  );
  for (const category of categories) {
    const categoryDir = path.join(ctxObj.categoriesRoot, category);
    if (await scan(categoryDir)) hasEmpty = true;
  }
  if (await scan(ctxObj.inboxRootPath)) hasEmpty = true;
  if (await scan(ctxObj.archiveRootPath)) hasEmpty = true;

  const removed = [];
  if (mode === "auto") {
    for (const relativeDir of emptyDirs) {
      const fullPath = path.join(ctxObj.userWorkspaceRoot, relativeDir);
      await fs.rm(fullPath, { recursive: true, force: true });
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