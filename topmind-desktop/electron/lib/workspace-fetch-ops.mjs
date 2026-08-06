/**
 * URL fetch ops — pure network path (no Electron).
 * Enhanced SPA render is layered in WorkspaceService via fetch-render.mjs.
 */
import { extractArticle, cleanCaptureUrl } from "./fetch-article.mjs";
import { S } from "./workspace-helpers.mjs";

/**
 * Decode a Buffer to string using the given charset label.
 *
 * Prefers TextDecoder (supports gbk, gb2312, gb18030, big5, euc-kr,
 * shift_jis, etc.), falls back to Buffer.toString, then to utf-8.
 * Never throws — invalid / unsupported encodings degrade to utf-8.
 */
export function decodeBuffer(buf, charset) {
  const enc = String(charset || "utf-8").toLowerCase().trim();
  if (!enc || enc === "utf-8" || enc === "utf8") return buf.toString("utf-8");
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    try {
      return buf.toString(enc);
    } catch {
      return buf.toString("utf-8");
    }
  }
}

/**
 * Build result object from extractArticle + meta.
 * @param {object} article
 * @param {{ url: string, maxLen: number, rawBytes?: number, methodOverride?: string }} meta
 */
export function buildFetchResult(article, meta) {
  const cap = meta.maxLen;
  let warning;
  const method = meta.methodOverride || article.method;
  if (article.likelySpa && article.wordCount < 40 && method !== "render") {
    warning = "正文极少，可能是需 JavaScript 渲染的页面。可点「增强渲染」或手动粘贴。";
  } else if (article.truncated) {
    warning = `正文已截断（上限 ${cap} 字符）。可改用「完整抓取」提高上限，或拆成多条笔记。`;
  } else if (article.wordCount < 40) {
    warning = "未能提取有效正文，请手动粘贴内容。";
  }

  return {
    title: article.title || "",
    text: article.text,
    url: meta.url,
    description: article.description,
    author: article.author,
    siteName: article.siteName,
    image: article.image,
    method,
    wordCount: article.wordCount,
    canonical: article.canonical,
    truncated: Boolean(article.truncated),
    extractedChars: article.extractedChars ?? (article.text || "").length,
    maxLen: cap,
    likelySpa: Boolean(article.likelySpa),
    rawBytes: meta.rawBytes ?? 0,
    warning,
  };
}

export const fetchOps = {
  /**
   * Static HTTP fetch → Readability extract → clean Markdown.
   * @param {{ url: string, maxLen?: number }} p
   */
  async fetchUrl({ url, maxLen }, _ctx) {
    S(url, "url", { maxLen: 4096 });
    if (!/^https?:\/\//iu.test(url)) {
      const err = new Error("URL 需以 http:// 或 https:// 开头。");
      err.code = "invalid_url";
      throw err;
    }
    const cleanedUrl = cleanCaptureUrl(url);
    const cap = Math.min(Math.max(Number(maxLen) || 40_000, 5_000), 200_000);

    let res;
    try {
      res = await fetch(cleanedUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; topmind/4.12; +https://github.com/topmindspace/topmind) AppleWebKit/537.36 (KHTML, like Gecko)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const err = new Error(
        /abort|timeout/iu.test(msg) ? `抓取超时（20s）：${msg}` : `网络错误：${msg}`,
      );
      err.code = /abort|timeout/iu.test(msg) ? "timeout" : "network";
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
      err.code = "http_error";
      throw err;
    }
    const ctHeader = res.headers.get("content-type") || "";
    if (ctHeader && !/html|xml|text\/plain/iu.test(ctHeader) && !/text\//iu.test(ctHeader)) {
      const err = new Error(`不支持的内容类型: ${ctHeader.split(";")[0]}（仅网页/文本）`);
      err.code = "unsupported_type";
      throw err;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5_000_000) {
      const err = new Error("页面过大（>5MB），未抓取。");
      err.code = "too_large";
      throw err;
    }

    let charset = "utf-8";
    const ctMatch = ctHeader.match(/charset=([\w-]+)/iu);
    if (ctMatch) charset = ctMatch[1].toLowerCase();

    let html = decodeBuffer(buf, charset);
    if (!ctMatch) {
      const metaMatch = html.match(/<meta[^>]+charset=["']?([\w-]+)/iu);
      if (metaMatch) {
        charset = metaMatch[1].toLowerCase();
        html = decodeBuffer(buf, charset);
      }
    }

    const finalUrl = cleanCaptureUrl(res.url || cleanedUrl);
    const article = extractArticle(html, { url: finalUrl, maxLen: cap });
    return buildFetchResult(article, { url: finalUrl, maxLen: cap, rawBytes: buf.length });
  },
};
