/**
 * Ops journal — lightweight browsable trail of writeback actions.
 *
 * NOT a second writeback/receipt system:
 * - receipts stay high-impact YAML under the workspace system dir
 * - this journal is a size-capped JSONL under desktopStateHome/logs/
 * - clearing it never touches workspace recovery artifacts
 */
import { promises as fs, appendFileSync, mkdirSync, statSync, unlinkSync, renameSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_KEEP = 2;

let journalPath = null;
let journalSize = 0;

function resolveOpsMaxBytes() {
  const n = Number(process.env.topmind_OPS_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function resolveOpsKeep() {
  const n = Number(process.env.topmind_OPS_KEEP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_KEEP;
}

function rotateJournal(filePath, keep) {
  try { unlinkSync(`${filePath}.${keep}`); } catch { /* absent */ }
  for (let i = keep - 1; i >= 1; i--) {
    try { renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`); } catch { /* absent */ }
  }
  try { renameSync(filePath, `${filePath}.1`); } catch { /* keep appending */ }
}

/**
 * Point the journal at `{desktopStateHome}/logs/ops.jsonl`.
 * @param {string} filePath
 */
export function attachOpsJournal(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    journalPath = filePath;
    let st = null;
    try { st = statSync(filePath); } catch { /* fresh */ }
    journalSize = st?.isFile() ? st.size : 0;
    return journalPath;
  } catch {
    journalPath = null;
    journalSize = 0;
    return null;
  }
}

export function getOpsJournalPath() {
  return journalPath;
}

/**
 * Append one op record. Never throws.
 * @param {{
 *   actor?: string,
 *   op: string,
 *   ok?: boolean,
 *   rel?: string,
 *   backup?: string|null,
 *   receipt?: string|null,
 *   reason?: string,
 *   extra?: object,
 * }} entry
 */
export function appendOpsEntry(entry) {
  if (!journalPath) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    actor: entry.actor || "user",
    op: String(entry.op || "unknown"),
    ok: entry.ok !== false,
    rel: entry.rel || null,
    backup: entry.backup || null,
    receipt: entry.receipt || null,
    reason: entry.reason || null,
    ...(entry.extra && typeof entry.extra === "object" ? entry.extra : null),
  }) + "\n";
  try {
    const buf = Buffer.from(line, "utf8");
    if (journalSize + buf.length > resolveOpsMaxBytes()) {
      rotateJournal(journalPath, resolveOpsKeep());
      journalSize = 0;
    }
    appendFileSync(journalPath, buf);
    journalSize += buf.length;
  } catch {
    /* never throw from journal */
  }
}

/**
 * Record a writeback evidence object (Desktop camelCase or Kernel dual shape).
 * @param {object} evidence
 * @param {{ actor?: string, workspaceRoot?: string }} [opts]
 */
export function recordWritebackEvidence(evidence, opts = {}) {
  if (!evidence || typeof evidence !== "object") return;
  const rel = evidence.targetPath || evidence.target_path || null;
  let shown = rel;
  if (rel && opts.workspaceRoot && path.isAbsolute(rel)) {
    try {
      shown = path.relative(opts.workspaceRoot, rel).replace(/\\/g, "/");
    } catch { /* keep abs */ }
  } else if (typeof rel === "string") {
    shown = rel.replace(/\\/g, "/");
  }
  appendOpsEntry({
    actor: opts.actor || evidence.actor || "user",
    op: evidence.operation || "update",
    ok: evidence.ok !== false && !evidence.needsConfirm && !evidence.pending,
    rel: shown,
    backup: evidence.backupPath || evidence.backup_path || null,
    receipt: evidence.receiptPath || evidence.receipt_path || null,
    reason: evidence.reason,
    extra: {
      wrote: evidence.wroteFiles !== false && evidence.wrote_files !== false,
      mode: evidence.writebackMode || evidence.writeback_mode || "auto",
      protection: evidence.protection,
    },
  });
}

/**
 * Read recent journal lines (newest last), newest-first optional.
 * @param {{ limit?: number, actor?: string, op?: string, hasBackup?: boolean, contains?: string, includeRotated?: boolean }} p
 */
export async function readOpsJournal(p = {}) {
  const limit = Math.max(1, Math.min(Number(p.limit) || 200, 2000));
  const files = [];
  if (!journalPath) return { entries: [], path: null, total: 0 };
  try {
    const dir = path.dirname(journalPath);
    const base = path.basename(journalPath);
    const names = await fs.readdir(dir);
    const current = names.filter((n) => n === base || /^ops\.jsonl\.\d+$/u.test(n));
    // current first, then rotated oldest → newest so reading chronologically works
    current.sort((a, b) => {
      if (a === base) return 1;
      if (b === base) return -1;
      return Number(b.split(".").pop()) - Number(a.split(".").pop());
    });
    for (const n of current) {
      if (!p.includeRotated && n !== base) continue;
      files.push(path.join(dir, n));
    }
  } catch {
    return { entries: [], path: journalPath, total: 0 };
  }

  const entries = [];
  for (const file of files) {
    let text = "";
    try { text = await fs.readFile(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (p.actor && obj.actor !== p.actor) continue;
      if (p.op && obj.op !== p.op) continue;
      if (p.hasBackup === true && !obj.backup) continue;
      if (p.hasBackup === false && obj.backup) continue;
      if (p.contains) {
        const hay = `${obj.rel || ""} ${obj.op || ""} ${obj.reason || ""}`.toLowerCase();
        if (!hay.includes(String(p.contains).toLowerCase())) continue;
      }
      entries.push(obj);
    }
  }
  const total = entries.length;
  return {
    path: journalPath,
    total,
    entries: entries.slice(-limit),
  };
}

/** Truncate current journal (keeps path). Rotated archives untouched. */
export async function clearOpsJournal() {
  if (!journalPath) return { ok: false, reason: "not-attached" };
  try {
    await fs.writeFile(journalPath, "", "utf8");
    journalSize = 0;
    return { ok: true, path: journalPath };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}
