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

const MAX_IMAGES = 40;
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 15_000;

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
 * @returns {Array<{ full: string, alt: string, url: string, index: number }>}
 */
export function findMarkdownImages(markdown) {
  const md = String(markdown || "");
  const re = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu;
  /** @type {Array<{ full: string, alt: string, url: string, index: number }>} */
  const out = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    out.push({
      full: m[0],
      alt: m[1] || "",
      url: (m[2] || "").trim(),
      index: m.index,
    });
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
  const matches = findMarkdownImages(md);
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
    if (!abs || !/^https?:\/\//iu.test(abs)) {
      skipped += 1;
      continue;
    }
    // already local (shouldn't happen for http) or already rewritten this pass
    if (seen.has(abs)) {
      const local = seen.get(abs);
      replacements.push({ from: hit.full, to: `![${hit.alt}](${local})` });
      continue;
    }
    // skip if already a relative workspace path (no scheme)
    if (!/^https?:\/\//iu.test(hit.url) && !hit.url.startsWith("//") && !baseUrl) {
      skipped += 1;
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
      seen.set(abs, hit.url); // keep original
    }
  }

  // Apply replacements from end to start so indices stay valid if we used index;
  // here we use unique full strings — same URL may appear multiple times with same full form.
  let out = md;
  const applied = new Set();
  for (const { from, to } of replacements) {
    if (from === to) continue;
    // Replace only image occurrences (global for identical full match)
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
    await fs.writeFile(path.join(dirAbs, name), buf);
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
