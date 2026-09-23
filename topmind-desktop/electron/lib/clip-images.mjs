/**
 * Clip / capture image localization.
 *
 * Convention (PROJECT-MODEL):
 *   Note at  {dest}/note.md
 *   Assets:  {dest}/images/{slug}/img-{hash}.{ext}
 *   Markdown: ![alt](images/{slug}/img-....png)   ← relative to the note file
 *
 * Fixes vs v1:
 * - Resolve protocol-relative + relative URLs via baseUrl (page URL)
 * - Pass Referer so CDN hotlink protection is less likely to 403
 * - Match all markdown image forms, not only absolute https in the regex gate
 * - Safer per-match rewrite (not global `](url)` which can hit links)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pickImgSrc } from "./html-to-markdown.mjs";

const MAX_IMAGES = 40;
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 15_000;

/**
 * One downloadable image reference.
 * @typedef {{ full: string, alt: string, url: string }} ImageHit
 */

/**
 * Resolve a media href against an optional page base URL.
 * @param {string} href
 * @param {string} [baseUrl]
 * @returns {string | null} absolute http(s) URL, or null if not downloadable
 */
export function resolveMediaUrl(href, baseUrl) {
  let h = String(href || "").trim();
  if (!h) return null;
  // strip optional angle brackets / surrounding quotes from markdown
  h = h.replace(/^<|>$/gu, "").replace(/^["']|["']$/gu, "");
  if (!h || h.startsWith("data:") || h.startsWith("blob:") || h.startsWith("javascript:")) {
    return null;
  }
  // already absolute
  if (/^https?:\/\//iu.test(h)) {
    try {
      return new URL(h).href;
    } catch {
      return null;
    }
  }
  // protocol-relative
  if (h.startsWith("//")) {
    try {
      const proto = baseUrl ? new URL(baseUrl).protocol : "https:";
      return new URL(`${proto}${h}`).href;
    } catch {
      return null;
    }
  }
  // root- or path-relative — need base
  if (!baseUrl) return null;
  try {
    return new URL(h, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Collect markdown image matches: ![alt](url) / ![alt](<url>) / with optional title.
 * @param {string} markdown
 * @returns {ImageHit[]}
 */
export function findMarkdownImages(markdown) {
  const md = String(markdown || "");
  const re = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu;
  /** @type {ImageHit[]} */
  const out = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    out.push({ full: m[0], alt: m[1] || "", url: (m[2] || "").trim() });
  }
  return out;
}

/**
 * Leftover HTML `<img>` that the HTML→Markdown pass kept verbatim.
 *
 * Uses the shared `pickImgSrc` so lazy-load attributes (`data-src`,
 * `data-original`, `data-actualsrc`) and `srcset` are honoured — otherwise a
 * placeholder `src` (1×1 gif) would be "downloaded" and the real image lost.
 * Rewritten to markdown by the caller so editor and feed share one path.
 * @param {string} html
 * @returns {ImageHit[]}
 */
export function findHtmlImages(html) {
  const src = String(html || "");
  const re = /<img\b[^>]*>/giu;
  /** @type {ImageHit[]} */
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = m[0];
    const url = pickImgSrc(tag);
    if (!url) continue;
    const altM = tag.match(/\balt\s*=\s*["']([^"']*)["']/iu);
    out.push({ full: tag, alt: altM ? altM[1] : "", url: url.trim() });
  }
  return out;
}

/**
 * @param {string} markdown
 * @param {{
 *   imagesDirAbs: string,
 *   relPrefix: string,
 *   baseUrl?: string,
 *   maxImages?: number,
 *   referer?: string,
 * }} opts
 * @returns {Promise<{ markdown: string, downloaded: number, failed: number, skipped: number }>}
 */
export async function localizeMarkdownImages(markdown, opts) {
  const md = String(markdown || "");
  // Markdown and leftover HTML `<img>` are disjoint spans — one URL can appear
  // in both forms, so both lists feed the same download/replace pass.
  const matches = [...findMarkdownImages(md), ...findHtmlImages(md)];
  if (!matches.length) {
    return { markdown: md, downloaded: 0, failed: 0, skipped: 0 };
  }

  const maxImages = Math.min(Math.max(Number(opts.maxImages) || MAX_IMAGES, 1), 80);
  const baseUrl = opts.baseUrl || opts.referer || "";
  const referer = opts.referer || baseUrl || "";

  await fs.mkdir(opts.imagesDirAbs, { recursive: true });

  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  /** @type {Map<string, string>} absoluteUrl -> local rel path */
  const seen = new Map();
  /** @type {Array<{ from: string, to: string }>} exact full-match replacements */
  const replacements = [];

  for (const hit of matches.slice(0, maxImages)) {
    const abs = resolveMediaUrl(hit.url, baseUrl);
    // Non-downloadable (data:, blob:, relative without a base) — leave as-is.
    if (!abs || !/^https?:\/\//iu.test(abs)) {
      skipped += 1;
      continue;
    }
    // Same URL seen earlier in this pass (markdown + leftover <img> can share
    // one target): reuse the local path instead of downloading twice.
    if (seen.has(abs)) {
      const local = seen.get(abs);
      // Failed downloads are remembered with an empty path — never rewrite
      // them, or a titled `![a](<url> "t")` would silently lose its title.
      if (local) replacements.push({ from: hit.full, to: `![${hit.alt}](${local})` });
      continue;
    }
    try {
      const localName = await downloadOne(abs, opts.imagesDirAbs, referer);
      const rel = `${opts.relPrefix}/${localName}`.replace(/\\/gu, "/");
      seen.set(abs, rel);
      replacements.push({ from: hit.full, to: `![${hit.alt}](${rel})` });
      downloaded += 1;
    } catch {
      failed += 1;
      seen.set(abs, "");
    }
  }

  // Replacements are applied by exact full-text match (never by index), so
  // duplicate forms of the same image collapse into a single pass.
  let out = md;
  const applied = new Set();
  for (const { from, to } of replacements) {
    if (from === to) continue;
    if (!applied.has(from + "→" + to)) {
      // split/join is safer than replaceAll when `from` has regex special chars
      out = out.split(from).join(to);
      applied.add(from + "→" + to);
    }
  }

  return { markdown: out, downloaded, failed, skipped };
}

/**
 * @param {string} url
 * @param {string} dirAbs
 * @param {string} [referer]
 */
async function downloadOne(url, dirAbs, referer = "") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    /** @type {Record<string, string>} */
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (compatible; topmind-Clip/1.2; +https://github.com/topmindspace/topmind)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    if (referer && /^https?:\/\//iu.test(referer)) {
      headers.Referer = referer;
      try {
        headers.Origin = new URL(referer).origin;
      } catch {
        /* ignore */
      }
    }
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error("size");
    // Reject obvious non-image HTML error pages
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("application/json")) {
      throw new Error("not_image");
    }
    const ext = extFromUrlOrType(url, ct);
    const hash = createHash("sha1").update(buf).digest("hex").slice(0, 12);
    const name = `img-${hash}${ext}`;
    // Defense: ensure final write path stays within the expected images directory.
    const finalPath = path.resolve(dirAbs, name);
    const resolvedDir = path.resolve(dirAbs);
    if (!finalPath.startsWith(resolvedDir + path.sep) && finalPath !== resolvedDir) {
      throw new Error("path_escape");
    }
    await fs.mkdir(dirAbs, { recursive: true });
    await fs.writeFile(finalPath, buf);
    return name;
  } finally {
    clearTimeout(timer);
  }
}

function extFromUrlOrType(url, contentType) {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct === "image/png") return ".png";
  if (ct === "image/jpeg" || ct === "image/jpg") return ".jpg";
  if (ct === "image/gif") return ".gif";
  if (ct === "image/webp") return ".webp";
  if (ct === "image/svg+xml") return ".svg";
  if (ct === "image/avif") return ".avif";
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(png|jpe?g|gif|webp|svg|avif)$/iu);
    if (m) return m[0].toLowerCase().replace("jpeg", "jpg");
  } catch {
    /* ignore */
  }
  return ".img";
}

/**
 * Safe slug for image subfolder (next to the note).
 * @param {string} title
 */
export function clipImageSlug(title) {
  const s = String(title || "clip")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "")
    .replace(/\s+/gu, "-")
    .slice(0, 40)
    .replace(/-+$/u, "");
  return s || `clip-${Date.now().toString(36)}`;
}
