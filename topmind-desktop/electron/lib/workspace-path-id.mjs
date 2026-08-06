/**
 * Pure workspace path identity + recent list hygiene.
 * No filesystem I/O — safe for settings-core and unit tests.
 */
import path from "node:path";

export const MAX_RECENT_WORKSPACES = 8;

/**
 * Canonical comparison key for workspace roots.
 * - resolve absolute
 * - strip trailing separators
 * - case-fold on darwin/win32 (typical case-insensitive FS)
 */
export function canonicalizeWorkspacePathKey(rootPath) {
  if (!rootPath || typeof rootPath !== "string") return "";
  let resolved = path.resolve(rootPath.trim());
  // strip trailing sep except root
  if (resolved.length > 1 && (resolved.endsWith(path.sep) || resolved.endsWith("/"))) {
    resolved = resolved.replace(/[/\\]+$/u, "") || resolved;
  }
  if (process.platform === "darwin" || process.platform === "win32") {
    return resolved.toLowerCase();
  }
  return resolved;
}

export function sameWorkspacePath(left, right) {
  if (!left || !right) return false;
  const a = canonicalizeWorkspacePathKey(left);
  const b = canonicalizeWorkspacePathKey(right);
  return Boolean(a && b && a === b);
}

/**
 * Dedupe recent entries by canonical path key; keep newest lastOpenedAt; cap.
 * @param {Array<{ rootPath?: string, lastOpenedAt?: string }|null|undefined>} entries
 * @param {number} [max]
 */
export function dedupeRecentWorkspaceEntries(entries, max = MAX_RECENT_WORKSPACES) {
  const list = Array.isArray(entries) ? entries : [];
  /** @type {Map<string, { rootPath: string, lastOpenedAt: string }>} */
  const byKey = new Map();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const rootPath =
      typeof raw.rootPath === "string" && raw.rootPath.trim()
        ? path.resolve(raw.rootPath.trim())
        : "";
    if (!rootPath) continue;
    const key = canonicalizeWorkspacePathKey(rootPath);
    if (!key) continue;
    const lastOpenedAt =
      typeof raw.lastOpenedAt === "string" && raw.lastOpenedAt.trim()
        ? raw.lastOpenedAt
        : new Date().toISOString();
    const prev = byKey.get(key);
    if (!prev || lastOpenedAt > prev.lastOpenedAt) {
      // Prefer the newer timestamp; keep the path string from the winner
      // (prefer longer-resolved / previously stored form of prev if same time)
      byKey.set(key, { rootPath, lastOpenedAt });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, Math.max(1, max));
}

/**
 * Basename heuristics for paths that must never be content workspaces.
 * Pure — full probe uses async checks in workspace-history.
 * @param {string} rootPath
 */
export function looksLikeDesktopRuntimePath(rootPath) {
  const base = path.basename(path.resolve(String(rootPath || "")));
  // Desktop state / app package directory names (not user notes)
  if (base === "topmind-desktop") return true;
  if (base === "state" && path.basename(path.dirname(path.resolve(String(rootPath || "")))) === "topmind-desktop") {
    return true;
  }
  return false;
}
