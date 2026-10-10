/**
 * Rewrite relative markdown image paths ↔ topmind-asset:// for the editor.
 *
 * On disk (truth):  ![alt](images/slug/img-….png)   relative to the note file
 * In editor (view): ![alt](topmind-asset://local/00-Inbox/images/slug/img-….png)
 * Remote http(s) images render via topmind-asset://remote/… (CSP-safe + cache).
 *
 * Obsidian image embeds `![[file.png]]` / `![[attachments/file.png|300]]` become
 * the same asset URLs. The original wikilink is kept in the image title (`tmw:`)
 * so save writes the wikilink back. Resolution uses a caller-supplied path list
 * and does not walk the disk.
 */
import {
  embedDisplayFromTitle,
  restoreWorkspaceImageMarkdown,
  rewriteWorkspaceImageMarkdown,
  wikilinkFromTitle,
} from "../../electron/lib/embed-images.mjs";

const ASSET_PREFIX = "topmind-asset://local/";
const REMOTE_PREFIX = "topmind-asset://remote/";

/** CSP-safe proxy URL for a remote image (main-process caches to media-cache). */
export function remoteAssetUrl(href: string): string {
  const h = String(href || "").trim();
  if (!/^https?:\/\//iu.test(h)) return h;
  return `${REMOTE_PREFIX}${encodeURIComponent(h)}`;
}

/** Decode topmind-asset://remote/<encoded> back to the remote URL. */
export function decodeRemoteAssetUrl(src: string): string {
  const m = String(src || "").match(/^topmind-asset:\/\/remote\/(.+)$/iu);
  if (!m) return String(src || "");
  try {
    return decodeURIComponent(m[1] || "");
  } catch {
    return m[1] || "";
  }
}

function noteDir(noteRelativePath: string): string {
  const p = String(noteRelativePath || "").replace(/\\/gu, "/");
  if (!p.includes("/")) return "";
  return p.split("/").slice(0, -1).join("/");
}

function normalizePosix(rel: string): string {
  const parts: string[] = [];
  for (const seg of String(rel || "").replace(/\\/gu, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Resolve a path relative to the note's directory into a workspace-relative path.
 */
export function resolveNoteMediaPath(noteRelativePath: string, mediaRel: string): string {
  const cleaned = String(mediaRel || "")
    .trim()
    .replace(/^<|>$/gu, "")
    .replace(/^["']|["']$/gu, "");
  if (!cleaned) return "";
  // already workspace-absolute-ish (starts with NN- or known roots) — keep if no ./
  if (cleaned.startsWith("images/") || cleaned.startsWith("./images/")) {
    const dir = noteDir(noteRelativePath);
    const joined = dir ? `${dir}/${cleaned.replace(/^\.\//u, "")}` : cleaned.replace(/^\.\//u, "");
    return normalizePosix(joined);
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(cleaned)) return ""; // scheme — not relative
  const dir = noteDir(noteRelativePath);
  const joined = dir ? `${dir}/${cleaned}` : cleaned;
  return normalizePosix(joined);
}

function isRemoteOrAssetUrl(url: string): boolean {
  const u = String(url || "").trim();
  return !u || /^(https?:|data:|topmind-asset:|blob:)/iu.test(u) || u.startsWith("//");
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//iu.test(String(url || "").trim());
}

/** Rewrite src= on HTML <img> tags. Leaves the tag unchanged when rewrite returns null. */
function rewriteHtmlImgSrc(
  html: string,
  rewrite: (url: string) => string | null,
): string {
  return String(html || "").replace(/<img\b[^>]*>/giu, (tag) =>
    tag.replace(/\bsrc\s*=\s*(["'])([^"']*)\1/iu, (full, q, url) => {
      const next = rewrite(String(url || "").trim());
      return next == null ? full : `src=${q}${next}${q}`;
    }),
  );
}

/**
 * DOM attrs for an editor image. Numeric wikilink sizes apply as width but
 * stay inside the content column (`max-width: 100%`). The `tmw:` title is
 * not shown as a tooltip — it only round-trips the original embed.
 */
export function wikiImageDomAttrs(title: unknown): { width?: string; style: string } {
  const style = "max-width:100%;height:auto";
  const display = embedDisplayFromTitle(String(title || ""));
  if (!display?.width) return { style };
  return {
    width: String(display.width),
    style: `width:${display.width}px;max-width:100%;height:auto`,
  };
}

/**
 * Disk markdown → editor markdown (relative images become topmind-asset URLs).
 * Covers `![alt](url)`, Obsidian `![[image]]`, and HTML `<img src>`.
 * Remote http(s) images go through topmind-asset://remote/… for CSP-safe display.
 *
 * `knownPaths` is an already-built workspace-relative list. Pathless embeds
 * resolve from it in one pass. Omit it to keep note-relative markdown images
 * and pathed embeds only (no basename lookup).
 */
export function mediaUrlsForEditor(
  markdown: string,
  noteRelativePath: string,
  knownPaths?: readonly string[] | null,
): string {
  return rewriteWorkspaceImageMarkdown(markdown, noteRelativePath, knownPaths);
}

/**
 * Preview HTML (stream cards / memory feed) — rewrite relative `<img src>`
 * to `topmind-asset://` so images next to the note actually render.
 * Remote http(s) images go through the remote proxy the same way.
 */
export function rewritePreviewHtmlMedia(html: string, noteRelativePath: string): string {
  if (!html) return html;
  return rewriteHtmlImgSrc(html, (url) => {
    if (/^(data:|topmind-asset:|blob:)/iu.test(url) || url.startsWith("//")) return null;
    if (isHttpUrl(url)) return remoteAssetUrl(url);
    if (!noteRelativePath) return null;
    if (isRemoteOrAssetUrl(url)) return null;
    const absRel = resolveNoteMediaPath(noteRelativePath, url);
    return absRel ? `${ASSET_PREFIX}${absRel}` : null;
  });
}

function decodeAssetPath(absRelRaw: string): string {
  // Segment decode so a literal `%` in `100%-方案` does not throw away the
  // rest of a path that also contains a real `%20`.
  const decoded = String(absRelRaw || "")
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
  return normalizePosix(decoded);
}

/**
 * Editor markdown → disk markdown (topmind-asset → relative to note).
 * Wikilink-origin images (`tmw:` title) are written back as `![[…]]`.
 */
export function mediaUrlsForDisk(markdown: string, noteRelativePath: string): string {
  const dir = noteDir(noteRelativePath);
  const toRelative = (absRelRaw: string): string => {
    const absRel = decodeAssetPath(absRelRaw);
    if (dir && absRel.startsWith(`${dir}/`)) return absRel.slice(dir.length + 1);
    return absRel;
  };
  let out = restoreWorkspaceImageMarkdown(markdown, noteRelativePath);
  out = out.replace(/<img\b[^>]*>/giu, (tag) => {
    const title = /\btitle\s*=\s*(["'])([^"']*)\1/iu.exec(tag)?.[2] || "";
    const wiki = wikilinkFromTitle(title);
    if (wiki) return wiki;
    return tag.replace(/\bsrc\s*=\s*(["'])([^"']*)\1/iu, (full, q, url) => {
      const m = String(url || "").trim().match(/^topmind-asset:\/\/local\/(.+)$/iu);
      if (!m) return full;
      return `src=${q}${toRelative(m[1] || "")}${q}`;
    });
  });
  return out;
}
