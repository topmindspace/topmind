// ── topmind Writeback Engine (Kernel 6/8) ──────────────────────────────────
// Authoritative mutation choke point: protection · confirm · backup · atomic write · receipt.
// Surfaces (Desktop / UTR) MUST route durable content writes here — no parallel policy.

import fs from "node:fs";
import path from "node:path";
import { resolveProtection, loadContract } from "./contract-engine.mjs";
import { buildReceipt } from "./yaml-writer.mjs";
import { parse as parseYaml } from "./yaml-bridge.mjs";

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
  const root = path.resolve(workspaceRoot);
  const absTarget = path.resolve(String(targetPath || ""));
  const relCheck = path.relative(root, absTarget);
  if (
    !absTarget ||
    absTarget === root ||
    relCheck.startsWith("..") ||
    path.isAbsolute(relCheck)
  ) {
    return {
      allowed: false,
      protection: "locked",
      reason: "Write denied: path outside workspace",
      needsConfirm: false,
      writebackMode: mode,
    };
  }

  const relativePath = relCheck.replace(/\\/g, "/");
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
 * Maximum number of backup copies to keep per file (rotating checkpoint).
 * Older backups beyond this limit are automatically pruned.
 * Set to 0 to disable rotation (keep all backups — not recommended).
 */
const BACKUP_KEEP = 3;

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
 * Execute durable content write through the single gate.
 *
 * Backup strategy (optimized):
 * - User-initiated saves (actor="user") skip backup by default — frequent, low-risk.
 * - AI writes (actor="ai") create rotating backups (max BACKUP_KEEP per file).
 * - High-impact operations (delete/archive) always create trash copies.
 * - Callers can explicitly request backup via skipBackup=false.
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
 * @param {boolean} [options.skipBackup=false]
 * @param {boolean} [options.skipReceipt=false]
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
  confirmed = false,
  actor = "ai",
  previewOnly = false,
  writebackModeOverride,
}) {
  if (!workspaceRoot) throw new Error("executeWrite requires workspaceRoot");
  if (!targetPath) throw new Error("executeWrite requires targetPath");
  if (typeof content !== "string") throw new Error("executeWrite requires string content");

  const resolvedContract = contract || loadContract(workspaceRoot);
  const fm = frontmatter || peekFrontmatter(content);
  const permission = evaluateWritePermission({
    contract: resolvedContract,
    targetPath,
    workspaceRoot,
    role,
    frontmatter: fm,
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
  const backupTo = writeback.backup_to || "99-归档/backups";
  const receiptsTo = writeback.receipts || "99-归档/receipts";

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
    evidence.note = "preview only";
    return toSurfaceEvidence(evidence, workspaceRoot);
  }

  if (shadow) {
    const shadowPath = `${targetPath}.shadow-draft.tmp`;
    fs.writeFileSync(shadowPath, content, "utf8");
    evidence.shadow_path = shadowPath;
  }

  // Optimized backup strategy:
  // - User saves (actor="user") skip backup by default — frequent, low-risk, atomic write is safe.
  // - AI writes (actor="ai") create rotating backups (max BACKUP_KEEP per file) to limit archive bloat.
  // - Callers can force backup with skipBackup=false regardless of actor.
  const isUserSave = actor === "user";
  const shouldBackup = !skipBackup && !isUserSave && fs.existsSync(targetPath);
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
    // Rotating checkpoint: prune older backups beyond BACKUP_KEEP
    pruneOldBackups(fileBackupDir, baseName, BACKUP_KEEP);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, targetPath);
    evidence.wrote_files = true;
    // Clean up shadow draft after successful write
    if (evidence.shadow_path) cleanupShadow(evidence.shadow_path);
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw err;
  }

  // Optimized receipt strategy:
  // - User saves (actor="user") skip receipt by default — frequent, low-risk, noisy.
  // - AI writes create receipts for audit trail.
  // - Callers can force receipt with skipReceipt=false regardless of actor.
  const shouldSkipReceipt = skipReceipt || isUserSave;
  if (!shouldSkipReceipt) {
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
    });
    fs.writeFileSync(receiptPath, receiptContent, "utf8");
    evidence.receipt_path = receiptPath;
    evidence.affected_files.push(receiptPath);
  }

  return toSurfaceEvidence(evidence, workspaceRoot);
}

/**
 * Delete a file. By default moves to archive trash (recoverable).
 * When permanent=true, deletes without trash copy (irreversible).
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

  // Default: move to trash (recoverable)
  const writeback = resolvedContract?.writeback || {};
  const backupTo = writeback.backup_to || "99-归档/backups";
  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
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
  fs.copyFileSync(targetPath, trashPath);
  fs.unlinkSync(targetPath);

  return toSurfaceEvidence(
    {
      operation: "delete",
      writeback_mode: permission.writebackMode,
      target_path: targetPath,
      affected_files: [targetPath, trashPath],
      wrote_files: true,
      backup_path: trashPath,
      protection: permission.protection,
      saved_at: new Date().toISOString(),
    },
    workspaceRoot,
  );
}

/**
 * Archive a file or topic directory into 99-归档 trash (durable lifecycle apply).
 * Files → same path as executeDelete; directories → copy tree then rm original.
 *
 * @param {object} options
 * @param {string} options.targetPath - absolute path
 * @param {string} options.workspaceRoot
 * @param {object} [options.contract]
 * @param {"user"|"ai"} [options.actor="user"]
 * @param {boolean} [options.confirmed=false]
 * @param {string} [options.role]
 * @param {boolean} [options.permanent=false] - if true, delete without archive copy
 */
export function executeArchive({
  targetPath,
  workspaceRoot,
  contract,
  actor = "user",
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
    return executeDelete({
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

  const writeback = resolvedContract?.writeback || {};
  const backupTo = writeback.backup_to || "99-归档/backups";
  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const archivePath = path.join(
    workspaceRoot,
    backupTo,
    "archived-topics",
    `${stamp}__${relativePath.replace(/\//g, "__")}`,
  );
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.cpSync(targetPath, archivePath, { recursive: true });
  fs.rmSync(targetPath, { recursive: true, force: true });

  return toSurfaceEvidence(
    {
      operation: "archive",
      writeback_mode: permission.writebackMode,
      target_path: targetPath,
      affected_files: [targetPath, archivePath],
      wrote_files: true,
      backup_path: archivePath,
      protection: permission.protection,
      saved_at: new Date().toISOString(),
      note: "topic/dir archived via write-gate",
    },
    workspaceRoot,
  );
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
