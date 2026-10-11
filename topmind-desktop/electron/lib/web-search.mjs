/**
 * Web search — no-API-key retrieval for the agent research loop.
 *
 * Pure parse / score / rank lives in `web-search-core.mjs` (shared with
 * Obsidian + engine). This module owns Desktop network I/O and the richer
 * linkedom parse when available. Results are structured `{ title, url,
 * snippet, score, host }` so the model can pick pages to `fetch_url` and the
 * host can harvest URL source receipts.
 */
import { parseHTML } from "linkedom";
import {
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_SNIPPET_MAX,
  ddgSearchUrl,
  isHttpUrl,
  parseDdgHtmlLite,
  rankResults,
  unwrapDdgRedirect,
  domainScore,
  hostOf,
} from "./web-search-core.mjs";

export { domainScore, rankResults, hostOf, isHttpUrl, unwrapDdgRedirect };

const FETCH_TIMEOUT_MS = 12_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 topmind-desktop/1.0";

/**
 * DOM parse (richer) with lite-regex fallback.
 * @param {string} html
 * @returns {Array<{ title: string, url: string, snippet: string }>}
 */
export function parseDdgHtml(html) {
  try {
    const { document } = parseHTML(String(html || ""));
    /** @type {Array<{ title: string, url: string, snippet: string }>} */
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll("a"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.includes("duckduckgo.com/y.js")) continue;
      const raw = unwrapDdgRedirect(href);
      if (!isHttpUrl(raw)) continue;
      if (/duckduckgo\.com\//iu.test(raw) && !/uddg=/iu.test(href)) continue;
      const title = (a.textContent || "").replace(/\s+/gu, " ").trim();
      if (!title || title.length < 2) continue;
      const cls = String(a.className || "");
      const isResult =
        /result__a|result-link|result__title/iu.test(cls) ||
        Boolean(a.closest(".result, .results_links, .result__body, [data-testid='result']"));
      if (!isResult) continue;
      const key = raw.replace(/#.*$/u, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const block =
        a.closest(".result, .results_links, .result__body, [data-testid='result']") || a.parentElement;
      let snippet = "";
      if (block) {
        const snip =
          block.querySelector(".result__snippet, .result-snippet, [data-testid='result-snippet']") ||
          null;
        snippet = (snip?.textContent || block.textContent || "").replace(/\s+/gu, " ").trim();
        if (title && snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
      }
      out.push({
        title: title.slice(0, 200),
        url: key,
        snippet: snippet.slice(0, WEB_SEARCH_SNIPPET_MAX),
      });
      if (out.length >= WEB_SEARCH_MAX_RESULTS * 3) break;
    }
    return out.length > 0 ? out : parseDdgHtmlLite(html);
  } catch {
    return parseDdgHtmlLite(html);
  }
}

/**
 * Run a web search (Desktop network path).
 * @param {{ query: string, limit?: number }} p
 */
export async function webSearch(p) {
  const query = String(p?.query || "").trim();
  if (!query) {
    return { ok: false, error: "query is required", hint: "请提供搜索关键词。" };
  }
  const limit = Math.max(1, Math.min(Number(p?.limit) || WEB_SEARCH_MAX_RESULTS, WEB_SEARCH_MAX_RESULTS));
  const endpoint = ddgSearchUrl(query);
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `search HTTP ${res.status}`,
        hint: "搜索服务暂不可用。可稍后重试，或直接用 fetch_url 打开已知网址。",
      };
    }
    const html = await res.text();
    const all = parseDdgHtml(html);
    const results = rankResults(all, { limit });
    return {
      ok: true,
      query,
      count: results.length,
      results,
      provider: "duckduckgo-html",
    };
  } catch (err) {
    const msg = err?.message || String(err);
    return {
      ok: false,
      error: msg,
      hint: "搜索失败（网络或解析）。检查网络后重试；也可用 fetch_url 直接抓取已知页面。",
    };
  }
}
