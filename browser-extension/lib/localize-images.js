/**
 * Download remote images into a workspace directory handle (extension path).
 * Mirrors Desktop clip-images: resolve relative/protocol-relative via page URL,
 * Referer header, higher limits.
 */

const MAX_IMAGES = 40;
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 15_000;

/**
 * @param {string} href
 * @param {string} [baseUrl]
 * @returns {string | null}
 */
export function resolveMediaUrl(href, baseUrl) {
  let h = String(href || "").trim().replace(/^<|>$/gu, "");
  if (!h || h.startsWith("data:") || h.startsWith("blob:") || h.startsWith("javascript:")) {
    return null;
  }
  if (/^https?:\/\//iu.test(h)) {
    try {
      return new URL(h).href;
    } catch {
      return null;
    }
  }
  if (h.startsWith("//")) {
    try {
      const proto = baseUrl ? new URL(baseUrl).protocol : "https:";
      return new URL(`${proto}${h}`).href;
    } catch {
      return null;
    }
  }
  if (!baseUrl) return null;
  try {
    return new URL(h, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * @param {string} markdown
 * @param {FileSystemDirectoryHandle} parentDir — topic/category/inbox handle
 * @param {string} slug
 * @param {{ baseUrl?: string }} [opts]
 * @returns {Promise<{ markdown: string, downloaded: number, failed: number, skipped: number }>}
 */
export async function localizeMarkdownImagesInDir(markdown, parentDir, slug, opts = {}) {
  const md = String(markdown || "");
  const re = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu;
  /** @type {Array<{ full: string, alt: string, url: string }>} */
  const matches = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    matches.push({ full: m[0], alt: m[1] || "", url: (m[2] || "").trim() });
  }
  if (!matches.length) return { markdown: md, downloaded: 0, failed: 0, skipped: 0 };

  let imagesRoot;
  try {
    imagesRoot = await parentDir.getDirectoryHandle("images", { create: true });
  } catch {
    return { markdown: md, downloaded: 0, failed: 0, skipped: 0 };
  }
  let dir;
  try {
    dir = await imagesRoot.getDirectoryHandle(slug || "clip", { create: true });
  } catch {
    return { markdown: md, downloaded: 0, failed: 0, skipped: 0 };
  }

  let out = md;
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  const seen = new Map();
  const relBase = `images/${slug || "clip"}`;
  const baseUrl = opts.baseUrl || "";

  for (const hit of matches.slice(0, MAX_IMAGES)) {
    const abs = resolveMediaUrl(hit.url, baseUrl);
    if (!abs || !/^https?:\/\//iu.test(abs)) {
      skipped += 1;
      continue;
    }
    if (seen.has(abs)) {
      out = out.split(hit.full).join(`![${hit.alt}](${seen.get(abs)})`);
      continue;
    }
    try {
      const name = await downloadToDir(abs, dir, baseUrl);
      const rel = `${relBase}/${name}`;
      seen.set(abs, rel);
      out = out.split(hit.full).join(`![${hit.alt}](${rel})`);
      downloaded += 1;
    } catch {
      failed += 1;
      seen.set(abs, hit.url);
    }
  }
  return { markdown: out, downloaded, failed, skipped };
}

/**
 * @param {string} url
 * @param {FileSystemDirectoryHandle} dir
 * @param {string} [referer]
 */
async function downloadToDir(url, dir, referer = "") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    /** @type {Record<string, string>} */
    const headers = {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; topmind-Clip/1.2; +https://github.com/topmindspace/topmind)",
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
      mode: "cors",
      credentials: "omit",
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) throw new Error("size");
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("application/json")) {
      throw new Error("not_image");
    }
    const ext = extFrom(url, ct);
    const hash = await sha1Short(buf);
    const name = `img-${hash}${ext}`;
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(buf);
    await w.close();
    return name;
  } finally {
    clearTimeout(timer);
  }
}

function extFrom(url, contentType) {
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

async function sha1Short(buf) {
  try {
    const dig = await crypto.subtle.digest("SHA-1", buf);
    return Array.from(new Uint8Array(dig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
}

export function imageSlug(title) {
  const s = String(title || "clip")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "")
    .replace(/\s+/gu, "-")
    .slice(0, 40)
    .replace(/-+$/u, "");
  return s || `clip-${Date.now().toString(36)}`;
}
