// ── topmind Writeback Engine (Kernel 6/8) ──────────────────────────────────
// Authoritative mutation choke point: protection · confirm · backup · atomic write · receipt.
// Surfaces (Desktop / UTR) MUST route durable content writes here — no parallel policy.

import fs from "node:fs";
import path from "node:path";
import { resolveProtection, loadContract } from "./contract-engine.mjs";
import { buildReceipt } from "./yaml-writer.mjs";
import { parse as parseYaml } from "./yaml-bridge.mjs";
import { isPathInsideWorkspace, resolveArchivePlaneRel } from "./model-core.mjs";

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
  if (typeof content !== "string" || !content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = content.slice(3, end);

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
 * @param {"user"|"ai"} [options.actor] - user may write locked files; ai cannot
 * @returns {{ allowed: boolean, protection: string, reason: string, needsConfirm: boolean, writebackMode: string }}
 */
/**
 * Resolve effective writeback mode: explicit override > contract > auto.
 * Desktop app settings should pass writebackModeOverride so UI「保存前问我」drives the gate.
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
}) {
  const mode = resolveWritebackMode(contract, writebackModeOverride);
  // Hard containment: never allow writes that resolve outside workspaceRoot
  const absTarget = path.resolve(String(targetPath || ""));
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
  const fileProtection = frontmatter?.protection;
  const roleProtection = resolveProtection(contract, relativePath, role, { workspaceRoot });
  const protection =
    fileProtection === "locked" || roleProtection === "locked"
      ? "locked"
      : fileProtection || roleProtection || "open";

  if (protection === "locked" && actor !== "user") {
    return {
      allowed: false,
      protection,
      reason: "File is locked; AI cannot write directly (fork or unlock required)",
      needsConfirm: false,
      writebackMode: mode,
    };
  }

  return {
    allowed: true,
    protection,
    reason: mode === "confirm" ? "Write allowed but requires user confirmation" : "Write allowed",
    needsConfirm: mode === "confirm" && actor !== "user",
    writebackMode: mode,
  };
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
    receiptPath: receiptPath || backupPath,
    backup_path: backupPath,
    backupPath,
    revision_path: evidence.revision_path || backupPath,
    revisionPath: evidence.revision_path || backupPath,
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
 */
const BACKUP_KEEP = Math.max(0, Number(process.env.BACKUP_KEEP) || 3);

/**
 * Maximum number of high-impact receipt files to retain.
 * Older receipts beyond this limit are pruned after each high-impact write.
 * Set to 0 to disable rotation (keep all — not recommended).
 * Surfaces may override via RECEIPT_KEEP env.
 */
const RECEIPT_KEEP = Math.max(0, Number(process.env.RECEIPT_KEEP) || 50);

/**
 * High-impact content write: only overwriting an existing *locked* file
 * warrants a backup + receipt. Open-file updates (AI or user) do not.
 *
 * AI cannot write locked files (evaluateWritePermission denies); high-impact
 * content backups therefore mainly cover **user** overwrites of locked files.
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
  return Boolean(fileExists && protection === "locked");
}

/** Slot 88 is delivery regardless of localized / renamed name. */
const DELIVERY_SLOT_RE = /^88[- ]/u;

/**
 * Whether `executeDelete` should leave trash + receipt, and whether
 * `executeArchive` should also write a YAML receipt (the archive *file*
 * always lands in 99-归档 as the new home).
 *
 * Durable extra recoverability (trash/receipt) is reserved for:
 * - overwrite/delete of **locked** notes/knowledge
 * - delete of **core** notes: memory plane, topic homepage (`topic.md`),
 *   topic directories (have `topic.md`), delivery (`88-输出`)
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
} = {}) {
  if (protection === "locked") return true;
  const rel = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/u, "");
  if (!rel) return false;
  if (rel === "memory" || rel.startsWith("memory/")) return true;
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
 * Execute durable content write through the single gate.
 *
 * Backup / receipt policy (high-impact only — single gate evaluation):
 * - Open-file create/update (actor ai|user): no backup, no receipt.
 * - Overwrite existing locked file (user only; AI denied earlier): rotating
 *   backup + receipt (BACKUP_KEEP / RECEIPT_KEEP prune high-impact artifacts).
 * - Delete: trash + receipt only when `isRecoverableLifecycle`
 *   (locked, memory/, topic.md, topic dir, delivery). Ordinary open scratch
 *   is unlinked with evidence only. `permanent=true` never trash/receipt.
 * - Archive: always a destination move into 99-归档 (unless permanent).
 *   YAML receipt only for locked/core.
 * - Callers may force-skip with skipBackup/skipReceipt true, or force a
 *   backup of an existing file with forceBackup true (rare escape hatch).
 * Do not rely on scattered actor-based skipBackup to invent policy.
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
 * @param {boolean} [options.forceBackup=false] - force backup when target exists
 * @param {boolean} [options.confirmed=false] - caller already got user confirm
 * @param {"user"|"ai"} [options.actor="ai"]
 * @param {boolean} [options.previewOnly=false] - evaluate + plan only, no disk write
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
  forceBackup = false,
  confirmed = false,
  actor = "ai",
  previewOnly = false,
  writebackModeOverride,
}) {
  if (!workspaceRoot) throw new Error("executeWrite requires workspaceRoot");
  if (!targetPath) throw new Error("executeWrite requires targetPath");
  if (typeof content !== "string") throw new Error("executeWrite requires string content");

  const resolvedContract = contract || loadContract(workspaceRoot);
  const fileExists = fs.existsSync(targetPath);
  // Existing on-disk protection wins for gate + high-impact backup: a rewrite
  // that drops `protection: locked` from frontmatter must still treat the
  // overwrite as high-impact (and still deny AI while the file is locked).
  let existingProtection = null;
  if (fileExists) {
    try {
      const existingFm = peekFrontmatter(fs.readFileSync(targetPath, "utf8"));
      if (existingFm?.protection === "locked") existingProtection = "locked";
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

  // High-impact only: overwrite of existing locked file (or explicit forceBackup).
  // Use existing on-disk protection so callers that rebuild FM without `locked` still backup.
  const highImpact = isHighImpactContentWrite({
    fileExists,
    protection:
      existingProtection === "locked" ? "locked" : permission.protection,
  });
  const shouldBackup =
    fileExists && !skipBackup && (forceBackup === true || highImpact);
  if (shouldBackup) {
    const backupDir = path.join(workspaceRoot, backupTo);
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
    const dirParts = path.dirname(relativePath).split("/").filter((p) => p && p !== ".");
    const baseName = path.basename(relativePath);
    const fileName = `${stamp}__${baseName}`;
    const fileBackupDir = path.join(backupDir, ...dirParts);
    const backupPath = path.join(fileBackupDir, fileName);
    fs.mkdirSync(fileBackupDir, { recursive: true });
    fs.copyFileSync(targetPath, backupPath);
    evidence.backup_path = backupPath;
    evidence.affected_files.push(backupPath);
    pruneOldBackups(fileBackupDir, baseName, BACKUP_KEEP);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // pid + random suffix: Desktop / Obsidian / UTR writing the same file in the
  // same millisecond must not share one temp path.
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
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
    const receiptsDir = path.join(workspaceRoot, receiptsTo);
    fs.mkdirSync(receiptsDir, { recursive: true });
    const receiptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const receiptPath = path.join(receiptsDir, `${receiptId}.yaml`);
    const receiptContent = buildReceipt({
      ...evidence,
      target_path: path.relative(workspaceRoot, targetPath).replace(/\\/g, "/"),
      receipt_path: path.relative(workspaceRoot, receiptPath).replace(/\\/g, "/"),
      backup_path: evidence.backup_path
        ? path.relative(workspaceRoot, evidence.backup_path).replace(/\\/g, "/")
        : null,
      // Receipts are portable artifacts — machine-absolute paths must not leak.
      affected_files: evidence.affected_files.map((p) =>
        path.isAbsolute(p) ? path.relative(workspaceRoot, p).replace(/\\/g, "/") : p,
      ),
    });
    fs.writeFileSync(receiptPath, receiptContent, "utf8");
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
    pruneOldReceipts(receiptsDir, RECEIPT_KEEP);
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
}) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`File not found: ${targetPath}`);
  }
  const resolvedContract = contract || loadContract(workspaceRoot);
  const content = fs.readFileSync(targetPath, "utf8");
  const fm = frontmatter || peekFrontmatter(content);
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath,
    workspaceRoot,
    role,
    frontmatter: fm,
    actor,
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

  // Permanent delete: skip trash copy entirely (irreversible)
  if (permanent) {
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
  // Prefer atomic rename (same filesystem); fall back to copy+delete (cross-FS)
  try {
    fs.renameSync(targetPath, trashPath);
  } catch {
    fs.copyFileSync(targetPath, trashPath);
    fs.unlinkSync(targetPath);
  }

  // Write receipt for delete operations (high-impact, recoverable)
  const receiptsDir = path.join(workspaceRoot, receiptsTo);
  fs.mkdirSync(receiptsDir, { recursive: true });
  const receiptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const receiptPath = path.join(receiptsDir, `${receiptId}.yaml`);
  const receiptContent = buildReceipt({
    operation: "delete",
    writeback_mode: permission.writebackMode,
    target_path: relativePath,
    affected_files: [relativePath, path.relative(workspaceRoot, trashPath).replace(/\\/g, "/")],
    wrote_files: true,
    receipt_path: path.relative(workspaceRoot, receiptPath).replace(/\\/g, "/"),
    backup_path: path.relative(workspaceRoot, trashPath).replace(/\\/g, "/"),
    protection: permission.protection,
    saved_at: new Date().toISOString(),
  });
  fs.writeFileSync(receiptPath, receiptContent, "utf8");
  pruneOldReceipts(receiptsDir, RECEIPT_KEEP);

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
}) {
  const resolvedContract = contract || loadContract(workspaceRoot);
  const content = fs.readFileSync(targetPath, "utf8");
  const fm = peekFrontmatter(content);
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath,
    workspaceRoot,
    role,
    frontmatter: fm,
    actor,
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
  });
  if (writeReceipt) {
    const receiptsDir = path.join(workspaceRoot, receiptsTo);
    fs.mkdirSync(receiptsDir, { recursive: true });
    const receiptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const receiptPath = path.join(receiptsDir, `${receiptId}.yaml`);
    const receiptContent = buildReceipt({
      operation: "archive",
      writeback_mode: permission.writebackMode,
      target_path: relativePath,
      affected_files: [relativePath, path.relative(workspaceRoot, destPath).replace(/\\/g, "/")],
      wrote_files: true,
      receipt_path: path.relative(workspaceRoot, receiptPath).replace(/\\/g, "/"),
      backup_path: path.relative(workspaceRoot, destPath).replace(/\\/g, "/"),
      protection: permission.protection,
      saved_at: evidence.saved_at,
    });
    fs.writeFileSync(receiptPath, receiptContent, "utf8");
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
    pruneOldReceipts(receiptsDir, RECEIPT_KEEP);
  }

  return toSurfaceEvidence(evidence, workspaceRoot);
}

/**
 * Archive a file or topic directory into 99-归档 as its **new home**
 * (lifecycle move, not a safety backup). Ordinary inbox_review / catch_all
 * files must land under 99-归档 — never unlink-without-destination.
 * `executeDelete` is the only path that may skip trash for open scratch.
 *
 * @param {object} options
 * @param {string} options.targetPath - absolute path
 * @param {string} options.workspaceRoot
 * @param {object} [options.contract]
 * @param {"user"|"ai"} [options.actor="ai"]
 * @param {boolean} [options.confirmed=false]
 * @param {string} [options.role]
 * @param {boolean} [options.permanent=false] - if true, delete without archive copy
 */
export function executeArchive({
  targetPath,
  workspaceRoot,
  contract,
  actor = "ai",
  confirmed = false,
  role,
  permanent = false,
}) {
  if (!workspaceRoot) throw new Error("executeArchive requires workspaceRoot");
  if (!targetPath) throw new Error("executeArchive requires targetPath");
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }
  const st = fs.statSync(targetPath);
  if (st.isFile()) {
    return archiveFile({
      targetPath,
      workspaceRoot,
      contract,
      actor,
      role,
      confirmed,
      permanent,
    });
  }
  if (!st.isDirectory()) {
    throw new Error(`Not a file or directory: ${targetPath}`);
  }

  const resolvedContract = contract || loadContract(workspaceRoot);
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

  // Permanent delete for directories: skip archive copy entirely
  if (permanent) {
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

  // Directory archive: always move to 99-归档 as the new home (unless permanent).
  // Uses rename when possible (same filesystem = atomic); falls back to cpSync + verify + rmSync.
  const backupTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "backups");
  const receiptsTo = resolveArchivePlaneRel(workspaceRoot, resolvedContract, "receipts");
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const archivePath = path.join(
    workspaceRoot,
    backupTo,
    "archived-topics",
    `${stamp}__${relativePath.replace(/\//g, "__")}`,
  );
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
    // Verify the copy: check the archive exists and has the same file count
    const origCount = countFilesRecursive(targetPath);
    const archiveCount = countFilesRecursive(archivePath);
    if (origCount > 0 && archiveCount !== origCount) {
      // Copy verification failed — remove partial archive, keep original
      fs.rmSync(archivePath, { recursive: true, force: true });
      throw new Error(`Archive copy verification failed: expected ${origCount} files, got ${archiveCount}`);
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  const evidence = {
    operation: "archive",
    writeback_mode: permission.writebackMode,
    target_path: targetPath,
    affected_files: [targetPath, archivePath],
    wrote_files: true,
    backup_path: archivePath,
    receipt_path: null,
    protection: permission.protection,
    saved_at: new Date().toISOString(),
    note: "topic/dir archived via write-gate",
  };

  const writeReceipt = isRecoverableLifecycle({
    protection: permission.protection,
    relativePath,
    isDirectory: true,
    hasTopicHome: Boolean(guardPath && path.basename(guardPath) === "topic.md"),
  });
  if (writeReceipt) {
    const receiptsDir = path.join(workspaceRoot, receiptsTo);
    fs.mkdirSync(receiptsDir, { recursive: true });
    const receiptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const receiptPath = path.join(receiptsDir, `${receiptId}.yaml`);
    const receiptContent = buildReceipt({
      operation: "archive",
      writeback_mode: permission.writebackMode,
      target_path: relativePath,
      affected_files: [relativePath, path.relative(workspaceRoot, archivePath).replace(/\\/g, "/")],
      wrote_files: true,
      receipt_path: path.relative(workspaceRoot, receiptPath).replace(/\\/g, "/"),
      backup_path: path.relative(workspaceRoot, archivePath).replace(/\\/g, "/"),
      protection: permission.protection,
      saved_at: evidence.saved_at,
    });
    fs.writeFileSync(receiptPath, receiptContent, "utf8");
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
    pruneOldReceipts(receiptsDir, RECEIPT_KEEP);
  }

  return toSurfaceEvidence(evidence, workspaceRoot);
}

/**
 * Count files in a directory tree (for archive copy verification).
 * @param {string} dirAbs
 * @returns {number}
 */
function countFilesRecursive(dirAbs) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return 0;
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

export function cleanupShadow(shadowPath) {
  if (shadowPath && fs.existsSync(shadowPath)) {
    fs.unlinkSync(shadowPath);
  }
}
