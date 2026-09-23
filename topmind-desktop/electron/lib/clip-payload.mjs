/**
 * Normalize browser-extension clip payloads into clean markdown + frontmatter.
 *
 * Reuses Desktop extract pipeline (html-to-markdown / extractArticle) so the
 * extension does not maintain a second converter.
 */
import { extractArticle, cleanCaptureUrl, cleanCaptureTitle } from "./fetch-article.mjs";
import { htmlToMarkdown } from "./html-to-markdown.mjs";

const CLIP_MAX_LEN = 200_000;

/**
 * @param {object} body - raw JSON body from POST /v1/clip
 * @param {{ maxLen?: number }} [opts]
 * @returns {{
 *   content: string,
 *   title?: string,
 *   source?: string,
 *   sourceType: string,
 *   frontmatter: Record<string, string | number | boolean>,
 *   method: string,
 * }}
 */
export function normalizeClipPayload(body, opts = {}) {
  const maxLen = Math.min(Math.max(Number(opts.maxLen) || CLIP_MAX_LEN, 5_000), CLIP_MAX_LEN);
  const sourceType = String(body?.source_type || body?.sourceType || "external-capture");
  const rawSource = body?.source || body?.url ? String(body.source || body.url).slice(0, 4096) : "";
  const source = rawSource ? cleanCaptureUrl(rawSource) : undefined;
  let siteName = body?.site_name || body?.siteName
    ? String(body.site_name || body.siteName).trim()
    : undefined;
  let title = body?.title
    ? cleanCaptureTitle(String(body.title), { siteName, maxLen: 160 })
    : undefined;
  const mode = String(body?.mode || "").toLowerCase();
  const selection = body?.selection ? String(body.selection).trim() : "";
  let plain = String(body?.content || body?.text || "").trim();
  const contentHtml = body?.content_html || body?.contentHtml
    ? String(body.content_html || body.contentHtml).trim()
    : "";

  let content = plain;
  let method = mapMode(mode) || "manual";
  let truncated = false;
  let wordCount = 0;
  let author = body?.author ? String(body.author).trim() : undefined;

  const published = body?.published ? String(body.published).trim() : undefined;
  const highlights = Array.isArray(body?.highlights)
    ? body.highlights.map((h) => String(h || "").trim()).filter(Boolean)
    : [];

  // Selection / highlights-first: user-intentional — don't re-run extractors
  if (mode === "highlights" && (highlights.length || plain)) {
    content = highlights.length
      ? highlights.map((t) => t.split("\n").map((l) => `> ${l}`).join("\n")).join("\n\n")
      : plain;
    method = "highlights";
  } else if (mode === "selection" || (selection.length >= 20 && selection === plain)) {
    content = selection || plain;
    method = "selection";
    // Keep cleaned page title (not first line of selection — that's body)
    if (!title && body?.title) {
      title = cleanCaptureTitle(String(body.title), { siteName, maxLen: 160 });
    }
  } else if (contentHtml) {
    const converted = convertHtml(contentHtml, { url: source, maxLen });
    if (converted.text && converted.text.replace(/\s/gu, "").length >= 40) {
      content = converted.text;
      method = converted.method || method || "readability";
      truncated = converted.truncated;
      wordCount = converted.wordCount;
      if (converted.author) author = author || converted.author;
      if (converted.siteName) siteName = siteName || converted.siteName;
      // Prefer cleaner of caller title vs converter title
      const fromHtml = converted.title
        ? cleanCaptureTitle(converted.title, { siteName, maxLen: 160 })
        : "";
      if (!title && fromHtml) title = fromHtml;
      else if (title) title = cleanCaptureTitle(title, { siteName, maxLen: 160 });
    } else if (!content || content.replace(/\s/gu, "").length < 40) {
      content = converted.text || plain;
      method = converted.method || method;
      truncated = converted.truncated;
      wordCount = converted.wordCount;
    }
  } else if (looksLikeHtmlDocument(plain)) {
    // Rare: extension/client sent full HTML as content
    const converted = convertHtml(plain, { url: source, maxLen, forceFullDoc: true });
    if (converted.text) {
      content = converted.text;
      method = converted.method || "heuristic";
      truncated = converted.truncated;
      wordCount = converted.wordCount;
      if (converted.author) author = author || converted.author;
      if (converted.siteName) siteName = siteName || converted.siteName;
      if (!title && converted.title) {
        title = cleanCaptureTitle(converted.title, { siteName, maxLen: 160 });
      }
    }
  }

  // Final pass: empty title stays undefined (ingest will stamp capture-*)
  if (title === "") title = undefined;

  // Provenance: selection prefix when both selection and longer page body exist
  if (
    selection &&
    content &&
    method !== "selection" &&
    !content.includes(selection.slice(0, Math.min(40, selection.length)))
  ) {
    content = `> 选区摘录\n\n${selection}\n\n---\n\n${content}`;
  }

  if (content.length > maxLen) {
    // htmlToMarkdown's cleanup() may already have appended the marker; strip
    // it before re-slicing so we never emit a doubled truncation notice.
    const TRUNC = "\n\n...(内容已截断)";
    const base = content.endsWith(TRUNC) ? content.slice(0, -TRUNC.length) : content;
    content = `${base.slice(0, maxLen)}\n\n...(内容已截断)`;
    truncated = true;
  }

  if (!wordCount) wordCount = countWords(content);

  /** @type {Record<string, string | number | boolean>} */
  const frontmatter = {};
  if (method) frontmatter.fetch_method = method;
  if (wordCount > 0) frontmatter.word_count = wordCount;
  if (truncated) frontmatter.fetch_truncated = true;
  if (author) frontmatter.author = author.slice(0, 200);
  if (siteName) frontmatter.site_name = siteName.slice(0, 200);
  if (published) frontmatter.published = published.slice(0, 80);
  if (body?.template_id) frontmatter.clip_template = String(body.template_id).slice(0, 64);

  return {
    content,
    title,
    source,
    sourceType,
    frontmatter,
    method,
  };
}

/**
 * @param {string} html
 * @param {{ url?: string, maxLen: number, forceFullDoc?: boolean }} opts
 */
function convertHtml(html, opts) {
  const fullDoc = opts.forceFullDoc || looksLikeHtmlDocument(html);
  if (fullDoc) {
    const art = extractArticle(html, { url: opts.url, maxLen: opts.maxLen });
    return {
      text: art.text,
      method: art.method,
      truncated: art.truncated,
      wordCount: art.wordCount,
      title: art.title,
      author: art.author,
      siteName: art.siteName,
    };
  }

  // Readability article fragment from extension — reuse Desktop converter only
  // Pass page URL so relative / protocol-relative image src become absolute https.
  let text = htmlToMarkdown(html, {
    maxLen: opts.maxLen,
    alreadyIsolated: true,
    baseUrl: opts.url,
  });
  let truncated = text.includes("...(内容已截断)");
  if (!text || text.replace(/\s/gu, "").length < 40) {
    // strip tags as last resort
    text = String(html)
      .replace(/<script[\s\S]*?<\/script>/giu, "")
      .replace(/<style[\s\S]*?<\/style>/giu, "")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (text.length > opts.maxLen) {
      text = `${text.slice(0, opts.maxLen)}\n\n...(内容已截断)`;
      truncated = true;
    }
  }
  return {
    text,
    method: "readability",
    truncated,
    wordCount: countWords(text),
  };
}

function looksLikeHtmlDocument(s) {
  const t = String(s || "").trim().slice(0, 500);
  return /<!DOCTYPE\s+html|<html[\s>]/iu.test(t);
}

function mapMode(mode) {
  if (mode === "selection") return "selection";
  if (mode === "highlights") return "highlights";
  if (mode === "readability") return "readability";
  if (mode === "heuristic") return "heuristic";
  if (mode === "render") return "render";
  if (mode === "manual") return "manual";
  return "";
}

function countWords(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/gu) || []).length;
  const latin = s
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean).length;
  return cjk + latin;
}
