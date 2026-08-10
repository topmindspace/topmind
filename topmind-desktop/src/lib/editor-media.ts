/**
 * Rewrite relative markdown image paths ↔ topmind-asset:// for the editor.
 *
 * On disk (truth):  ![alt](images/slug/img-….png)   relative to the note file
 * In editor (view): ![alt](topmind-asset://local/00-Inbox/images/slug/img-….png)
 */

const ASSET_PREFIX = "topmind-asset://local/";

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

/**
 * Disk markdown → editor markdown (relative images become topmind-asset URLs).
 */
export function mediaUrlsForEditor(markdown: string, noteRelativePath: string): string {
  return String(markdown || "").replace(
    /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu,
    (full, alt, rawUrl) => {
      const url = String(rawUrl || "").trim();
      if (!url) return full;
      if (/^(https?:|data:|topmind-asset:|blob:)/iu.test(url)) return full;
      if (url.startsWith("//")) return full;
      const absRel = resolveNoteMediaPath(noteRelativePath, url);
      if (!absRel) return full;
      return `![${alt}](${ASSET_PREFIX}${absRel})`;
    },
  );
}

/**
 * Editor markdown → disk markdown (topmind-asset → relative to note).
 */
export function mediaUrlsForDisk(markdown: string, noteRelativePath: string): string {
  const dir = noteDir(noteRelativePath);
  return String(markdown || "").replace(
    /!\[([^\]]*)\]\(\s*topmind-asset:\/\/local\/([^)\s]+)\s*\)/giu,
    (_full, alt, absRelRaw) => {
      const absRel = normalizePosix(decodeURIComponent(String(absRelRaw || "")));
      let rel = absRel;
      if (dir && absRel.startsWith(`${dir}/`)) {
        rel = absRel.slice(dir.length + 1);
      }
      return `![${alt}](${rel})`;
    },
  );
}
