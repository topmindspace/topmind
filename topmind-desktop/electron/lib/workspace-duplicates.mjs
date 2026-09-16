/**
 * Duplicate file detection — three-phase, streaming hash.
 *
 * P1 size buckets → P2 head+tail digest → P3 full sha256.
 * Typical workspaces only fully-hash a tiny candidate set.
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { absWorkspaceRoot } from "./path-model.mjs";

const SKIP_DIR_NAMES = new Set([".git", ".obsidian", ".topmind", "node_modules"]);
const SKIP_FILE_RE = /\.tmp-|\.shadow-draft\.tmp$|^\.DS_Store$/u;
// Writeback sidecars (`20260101T120000__note.md`) and classic backup suffixes.
// Deliberately not a bare `/__/` — user files may legitimately contain `__`.
const BACKUP_NAME_RE = /(?:^\d{8}(?:T\d{6})?__|__backup\b|\.(?:bak|old|orig|copy)$)/iu;
const HEAD_TAIL = 4096;
const DEFAULT_MIN_SIZE = 1024;
const DEFAULT_MAX_GROUPS = 50;
const DEFAULT_MAX_FULL_HASH_BYTES = 50 * 1024 * 1024;

/**
 * Default keep index for a duplicate group — used by Tools panel bulk clean.
 * Prefer: non-backup name → newest mtime → year-dir path (stream stickiness)
 * → first walk order. Never auto-pick when `full` is false (partial-only).
 * @param {{ paths: string[], mtimes?: string[], full?: boolean }} group
 * @returns {number}
 */
export function suggestKeepIndex(group) {
  const paths = group?.paths || [];
  if (paths.length <= 1) return 0;
  if (group?.full === false) return 0;
  const score = (i) => {
    const p = String(paths[i] || "");
    const name = p.split("/").pop() || p;
    let s = 0;
    if (!BACKUP_NAME_RE.test(name)) s += 4;
    if (/\d{4}\/\d{4}-W\d{2}\.md$/u.test(p)) s += 2; // year-dir sticky twin preferred
    const mtime = group?.mtimes?.[i] ? Date.parse(group.mtimes[i]) : NaN;
    if (Number.isFinite(mtime)) s += mtime / 1e15; // tiny tiebreak, newest wins
    return s;
  };
  let best = 0;
  let bestScore = score(0);
  for (let i = 1; i < paths.length; i++) {
    const s = score(i);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

async function headTailDigest(abs, size) {
  const fd = await fs.open(abs, "r");
  try {
    const headLen = Math.min(HEAD_TAIL, size);
    const head = Buffer.alloc(headLen);
    await fd.read(head, 0, headLen, 0);
    let tail = Buffer.alloc(0);
    if (size > HEAD_TAIL) {
      const tLen = Math.min(HEAD_TAIL, size - HEAD_TAIL);
      tail = Buffer.alloc(tLen);
      await fd.read(tail, 0, tLen, size - tLen);
    }
    return createHash("sha256")
      .update(head)
      .update(tail)
      .update(String(size))
      .digest("hex")
      .slice(0, 32);
  } finally {
    await fd.close();
  }
}

function fullHash(abs) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(abs);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * @param {string | { userWorkspaceRoot?: string, workspaceRoot?: string }} workspaceRoot
 * @param {{ minSize?: number, maxGroups?: number, maxFullHashBytes?: number, includeArchive?: boolean }} [opts]
 */
export async function findDuplicateFiles(workspaceRoot, opts = {}) {
  const root = absWorkspaceRoot(workspaceRoot);
  const minSize = Number.isFinite(opts.minSize) ? Number(opts.minSize) : DEFAULT_MIN_SIZE;
  const maxGroups = Number.isFinite(opts.maxGroups) ? Number(opts.maxGroups) : DEFAULT_MAX_GROUPS;
  const maxFull = Number.isFinite(opts.maxFullHashBytes) ? Number(opts.maxFullHashBytes) : DEFAULT_MAX_FULL_HASH_BYTES;
  const includeArchive = Boolean(opts.includeArchive);

  /** @type {Map<number, Array<{rel: string, abs: string, mtime: string}>>} */
  const bySize = new Map();

  async function walk(abs, rel) {
    let dirents;
    try { dirents = await fs.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const d of dirents) {
      if (SKIP_DIR_NAMES.has(d.name)) continue;
      if (d.name.startsWith(".")) continue;
      const childAbs = path.join(abs, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (!includeArchive && /^99[- ]/u.test(d.name)) continue;
      if (d.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (!d.isFile() || SKIP_FILE_RE.test(d.name)) continue;
      if (BACKUP_NAME_RE.test(d.name)) continue;
      let st;
      try { st = await fs.stat(childAbs); } catch { continue; }
      if (st.size < minSize) continue;
      const bucket = bySize.get(st.size) || [];
      bucket.push({ rel: childRel, abs: childAbs, mtime: st.mtime?.toISOString?.() || "" });
      bySize.set(st.size, bucket);
    }
  }
  await walk(root, "");

  // P2 — partial digest
  /** @type {Map<string, {size: number, files: Array<{rel: string, abs: string, mtime: string}>}>} */
  const byPartial = new Map();
  for (const [size, files] of bySize) {
    if (files.length < 2) continue;
    for (const f of files) {
      try {
        const dig = await headTailDigest(f.abs, size);
        const key = `${size}:${dig}`;
        const g = byPartial.get(key) || { size, files: [] };
        g.files.push(f);
        byPartial.set(key, g);
      } catch { /* unreadable */ }
    }
  }

  // P3 — full hash
  const groups = [];
  for (const g of byPartial.values()) {
    if (g.files.length < 2) continue;
    /** @type {Map<string, Array<{rel: string, abs: string, mtime: string}>>} */
    const byFull = new Map();
    for (const f of g.files) {
      if (g.size > maxFull) {
        // Too large: keep as size+partial collision group (still useful signal)
        const key = "partial-only";
        const arr = byFull.get(key) || [];
        arr.push(f);
        byFull.set(key, arr);
        continue;
      }
      try {
        const dig = await fullHash(f.abs);
        const arr = byFull.get(dig) || [];
        arr.push(f);
        byFull.set(dig, arr);
      } catch { /* skip */ }
    }
    for (const [hash, files] of byFull) {
      if (files.length < 2) continue;
      const group = {
        hash,
        size: g.size,
        full: hash !== "partial-only",
        paths: files.map((f) => f.rel),
        mtimes: files.map((f) => f.mtime),
      };
      group.suggestedKeepIndex = suggestKeepIndex(group);
      groups.push(group);
    }
  }

  groups.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1));
  const waste = groups.reduce((s, g) => s + g.size * (g.paths.length - 1), 0);
  return {
    scannedAt: new Date().toISOString(),
    minSize,
    groupCount: groups.length,
    wastedBytes: waste,
    groups: groups.slice(0, maxGroups),
    truncated: groups.length > maxGroups,
  };
}
