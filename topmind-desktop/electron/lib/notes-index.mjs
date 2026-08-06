/**
 * In-memory notes metadata index for Timeline / Tags / Kanban.
 * Invalidated on workspace mutations and chokidar events.
 *
 * Not a content truth store — only a performance projection of FS frontmatter.
 *
 * When the walk hits the scan cap (`truncated: true`):
 * - `total` / `returned` = notes in this projection (≤ limit)
 * - `scannedTotal` = lightweight full census of eligible .md files (no frontmatter parse)
 * When complete, `scannedTotal === total`.
 */
import path from "node:path";
import { resolveDataRoot, CATEGORY_PATTERN } from "./path-model.mjs";
import { listDir, statSafe, readTextPreview } from "./fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./frontmatter.mjs";
import { resolveCategoryRoles } from "./workspace-helpers.mjs";

/**
 * @typedef {{ notes: object[], builtAt: number, root: string, complete: boolean, scannedTotal: number }} NotesIndexCache
 * @type {Map<string, NotesIndexCache>}
 */
const caches = new Map();

const DEFAULT_TTL_MS = 30_000;

function rootKey(workspaceRoot) {
  return resolveDataRoot(workspaceRoot);
}

export function invalidateNotesIndex(relativePath) {
  if (!relativePath) {
    caches.clear();
    return;
  }
  // Full invalidate is simplest & correct; path-scoped patch can come later.
  caches.clear();
}

export function peekNotesIndex(workspaceRoot) {
  return caches.get(rootKey(workspaceRoot)) || null;
}

/**
 * Count eligible markdown files under non-system / non-hidden categories.
 * No frontmatter parse — used for scannedTotal when the metadata walk is capped.
 * @param {string} root
 * @param {Map<string, object>} roleMap
 */
async function countEligibleMarkdown(root, roleMap) {
  let count = 0;
  const walkDir = async (dir) => {
    let entries;
    try {
      entries = await listDir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const abs = path.join(dir, e);
      const s = await statSafe(abs);
      if (!s) continue;
      if (s.isDirectory()) {
        await walkDir(abs);
      } else if (s.isFile() && /\.md$/iu.test(e)) {
        count += 1;
      }
    }
  };

  const entries = await listDir(root).catch(() => []);
  for (const e of entries) {
    if (!CATEGORY_PATTERN.test(e)) continue;
    const def = roleMap.get(e) || {};
    const role = def.role || "unknown";
    if (role === "system") continue;
    if (def.hidden) continue;
    await walkDir(path.join(root, e));
  }
  return count;
}

/**
 * Build or return cached note metadata list.
 * @param {object} workspaceRoot path context
 * @param {{ limit?: number, force?: boolean, ttlMs?: number }} opts
 */
export async function getNotesIndex(workspaceRoot, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 5000);
  const force = Boolean(opts.force);
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const root = rootKey(workspaceRoot);
  const hit = caches.get(root);
  // Reuse cache when still warm; if prior scan was capped below this request, rebuild.
  if (
    !force
    && hit
    && hit.root === root
    && Date.now() - hit.builtAt < ttlMs
    && (hit.complete || hit.notes.length >= limit)
  ) {
    const notes = hit.notes.slice(0, limit);
    return {
      notes,
      /** Notes currently held in this projection (not a full-workspace count when truncated). */
      total: hit.notes.length,
      /** Same as notes.length for this response. */
      returned: notes.length,
      /**
       * Full eligible .md census when known.
       * Equals total when complete; when truncated, ≥ total (lightweight count).
       */
      scannedTotal: Number.isFinite(hit.scannedTotal) ? hit.scannedTotal : hit.notes.length,
      /** True when walk stopped early at the scan cap — do not treat total as complete. */
      truncated: !hit.complete,
      complete: Boolean(hit.complete),
      cached: true,
      builtAt: hit.builtAt,
    };
  }

  const roleMap = await resolveCategoryRoles(workspaceRoot);
  const notes = [];

  const walkDir = async (dir, { category = null, topic = null } = {}) => {
    let entries;
    try { entries = await listDir(dir); } catch { return; }
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const abs = path.join(dir, e);
      const s = await statSafe(abs);
      if (!s) continue;
      if (s.isDirectory()) {
        await walkDir(abs, { category, topic: topic || e });
      } else if (s.isFile() && /\.md$/iu.test(e)) {
        const rel = path.relative(root, abs).replace(/\\/gu, "/");
        let fm = {};
        try {
          const preview = await readTextPreview(abs, 4096);
          fm = splitMarkdownFrontmatter(preview).data || {};
        } catch { /* no frontmatter */ }
        notes.push({
          path: rel,
          name: e,
          category,
          topic,
          mtime: s.mtime.toISOString(),
          size: s.size,
          title: fm.title || null,
          tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [String(fm.tags)] : []),
          status: fm.status || null,
          priority: fm.priority || null,
          due: fm.due || fm.deadline || null,
          source_type: fm.source_type || null,
        });
        if (notes.length >= limit) return;
      }
    }
  };

  const entries = await listDir(root).catch(() => []);
  for (const e of entries) {
    if (!CATEGORY_PATTERN.test(e)) continue;
    const def = roleMap.get(e) || {};
    const role = def.role || "unknown";
    if (role === "system") continue;
    // Honor categoryOverrides.hidden — keep out of timeline/tags/kanban projections
    if (def.hidden) continue;
    await walkDir(path.join(root, e), { category: e, topic: null });
    if (notes.length >= limit) break;
  }

  notes.sort((a, b) => b.mtime.localeCompare(a.mtime));
  const builtAt = Date.now();
  // complete=true only when we stopped before hitting the scan cap
  const complete = notes.length < limit;
  /** @type {number} */
  let scannedTotal = notes.length;
  if (!complete) {
    // Lightweight full census (no frontmatter) so UI can show "显示 N / 共 M"
    try {
      scannedTotal = await countEligibleMarkdown(root, roleMap);
      if (scannedTotal < notes.length) scannedTotal = notes.length;
    } catch {
      scannedTotal = notes.length;
    }
  }
  caches.set(root, { notes, builtAt, root, complete, scannedTotal });
  const returned = notes.slice(0, limit);
  return {
    notes: returned,
    total: notes.length,
    returned: returned.length,
    scannedTotal,
    truncated: !complete,
    complete,
    cached: false,
    builtAt,
  };
}
