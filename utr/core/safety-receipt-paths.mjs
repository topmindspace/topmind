/**
 * Shared path classification for list-safety-receipts + restore-safety-receipt.
 *
 * Canonical archive roots: 99-归档 / 99 归档 / 99-Archive / 99 Archive
 * Kernel trash: `{archive}/backups/trash/{originalRel}`
 * Legacy trash: `{archive}/trash/{originalRel}`
 * Backups: `{archive}/backups/{originalRel}` (not under trash/)
 * Archived topic: `{archive}/{category}-{topic}-{stamp}/…`
 * Output revision: `{outputs}/… - 修订版.md`
 *
 * Name lists come from Kernel `ROLE_DIR_ALIASES` (single truth).
 */
import { ROLE_DIR_ALIASES } from "../../lib/model-core.mjs";

export const ARCHIVE_ROOT_NAMES = Object.freeze([
  ...ROLE_DIR_ALIASES.system,
  "archive", // legacy prefix only
]);

export const OUTPUTS_ROOT_NAMES = Object.freeze([...ROLE_DIR_ALIASES.delivery]);

/**
 * @param {string} receiptPath workspace-relative
 * @returns {{ archiveRoot: string, rest: string } | null}
 */
export function parseArchiveReceiptPath(receiptPath) {
  const norm = String(receiptPath || "").replace(/\\/gu, "/");
  for (const root of ARCHIVE_ROOT_NAMES) {
    if (norm === root) return { archiveRoot: root, rest: "" };
    if (norm.startsWith(`${root}/`)) {
      return { archiveRoot: root, rest: norm.slice(root.length + 1) };
    }
  }
  return null;
}

/**
 * Strip Kernel / legacy backup stamps from a file basename.
 * Kernel: `20260725T120000000Z__note.md` · legacy: `20260614-055900-topic.md`
 * @param {string} basename
 * @returns {string}
 */
export function stripBackupStampName(basename) {
  const name = String(basename || "");
  const kernel = name.match(/^\d{8}T[\d.Z]+__(.+)$/u);
  if (kernel) return kernel[1];
  const legacy = name.match(/^\d{8}-\d{6}-(.+)$/u);
  if (legacy) return legacy[1];
  const generic = name.match(/^.+?__(.+)$/u);
  if (generic) return generic[1];
  return name;
}

/**
 * Classify list-safety type from a workspace-relative path.
 * @param {string} relativePath
 * @returns {"backup"|"trash"|"archived-topic"|"revision"|null}
 */
export function classifySafetyReceiptType(relativePath) {
  const norm = String(relativePath || "").replace(/\\/gu, "/");
  const basename = norm.split("/").pop() || "";

  for (const root of ARCHIVE_ROOT_NAMES) {
    const prefix = `${root}/`;
    if (!norm.startsWith(prefix) && norm !== root) continue;
    const rest = norm === root ? "" : norm.slice(prefix.length);
    if (rest.startsWith("backups/trash/") || rest === "backups/trash") return "trash";
    if (rest.startsWith("backups/") || rest === "backups") return "backup";
    if (rest.startsWith("trash/") || rest === "trash") return "trash";
    if (rest.startsWith("restore-receipts/") || rest.startsWith("receipts/")) return null;
    if (rest) return "archived-topic";
  }

  for (const root of OUTPUTS_ROOT_NAMES) {
    const prefix = `${root}/`;
    if (norm.startsWith(prefix) && / - 修订版(?:-\d+)?\.md$/u.test(basename)) {
      return "revision";
    }
  }
  return null;
}

/**
 * Infer category/topic labels from a safety receipt relative path.
 * @param {string} relativePath
 * @param {"backup"|"trash"|"archived-topic"|"revision"} type
 * @returns {{ category: string|null, topic: string|null } | null}
 */
export function inferTopicFromSafetyPath(relativePath, type) {
  const parts = String(relativePath || "").replace(/\\/gu, "/").split("/");
  if (!ARCHIVE_ROOT_NAMES.includes(parts[0]) && !OUTPUTS_ROOT_NAMES.includes(parts[0])) {
    return null;
  }
  if (type === "trash") {
    if (parts[1] === "backups" && parts[2] === "trash") {
      return { category: parts[3] || null, topic: parts[4] || null };
    }
    if (parts[1] === "trash") {
      return { category: parts[2] || null, topic: parts[3] || null };
    }
    return null;
  }
  if (type === "backup") {
    if (parts[1] === "backups" && parts[2] !== "trash") {
      return { category: parts[2] || null, topic: parts[3] || null };
    }
    return null;
  }
  if (type === "archived-topic") {
    if (ARCHIVE_ROOT_NAMES.includes(parts[0]) && parts.length >= 2) {
      const dirname = parts[1] || "";
      // `{category}-{topic}-{stamp}` where category is `NN-Name` / `NN Name`.
      // Category name stops at the first `-` so year-prefixed topics
      // (`2026-示例专题`) do not get glued onto the category
      // (`20-研究-2026` ← wrong). Stamp is always `YYYYMMDD-HHMMSS`.
      const m = dirname.match(/^(\d{2}[ -][^-]+)-(.+)-(\d{8}-\d{6})$/u);
      if (m) return { category: m[1], topic: m[2] };
      return { category: dirname, topic: null };
    }
    return null;
  }
  if (type === "revision" && OUTPUTS_ROOT_NAMES.includes(parts[0])) {
    if (parts.length >= 2) return { category: null, topic: parts[1] };
  }
  return null;
}

/**
 * Map a receipt path to the ideal restore destination (workspace-relative).
 * Does not perform I/O; caller applies non-overwrite stamps.
 *
 * @param {string} receiptPath
 * @param {{ isDirectory?: boolean }} [meta]
 * @returns {{ kind: string, destRel: string, isDirectory?: boolean }}
 */
export function classifyRestoreTarget(receiptPath, meta = {}) {
  const norm = String(receiptPath || "").replace(/\\/gu, "/");
  const isDirectory = Boolean(meta.isDirectory);
  const arch = parseArchiveReceiptPath(norm);

  if (arch) {
    const { rest } = arch;
    if (rest.startsWith("backups/trash/") || rest.startsWith("trash/")) {
      const under = rest.startsWith("backups/trash/")
        ? rest.slice("backups/trash/".length)
        : rest.slice("trash/".length);
      const segs = under.split("/").filter(Boolean);
      if (segs.length === 0) {
        throw new Error(`Invalid trash receipt path: ${receiptPath}`);
      }
      if (isDirectory) {
        return { kind: "trash-dir", destRel: segs.join("/"), isDirectory: true };
      }
      const stamped = segs[segs.length - 1];
      const origName = stripBackupStampName(stamped);
      const destRel = [...segs.slice(0, -1), origName].join("/");
      return { kind: "trash", destRel };
    }
    if (rest.startsWith("backups/")) {
      const under = rest.slice("backups/".length);
      const segs = under.split("/").filter(Boolean);
      if (segs.length === 0) {
        throw new Error(`Invalid backup receipt path: ${receiptPath}`);
      }
      if (isDirectory) {
        return { kind: "backup-dir", destRel: segs.join("/"), isDirectory: true };
      }
      const stamped = segs[segs.length - 1];
      const origName = stripBackupStampName(stamped);
      const destRel = [...segs.slice(0, -1), origName].join("/");
      return { kind: "backup", destRel };
    }
    if (rest) {
      const top = rest.split("/")[0];
      return { kind: "archived-topic", destRel: top, isDirectory: true };
    }
  }

  for (const outRoot of OUTPUTS_ROOT_NAMES) {
    if (norm === outRoot || norm.startsWith(`${outRoot}/`)) {
      const baseName = (norm.split("/").pop() || "").replace(/ - 修订版(?:-\d+)?\.md$/u, ".md");
      return { kind: "revision", destRel: `${outRoot}/${baseName}` };
    }
  }

  return { kind: "raw", destRel: norm };
}

/**
 * Prefer labels written into `archive-receipt.json` at the landing dir.
 * Pure parse of receipt text — caller supplies the file contents (or null).
 * @param {string|null|undefined} receiptJsonText
 * @returns {{ category: string|null, topic: string|null }}
 */
export function parseArchivedTopicReceiptLabels(receiptJsonText) {
  if (!receiptJsonText) return { category: null, topic: null };
  try {
    const obj = JSON.parse(String(receiptJsonText));
    const category = typeof obj?.category === "string" && obj.category ? obj.category : null;
    const topic = typeof obj?.topic === "string" && obj.topic ? obj.topic : null;
    return { category, topic };
  } catch {
    return { category: null, topic: null };
  }
}

/**
 * Resolve restore destination labels for an archived-topic landing.
 * Receipt wins over dirname parse (dirname parse is greedy when topic
 * itself contains hyphens / year prefixes).
 * @param {{ landingDirName: string, receiptJsonText?: string|null }} p
 * @returns {{ category: string|null, topic: string|null, destRel: string|null }}
 */
export function resolveArchivedTopicRestoreLabels({ landingDirName, receiptJsonText }) {
  const fromReceipt = parseArchivedTopicReceiptLabels(receiptJsonText);
  if (fromReceipt.category && fromReceipt.topic) {
    return { ...fromReceipt, destRel: `${fromReceipt.category}/${fromReceipt.topic}` };
  }
  const rel = `${ARCHIVE_ROOT_NAMES[0]}/${landingDirName}/x.md`;
  const inferred = inferTopicFromSafetyPath(rel, "archived-topic");
  if (inferred?.category && inferred?.topic) {
    return { ...inferred, destRel: `${inferred.category}/${inferred.topic}` };
  }
  return { category: null, topic: null, destRel: null };
}
