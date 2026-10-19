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
import { readdir } from "node:fs/promises";
import { resolveDataRoot, CATEGORY_PATTERN } from "./path-model.mjs";
import { statSafe, readTextPreview } from "./fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./frontmatter.mjs";
import { resolveCategoryRoles } from "./workspace-helpers.mjs";
import { retainKeyedProjection, WORKING_SET_CAPS } from "./runtime-bounds.mjs";
import {
  loadVaultIgnoreSync,
  pathMatchesUserIgnore,
  shouldSkipVaultDirName,
} from "./file-filter.mjs";

/**
 * @typedef {{ notes: object[], builtAt: number, root: string, complete: boolean, scannedTotal: number }} NotesIndexCache
 * @type {Map<string, NotesIndexCache>}
 */
const caches = new Map();

const DEFAULT_TTL_MS = 30_000;

function rootKey(workspaceRoot) {
  return resolveDataRoot(workspaceRoot);
}

/** Drop every in-memory notes projection (workspace close / quit / invalidate). */
export function releaseNotesIndex() {
  caches.clear();
}

/**
 * Store one workspace projection and evict older roots past the cap.
 * @param {string} root
 * @param {{ notes: object[], builtAt: number, root: string, complete: boolean, scannedTotal: number }} entry
 */
export function storeNotesIndex(root, entry) {
  retainKeyedProjection(caches, root, entry, {
    maxKeys: WORKING_SET_CAPS.notesIndexRoots,
    notesCap: WORKING_SET_CAPS.notesPerRoot,
    activeKey: root,
  });
  return caches.get(root);
}

export function invalidateNotesIndex(relativePath) {
  // Full invalidate is simplest & correct; path-scoped patch can come later.
  void relativePath;
  releaseNotesIndex();
}

/**
 * Count eligible markdown files under non-system / non-hidden categories.
 * No frontmatter parse — used for scannedTotal when the metadata walk is capped.
 * @param {string} root
 * @param {Map<string, object>} roleMap
 */
async function countEligibleMarkdown(root, roleMap, ignore) {
  let count = 0;
  const walkDir = async (dir, relBase) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink() || shouldSkipVaultDirName(e.name)) continue;
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (pathMatchesUserIgnore(rel, ignore)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkDir(abs, rel);
      } else if (e.isFile() && /\.md$/iu.test(e.name)) {
        count += 1;
      }
    }
  };

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    if (!CATEGORY_PATTERN.test(e.name)) continue;
    const def = roleMap.get(e.name) || {};
    const role = def.role || "unknown";
    if (role === "system") continue;
    if (def.hidden) continue;
    await walkDir(path.join(root, e.name), e.name);
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
  const ignore = loadVaultIgnoreSync(root);
  const notes = [];

  const walkDir = async (dir, relBase, { category = null, topic = null } = {}) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (notes.length >= limit) return;
      if (e.isSymbolicLink() || shouldSkipVaultDirName(e.name)) continue;
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (pathMatchesUserIgnore(rel, ignore)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkDir(abs, rel, { category, topic: topic || e.name });
      } else if (e.isFile() && /\.md$/iu.test(e.name)) {
        const s = await statSafe(abs);
        if (!s || !s.isFile()) continue;
        let fm = {};
        try {
          const preview = await readTextPreview(abs, 4096);
          fm = splitMarkdownFrontmatter(preview).data || {};
        } catch { /* no frontmatter */ }
        notes.push({
          path: rel,
          name: e.name,
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
      }
    }
  };

  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    if (!CATEGORY_PATTERN.test(e.name)) continue;
    const def = roleMap.get(e.name) || {};
    const role = def.role || "unknown";
    if (role === "system") continue;
    // Honor categoryOverrides.hidden — keep out of timeline/tags/kanban projections
    if (def.hidden) continue;
    await walkDir(path.join(root, e.name), e.name, { category: e.name, topic: null });
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
      scannedTotal = await countEligibleMarkdown(root, roleMap, ignore);
      if (scannedTotal < notes.length) scannedTotal = notes.length;
    } catch {
      scannedTotal = notes.length;
    }
  }
  storeNotesIndex(root, { notes, builtAt, root, complete, scannedTotal });
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
