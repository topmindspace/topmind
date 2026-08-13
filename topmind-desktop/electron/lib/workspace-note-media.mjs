/**
 * Note-local media helpers — keep images/ assets with the markdown note
 * when moving, publishing, deleting, or renaming.
 *
 * Convention (skills/shared/media-assets.md):
 *   {noteDir}/note.md
 *   {noteDir}/images/{slug}/img-….png
 *   Markdown: ![alt](images/{slug}/img-….png)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { exists, statSafe } from "./fs-utils.mjs";
import { sp, trashAbsolute, trashRelative } from "./workspace-helpers.mjs";
import { timestampStamp } from "./writeback.mjs";

const MD_IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu;

/**
 * Local relative media refs in markdown (not http/data/asset protocol).
 * @param {string} markdown
 * @returns {string[]}
 */
export function findLocalMediaRefs(markdown) {
  const refs = [];
  const seen = new Set();
  let m;
  const re = new RegExp(MD_IMG_RE.source, MD_IMG_RE.flags);
  while ((m = re.exec(String(markdown || ""))) !== null) {
    let url = String(m[2] || "").trim().replace(/^<|>$/gu, "");
    if (!url) continue;
    if (/^(https?:|data:|blob:|topmind-asset:|file:)/iu.test(url)) continue;
    if (url.startsWith("//")) continue;
    url = url.replace(/^\.\//u, "");
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push(url);
  }
  return refs;
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
 * }>}
 */
export async function planNoteMedia(noteRelativePath, markdown, ctx) {
  const noteRel = String(noteRelativePath).replace(/\\/gu, "/");
  const noteDir = noteRel.includes("/")
    ? noteRel.split("/").slice(0, -1).join("/")
    : "";
  const stem = path.basename(noteRel, path.extname(noteRel));
  const refs = findLocalMediaRefs(markdown);
  /** @type {Set<string>} relative to noteDir */
  const mediaDirs = new Set();
  /** @type {Set<string>} relative to noteDir (loose files not in a slug dir) */
  const mediaFiles = new Set();

  for (const ref of refs) {
    const cleaned = ref.replace(/^\.\//u, "");
    // images/{slug}/file.ext → move whole images/{slug}
    const dirMatch = cleaned.match(/^(images\/[^/]+)\//u);
    if (dirMatch) {
      mediaDirs.add(dirMatch[1]);
      continue;
    }
    // images/file.ext (flat)
    if (cleaned.startsWith("images/")) {
      mediaFiles.add(cleaned);
      continue;
    }
    // other relative assets next to note
    mediaFiles.add(cleaned);
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
  const stamp = timestampStamp();

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
      await fs.cp(fromAbs, destAbs, { recursive: true }).catch(() => {});
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
      await fs.copyFile(fromAbs, destAbs).catch(() => {});
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
  return {
    markdown: nextMd,
    renamedDir,
    rewritten: nextMd !== markdown || Boolean(renamedDir),
  };
}
