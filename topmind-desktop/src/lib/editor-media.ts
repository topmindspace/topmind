/**
 * Rewrite relative markdown image paths ↔ topmind-asset:// for the editor.
 *
 * On disk (truth):  ![alt](images/slug/img-….png)   relative to the note file
 * In editor (view): ![alt](topmind-asset://local/00-Inbox/images/slug/img-….png)
 * Remote http(s) images render via topmind-asset://remote/… (CSP-safe + cache).
 */

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
 * Disk markdown → editor markdown (relative images become topmind-asset URLs).
 * Covers `![alt](url)` and HTML `<img src>` (TipTap html:true may emit either).
 * Remote http(s) images go through topmind-asset://remote/… for CSP-safe display.
 */
export function mediaUrlsForEditor(markdown: string, noteRelativePath: string): string {
  let out = String(markdown || "").replace(
    /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu,
    (full, alt, rawUrl) => {
      const url = String(rawUrl || "").trim();
      if (/^(data:|topmind-asset:|blob:)/iu.test(url) || url.startsWith("//")) return full;
      if (isHttpUrl(url)) return `![${alt}](${remoteAssetUrl(url)})`;
      if (isRemoteOrAssetUrl(url)) return full;
      const absRel = resolveNoteMediaPath(noteRelativePath, url);
      if (!absRel) return full;
      return `![${alt}](${ASSET_PREFIX}${absRel})`;
    },
  );
  out = rewriteHtmlImgSrc(out, (url) => {
    if (/^(data:|topmind-asset:|blob:)/iu.test(url) || url.startsWith("//")) return null;
    if (isHttpUrl(url)) return remoteAssetUrl(url);
    if (isRemoteOrAssetUrl(url)) return null;
    const absRel = resolveNoteMediaPath(noteRelativePath, url);
    return absRel ? `${ASSET_PREFIX}${absRel}` : null;
  });
  return out;
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

/**
 * Editor markdown → disk markdown (topmind-asset → relative to note).
 */
export function mediaUrlsForDisk(markdown: string, noteRelativePath: string): string {
  const dir = noteDir(noteRelativePath);
  const toRelative = (absRelRaw: string): string => {
    // The editor URL is percent-encoded by the renderer, so decode it back —
    // but a literal `%` (note path like `100%-方案/`) must not throw here.
    let decoded = String(absRelRaw || "");
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* keep the raw form — malformed percent escape */
    }
    const absRel = normalizePosix(decoded);
    if (dir && absRel.startsWith(`${dir}/`)) return absRel.slice(dir.length + 1);
    return absRel;
  };
  let out = String(markdown || "").replace(
    /!\[([^\]]*)\]\(\s*topmind-asset:\/\/local\/([^)\s]+)\s*\)/giu,
    (_full, alt, absRelRaw) => `![${alt}](${toRelative(absRelRaw)})`,
  );
  out = rewriteHtmlImgSrc(out, (url) => {
    const m = url.match(/^topmind-asset:\/\/local\/(.+)$/iu);
    return m ? toRelative(m[1] || "") : null;
  });
  return out;
}
