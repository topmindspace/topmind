/**
 * Directory listing with nested folders + file-filter modes.
 * Used by topic tree lazy-load, Outputs, Archive.
 */
import path from "node:path";
import { lstat } from "node:fs/promises";
import { exists, listDir, statSafe, readTextPreview } from "./fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./frontmatter.mjs";
import { S, sp } from "./workspace-helpers.mjs";
import { absWorkspaceRoot } from "./path-model.mjs";
import { isEscapingSymlinkSync } from "./path-safety.mjs";
import {
  shouldShowFile,
  shouldSkipDirName,
  normalizeFileFilterMode,
  fileExtension,
  loadVaultIgnoreSync,
  pathMatchesUserIgnore,
} from "./file-filter.mjs";

async function peekMdTitle(absPath) {
  if (!/\.md$/iu.test(absPath)) return null;
  try {
    const preview = await readTextPreview(absPath, 2048);
    const data = splitMarkdownFrontmatter(preview).data || {};
    return typeof data.title === "string" ? data.title : null;
  } catch {
    return null;
  }
}

/** Peek published_at from markdown frontmatter (delivery shelf honesty). */
async function peekMdPublishedAt(absPath) {
  if (!/\.md$/iu.test(absPath)) return null;
  try {
    const preview = await readTextPreview(absPath, 2048);
    const data = splitMarkdownFrontmatter(preview).data || {};
    const raw = data.published_at ?? data.publishedAt;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * Attach delivery metadata for output shelf rows.
 * @param {{ name: string, relativePath: string, size: number, mtime: string, ext?: string }} file
 * @param {string} absPath
 */
async function enrichOutputFile(file, absPath) {
  if (!/\.md$/iu.test(file.name || absPath)) {
    return { ...file, publishedAt: null, title: null };
  }
  const [title, publishedAt] = await Promise.all([
    peekMdTitle(absPath),
    peekMdPublishedAt(absPath),
  ]);
  return { ...file, title, publishedAt };
}

/**
 * List one directory under the workspace (not recursive).
 * @param {{ relativePath: string, filter?: string }} p
 */
export async function listWorkspaceDir({ relativePath, filter }, ctx) {
  S(relativePath, "relativePath");
  const mode = normalizeFileFilterMode(filter || ctx?.fileFilterMode || "default");
  const abs = await sp(ctx.workspaceRoot, relativePath);
  if (!(await exists(abs))) return { relativePath, filter: mode, entries: [] };
  const root = absWorkspaceRoot(ctx.workspaceRoot);
  const ignore = loadVaultIgnoreSync(root);

  const names = await listDir(abs).catch(() => []);
  /** @type {Array<object>} */
  const entries = [];
  for (const name of names) {
    if (shouldSkipDirName(name)) continue;
    const childAbs = path.join(abs, name);
    const childRel = relativePath ? `${relativePath.replace(/\\/gu, "/")}/${name}` : name;
    if (pathMatchesUserIgnore(childRel, ignore)) continue;
    let lst;
    try {
      lst = await lstat(childAbs);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink() && isEscapingSymlinkSync(root, childAbs)) continue;
    const st = lst.isSymbolicLink() ? await statSafe(childAbs) : lst;
    if (!st) continue;
    if (st.isDirectory()) {
      // Count visible children (shallow) for badge. lstat so a symlink out of
      // the vault is not reported as a directory of /Applications.
      let childCount = 0;
      try {
        const sub = await listDir(childAbs);
        for (const s of sub) {
          if (shouldSkipDirName(s)) continue;
          const sAbs = path.join(childAbs, s);
          const sRel = `${childRel}/${s}`;
          if (pathMatchesUserIgnore(sRel, ignore)) continue;
          let subLst;
          try {
            subLst = await lstat(sAbs);
          } catch {
            continue;
          }
          if (subLst.isSymbolicLink()) {
            if (isEscapingSymlinkSync(root, sAbs)) continue;
            const followed = await statSafe(sAbs);
            if (!followed) continue;
            if (followed.isDirectory()) childCount += 1;
            else if (followed.isFile() && shouldShowFile(s, mode)) childCount += 1;
            continue;
          }
          if (subLst.isDirectory()) childCount += 1;
          else if (subLst.isFile() && shouldShowFile(s, mode)) childCount += 1;
        }
      } catch {
        /* */
      }
      entries.push({
        kind: "dir",
        name,
        relativePath: childRel.replace(/\\/gu, "/"),
        mtime: st.mtime.toISOString(),
        size: 0,
        childCount,
      });
    } else if (st.isFile()) {
      if (!shouldShowFile(name, mode)) continue;
      const title = await peekMdTitle(childAbs);
      entries.push({
        kind: "file",
        name,
        relativePath: childRel.replace(/\\/gu, "/"),
        mtime: st.mtime.toISOString(),
        size: st.size,
        title,
        ext: fileExtension(name),
      });
    }
  }

  // Dirs first, then files — both by mtime desc within group for recent work
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return String(b.mtime || "").localeCompare(String(a.mtime || ""));
  });

  return { relativePath: relativePath.replace(/\\/gu, "/"), filter: mode, entries };
}

/**
 * Enhanced topic listing: files + subdirs at topic root (or nested path).
 * @param {{ topicId: string, subPath?: string, filter?: string }} p
 */
export async function listTopicFilesEnhanced({ topicId, subPath = "", filter }, ctx) {
  S(topicId, "topicId");
  const rel = subPath
    ? `${topicId.replace(/\\/gu, "/")}/${String(subPath).replace(/^\/+|\/+$/gu, "")}`
    : topicId.replace(/\\/gu, "/");
  const listed = await listWorkspaceDir({ relativePath: rel, filter }, ctx);
  // Backward-compatible flat files array (files only, this level)
  const files = listed.entries
    .filter((e) => e.kind === "file")
    .map((e) => ({
      name: e.name,
      size: e.size,
      mtime: e.mtime,
      title: e.title ?? null,
      relativePath: e.relativePath,
    }));
  return {
    topicId,
    subPath: subPath || "",
    filter: listed.filter,
    files,
    entries: listed.entries,
  };
}

/**
 * Outputs: top-level or nested under 88-Outputs.
 * When recursiveFlat is true, walk all files (for OutputsView search).
 */
export async function listOutputsEnhanced({ subPath = "", filter, recursiveFlat = false, limit = 500 }, ctx) {
  // Resolve outputs dir name via path helpers
  const { outputsRoot } = await import("./path-model.mjs");
  const outAbs = outputsRoot(ctx.workspaceRoot);
  const outputsName = path.basename(outAbs);
  const relBase = subPath
    ? `${outputsName}/${String(subPath).replace(/^\/+|\/+$/gu, "")}`
    : outputsName;

  if (!recursiveFlat) {
    const listed = await listWorkspaceDir({ relativePath: relBase, filter }, ctx);
    const baseFiles = listed.entries
      .filter((e) => e.kind === "file")
      .map((e) => ({
        name: e.name,
        relativePath: e.relativePath,
        size: e.size,
        mtime: e.mtime,
        ext: e.ext,
      }));
    const files = [];
    for (const f of baseFiles) {
      // ctx.workspaceRoot may be a WorkspaceContext object — use sp() not path.join
      const abs = await sp(ctx.workspaceRoot, f.relativePath);
      files.push(await enrichOutputFile(f, abs));
    }
    return {
      outputsName,
      subPath: subPath || "",
      filter: listed.filter,
      files,
      entries: listed.entries,
    };
  }

  // Recursive flat walk for main Outputs view
  const mode = normalizeFileFilterMode(filter || "default");
  const files = [];
  const walk = async (abs, prefix) => {
    if (files.length >= limit) return;
    let names;
    try {
      names = await listDir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (files.length >= limit) return;
      if (shouldSkipDirName(name)) continue;
      const childAbs = path.join(abs, name);
      let st;
      try { st = await lstat(childAbs); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      const childRel = prefix ? `${prefix}/${name}` : `${outputsName}/${name}`;
      if (st.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (st.isFile() && shouldShowFile(name, mode)) {
        const raw = {
          name,
          relativePath: childRel.replace(/\\/gu, "/"),
          size: st.size,
          mtime: st.mtime.toISOString(),
          ext: fileExtension(name),
        };
        files.push(await enrichOutputFile(raw, childAbs));
      }
    }
  };
  await walk(outAbs, outputsName);
  files.sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));
  return { outputsName, filter: mode, files, entries: [] };
}

/**
 * Archive listing — one directory level (lazy tree) or recursive flat.
 */
export async function listArchiveEnhanced({ subPath = "", filter, recursiveFlat = false, limit = 500 }, ctx) {
  const { archiveRoot } = await import("./path-model.mjs");
  const archAbs = archiveRoot(ctx.workspaceRoot);
  const archiveName = path.basename(archAbs);
  const relBase = subPath
    ? `${archiveName}/${String(subPath).replace(/^\/+|\/+$/gu, "")}`
    : archiveName;

  if (!recursiveFlat) {
    const listed = await listWorkspaceDir(
      { relativePath: relBase, filter: filter || "all" },
      ctx,
    );
    const items = listed.entries
      .filter((e) => e.kind === "file")
      .map((e) => ({
        name: e.name,
        relativePath: e.relativePath,
        size: e.size,
        mtime: e.mtime,
      }));
    return {
      archiveName,
      subPath: subPath || "",
      filter: listed.filter,
      items,
      entries: listed.entries,
    };
  }

  const mode = normalizeFileFilterMode(filter || "all");
  const items = [];
  const walk = async (abs, prefix) => {
    if (items.length >= limit) return;
    let names;
    try {
      names = await listDir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (items.length >= limit) return;
      if (shouldSkipDirName(name)) continue;
      const childAbs = path.join(abs, name);
      let st;
      try { st = await lstat(childAbs); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      const childRel = prefix ? `${prefix}/${name}` : `${archiveName}/${name}`;
      if (st.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (st.isFile() && shouldShowFile(name, mode === "default" ? "all" : mode)) {
        items.push({
          name,
          relativePath: childRel.replace(/\\/gu, "/"),
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      }
    }
  };
  await walk(archAbs, archiveName);
  items.sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));
  return { archiveName, filter: mode, items, entries: [] };
}

