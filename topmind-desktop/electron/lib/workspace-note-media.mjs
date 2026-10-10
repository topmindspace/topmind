/**
 * Note-local media helpers — keep images/ assets with the markdown note
 * when moving, publishing, deleting, or renaming.
 *
 * Convention (docs/capture-clip-matrix.md):
 *   {noteDir}/note.md
 *   {noteDir}/images/{slug}/img-….png
 *   Markdown: ![alt](images/{slug}/img-….png)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { exists, listDir, statSafe } from "./fs-utils.mjs";
import { resolveDataRoot } from "./path-model.mjs";
import { sp, trashAbsolute, trashRelative } from "./workspace-helpers.mjs";
import {
  buildImageIndex,
  collectImageEmbeds,
  collectLocalMarkdownImageTargets,
  normalizePosixPath,
  resolveEmbedTarget,
  safeDecodePath,
} from "./embed-images.mjs";

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp)$/iu;
const SKIP_WALK_DIR = new Set(["node_modules"]);

/**
 * Workspace-relative raster image paths. Not used by the markdown rewrite.
 * `fresh` skips the short TTL so a move sees files just written.
 * @param {string} root absolute workspace root
 * @param {{ fresh?: boolean, ttlMs?: number, max?: number }} [opts]
 * @returns {Promise<string[]>}
 */
const imageListCache = new Map();

/** Drop the short TTL so the next list walks. Not tied to every text save. */
export function invalidateWorkspaceImageFileList() {
  imageListCache.clear();
}

export async function listWorkspaceImageFiles(root, opts = {}) {
  const absRoot = path.resolve(String(root || ""));
  const fresh = opts.fresh === true;
  const ttl = Number.isFinite(opts.ttlMs) ? opts.ttlMs : 15_000;
  const max = Math.max(1, Math.min(20_000, Number(opts.max) || 8000));
  const hit = imageListCache.get(absRoot);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.paths;
  /** @type {string[]} */
  const paths = [];
  const walk = async (dir) => {
    if (paths.length >= max) return;
    const names = await listDir(dir);
    for (const name of names) {
      if (paths.length >= max) return;
      if (!name || name.startsWith(".") || SKIP_WALK_DIR.has(name)) continue;
      const abs = path.join(dir, name);
      const st = await statSafe(abs);
      if (!st) continue;
      if (st.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (st.isFile() && IMAGE_FILE_RE.test(name)) {
        paths.push(path.relative(absRoot, abs).replace(/\\/gu, "/"));
      }
    }
  };
  await walk(absRoot);
  imageListCache.set(absRoot, { at: Date.now(), paths });
  return paths;
}

/**
 * Local relative media refs in markdown (not http/data/asset protocol).
 * Includes spaced `<Pasted image x.png>` and percent-encoded targets.
 * Skips fenced code. Image wikilinks are planned separately.
 * @param {string} markdown
 * @returns {string[]}
 */
export function findLocalMediaRefs(markdown) {
  return collectLocalMarkdownImageTargets(markdown);
}

/**
 * Plan which relative directories/files under the note dir must travel with the note.
 * @param {string} noteRelativePath workspace-relative .md path
 * @param {string} markdown full file content
 * @param {object} ctx
 * @returns {Promise<{
 *   noteDir: string,
 *   stem: string,
 *   mediaDirs: string[],
 *   mediaFiles: string[],
 *   referencedImages: string[],
 * }>}
 */
export async function planNoteMedia(noteRelativePath, markdown, ctx) {
  const noteRel = String(noteRelativePath).replace(/\\/gu, "/");
  const noteDir = noteRel.includes("/")
    ? noteRel.split("/").slice(0, -1).join("/")
    : "";
  const stem = path.basename(noteRel, path.extname(noteRel));
  const refs = findLocalMediaRefs(markdown);
  const embeds = collectImageEmbeds(markdown);
  /** @type {Set<string>} relative to noteDir */
  const mediaDirs = new Set();
  /** @type {Set<string>} relative to noteDir (loose files not in a slug dir) */
  const mediaFiles = new Set();
  /** @type {Set<string>} workspace-relative image paths that belong to this note */
  const referencedImages = new Set();

  const addRef = (ref) => {
    const cleaned = String(ref || "").replace(/^\.\//u, "").trim();
    if (!cleaned || cleaned.split("/").includes("..")) return;
    const dirMatch = cleaned.match(/^(images\/[^/]+)\//u);
    if (dirMatch) {
      mediaDirs.add(dirMatch[1]);
    } else {
      mediaFiles.add(cleaned);
    }
    const ws = noteDir ? `${noteDir}/${cleaned}` : cleaned;
    referencedImages.add(normalizePosixPath(ws));
  };

  for (const ref of refs) addRef(ref);

  let index = buildImageIndex(undefined);
  if (embeds.some((e) => !e.target.includes("/"))) {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const listed = await listWorkspaceImageFiles(root, { fresh: true });
    index = buildImageIndex(listed);
  }
  for (const emb of embeds) {
    const pathed = emb.target.includes("/");
    let ws = pathed
      ? resolveEmbedTarget(emb.target, buildImageIndex(undefined))
      : resolveEmbedTarget(emb.target, index);
    if (!ws && !pathed) {
      const guess = normalizePosixPath(
        noteDir ? `${noteDir}/${safeDecodePath(emb.target)}` : safeDecodePath(emb.target),
      );
      if (guess && !guess.split("/").includes("..")) {
        const guessAbs = await sp(ctx.workspaceRoot, guess);
        const gst = await statSafe(guessAbs);
        if (gst?.isFile()) ws = guess;
      }
    }
    if (!ws) continue;
    const norm = normalizePosixPath(ws);
    referencedImages.add(norm);
    if (noteDir && norm.startsWith(`${noteDir}/`)) {
      addRef(norm.slice(noteDir.length + 1));
    } else if (!noteDir && !norm.includes("/")) {
      addRef(norm);
    }
  }

  // Convention folder even if not every file is referenced
  const convention = `images/${stem}`;
  const convAbs = await sp(
    ctx.workspaceRoot,
    noteDir ? `${noteDir}/${convention}` : convention,
  );
  const st = await statSafe(convAbs);
  if (st?.isDirectory()) mediaDirs.add(convention);

  return {
    noteDir,
    stem,
    mediaDirs: [...mediaDirs],
    mediaFiles: [...mediaFiles],
    referencedImages: [...referencedImages],
  };
}

/**
 * Copy or move a directory recursively; skip if source missing.
 * @returns {Promise<boolean>} true if something was transferred
 */
async function transferDir(srcAbs, destAbs, { move }) {
  const st = await statSafe(srcAbs);
  if (!st?.isDirectory()) return false;
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  if (move) {
    // If dest exists, merge files
    if (await exists(destAbs)) {
      await fs.cp(srcAbs, destAbs, { recursive: true, force: true });
      await fs.rm(srcAbs, { recursive: true, force: true }).catch(() => {});
    } else {
      await fs.rename(srcAbs, destAbs).catch(async () => {
        await fs.cp(srcAbs, destAbs, { recursive: true });
        await fs.rm(srcAbs, { recursive: true, force: true });
      });
    }
  } else {
    await fs.cp(srcAbs, destAbs, { recursive: true, force: true });
  }
  return true;
}

async function transferFile(srcAbs, destAbs, { move }) {
  const st = await statSafe(srcAbs);
  if (!st?.isFile()) return false;
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  if (move) {
    await fs.rename(srcAbs, destAbs).catch(async () => {
      await fs.copyFile(srcAbs, destAbs);
      await fs.unlink(srcAbs).catch(() => {});
    });
  } else {
    await fs.copyFile(srcAbs, destAbs);
  }
  return true;
}

/**
 * Move or copy note-local media to a new note directory.
 * Relative paths in markdown stay the same (images/slug/… under both dirs).
 *
 * @param {{
 *   noteRelativePath: string,
 *   destNoteDir: string,
 *   markdown: string,
 *   mode?: 'move' | 'copy',
 * }} p
 * @param {object} ctx
 * @returns {Promise<{ movedDirs: string[], movedFiles: string[], count: number }>}
 */
export async function transferNoteMedia(p, ctx) {
  const mode = p.mode === "copy" ? "copy" : "move";
  const plan = await planNoteMedia(p.noteRelativePath, p.markdown, ctx);
  const movedDirs = [];
  const movedFiles = [];
  const srcBase = plan.noteDir;
  const destBase = String(p.destNoteDir || "").replace(/\\/gu, "/");

  for (const d of plan.mediaDirs) {
    const fromRel = srcBase ? `${srcBase}/${d}` : d;
    const toRel = destBase ? `${destBase}/${d}` : d;
    const fromAbs = await sp(ctx.workspaceRoot, fromRel);
    const toAbs = await sp(ctx.workspaceRoot, toRel);
    // Don't move into itself
    if (path.resolve(fromAbs) === path.resolve(toAbs)) continue;
    const ok = await transferDir(fromAbs, toAbs, { move: mode === "move" });
    if (ok) movedDirs.push(toRel);
  }

  for (const f of plan.mediaFiles) {
    // Skip if already covered by a media dir
    if (plan.mediaDirs.some((d) => f === d || f.startsWith(`${d}/`))) continue;
    const fromRel = srcBase ? `${srcBase}/${f}` : f;
    const toRel = destBase ? `${destBase}/${f}` : f;
    const fromAbs = await sp(ctx.workspaceRoot, fromRel);
    const toAbs = await sp(ctx.workspaceRoot, toRel);
    if (path.resolve(fromAbs) === path.resolve(toAbs)) continue;
    const ok = await transferFile(fromAbs, toAbs, { move: mode === "move" });
    if (ok) movedFiles.push(toRel);
  }

  invalidateWorkspaceImageFileList();
  return {
    movedDirs,
    movedFiles,
    count: movedDirs.length + movedFiles.length,
  };
}

/**
 * Rewrite images/{oldSlug}/… → images/{newSlug}/… in markdown bodies.
 * @param {string} markdown
 * @param {string} oldSlug
 * @param {string} newSlug
 */
export function rewriteMediaSlug(markdown, oldSlug, newSlug) {
  const from = String(oldSlug || "").trim();
  const to = String(newSlug || "").trim();
  if (!from || !to || from === to) return String(markdown || "");
  const esc = from.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // ![alt](images/old/…) or ![alt](./images/old/…)
  const re = new RegExp(
    `(!\\[[^\\]]*\\]\\(\\s*<?)(?:\\./)?images/${esc}/`,
    "giu",
  );
  return String(markdown || "").replace(re, `$1images/${to}/`);
}

/**
 * Remove note-local media (dirs + loose files).
 * When `toTrash` is true (locked/core notes only), park under
 * 99-Archive/backups/trash. Ordinary open notes just unlink.
 * Does not delete the .md itself.
 *
 * @param {{ noteRelativePath: string, markdown: string, toTrash?: boolean }} p
 * @param {object} ctx
 * @returns {Promise<{ trashed: string[], count: number }>}
 */
export async function trashNoteMedia(p, ctx) {
  const toTrash = p.toTrash !== false;
  const plan = await planNoteMedia(p.noteRelativePath, p.markdown, ctx);
  const trashed = [];
  const srcBase = plan.noteDir;
  const dirParts = srcBase ? srcBase.split("/").filter(Boolean) : [];
  // ISO stamp — same axis as Kernel writeback-engine trash naming.
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");

  for (const d of plan.mediaDirs) {
    const fromRel = srcBase ? `${srcBase}/${d}` : d;
    const fromAbs = await sp(ctx.workspaceRoot, fromRel);
    const st = await statSafe(fromAbs);
    if (!st?.isDirectory()) continue;
    if (toTrash) {
      const slug = path.basename(d);
      const destAbs = trashAbsolute(
        ctx.workspaceRoot,
        ...dirParts,
        "images",
        `${stamp}__${slug}`,
      );
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      try {
        await fs.cp(fromAbs, destAbs, { recursive: true });
      } catch {
        continue; // copy failed — keep the original in place, never destroy it
      }
      trashed.push(
        trashRelative(ctx.workspaceRoot, ...dirParts, "images", `${stamp}__${slug}`),
      );
    }
    await fs.rm(fromAbs, { recursive: true, force: true }).catch(() => {});
  }

  for (const f of plan.mediaFiles) {
    if (plan.mediaDirs.some((d) => f === d || f.startsWith(`${d}/`))) continue;
    const fromRel = srcBase ? `${srcBase}/${f}` : f;
    const fromAbs = await sp(ctx.workspaceRoot, fromRel);
    const st = await statSafe(fromAbs);
    if (!st?.isFile()) continue;
    if (toTrash) {
      const base = path.basename(f);
      const destAbs = trashAbsolute(
        ctx.workspaceRoot,
        ...dirParts,
        "images",
        `${stamp}__${base}`,
      );
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      try {
        await fs.copyFile(fromAbs, destAbs);
      } catch {
        continue; // copy failed — keep the original in place
      }
      trashed.push(
        trashRelative(ctx.workspaceRoot, ...dirParts, "images", `${stamp}__${base}`),
      );
    }
    await fs.unlink(fromAbs).catch(() => {});
  }

  // Remove empty images/ under note dir
  if (srcBase) {
    const imagesParent = await sp(ctx.workspaceRoot, `${srcBase}/images`);
    try {
      const left = await fs.readdir(imagesParent);
      if (left.length === 0) await fs.rmdir(imagesParent).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  invalidateWorkspaceImageFileList();
  return { trashed, count: trashed.length };
}

/**
 * Rename convention media folder images/{oldStem} → images/{newStem}
 * and rewrite markdown body refs. Returns rewritten markdown.
 *
 * @param {{
 *   noteDir: string,
 *   oldStem: string,
 *   newStem: string,
 *   markdown: string,
 * }} p
 * @param {object} ctx
 * @returns {Promise<{ markdown: string, renamedDir: string | null, rewritten: boolean }>}
 */
export async function renameNoteMediaSlug(p, ctx) {
  const oldStem = String(p.oldStem || "").trim();
  const newStem = String(p.newStem || "").trim();
  const noteDir = String(p.noteDir || "").replace(/\\/gu, "/");
  let markdown = String(p.markdown || "");
  if (!oldStem || !newStem || oldStem === newStem) {
    return { markdown, renamedDir: null, rewritten: false };
  }

  const fromRel = noteDir ? `${noteDir}/images/${oldStem}` : `images/${oldStem}`;
  const toRel = noteDir ? `${noteDir}/images/${newStem}` : `images/${newStem}`;
  const fromAbs = await sp(ctx.workspaceRoot, fromRel);
  const toAbs = await sp(ctx.workspaceRoot, toRel);
  let renamedDir = null;

  const st = await statSafe(fromAbs);
  if (st?.isDirectory()) {
    const destExists = await statSafe(toAbs);
    if (destExists) {
      // Merge into existing new slug folder
      await fs.cp(fromAbs, toAbs, { recursive: true, force: true });
      await fs.rm(fromAbs, { recursive: true, force: true }).catch(() => {});
    } else {
      await fs.mkdir(path.dirname(toAbs), { recursive: true });
      await fs.rename(fromAbs, toAbs).catch(async () => {
        await fs.cp(fromAbs, toAbs, { recursive: true });
        await fs.rm(fromAbs, { recursive: true, force: true });
      });
    }
    renamedDir = toRel;
  }

  const nextMd = rewriteMediaSlug(markdown, oldStem, newStem);
  if (renamedDir) invalidateWorkspaceImageFileList();
  return {
    markdown: nextMd,
    renamedDir,
    rewritten: nextMd !== markdown || Boolean(renamedDir),
  };
}
