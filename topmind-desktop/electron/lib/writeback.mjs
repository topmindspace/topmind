import { promises as fs, appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { archiveRoot, resolveDataRoot } from "./path-model.mjs";
import { assertPathWithin } from "./path-safety.mjs";
import { t } from "./electron-i18n.mjs";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LOG_LEVELS[process.env.topmind_LOG_LEVEL] ?? LOG_LEVELS.info;

/** Optional file sink — packaged Windows GUI apps have no visible stderr. */
let logFilePath = null;

/** Current byte size of the file sink (tracked so rotation needs no per-line stat). */
let logFileSize = 0;

/**
 * Soft size cap per log file before rotation (default 2 MB).
 * Env override read at call time (same rationale as Kernel BACKUP_KEEP).
 */
function resolveLogMaxBytes() {
  const n = Number(process.env.topmind_LOG_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
}

/**
 * Archived files retained after rotation (`main.log.1` … `main.log.{keep}`,
 * default 3 → worst case on disk ≈ (keep + 1) × cap).
 */
function resolveLogKeep() {
  const n = Number(process.env.topmind_LOG_KEEP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/**
 * Shift `main.log.{i}` → `main.log.{i+1}` (dropping the oldest slot), then
 * `main.log` → `main.log.1`. Every step is best-effort: a locked/stale rotated
 * file must never break logging.
 */
function rotateLogFile(filePath, keep) {
  try { unlinkSync(`${filePath}.${keep}`); } catch { /* slot absent */ }
  for (let i = keep - 1; i >= 1; i--) {
    try { renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`); } catch { /* slot absent */ }
  }
  try { renameSync(filePath, `${filePath}.1`); } catch { /* keep appending to current */ }
}

/**
 * Enable append-only JSONL file logging with size-capped rotation (idempotent).
 * Call once early from main after desktop state home is known.
 * @param {string} filePath absolute path e.g. …/topmind/topmind-desktop/logs/main.log
 */
export function attachFileLogger(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    logFilePath = filePath;
    let st = null;
    try { st = statSync(filePath); } catch { /* fresh file */ }
    // Existing oversized log (e.g., upgraded from unbounded version) rotates
    // on the first appended line — no special-case startup cleanup needed.
    logFileSize = st?.isFile() ? st.size : 0;
    return logFilePath;
  } catch {
    logFilePath = null;
    logFileSize = 0;
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
      const buf = Buffer.from(line, "utf8");
      if (logFileSize + buf.length > resolveLogMaxBytes()) {
        rotateLogFile(logFilePath, resolveLogKeep());
        logFileSize = 0;
      }
      appendFileSync(logFilePath, buf);
      logFileSize += buf.length;
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

/**
 * Kernel-identical ISO stamp for backup filenames (`20260816T142030123Z`).
 * Kernel's pruneOldBackups sorts backup names lexicographically — Desktop
 * checkpoints must use the same format or rotation misjudges which copies
 * are oldest and prunes the wrong ones.
 */
export function backupStamp(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, "");
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
// This Desktop-side checkpoint helper is a **supplement** to the Kernel's
// writeback-engine (`lib/writeback-engine.mjs`), not a replacement.
//
// Relationship to Kernel writeback-engine:
// - Kernel `executeWrite` handles its own high-impact backup (locked file
//   overwrite → backup + receipt, rotated by BACKUP_KEEP=3).
// - Kernel `executeDelete` / `executeArchive` handle trash/archive copies.
// - This Desktop helper (`writePathCheckpoint`) is for rare non-content
//   checkpoints (locked binary overwrite). Connectors, restore, and ordinary
//   content writes MUST NOT call it.
// - All content-plane markdown writes MUST go through `kernelDurableWrite`
//   → Kernel `executeWrite` — never this helper.
// - Backup filenames use the Kernel ISO stamp (`backupStamp`) so Kernel's
//   lexicographic keep-N rotation in `99-归档/backups/` judges Desktop
//   checkpoints and Kernel backups on the same sortable axis.

/**
 * Generic rotating checkpoint keyed by any workspace-relative file path.
 * Backups land in `{99-Archive|99 Archive}/backups/<parent dirs>/<stamp>__<name>`.
 * `content` may be a string (utf8) or a Buffer (binary checkpoint, stored
 * as-is so the backup stays directly restorable).
 */
export async function writePathCheckpoint(workspaceContext, { savedAt, content, relativePath, keep = 5 }) {
  if (content === null || content === undefined) return undefined;
  if (!relativePath) throw new Error("writePathCheckpoint requires relativePath.");
  const segments = relativePath.split("/");
  const baseName = segments.pop();
  const dirParts = segments;
  const stamp = backupStamp(new Date(savedAt));
  const baseDir = path.join(archiveRoot(workspaceContext), "backups", ...dirParts);
  const safeRelative = baseName.replace(/[\\/]/gu, "__");
  await assertPathWithin(dataRootOf(workspaceContext), baseDir, { allowMissing: true });
  await fs.mkdir(baseDir, { recursive: true });

  const fileName = `${stamp}__${safeRelative}`;
  const filePath = path.join(baseDir, fileName);
  await assertPathWithin(dataRootOf(workspaceContext), filePath, { allowMissing: true });
  await fs.writeFile(filePath, content);
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
