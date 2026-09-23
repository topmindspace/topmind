// ── topmind Writeback Engine (Kernel 6/8) ──────────────────────────────────
// Authoritative mutation choke point: protection · confirm · backup · atomic write · receipt.
// Surfaces (Desktop / UTR) MUST route durable content writes here — no parallel policy.

import fs from "node:fs";
import path from "node:path";
import { resolveProtection, loadContract } from "./contract-engine.mjs";
import { buildReceipt } from "./yaml-writer.mjs";
import { parse as parseYaml } from "./yaml-bridge.mjs";
import {
  isPathInsideWorkspace,
  resolveArchivePlaneRel,
  resolveSystemRoot,
  isSamePathName,
  isProtectedContractFileName,
  normalizeProtectionLevel,
  isPathOnOrUnder,
  DELIVERY_SLOT_RE,
} from "./model-core.mjs";
import { isMemoryPlaneRelPath, normalizeMemoryConfig } from "./stream-period.mjs";

/**
 * Reject lifecycle moves (archive/delete) of structural planes that must
 * remain in place for the workspace to keep working.
 *
 * Hard-deny targets (name checks are case-insensitive — Topmind.yaml /
 * Memory / BACKUPS must not bypass the fence on APFS/NTFS):
 * - workspace root itself
 * - contract file `topmind.yaml` / legacy `.topmind-config.json`
 * - system/archive plane (live system-role dir, e.g. `99-归档`) — archiving
 *   it into itself is a recursive self-copy; deleting it destroys backups
 * - resolved archive plane trees (`backup_to` / `receipts`) and the known
 *   safety leaves under the system plane (`backups` / `receipts` / `trash` /
 *   `stream-archive` / `archived-topics`) — fully fenced (root + contents)
 *   so the recovery layer cannot be lifecycle-moved
 * - memory plane root (`{memory.dir}`) — semantic plane home
 *
 * Safety leaves are intentionally over-denied (contents included): cleanup
 * of stale backups is not a normal lifecycle op.
 * `archived-topics` is a **legacy** fence leaf (pre-2026-09 landing under
 * `{backup}/archived-topics/`). New directory archives land at
 * `{archive}/{category}-{topic}-{stamp}/` as the content new home and are
 * recoverable via restore-safety-receipt — the leaf stays so old safety-layer
 * trees cannot be lifecycle-moved.
 *
 * @param {{ workspaceRoot: string, targetPath: string, contract?: object }} p
 * @returns {{ allowed: boolean, reason: string }}
 */
export function evaluateLifecycleTarget({ workspaceRoot, targetPath, contract }) {
  if (!workspaceRoot || !targetPath) {
    return { allowed: false, reason: "workspaceRoot and targetPath required" };
  }
  const root = path.resolve(workspaceRoot);
  // Relative targetPath is relative to workspaceRoot, never process.cwd().
  const raw = String(targetPath);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (abs === root) {
    return { allowed: false, reason: "Cannot archive/delete the workspace root" };
  }
  if (!isPathInsideWorkspace(root, abs)) {
    return { allowed: false, reason: "Write denied: path outside workspace" };
  }
  const relativePath = path.relative(root, abs).replace(/\\/g, "/");
  const base = path.basename(relativePath);
  if (isProtectedContractFileName(base)) {
    // Contract mutations must go through writeContract / ensureContract only.
    return {
      allowed: false,
      reason: `Cannot archive/delete ${base} — use writeContract/ensureContract`,
    };
  }
  let resolved;
  try {
    resolved = contract || loadContract(root);
  } catch {
    // Unreadable contract: still apply system/memory fences via defaults.
    resolved = contract || null;
  }

  // System plane root: live system-role directory (not "first segment of backup_to").
  // A hostile/mistaken `backup_to: "00-Inbox/backups"` must not promote Inbox
  // to system plane and freeze ordinary lifecycle.
  let systemRel = null;
  try {
    const sysAbs = resolveSystemRoot(root, "system", { config: resolved || undefined });
    const rel = path.relative(root, sysAbs).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      systemRel = rel;
    }
  } catch {
    systemRel = null;
  }
  // Fallback when resolveSystemRoot cannot run: derive from backup_to top segment
  // only if it looks like a numbered system slot (99-*, not a content category).
  if (!systemRel) {
    try {
      const backupRel = String(resolveArchivePlaneRel(root, resolved, "backups")).replace(/\\/g, "/");
      const top = backupRel.split("/")[0];
      if (top && /^99[- ]/u.test(top)) systemRel = top;
    } catch {
      /* leave null */
    }
  }

  if (systemRel && isSamePathName(relativePath, systemRel)) {
    return {
      allowed: false,
      reason: "Cannot archive/delete the system archive plane (backups/receipts home)",
    };
  }

  // Resolved archive plane trees (may live under a content category — fence
  // only those trees, never the whole parent category).
  // `archived-topics` = legacy landing (see module header); keep fenced.
  const SAFETY_LEAVES = ["backups", "receipts", "trash", "stream-archive", "archived-topics"];
  try {
    for (const leaf of ["backups", "receipts"]) {
      const plane = String(resolveArchivePlaneRel(root, resolved, leaf)).replace(/\\/g, "/");
      if (plane && isPathOnOrUnder(relativePath, plane)) {
        return {
          allowed: false,
          reason: `Cannot archive/delete system safety path ${relativePath}`,
        };
      }
    }
  } catch {
    /* ignore — leaf fence below still applies under systemRel */
  }
  if (systemRel && isPathOnOrUnder(relativePath, systemRel)) {
    const leaf = relativePath.slice(systemRel.length + 1);
    if (
      SAFETY_LEAVES.some(
        (s) => isSamePathName(leaf, s) || leaf.toLowerCase().startsWith(`${s.toLowerCase()}/`),
      )
    ) {
      return {
        allowed: false,
        reason: `Cannot archive/delete system safety path ${relativePath}`,
      };
    }
  }

  const memoryDir = normalizeMemoryConfig(resolved?.memory || {}).dir || "memory";
  if (isSamePathName(relativePath, String(memoryDir).replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))) {
    return {
      allowed: false,
      reason: "Cannot archive/delete the memory plane root",
    };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Parse frontmatter from markdown head. Uses the full YAML parser first
 * (handles multi-line values, arrays, nested maps, quoted scalars), then
 * falls back to a line-based scalar scan when the YAML block is malformed.
 * Scalar values are coerced to strings so protection checks stay stable.
 *
 * @param {string} content
 * @returns {object}
 */
export function peekFrontmatter(content) {
  if (typeof content !== "string") return {};
  // Strip UTF-8 BOM so a BOM-prefixed note still parses protection: locked.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = text.slice(3, end);

  // Full YAML parse (primary path)
  try {
    const doc = parseYaml(block);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      /** @type {Record<string, unknown>} */
      const data = {};
      for (const [key, value] of Object.entries(doc)) {
        data[key] =
          value == null || typeof value === "object" ? value : String(value);
      }
      return data;
    }
  } catch {
    // Fall through to line-based scan
  }

  // Fallback: single-line `key: value` scalar scan
  /** @type {Record<string, string>} */
  const data = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[m[1]] = v;
  }
  return data;
}

/**
 * @param {object} options
 * @param {object} [options.contract]
 * @param {string} options.targetPath - absolute
 * @param {string} options.workspaceRoot
 * @param {string} [options.role]
 * @param {object} [options.frontmatter]
 * @param {"user"|"ai"} [options.actor] - default fail-closed to ai; locked is editable (snapshot, not deny)
 * @param {boolean} [options.lifecycle] - delete/archive is stricter than content edit under confirm
 * @returns {{ allowed: boolean, protection: string, reason: string, needsConfirm: boolean, writebackMode: string }}
 */
/**
 * Resolve effective writeback mode: explicit override > contract > auto.
 * Desktop app settings should pass writebackModeOverride so UI「删除/归档前问我」drives the gate.
 * @param {object} [contract]
 * @param {"auto"|"confirm"|string} [writebackModeOverride]
 */
export function resolveWritebackMode(contract, writebackModeOverride) {
  if (writebackModeOverride === "confirm" || writebackModeOverride === "auto") {
    return writebackModeOverride;
  }
  const writeback = contract?.writeback || {};
  return writeback.mode === "confirm" ? "confirm" : "auto";
}

export function evaluateWritePermission({
  contract,
  targetPath,
  workspaceRoot,
  role,
  frontmatter,
  actor = "ai",
  writebackModeOverride,
  /** Delete/archive (destructive move) — stricter than content edit. */
  lifecycle = false,
}) {
  const mode = resolveWritebackMode(contract, writebackModeOverride);
  // Hard containment: never allow writes that resolve outside workspaceRoot.
  // Relative targetPath is always relative to workspaceRoot (never process.cwd())
  // so a surface cannot smuggle a path by changing cwd.
  const rawTarget = String(targetPath || "");
  const absTarget = path.isAbsolute(rawTarget)
    ? path.resolve(rawTarget)
    : path.resolve(String(workspaceRoot || "."), rawTarget);
  if (!workspaceRoot || !isPathInsideWorkspace(workspaceRoot, absTarget)) {
    return {
      allowed: false,
      protection: "locked",
      reason: "Write denied: path outside workspace",
      needsConfirm: false,
      writebackMode: mode,
    };
  }

  const relativePath = path.relative(path.resolve(workspaceRoot), absTarget).replace(/\\/g, "/");
  // Contract file is policy truth — only writeContract/ensureContract may mutate it.
  // executeWrite must never rewrite writeback.mode / backup_to (even as "user").
  // Case-insensitive: Topmind.yaml / TOPMIND.YAML must not bypass on APFS/NTFS.
  const baseName = path.basename(relativePath);
  if (isProtectedContractFileName(baseName)) {
    return {
      allowed: false,
      protection: "locked",
      reason: `Write denied: ${baseName} must go through writeContract/ensureContract`,
      needsConfirm: false,
      writebackMode: mode,
    };
  }
  const fileProtection = normalizeProtectionLevel(frontmatter?.protection);
  const roleProtection = normalizeProtectionLevel(
    resolveProtection(contract, relativePath, role, { workspaceRoot }),
  );
  const protection =
    fileProtection === "locked" || roleProtection === "locked"
      ? "locked"
      : fileProtection || roleProtection || "open";

  // Authorization model (2026-09-17c — graded confirm):
  // - Workspace fence is absolute (above).
  // - An agent session inside the fence is authorized to write.
  // - `locked` = important content: editable with a task-scoped first-write snapshot.
  // - `confirm` is **graded**: content create/update/edit land immediately (auto);
  //   only lifecycle (delete/archive) becomes pending for review.
  // - Recoverable locked delete/archive is allowed in auto; permanent of
  //   locked/core is user-only (executeDelete/archive guards).
  const needsConfirm = mode === "confirm" && actor !== "user" && lifecycle;

  return {
    allowed: true,
    protection,
    reason: needsConfirm
      ? "Lifecycle op requires user confirmation (confirm mode)"
      : protection === "locked"
        ? lifecycle
          ? "Locked note: recoverable delete/archive allowed (trash + receipt)"
          : "Locked note: write allowed with pre-write snapshot"
        : mode === "confirm" && actor !== "user"
          ? "Content write allowed (confirm mode is graded — edits land; lifecycle pending)"
          : "Write allowed",
    needsConfirm,
    writebackMode: mode,
    preBackupRequired: protection === "locked" && !lifecycle,
  };
}

/**
 * Task-scoped backup ledger: a multi-edit agent task snapshots a locked file
 * once, not on every tool call. Process-local is enough — Desktop agent
 * sessions and one-shot UTR/Obsidian ops live in one process.
 * @type {Map<string, true>}
 */
const taskBackupLedger = new Map();

/**
 * @param {string} workspaceRoot
 * @param {string} taskId
 * @param {string} relativePath
 */
function taskBackupKey(workspaceRoot, taskId, relativePath) {
  return `${path.resolve(workspaceRoot)}\0${taskId}\0${relativePath}`;
}

/** Test helper — clear the in-process task backup ledger. */
export function resetTaskBackupLedger() {
  taskBackupLedger.clear();
}

/**
 * Whether this write should take a locked-file snapshot.
 * - No taskId: every locked overwrite snapshots (legacy / one-shot safety).
 * - With taskId: snapshot only the first time (taskId, path) is seen.
 *
 * Callers must only mark the ledger *after* the backup copy succeeds
 * (see markTaskSnapshotTaken). This function is the pure check.
 * @param {{ taskId?: string, relativePath: string, workspaceRoot: string }} p
 * @returns {boolean}
 */
export function shouldSnapshotLockedWrite({ taskId, relativePath, workspaceRoot }) {
  if (!taskId) return true;
  const key = taskBackupKey(workspaceRoot, taskId, relativePath);
  return !taskBackupLedger.has(key);
}

/**
 * Record a successful locked snapshot for (taskId, path). Must be called
 * only after copyFileSync succeeds — otherwise a failed first backup would
 * suppress every later snapshot in the same task.
 * @param {{ taskId: string, relativePath: string, workspaceRoot: string }} p
 */
export function markTaskSnapshotTaken({ taskId, relativePath, workspaceRoot }) {
  if (!taskId) return;
  taskBackupLedger.set(taskBackupKey(workspaceRoot, taskId, relativePath), true);
}

/**
 * Normalize evidence for Surfaces (camelCase + relative target when possible).
 * @param {object} evidence
 * @param {string} workspaceRoot
 */
export function toSurfaceEvidence(evidence, workspaceRoot) {
  const rel = (p) => {
    if (!p || typeof p !== "string") return p;
    if (!workspaceRoot) return p.replace(/\\/g, "/");
    if (path.isAbsolute(p)) {
      return path.relative(workspaceRoot, p).replace(/\\/g, "/");
    }
    return p.replace(/\\/g, "/");
  };
  const targetPath = rel(evidence.target_path || evidence.targetPath);
  const backupPath = rel(evidence.backup_path || evidence.backupPath);
  const receiptPath = rel(evidence.receipt_path || evidence.receiptPath);
  const affected = (evidence.affected_files || evidence.affectedFiles || [targetPath])
    .map(rel)
    .filter(Boolean);
  const wroteFiles = evidence.wrote_files ?? evidence.wroteFiles ?? false;
  const mode = evidence.writeback_mode || evidence.writebackMode || "auto";
  const defaultActions = wroteFiles
    ? [`查看 ${targetPath}`, ...(backupPath ? [`必要时从 ${backupPath} 恢复`] : [])]
    : ["查看预览结果"];

  return {
    operation: evidence.operation,
    writeback_mode: mode,
    writebackMode: mode === "confirm" ? "confirm" : "auto",
    target_path: targetPath,
    targetPath,
    affected_files: affected,
    affectedFiles: affected,
    wrote_files: wroteFiles,
    wroteFiles,
    receipt_path: receiptPath,
    receiptPath,
    backup_path: backupPath,
    backupPath,
    // revision_path is a historical alias of backupPath only (never of receipt).
    revision_path: evidence.revision_path || backupPath,
    revisionPath: evidence.revision_path || backupPath,
    archive_receipt_path: evidence.archive_receipt_path,
    archiveReceiptPath: evidence.archive_receipt_path,
    protection: evidence.protection || "open",
    saved_at: evidence.saved_at || evidence.savedAt,
    savedAt: evidence.saved_at || evidence.savedAt,
    next_actions: evidence.next_actions || evidence.nextActions || defaultActions,
    nextActions: evidence.next_actions || evidence.nextActions || defaultActions,
    needsConfirm: Boolean(evidence.needsConfirm),
    pending: Boolean(evidence.pending),
    shadow_path: evidence.shadow_path,
    note: evidence.note,
    // Full body for confirm-mode stash / accept (must not drop)
    previewContent:
      typeof evidence.previewContent === "string"
        ? evidence.previewContent
        : typeof evidence.preview_content === "string"
          ? evidence.preview_content
          : undefined,
  };
}

/**
 * Maximum number of high-impact backup copies to keep per file (rotating).
 * Older backups beyond this limit are automatically pruned.
 * Set to 0 to disable rotation (keep all — not recommended).
 * Surfaces may override via BACKUP_KEEP env (e.g. Obsidian settings).
 *
 * Read at call time, NOT module load: surfaces (Obsidian) set the env after
 * the bundle has already been imported — a module-top const would freeze the
 * pre-setting default and silently ignore user preferences.
 */
function resolveBackupKeep() {
  return Math.max(0, Number(process.env.BACKUP_KEEP) || 3);
}

/**
 * Maximum number of high-impact receipt files to retain.
 * Older receipts beyond this limit are pruned after each high-impact write.
 * Set to 0 to disable rotation (keep all — not recommended).
 * Surfaces may override via RECEIPT_KEEP env (call-time read, same reason).
 */
function resolveReceiptKeep() {
  return Math.max(0, Number(process.env.RECEIPT_KEEP) || 50);
}

/**
 * High-impact content write: overwriting an existing *locked* file warrants a
 * pre-write snapshot (backup) + YAML receipt. Open-file updates do not.
 *
 * locked means "important — keep a recoverable snapshot", not "AI cannot write".
 * Multi-edit agent tasks pass `taskId` so the snapshot is taken once per task
 * (see shouldSnapshotLockedWrite), not once per tool call.
 *
 * Delete recoverability is a separate classifier (`isRecoverableLifecycle`).
 * `executeArchive` is a destination move into 99-归档 (always keeps the
 * content unless `permanent`). Only `executeDelete` of ordinary open scratch
 * unlinks without trash.
 *
 * @param {{ fileExists: boolean, protection: string }} p
 * @returns {boolean}
 */
export function isHighImpactContentWrite({ fileExists, protection }) {
  return Boolean(fileExists && normalizeProtectionLevel(protection) === "locked");
}

/** Slot 88 is delivery regardless of localized / renamed name. */
export { DELIVERY_SLOT_RE };

/**
 * Whether `executeDelete` should leave trash + receipt, and whether
 * `executeArchive` should also write a YAML receipt (the archive *file*
 * always lands in 99-归档 as the new home).
 *
 * Durable extra recoverability (trash/receipt) is reserved for:
 * - overwrite/delete of **locked** notes/knowledge
 * - delete of **core** notes: memory plane, topic homepage (`topic.md`),
 *   topic directories (have `topic.md`), delivery (`88-交付`)
 *
 * Ordinary open stream / inbox / scratch **delete**: unlink, no trash, no receipt.
 * Ordinary **archive**: still moves the note into 99-归档 (destination, not backup).
 * `permanent` is handled by the caller (never recoverable).
 *
 * @param {{
 *   protection?: string,
 *   relativePath?: string,
 *   isDirectory?: boolean,
 *   hasTopicHome?: boolean,
 * }} p
 * @returns {boolean}
 */
export function isRecoverableLifecycle({
  protection,
  relativePath,
  isDirectory = false,
  hasTopicHome = false,
  workspaceRoot,
  memoryDir,
} = {}) {
  if (normalizeProtectionLevel(protection) === "locked") return true;
  const rel = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/u, "");
  if (!rel) return false;
  let memoryDirRel = memoryDir;
  if (!memoryDirRel && workspaceRoot) {
    try {
      memoryDirRel = normalizeMemoryConfig(loadContract(workspaceRoot)?.memory || {}).dir || "memory";
    } catch {
      memoryDirRel = "memory";
    }
  }
  if (isMemoryPlaneRelPath(rel, memoryDirRel)) return true;
  if (/(^|\/)topic\.md$/iu.test(rel)) return true;
  if (isDirectory && hasTopicHome) return true;
  if (DELIVERY_SLOT_RE.test(rel.split("/")[0] || "")) return true;
  return false;
}

/**
 * Prune older backups for a specific file path, keeping only the most recent `keep` copies.
 * @param {string} backupDir - absolute backup directory for this file's parent
 * @param {string} baseName - original file basename
 * @param {number} keep - max backups to retain
 */
function pruneOldBackups(backupDir, baseName, keep) {
  if (keep <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(backupDir);
  } catch {
    return;
  }
  // Match files ending with __<baseName> (the backup naming convention)
  const suffix = `__${baseName}`;
  const backups = entries
    .filter((n) => n.endsWith(suffix))
    .sort() // ISO timestamp prefix sorts chronologically
    .reverse(); // newest first
  if (backups.length <= keep) return;
  for (const stale of backups.slice(keep)) {
    try {
      fs.unlinkSync(path.join(backupDir, stale));
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Prune oldest receipt files when the receipts directory exceeds `keep` count.
 * Receipts are named `{timestamp}-{random}.yaml`; ISO timestamp prefix sorts
 * chronologically so oldest are pruned first.
 * @param {string} receiptsDir - absolute receipts directory
 * @param {number} keep - max receipts to retain
 */
function pruneOldReceipts(receiptsDir, keep) {
  if (keep <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(receiptsDir);
  } catch {
    return;
  }
  // Only match receipt files (timestamp-random.yaml pattern)
  const receipts = entries
    .filter((n) => /^\d+-[a-z0-9]+\.yaml$/u.test(n))
    .sort() // numeric timestamp prefix sorts chronologically
    .reverse(); // newest first
  if (receipts.length <= keep) return;
  for (const stale of receipts.slice(keep)) {
    try {
      fs.unlinkSync(path.join(receiptsDir, stale));
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Single write site for high-impact YAML receipts (write/delete/archive).
 * Paths in the YAML stay workspace-relative so receipts stay portable.
 * @param {{ workspaceRoot: string, receiptsTo: string, evidence: object }} p
 * @returns {{ receiptPath: string, relativeReceipt: string }}
 */
function writeReceiptFile({ workspaceRoot, receiptsTo, evidence }) {
  const receiptsDir = path.join(workspaceRoot, receiptsTo);
  fs.mkdirSync(receiptsDir, { recursive: true });
  const receiptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const receiptPath = path.join(receiptsDir, `${receiptId}.yaml`);
  const rel = (p) => (p ? path.relative(workspaceRoot, p).replace(/\\/g, "/") : null);
  const receiptContent = buildReceipt({
    ...evidence,
    target_path: path.isAbsolute(String(evidence.target_path || ""))
      ? rel(evidence.target_path)
      : evidence.target_path,
    affected_files: (evidence.affected_files || []).map((p) =>
      path.isAbsolute(String(p)) ? rel(p) : p,
    ),
    receipt_path: rel(receiptPath),
    backup_path: evidence.backup_path
      ? (path.isAbsolute(String(evidence.backup_path)) ? rel(evidence.backup_path) : evidence.backup_path)
      : null,
  });
  fs.writeFileSync(receiptPath, receiptContent, "utf8");
  pruneOldReceipts(receiptsDir, resolveReceiptKeep());
  return { receiptPath, relativeReceipt: rel(receiptPath) };
}

/**
 * Execute durable content write through the single gate.
 *
 * Authorization + snapshot policy (2026-09-17):
 * - Workspace fence: absolute (path outside root → deny).
 * - Agent session inside fence is authorized: open files write immediately
 *   under `auto` (evidence only — no backup, no YAML receipt).
 * - `locked` = important content, NOT an AI deny-list. AI/user may write;
 *   the first overwrite in a task takes a rotating snapshot + YAML receipt.
 *   Pass `taskId` (agent session id) so a multi-edit turn snapshots once.
 * - `confirm` mode is **graded**: content create/update/edit land immediately;
 *   only delete/archive become pending (user accept) — cautious lifecycle UX.
 * - Delete: trash + receipt only when `isRecoverableLifecycle`
 *   (locked, memory/, topic.md, topic dir, delivery). Ordinary open scratch
 *   is unlinked with evidence only. `permanent=true` never trash/receipt.
 * - Archive: always a destination move into 99-归档 (unless permanent).
 *   YAML receipt only for locked/core.
 * - Callers may force-skip with skipBackup/skipReceipt true (escape hatch).
 *
 * Receipt definition: a **recovery trail YAML** for high-impact ops only
 * (locked first snapshot, recoverable delete/archive). The always-on audit
 * trail is the ops journal / tool evidence return value — not a second YAML
 * per open-file write.
 *
 * @param {object} options
 * @param {string} options.targetPath - absolute path
 * @param {string} options.content
 * @param {object} [options.contract] - if omitted, loadContract(workspaceRoot)
 * @param {string} options.workspaceRoot
 * @param {string} [options.role]
 * @param {object} [options.frontmatter]
 * @param {string} [options.operation]
 * @param {boolean} [options.skipShadow=true]
 * @param {boolean} [options.skipBackup=false] - force no backup (escape hatch)
 * @param {boolean} [options.skipReceipt=false] - force no receipt (escape hatch)
 * @param {boolean} [options.confirmed=false] - caller already got user confirm
 * @param {"user"|"ai"} [options.actor="ai"]
 * @param {boolean} [options.previewOnly=false] - evaluate + plan only, no disk write
 * @param {string} [options.taskId] - agent/task id for once-per-task locked snapshot
 * @returns {object} surface evidence
 */
export function executeWrite({
  targetPath,
  content,
  contract,
  workspaceRoot,
  role,
  frontmatter,
  operation = "update",
  skipShadow = true,
  skipBackup = false,
  skipReceipt = false,
  confirmed = false,
  actor = "ai",
  previewOnly = false,
  writebackModeOverride,
  taskId,
}) {
  if (!workspaceRoot) throw new Error("executeWrite requires workspaceRoot");
  if (!targetPath) throw new Error("executeWrite requires targetPath");
  if (typeof content !== "string") throw new Error("executeWrite requires string content");

  const resolvedContract = contract || loadContract(workspaceRoot);
  const fileExists = fs.existsSync(targetPath);
  // Existing on-disk protection wins for gate + high-impact backup: a rewrite
  // that drops `protection: locked` from frontmatter must still treat the
  // overwrite as high-impact.
  let existingProtection = null;
  if (fileExists) {
    try {
      const existingFm = peekFrontmatter(fs.readFileSync(targetPath, "utf8"));
      if (normalizeProtectionLevel(existingFm?.protection) === "locked") existingProtection = "locked";
    } catch {
      /* unreadable existing — proceed with new content FM */
    }
  }
  const fm = frontmatter || peekFrontmatter(content);
  const effectiveFm =
    existingProtection === "locked"
      ? { ...fm, protection: "locked" }
      : fm;
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath,
    workspaceRoot,
    role,
    frontmatter: effectiveFm,
    actor,
    writebackModeOverride,
  });

  if (!permission.allowed) {
    throw new Error(`Write denied: ${permission.reason}`);
  }

  const mode = permission.writebackMode;
  if (permission.needsConfirm && !confirmed && !previewOnly) {
    const pending = {
      operation,
      writeback_mode: mode,
      target_path: targetPath,
      affected_files: [targetPath],
      wrote_files: false,
      receipt_path: null,
      backup_path: null,
      protection: permission.protection,
      saved_at: new Date().toISOString(),
      needsConfirm: true,
      pending: true,
      note: "confirm required — call again with confirmed:true after user accept",
      previewContent: content,
    };
    return toSurfaceEvidence(pending, workspaceRoot);
  }

  const writeback = resolvedContract?.writeback || {};
  const shadow = writeback.shadow !== false && !skipShadow;
  const backupTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "backups");
  const receiptsTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "receipts");

  const evidence = {
    operation,
    writeback_mode: mode,
    target_path: targetPath,
    affected_files: [targetPath],
    wrote_files: false,
    receipt_path: null,
    backup_path: null,
    protection: permission.protection,
    saved_at: new Date().toISOString(),
    needsConfirm: false,
    pending: false,
  };

  if (previewOnly) {
    // Preview must still report the confirmation requirement honestly —
    // callers use preview evidence to decide whether to prompt.
    evidence.needsConfirm = permission.needsConfirm;
    evidence.note = "preview only";
    return toSurfaceEvidence(evidence, workspaceRoot);
  }

  if (shadow) {
    const shadowPath = `${targetPath}.shadow-draft.tmp`;
    fs.writeFileSync(shadowPath, content, "utf8");
    evidence.shadow_path = shadowPath;
  }

  // High-impact only: overwrite of existing locked file.
  // Use existing on-disk protection so callers that rebuild FM without `locked` still backup.
  // Task-scoped: with taskId, snapshot only the first write of this path in the task.
  const effectiveProtection =
    existingProtection === "locked" ? "locked" : permission.protection;
  const highImpact = isHighImpactContentWrite({
    fileExists,
    protection: effectiveProtection,
  });
  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
  let shouldBackup = fileExists && !skipBackup && highImpact;
  if (shouldBackup && taskId) {
    shouldBackup = shouldSnapshotLockedWrite({
      taskId,
      relativePath,
      workspaceRoot,
    });
  }
  if (shouldBackup) {
    const backupDir = path.join(workspaceRoot, backupTo);
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const dirParts = path.dirname(relativePath).split("/").filter((p) => p && p !== ".");
    const baseName = path.basename(relativePath);
    const fileName = `${stamp}__${baseName}`;
    const fileBackupDir = path.join(backupDir, ...dirParts);
    const backupPath = path.join(fileBackupDir, fileName);
    fs.mkdirSync(fileBackupDir, { recursive: true });
    fs.copyFileSync(targetPath, backupPath);
    // Mark only after a successful copy — a failed first snapshot must not
    // suppress later snapshots in the same task.
    if (taskId) {
      markTaskSnapshotTaken({ taskId, relativePath, workspaceRoot });
    }
    evidence.backup_path = backupPath;
    evidence.affected_files.push(backupPath);
    pruneOldBackups(fileBackupDir, baseName, resolveBackupKeep());
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // pid + random suffix: Desktop / Obsidian / UTR writing the same file in the
  // same millisecond must not share one temp path.
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    // TOCTOU re-check: a parent component may have been swapped for a symlink
    // between the permission check and the rename. Cheap realpath comparison.
    if (!isPathInsideWorkspace(workspaceRoot, targetPath)) {
      throw new Error("Write denied: path escaped workspace after permission check");
    }
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, targetPath);
    evidence.wrote_files = true;
    if (evidence.shadow_path) cleanupShadow(evidence.shadow_path);
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (evidence.shadow_path) cleanupShadow(evidence.shadow_path);
    throw err;
  }

  // Receipt only when a backup was taken (high-impact recovery trail). Never invent receipt without backup.
  if (!skipReceipt && evidence.backup_path) {
    const { receiptPath } = writeReceiptFile({
      workspaceRoot,
      receiptsTo,
      evidence: {
        operation,
        writeback_mode: mode,
        target_path: targetPath,
        affected_files: evidence.affected_files,
        wrote_files: true,
        backup_path: evidence.backup_path,
        protection: permission.protection,
        saved_at: evidence.saved_at,
      },
    });
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
  }

  return toSurfaceEvidence(evidence, workspaceRoot);
}

/**
 * Delete a file.
 * Recoverable trash + receipt only for locked / core notes
 * (`isRecoverableLifecycle`). Ordinary open scratch is unlinked with
 * returned evidence only. `permanent=true` is irreversible (no trash).
 *
 * @param {object} options
 * @param {string} options.targetPath - absolute path
 * @param {string} options.workspaceRoot
 * @param {object} [options.contract]
 * @param {"user"|"ai"} [options.actor="ai"]
 * @param {object} [options.frontmatter]
 * @param {string} [options.role]
 * @param {boolean} [options.confirmed=false]
 * @param {boolean} [options.permanent=false] - if true, skip trash copy (irreversible)
 * @param {string} [options.writebackModeOverride]
 */
export function executeDelete({
  targetPath,
  workspaceRoot,
  contract,
  actor = "ai",
  frontmatter,
  role,
  confirmed = false,
  permanent = false,
  writebackModeOverride,
}) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`File not found: ${targetPath}`);
  }
  // Reject directories — delete is for files only. Use executeArchive for dirs.
  const st = fs.statSync(targetPath);
  if (st.isDirectory()) {
    throw new Error(`Cannot delete a directory via executeDelete: ${targetPath}. Use executeArchive or a directory-aware operation.`);
  }
  const resolvedContract = contract || loadContract(workspaceRoot);
  const lifecycleGate = evaluateLifecycleTarget({
    workspaceRoot,
    targetPath,
    contract: resolvedContract,
  });
  if (!lifecycleGate.allowed) {
    throw new Error(`Delete denied: ${lifecycleGate.reason}`);
  }
  // Read only the head for the frontmatter peek — delete must stay cheap for
  // large binary assets (frontmatter, when present, lives in the first lines).
  // 32KB cap: pathological-but-legal frontmatter with protection:locked past
  // 8KB would be treated as open and deleted without trash.
  let content = "";
  if (!frontmatter) {
    const fd = fs.openSync(targetPath, "r");
    try {
      const buf = Buffer.alloc(32768);
      const n = fs.readSync(fd, buf, 0, 32768, 0);
      content = buf.toString("utf8", 0, n);
    } finally {
      fs.closeSync(fd);
    }
  }
  const fm = frontmatter || peekFrontmatter(content);
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath,
    workspaceRoot,
    role,
    frontmatter: fm,
    actor,
    lifecycle: true,
    writebackModeOverride,
  });
  if (!permission.allowed) throw new Error(`Write denied: ${permission.reason}`);
  if (permission.needsConfirm && !confirmed) {
    return toSurfaceEvidence(
      {
        operation: "delete",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: false,
        needsConfirm: true,
        pending: true,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "confirm required for delete",
      },
      workspaceRoot,
    );
  }

  // Permanent delete: skip trash copy entirely (irreversible).
  // AI may not permanently destroy locked/core content — recoverable delete
  // (trash + receipt) is the auto-mode path; permanent stays a user action.
  if (permanent) {
    const relForPerm = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
    const wouldBeRecoverable =
      permission.protection === "locked" ||
      isRecoverableLifecycle({
        protection: permission.protection,
        relativePath: relForPerm,
        isDirectory: false,
        workspaceRoot,
      });
    if (actor !== "user" && wouldBeRecoverable) {
      throw new Error(
        "Permanent delete denied: locked/core content must use recoverable delete (trash + receipt), or act as user",
      );
    }
    fs.unlinkSync(targetPath);
    return toSurfaceEvidence(
      {
        operation: "delete-permanent",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: true,
        backup_path: null,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "permanently deleted (no trash copy)",
      },
      workspaceRoot,
    );
  }

  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
  const recoverable = isRecoverableLifecycle({
    protection: permission.protection,
    relativePath,
    isDirectory: false,
    workspaceRoot,
  });

  // Ordinary open scratch: unlink, evidence only (no trash, no receipt).
  if (!recoverable) {
    fs.unlinkSync(targetPath);
    return toSurfaceEvidence(
      {
        operation: "delete",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: true,
        backup_path: null,
        receipt_path: null,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "deleted (no trash — ordinary open content)",
      },
      workspaceRoot,
    );
  }

  // Locked / core: move to trash (recoverable) — atomic rename when same filesystem
  const backupTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "backups");
  const receiptsTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "receipts");
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const dirParts = path.dirname(relativePath).split("/").filter((p) => p && p !== ".");
  const trashPath = path.join(
    workspaceRoot,
    backupTo,
    "trash",
    ...dirParts,
    `${stamp}__${path.basename(relativePath)}`,
  );
  fs.mkdirSync(path.dirname(trashPath), { recursive: true });
  // TOCTOU: re-verify source still inside the fence before the destructive move.
  if (!isPathInsideWorkspace(workspaceRoot, targetPath)) {
    throw new Error("Delete denied: path escaped workspace after permission check");
  }
  // Prefer atomic rename (same filesystem); fall back to copy+delete (cross-FS)
  try {
    fs.renameSync(targetPath, trashPath);
  } catch {
    fs.copyFileSync(targetPath, trashPath);
    fs.unlinkSync(targetPath);
  }

  // Write receipt for delete operations (high-impact, recoverable)
  const { receiptPath } = writeReceiptFile({
    workspaceRoot,
    receiptsTo,
    evidence: {
      operation: "delete",
      writeback_mode: permission.writebackMode,
      target_path: relativePath,
      affected_files: [relativePath, path.relative(workspaceRoot, trashPath).replace(/\\/g, "/")],
      wrote_files: true,
      backup_path: trashPath,
      protection: permission.protection,
      saved_at: new Date().toISOString(),
    },
  });

  return toSurfaceEvidence(
    {
      operation: "delete",
      writeback_mode: permission.writebackMode,
      target_path: targetPath,
      affected_files: [targetPath, trashPath, receiptPath],
      wrote_files: true,
      backup_path: trashPath,
      receipt_path: receiptPath,
      protection: permission.protection,
      saved_at: new Date().toISOString(),
    },
    workspaceRoot,
  );
}

/**
 * Archive a single file into `{backup_to}/trash/…` as its new home.
 * Always keeps the content unless `permanent`. YAML receipt only for locked/core.
 */
function archiveFile({
  targetPath,
  workspaceRoot,
  contract,
  actor,
  role,
  confirmed,
  permanent,
  writebackModeOverride,
}) {
  const resolvedContract = contract || loadContract(workspaceRoot);
  const lifecycleGate = evaluateLifecycleTarget({
    workspaceRoot,
    targetPath,
    contract: resolvedContract,
  });
  if (!lifecycleGate.allowed) {
    throw new Error(`Archive denied: ${lifecycleGate.reason}`);
  }
  // Head peek only — archiving a multi-GB binary must not read the whole file.
  let content = "";
  try {
    const fd = fs.openSync(targetPath, "r");
    try {
      const buf = Buffer.alloc(32768);
      const n = fs.readSync(fd, buf, 0, 32768, 0);
      content = buf.toString("utf8", 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    content = "";
  }
  const fm = peekFrontmatter(content);
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath,
    workspaceRoot,
    role,
    frontmatter: fm,
    actor,
    lifecycle: true,
    writebackModeOverride,
  });
  if (!permission.allowed) throw new Error(`Write denied: ${permission.reason}`);
  if (permission.needsConfirm && !confirmed) {
    return toSurfaceEvidence(
      {
        operation: "archive",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: false,
        needsConfirm: true,
        pending: true,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "confirm required for archive",
      },
      workspaceRoot,
    );
  }

  if (permanent) {
    const relForPerm = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
    const wouldBeRecoverable =
      permission.protection === "locked" ||
      isRecoverableLifecycle({
        protection: permission.protection,
        relativePath: relForPerm,
        isDirectory: false,
        workspaceRoot,
      });
    if (actor !== "user" && wouldBeRecoverable) {
      throw new Error(
        "Permanent archive denied: locked/core content must use recoverable archive, or act as user",
      );
    }
    fs.unlinkSync(targetPath);
    return toSurfaceEvidence(
      {
        operation: "archive-permanent",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: true,
        backup_path: null,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "permanently deleted (no archive copy)",
      },
      workspaceRoot,
    );
  }

  const backupTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "backups");
  const receiptsTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "receipts");
  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const dirParts = path.dirname(relativePath).split("/").filter((p) => p && p !== ".");
  const destPath = path.join(
    workspaceRoot,
    backupTo,
    "trash",
    ...dirParts,
    `${stamp}__${path.basename(relativePath)}`,
  );
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (!isPathInsideWorkspace(workspaceRoot, targetPath)) {
    throw new Error("Archive denied: path escaped workspace after permission check");
  }
  try {
    fs.renameSync(targetPath, destPath);
  } catch {
    fs.copyFileSync(targetPath, destPath);
    fs.unlinkSync(targetPath);
  }

  const evidence = {
    operation: "archive",
    writeback_mode: permission.writebackMode,
    target_path: targetPath,
    affected_files: [targetPath, destPath],
    wrote_files: true,
    backup_path: destPath,
    receipt_path: null,
    protection: permission.protection,
    saved_at: new Date().toISOString(),
    note: "archived to 99-归档 (destination, not backup)",
  };

  const writeReceipt = isRecoverableLifecycle({
    protection: permission.protection,
    relativePath,
    isDirectory: false,
    workspaceRoot,
  });
  if (writeReceipt) {
    const { receiptPath } = writeReceiptFile({
      workspaceRoot,
      receiptsTo,
      evidence: {
        operation: "archive",
        writeback_mode: permission.writebackMode,
        target_path: relativePath,
        affected_files: [relativePath, path.relative(workspaceRoot, destPath).replace(/\\/g, "/")],
        wrote_files: true,
        backup_path: destPath,
        protection: permission.protection,
        saved_at: evidence.saved_at,
      },
    });
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
  }

  return toSurfaceEvidence(evidence, workspaceRoot);
}

/**
 * Canonical archived-topic stamp: `YYYYMMDD-HHMMSS` (matches
 * `utr/core/safety-receipt-paths.mjs` inferTopicFromSafetyPath).
 * @param {Date} [date]
 * @returns {string}
 */
export function formatArchiveTopicStamp(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

/**
 * Workspace-relative archive (role:system) plane root — the content new home
 * for archived topics (`99-归档` / `99-Archive` / user-renamed).
 * @param {string} workspaceRoot
 * @param {object} [contract]
 * @returns {string} posix relative path
 */
export function resolveArchivePlaneRootRel(workspaceRoot, contract) {
  try {
    const sysAbs = resolveSystemRoot(workspaceRoot, "system", { config: contract });
    const rel = path.relative(workspaceRoot, sysAbs).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  } catch {
    /* fall through */
  }
  const backupTo = String(resolveArchivePlaneRel(workspaceRoot, contract, "backups")).replace(/\\/g, "/");
  return backupTo.split("/")[0] || "99-归档";
}

/**
 * Canonical archived-topic landing name: `{category}-{topic}-{stamp}`.
 * category = first path segment; topic = second segment or directory name.
 * Shared by executeArchive (directory branch) and UTR archiveTopic.
 *
 * @param {{ relativePath: string, stamp?: string }} p
 * @returns {{ category: string, topic: string, name: string }}
 */
export function buildArchivedTopicName({ relativePath, stamp }) {
  const parts = String(relativePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  const category = parts[0] || "topic";
  const topic = parts[1] || parts[parts.length - 1] || category;
  const s = stamp || formatArchiveTopicStamp();
  return { category, topic, name: `${category}-${topic}-${s}` };
}

/**
 * Archive a file or topic directory into 99-归档 as its **new home**
 * (lifecycle move, not a safety backup). Ordinary inbox_review / catch_all
 * files must land under 99-归档 — never unlink-without-destination.
 * `executeDelete` is the only path that may skip trash for open scratch.
 *
 * Directory landing (canonical): `{archivePlane}/{category}-{topic}-{stamp}/`
 * plus `archive-receipt.json` (command/category/topic/reason/archivedAt)
 * written into the destination. File landing stays under backups/trash/.
 *
 * @param {object} options
 * @param {string} options.targetPath - absolute path
 * @param {string} options.workspaceRoot
 * @param {object} [options.contract]
 * @param {"user"|"ai"} [options.actor="ai"]
 * @param {boolean} [options.confirmed=false]
 * @param {string} [options.role]
 * @param {boolean} [options.permanent=false] - if true, delete without archive copy
 * @param {"auto"|"confirm"|string} [options.writebackModeOverride] - Desktop UI override
 * @param {string} [options.reason] - archive reason for archive-receipt.json
 * @param {string} [options.command="archive-topic"] - command name for archive-receipt.json
 */
export function executeArchive({
  targetPath,
  workspaceRoot,
  contract,
  actor = "ai",
  confirmed = false,
  role,
  permanent = false,
  writebackModeOverride,
  reason,
  command = "archive-topic",
}) {
  if (!workspaceRoot) throw new Error("executeArchive requires workspaceRoot");
  if (!targetPath) throw new Error("executeArchive requires targetPath");
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }
  const st = fs.statSync(targetPath);
  const resolvedContractEarly = contract || loadContract(workspaceRoot);
  const lifecycleGate = evaluateLifecycleTarget({
    workspaceRoot,
    targetPath,
    contract: resolvedContractEarly,
  });
  if (!lifecycleGate.allowed) {
    throw new Error(`Archive denied: ${lifecycleGate.reason}`);
  }
  if (st.isFile()) {
    return archiveFile({
      targetPath,
      workspaceRoot,
      contract,
      actor,
      role,
      confirmed,
      permanent,
      writebackModeOverride,
    });
  }
  if (!st.isDirectory()) {
    throw new Error(`Not a file or directory: ${targetPath}`);
  }

  const resolvedContract = resolvedContractEarly;
  // Directory archive: evaluate protection from topic.md (or first .md), same as file branch
  const guardPath = resolveDirProtectionSource(targetPath);
  const guardContent = guardPath ? fs.readFileSync(guardPath, "utf8") : "";
  const frontmatter = guardContent
    ? peekFrontmatter(guardContent)
    : {};
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath: guardPath || targetPath,
    workspaceRoot,
    role: role || "deep-work",
    frontmatter,
    actor,
    lifecycle: true,
    writebackModeOverride,
  });
  if (!permission.allowed) throw new Error(`Write denied: ${permission.reason}`);
  if (permission.needsConfirm && !confirmed) {
    return toSurfaceEvidence(
      {
        operation: "archive",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: false,
        needsConfirm: true,
        pending: true,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "confirm required for archive",
      },
      workspaceRoot,
    );
  }

  // Permanent delete for directories: skip archive copy entirely.
  // Guard file open ≠ children open — refuse irreversible delete when any
  // descendant is locked/core recoverable (would lose trash that non-permanent
  // archive would have preserved for locked files).
  if (permanent) {
    const blocked = findProtectedDescendant({
      workspaceRoot,
      dirAbs: targetPath,
      contract: resolvedContract,
    });
    if (blocked) {
      throw new Error(
        `Permanent archive denied: locked/core content at ${blocked}. ` +
          `Use non-permanent archive so recoverable notes keep trash/receipt.`,
      );
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    return toSurfaceEvidence(
      {
        operation: "archive-permanent",
        writeback_mode: permission.writebackMode,
        target_path: targetPath,
        affected_files: [targetPath],
        wrote_files: true,
        backup_path: null,
        protection: permission.protection,
        saved_at: new Date().toISOString(),
        note: "permanently deleted (no archive copy)",
      },
      workspaceRoot,
    );
  }

  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");

  // Directory archive: always move to the archive plane as the new home
  // `{archive}/{category}-{topic}-{stamp}/` (unless permanent).
  // Uses rename when possible (same filesystem = atomic); falls back to cpSync + verify + rmSync.
  const backupTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "backups");
  const receiptsTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "receipts");
  const archiveRootRel = resolveArchivePlaneRootRel(workspaceRoot, resolvedContract);
  const stamp = formatArchiveTopicStamp();
  let { category: archCategory, topic: archTopic, name: archName } = buildArchivedTopicName({
    relativePath,
    stamp,
  });
  let archivePath = path.join(workspaceRoot, archiveRootRel, archName);
  if (fs.existsSync(archivePath)) {
    archName = `${archName}-${Date.now().toString(36)}`;
    archivePath = path.join(workspaceRoot, archiveRootRel, archName);
  }
  // Destination must never sit inside the source (self-copy → disk fill / hang).
  const archiveAbs = path.resolve(archivePath);
  const rawTarget = String(targetPath);
  const targetAbs = path.isAbsolute(rawTarget)
    ? path.resolve(rawTarget)
    : path.resolve(String(workspaceRoot), rawTarget);
  if (archiveAbs === targetAbs || archiveAbs.startsWith(targetAbs + path.sep)) {
    throw new Error(
      "Archive denied: destination resolves inside the source — refusing self-copy",
    );
  }
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });

  // Safety: copy first, then verify the copy succeeded before removing original.
  // This is NOT fully atomic but is far safer than cpSync+rmSync blindly —
  // if copy fails, the original is preserved.
  try {
    // Try atomic rename first (same filesystem: workspace + archive under same root)
    fs.renameSync(targetPath, archivePath);
  } catch {
    // Cross-filesystem or other error: fall back to copy + verify + remove
    fs.cpSync(targetPath, archivePath, { recursive: true });
    // Verify the copy: check the archive exists and has the same file count.
    // countFilesRecursive throws on unreadable source — never treat that as empty
    // (which would skip verification and delete the original).
    const origCount = countFilesRecursive(targetPath);
    const archiveCount = countFilesRecursive(archivePath);
    if (origCount !== archiveCount) {
      // Copy verification failed — remove partial archive, keep original
      fs.rmSync(archivePath, { recursive: true, force: true });
      throw new Error(`Archive copy verification failed: expected ${origCount} files, got ${archiveCount}`);
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  // Compact metadata lives WITH the archived topic (destination is the new home).
  const archiveReceiptPath = path.join(archivePath, "archive-receipt.json");
  fs.writeFileSync(
    archiveReceiptPath,
    JSON.stringify(
      {
        command,
        category: archCategory,
        topic: archTopic,
        reason: reason || null,
        archivedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  const evidence = {
    operation: "archive",
    writeback_mode: permission.writebackMode,
    target_path: targetPath,
    affected_files: [targetPath, archivePath, archiveReceiptPath],
    wrote_files: true,
    backup_path: archivePath,
    receipt_path: null,
    archive_receipt_path: archiveReceiptPath,
    protection: permission.protection,
    saved_at: new Date().toISOString(),
    note: "topic/dir archived into archive plane (new home)",
  };

  const writeReceipt = isRecoverableLifecycle({
    protection: permission.protection,
    relativePath,
    isDirectory: true,
    hasTopicHome: Boolean(guardPath && path.basename(guardPath) === "topic.md"),
    workspaceRoot,
  });
  if (writeReceipt) {
    const { receiptPath } = writeReceiptFile({
      workspaceRoot,
      receiptsTo,
      evidence: {
        operation: "archive",
        writeback_mode: permission.writebackMode,
        target_path: relativePath,
        affected_files: [relativePath, path.relative(workspaceRoot, archivePath).replace(/\\/g, "/")],
        wrote_files: true,
        backup_path: archivePath,
        protection: permission.protection,
        saved_at: evidence.saved_at,
      },
    });
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
  }

  return toSurfaceEvidence(evidence, workspaceRoot);
}

/**
 * Count files in a directory tree (for archive copy verification).
 * Throws on readdir failure so callers never treat an unreadable tree as empty
 * (which would skip verification and delete the original).
 * @param {string} dirAbs
 * @returns {number}
 */
function countFilesRecursive(dirAbs) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (err) {
    const code = err && err.code;
    if (code === "ENOENT") return 0;
    throw new Error(`Archive verification cannot read ${dirAbs}: ${err.message}`);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      count += countFilesRecursive(path.join(dirAbs, e.name));
    } else if (e.isFile()) {
      count++;
    }
  }
  return count;
}

/**
 * Prefer topic.md for directory protection; else first .md one level deep.
 * @param {string} dirAbs
 * @returns {string|null} absolute path of markdown used for FM peek
 */
function resolveDirProtectionSource(dirAbs) {
  const topicMd = path.join(dirAbs, "topic.md");
  if (fs.existsSync(topicMd) && fs.statSync(topicMd).isFile()) return topicMd;
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".md")) {
      return path.join(dirAbs, e.name);
    }
  }
  return null;
}

/**
 * Find a locked/core descendant that would lose recoverability under permanent
 * directory delete. Returns a workspace-relative path or null.
 * @param {{ workspaceRoot: string, dirAbs: string, contract?: object }} p
 * @returns {string|null}
 */
function findProtectedDescendant({ workspaceRoot, dirAbs, contract }) {
  const root = path.resolve(workspaceRoot);
  /** @type {string[]} */
  const stack = [dirAbs];
  let visited = 0;
  while (stack.length > 0) {
    // Hard cap keeps pathological trees from hanging the gate.
    if (visited++ > 50_000) return path.relative(root, dirAbs).replace(/\\/g, "/");
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      let fm = {};
      try {
        if (e.name.endsWith(".md")) {
          const fd = fs.openSync(abs, "r");
          try {
            const buf = Buffer.alloc(32768);
            const n = fs.readSync(fd, buf, 0, 32768, 0);
            fm = peekFrontmatter(buf.toString("utf8", 0, n));
          } finally {
            fs.closeSync(fd);
          }
        }
      } catch {
        fm = {};
      }
      const relativePath = path.relative(root, abs).replace(/\\/g, "/");
      const recoverable = isRecoverableLifecycle({
        protection: fm?.protection,
        relativePath,
        isDirectory: false,
        workspaceRoot,
      });
      if (recoverable) return relativePath;
    }
  }
  return null;
}

export function cleanupShadow(shadowPath) {
  if (shadowPath && fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
