import { promises as fs, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { archiveRoot, resolveDataRoot } from "./path-model.mjs";
import { assertPathWithin } from "./path-safety.mjs";
import { t } from "./electron-i18n.mjs";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LOG_LEVELS[process.env.topmind_LOG_LEVEL] ?? LOG_LEVELS.info;

/** Optional file sink — packaged Windows GUI apps have no visible stderr. */
let logFilePath = null;

/**
 * Enable append-only JSONL file logging (idempotent).
 * Call once early from main after desktop state home is known.
 * @param {string} filePath absolute path e.g. …/topmind/topmind-desktop/logs/main.log
 */
export function attachFileLogger(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    logFilePath = filePath;
    return logFilePath;
  } catch {
    logFilePath = null;
    return null;
  }
}

export function getLogFilePath() {
  return logFilePath;
}

function log(level, category, message, meta = {}) {
  if ((LOG_LEVELS[level] ?? 1) < minLevel) return;
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      cat: category,
      msg: message,
      ...meta,
    }) + "\n";
  try {
    process.stderr.write(line);
  } catch {
    /* ignore broken pipe */
  }
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line, "utf8");
    } catch {
      /* disk full / permission — never throw from logger */
    }
  }
}

export function logInfo(cat, msg, meta) { log("info", cat, msg, meta); }
export function logWarn(cat, msg, meta) { log("warn", cat, msg, meta); }
export function logError(cat, msg, meta) { log("error", cat, msg, meta); }

/**
 * Short, human-readable timestamp for backup filenames and conflict resolution.
 * Format: MMDD-HHMM (e.g. 0806-1430 for Aug 6, 14:30)
 * Shorter than ISO, sortable within a day, and friendly in filenames.
 */
export function timestampStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Workspace-relative path under the real archive dir name (e.g. 99-Archive/backups/...). */
function archiveRelative(workspaceContext, ...parts) {
  const archName = path.basename(archiveRoot(workspaceContext));
  return path.join(archName, ...parts).replace(/\\/gu, "/");
}

function dataRootOf(workspaceContext) {
  return resolveDataRoot(workspaceContext);
}

// ── Backup Chain ─────────────────────────────────────────────────────────────
// These Desktop-side backup helpers are a **supplement** to the Kernel's
// writeback-engine (`lib/writeback-engine.mjs`), not a replacement.
//
// Relationship to Kernel writeback-engine:
// - Kernel `executeWrite` handles its own high-impact backup (locked file
//   overwrite → backup + receipt, rotated by BACKUP_KEEP=3).
// - Kernel `executeDelete` / `executeArchive` handle trash/archive copies.
// - These Desktop helpers (`writeArchiveBackup` / `writePathCheckpoint`)
//   are for rare non-content checkpoints (locked binary overwrite).
//   Connectors, restore, and ordinary content writes MUST NOT call them.
// - All content-plane markdown writes MUST go through `kernelDurableWrite`
//   → Kernel `executeWrite` — never these helpers.
// - Backup filenames use `MMDD-HHMM__name` format; Kernel uses ISO timestamp
//   format. Both land in `99-归档/backups/` but with different naming so they
//   don't collide.

export async function writeArchiveBackup(workspaceContext, { savedAt, content, pathParts }) {
  if (content === null || content === undefined) return undefined;
  const stamp = timestampStamp(new Date(savedAt));
  const resolvedParts = typeof pathParts === "function" ? pathParts(stamp) : pathParts;
  if (!Array.isArray(resolvedParts) || resolvedParts.length === 0) {
    throw new Error("Missing backup path parts.");
  }
  const backupPath = path.join(archiveRoot(workspaceContext), "backups", ...resolvedParts);
  await assertPathWithin(dataRootOf(workspaceContext), backupPath, { allowMissing: true });
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, content, "utf8");
  return archiveRelative(workspaceContext, "backups", ...resolvedParts);
}

/**
 * Generic rotating checkpoint keyed by any workspace-relative file path.
 * Backups land in `{99-Archive|99 Archive}/backups/<parent dirs>/<stamp>__<name>`.
 */
export async function writePathCheckpoint(workspaceContext, { savedAt, content, relativePath, keep = 5 }) {
  if (content === null || content === undefined) return undefined;
  if (!relativePath) throw new Error("writePathCheckpoint requires relativePath.");
  const segments = relativePath.split("/");
  const baseName = segments.pop();
  const dirParts = segments;
  const stamp = timestampStamp(new Date(savedAt));
  const baseDir = path.join(archiveRoot(workspaceContext), "backups", ...dirParts);
  const safeRelative = baseName.replace(/[\\/]/gu, "__");
  await assertPathWithin(dataRootOf(workspaceContext), baseDir, { allowMissing: true });
  await fs.mkdir(baseDir, { recursive: true });

  const fileName = `${stamp}__${safeRelative}`;
  const filePath = path.join(baseDir, fileName);
  await assertPathWithin(dataRootOf(workspaceContext), filePath, { allowMissing: true });
  await fs.writeFile(filePath, content, "utf8");
  const backupRelativePath = archiveRelative(workspaceContext, "backups", ...dirParts, fileName);

  if (keep > 0) {
    const entries = await fs.readdir(baseDir)
      .then((names) => names.filter((n) => n.endsWith(`__${safeRelative}`)))
      .catch(() => []);
    if (entries.length > keep) {
      entries.sort();
      for (const stale of entries.slice(0, entries.length - keep)) {
        await fs.unlink(path.join(baseDir, stale)).catch(() => undefined);
      }
    }
  }
  return backupRelativePath;
}

// ── Writeback Evidence ───────────────────────────────────────────────────────

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const item of paths) {
    const v = String(item || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    result.push(v);
  }
  return result;
}

export function buildWritebackEvidence({
  operation, targetPath, savedAt, backupPath, receiptPath, revisionPath,
  writebackMode = "auto", affectedFiles, wroteFiles = true, nextActions,
}) {
  const resolvedReceipt = receiptPath || backupPath;
  const resolvedRevision = revisionPath || backupPath;
  const resolvedAffected = uniquePaths([...(affectedFiles ?? [targetPath]), backupPath, resolvedReceipt, resolvedRevision]);

  const defaultActions = wroteFiles
    ? [t("writeback.viewTarget", { path: targetPath }), ...(resolvedReceipt ? [t("writeback.restoreIfNeeded", { path: resolvedReceipt })] : [])]
    : [t("writeback.viewPreview")];

  return {
    operation,
    writebackMode: ["confirm"].includes(writebackMode) ? writebackMode : "auto",
    targetPath,
    affectedFiles: resolvedAffected,
    wroteFiles,
    backupPath,
    receiptPath: resolvedReceipt,
    revisionPath: resolvedRevision,
    savedAt,
    nextActions: Array.isArray(nextActions) && nextActions.length > 0 ? nextActions.map(String) : defaultActions,
  };
}
