/**
 * Client-side recent workspace list hygiene (display).
 * Server already dedupes on write; this guards renderer/stale snapshots.
 */

export type RecentWorkspaceLike = {
  rootPath: string;
  lastOpenedAt?: string;
};

/** Case-fold + trailing-slash strip for comparison (mirrors electron path id). */
export function workspacePathKey(rootPath: string): string {
  if (!rootPath || typeof rootPath !== "string") return "";
  let p = rootPath.trim().replace(/\\/gu, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/u, "");
  return p.toLowerCase();
}

export function sameWorkspacePathClient(a: string, b: string): boolean {
  const ka = workspacePathKey(a);
  const kb = workspacePathKey(b);
  return Boolean(ka && kb && ka === kb);
}

/** Dedupe by path key; keep newest lastOpenedAt; cap. */
export function dedupeRecentWorkspaces(
  entries: RecentWorkspaceLike[] | null | undefined,
  max = 8,
): RecentWorkspaceLike[] {
  const list = Array.isArray(entries) ? entries : [];
  const map = new Map<string, RecentWorkspaceLike>();
  for (const e of list) {
    if (!e?.rootPath?.trim()) continue;
    const key = workspacePathKey(e.rootPath);
    if (!key) continue;
    const prev = map.get(key);
    const ts = e.lastOpenedAt || "";
    if (!prev || ts > (prev.lastOpenedAt || "")) {
      map.set(key, { rootPath: e.rootPath.trim(), lastOpenedAt: e.lastOpenedAt });
    }
  }
  return [...map.values()]
    .sort((a, b) => String(b.lastOpenedAt || "").localeCompare(String(a.lastOpenedAt || "")))
    .slice(0, max);
}
