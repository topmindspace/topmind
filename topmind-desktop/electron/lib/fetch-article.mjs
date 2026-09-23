/**
 * Article extraction pipeline for URL capture.
 *
 * Prefer Mozilla Readability (industry standard) via linkedom DOM.
 * Fall back to lightweight html-to-markdown heuristics when Readability
 * finds little content (SPA shells, paywalls, minimal pages).
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { htmlToMarkdown, extractMeta } from "./html-to-markdown.mjs";

/**
 * Clean capture titles from browser tabs / og:title / Readability.
 * Strips site-name suffixes ("Article | Site", "Article - Brand") and noise.
 * @param {string} [raw]
 * @param {{ siteName?: string, maxLen?: number }} [opts]
 */
export function cleanCaptureTitle(raw, opts = {}) {
  let t = String(raw || "")
    .replace(/\s+/gu, " ")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .trim();
  if (!t) return "";

  // Light entity decode (titles sometimes arrive escaped)
  t = t
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");

  const site = opts.siteName ? String(opts.siteName).trim() : "";
  // Hierarchical / brand separators common on the web
  const sepRe = /\s*[|»›·•]\s*|\s+[-–—]\s+/u;
  if (sepRe.test(t)) {
    const parts = t.split(sepRe).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const left = parts[0];
      const right = parts[parts.length - 1];
      const rightIsSite =
        (site &&
          (right.toLowerCase().includes(site.toLowerCase().slice(0, Math.min(12, site.length))) ||
            site.toLowerCase().includes(right.toLowerCase().slice(0, Math.min(12, right.length))))) ||
        (right.length <= 36 && left.length >= 8 && left.length >= right.length);
      // Prefer substantive left segment; drop trailing brand crumbs
      if (rightIsSite && left.length >= 4) {
        t = left;
      } else if (parts.length === 2 && left.length >= 12 && right.length <= 28) {
        t = left;
      }
    }
  }

  // "Home > Article" crumbs
  t = t.replace(/^(Home|首页|主页)\s*[>|/›»-]+\s*/iu, "").trim();

  const maxLen = Math.min(Math.max(Number(opts.maxLen) || 120, 40), 200);
  if (t.length > maxLen) {
    t = `${t.slice(0, maxLen - 1).trim()}…`;
  }
  return t;
}

/**
 * Safe basename for Inbox notes (no path separators / illegal FS chars).
 * @param {string} [title]
 * @param {string} [fallback]
 */
export function sanitizeCaptureFilename(title, fallback = "capture") {
  let s = cleanCaptureTitle(title, { maxLen: 80 });
  s = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/\.+$/gu, "")
    .trim();
  if (!s) s = String(fallback || "capture").trim() || "capture";
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s;
}

/** Strip common tracking query params from captured URLs. */
export function cleanCaptureUrl(raw) {
  try {
    const original = String(raw || "").trim();
    const u = new URL(original);
    const drop = [];
    for (const key of u.searchParams.keys()) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_|spm|from$|from_|source$|ic_|ved$|si$|sclid|feature$|share_token)/iu.test(key)) {
        drop.push(key);
      }
    }
    for (const k of drop) u.searchParams.delete(k);
    u.hash = "";
    let out = u.toString();
    // URL() normalizes origin-only to trailing `/`; keep bare host when input had no path
    const pathPart = original.replace(/^[a-z]+:\/\/[^/?#]+/iu, "").split(/[?#]/u)[0];
    if (!pathPart || pathPart === "") {
      out = out.replace(/\/(?=\?|$)/u, "");
    }
    return out;
  } catch {
    return String(raw || "").trim();
  }
}

/**
 * @param {string} html
 * @param {{ url?: string, maxLen?: number }} [opts]
 * @returns {{
 *   title: string,
 *   text: string,
 *   description?: string,
 *   author?: string,
 *   siteName?: string,
 *   image?: string,
 *   method: 'readability' | 'heuristic',
 *   wordCount: number,
 *   canonical?: string,
 *   truncated: boolean,
 *   extractedChars: number,
 *   maxLen: number,
 *   likelySpa: boolean,
 * }}
 */
export function extractArticle(html, opts = {}) {
  const maxLen = opts.maxLen ?? 40_000;
  const meta = extractMeta(html || "");
  let title = meta.og_title || meta.title || "";
  let description = meta.og_description || meta.description || undefined;
  let author = meta.author || undefined;
  let siteName = meta.og_sitename || meta.og_siteName || undefined;
  let image = meta.og_image || undefined;
  const canonical = meta.canonical || undefined;
  let text = "";
  let method = "heuristic";
  let truncated = false;

  try {
    const { document } = parseHTML(String(html || ""));
    if (opts.url && document.head) {
      try {
        const base = document.createElement("base");
        base.setAttribute("href", opts.url);
        document.head.insertBefore(base, document.head.firstChild);
      } catch {
        /* ignore */
      }
    }
    const article = new Readability(document, {
      charThreshold: 80,
      keepClasses: false,
    }).parse();

    if (article && String(article.textContent || "").trim().length >= 80) {
      title = (article.title || title || "").trim();
      author = (article.byline || author || "").trim() || undefined;
      description = (article.excerpt || description || "").trim() || undefined;
      const contentHtml = article.content || "";
      const converted = applyMaxLen(
        htmlToMarkdown(contentHtml, {
          maxLen,
          alreadyIsolated: true,
          baseUrl: opts.url,
        }),
        maxLen,
      );
      text = converted.text;
      truncated = converted.truncated;
      // If conversion lost too much, use plain text with light paragraph breaks
      if (!text || text.replace(/\s/gu, "").length < 40) {
        const plain = plainTextToMarkdown(article.textContent || "", maxLen);
        text = plain.text;
        truncated = plain.truncated;
      }
      method = "readability";
    }
  } catch {
    /* fall through to heuristic */
  }

  if (!text || text.replace(/\s/gu, "").length < 40) {
    const converted = applyMaxLen(
      htmlToMarkdown(html, { maxLen, baseUrl: opts.url }),
      maxLen,
    );
    text = converted.text;
    truncated = converted.truncated || isTruncationMarker(text);
    method = "heuristic";
  } else {
    truncated = truncated || isTruncationMarker(text);
  }

  const wordCount = countWords(text);
  const extractedChars = text.replace(/\n\n\.\.\.\(内容已截断\)\s*$/u, "").length;
  const likelySpa = wordCount < 40 && /<script[^>]+src=|<div\s+id=["'](?:app|root|__next)["']/iu.test(String(html || ""));

  return {
    title: cleanCaptureTitle(title || "", { siteName, maxLen: 160 }),
    text,
    description,
    author,
    siteName,
    image,
    method,
    wordCount,
    canonical,
    truncated,
    extractedChars,
    maxLen,
    likelySpa,
  };
}

const TRUNC_MARK = "\n\n...(内容已截断)";

function isTruncationMarker(text) {
  return String(text || "").includes("...(内容已截断)");
}

function applyMaxLen(text, maxLen) {
  let out = String(text || "");
  if (out.length > maxLen) {
    return { text: `${out.slice(0, maxLen)}${TRUNC_MARK}`, truncated: true };
  }
  return { text: out, truncated: isTruncationMarker(out) };
}

function plainTextToMarkdown(text, maxLen) {
  let out = String(text || "")
    .replace(/\r/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return applyMaxLen(out, maxLen);
}

function countWords(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  // CJK chars count as words; Latin split on whitespace
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/gu) || []).length;
  const latin = s
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean).length;
  return cjk + latin;
}
