/**
 * Workspace size/type statistics for the Tools & Logs panel.
 * No Electron dependency. Skip machine junk; bucket by role-ish top-level.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { CATEGORY_PATTERN, absWorkspaceRoot } from "./path-model.mjs";
import { resolveCategoryRoles } from "./workspace-helpers.mjs";

const SKIP_DIR_NAMES = new Set([
  ".git", ".obsidian", ".topmind", "node_modules",
]);
const SKIP_FILE_RE = /\.tmp-|\.shadow-draft\.tmp$|^\.DS_Store$/u;
const MAX_WALK = 200_000;

function emptyBuckets() {
  return {
    totalFiles: 0,
    totalBytes: 0,
    byExt: new Map(),
    byTopLevel: new Map(),
    largest: [],
    delivery: { count: 0, bytes: 0, oldest: null, newest: null, nestedDirs: 0 },
    archive: {
      count: 0, bytes: 0,
      backups: 0, receipts: 0, trash: 0, streamArchive: 0, other: 0,
    },
    skipped: false,
  };
}

function pushLargest(largest, item, cap = 20) {
  largest.push(item);
  largest.sort((a, b) => b.bytes - a.bytes);
  if (largest.length > cap) largest.length = cap;
}

/**
 * @param {string | { userWorkspaceRoot?: string, workspaceRoot?: string }} workspaceRoot
 * @param {{ includeArchive?: boolean }} [opts]
 */
export async function collectWorkspaceStats(workspaceRoot, opts = {}) {
  // RPC ctx.workspaceRoot is often a workspace *context object*, not a path string.
  const root = absWorkspaceRoot(workspaceRoot);
  const acc = emptyBuckets();
  let roleMap = new Map();
  try {
    roleMap = await resolveCategoryRoles(root);
  } catch { /* fs-only */ }

  let walked = 0;
  async function walk(abs, rel) {
    if (walked >= MAX_WALK) {
      acc.skipped = true;
      return;
    }
    let dirents;
    try {
      dirents = await fs.readdir(abs, { withFileTypes: true });
    } catch { return; }
    for (const d of dirents) {
      if (d.name.startsWith(".") && d.name !== ".topmind") continue;
      if (SKIP_DIR_NAMES.has(d.name)) continue;
      const childAbs = path.join(abs, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!opts.includeArchive && /^99[- ]/u.test(d.name)) {
          // still measure archive separately below via a dedicated pass
        }
        await walk(childAbs, childRel);
        continue;
      }
      if (!d.isFile()) continue;
      if (SKIP_FILE_RE.test(d.name)) continue;
      walked += 1;
      let st;
      try { st = await fs.stat(childAbs); } catch { continue; }
      const bytes = st.size;
      const top = childRel.split("/")[0] || "";
      const ext = (path.extname(d.name) || "(none)").toLowerCase();

      acc.totalFiles += 1;
      acc.totalBytes += bytes;

      const extAgg = acc.byExt.get(ext) || { count: 0, bytes: 0 };
      extAgg.count += 1;
      extAgg.bytes += bytes;
      acc.byExt.set(ext, extAgg);

      const topAgg = acc.byTopLevel.get(top) || { count: 0, bytes: 0 };
      topAgg.count += 1;
      topAgg.bytes += bytes;
      acc.byTopLevel.set(top, topAgg);

      pushLargest(acc.largest, { path: childRel, bytes, mtime: st.mtime?.toISOString?.() || null });

      const role = (roleMap.get(top) || {}).role;
      if (role === "delivery" || /^88[- ]/u.test(top)) {
        acc.delivery.count += 1;
        acc.delivery.bytes += bytes;
        const iso = st.mtime?.toISOString?.() || null;
        if (iso) {
          if (!acc.delivery.oldest || iso < acc.delivery.oldest) acc.delivery.oldest = iso;
          if (!acc.delivery.newest || iso > acc.delivery.newest) acc.delivery.newest = iso;
        }
        if (childRel.split("/").length > 2) acc.delivery.nestedDirs += 1;
      }
      if (role === "system" || /^99[- ]/u.test(top)) {
        acc.archive.count += 1;
        acc.archive.bytes += bytes;
        if (/\/backups\/trash\//u.test(childRel) || /\/backups\/trash$/u.test(path.dirname(childRel))) {
          acc.archive.trash += bytes;
        } else if (/\/backups\//u.test(childRel)) {
          acc.archive.backups += bytes;
        } else if (/\/receipts\//u.test(childRel)) {
          acc.archive.receipts += bytes;
        } else if (/\/stream-archive\//u.test(childRel)) {
          acc.archive.streamArchive += bytes;
        } else {
          acc.archive.other += bytes;
        }
      }
    }
  }

  // Walk everything including 99 for archive buckets; UI can filter.
  await walk(root, "");

  const byExt = [...acc.byExt.entries()]
    .map(([ext, v]) => ({ ext, ...v }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 15);
  const byTopLevel = [...acc.byTopLevel.entries()]
    .map(([name, v]) => ({
      name,
      ...v,
      role: (roleMap.get(name) || {}).role || (CATEGORY_PATTERN.test(name) ? "category" : "other"),
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    scannedAt: new Date().toISOString(),
    skipped: acc.skipped,
    totalFiles: acc.totalFiles,
    totalBytes: acc.totalBytes,
    byExt,
    byTopLevel,
    largest: acc.largest,
    delivery: acc.delivery,
    archive: acc.archive,
  };
}

/** Human-readable byte size (1 decimal). */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
