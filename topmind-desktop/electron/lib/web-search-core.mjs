/**
 * Web-search core — pure parse / score / rank (no network, no DOM lib).
 *
 * Shared by Desktop (`electron/lib/web-search.mjs`) and Obsidian (`#kernel/…`).
 * Network stays in each surface (fetch vs requestUrl). The HTML parser here is
 * regex-based so surfaces without linkedom stay portable; Desktop may overlay
 * a richer DOM parse on top of the same ranker.
 */

/** Hard result cap — the model needs a shortlist, not a SERP dump. */
export const WEB_SEARCH_MAX_RESULTS = 8;
/** Per-snippet char cap so a tool result never blows the context window. */
export const WEB_SEARCH_SNIPPET_MAX = 280;

/**
 * True when the URL is a plain http(s) web URL we are willing to fetch.
 * @param {string} url
 */
export function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Decode DDG's `/l/?uddg=` redirect wrappers to the real target URL.
 * @param {string} href
 * @returns {string}
 */
export function unwrapDdgRedirect(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return href;
  }
}

/**
 * Domain credibility ladder (industry practice: official docs > edu/gov >
 * major reference > established press > vendor blog > unknown).
 * @param {string} hostname
 * @returns {number}
 */
export function domainScore(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^www\./u, "");
  if (!h) return 0.3;
  if (
    /(?:^|\.)(?:apple|google|microsoft|github|gitlab|w3c|ietf|whatwg|iso|unicode|mdn|developer\.(?:mozilla|apple|google))\./u.test(h) ||
    /(?:^|\.)(?:docs?|developer|dev|api|spec|rfc)\./u.test(h)
  ) {
    return 1.0;
  }
  if (/(?:^|\.)(?:edu|gov|ac\.[a-z]{2}|go\.[a-z]{2})$/u.test(h) || /\.edu\.|\.ac\./u.test(h)) {
    return 0.95;
  }
  if (/(?:wikipedia|wikidata|britannica|stack(?:overflow|exchange)|mdn)\./u.test(h)) {
    return 0.9;
  }
  if (
    /(?:reuters|apnews|bbc|nytimes|ft\.com|wsj|economist|nature|science|arxiv|acm|ieee|springer|elsevier|scholar\.google)/u.test(
      h,
    )
  ) {
    return 0.85;
  }
  if (/(?:xinhuanet|people\.com|cctv|chinanews|zhihu|juejin|cnblogs|infoq|csdn|aliyun|tencent|bytedance|baidu|huawei)/u.test(h)) {
    return 0.8;
  }
  if (/(?:medium\.com|substack|wordpress|blogspot|\.blog\.)|blog\./u.test(h)) {
    return 0.65;
  }
  if (/(?:reddit|quora|facebook|twitter|x\.com|instagram|tiktok|zhihu\.com\/question)/u.test(h)) {
    return 0.5;
  }
  if (/(?:bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|shutterstock|gettyimages)/u.test(h)) {
    return 0.25;
  }
  return 0.7;
}

/**
 * Host of a URL (empty on parse failure).
 * @param {string} url
 */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return "";
  }
}

/**
 * Rank + dedupe search results (score = domainScore + snippet richness;
 * same host kept at most `perHost` times).
 * @param {Array<{title:string,url:string,snippet:string}>} results
 * @param {{ limit?: number, perHost?: number }} [opts]
 */
export function rankResults(results, opts = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || WEB_SEARCH_MAX_RESULTS, WEB_SEARCH_MAX_RESULTS));
  const perHost = Math.max(1, Math.min(Number(opts.perHost) || 2, 4));
  const scored = (Array.isArray(results) ? results : []).map((r) => {
    const host = hostOf(r.url);
    const snipLen = String(r.snippet || "").length;
    const richness = snipLen > 120 ? 0.1 : snipLen > 40 ? 0.05 : 0;
    return { ...r, host, score: Number((domainScore(host) + richness).toFixed(3)) };
  });
  scored.sort((a, b) => b.score - a.score || (b.snippet?.length || 0) - (a.snippet?.length || 0));
  /** @type {typeof scored} */
  const out = [];
  const hostCount = new Map();
  for (const r of scored) {
    const n = hostCount.get(r.host) || 0;
    if (n >= perHost) continue;
    hostCount.set(r.host, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Regex DDG HTML parse (portable — no linkedom). Tolerant to minor markup drift.
 * @param {string} html
 * @returns {Array<{ title: string, url: string, snippet: string }>}
 */
export function parseDdgHtmlLite(html) {
  const raw = String(html || "");
  /** @type {Array<{ title: string, url: string, snippet: string }>} */
  const out = [];
  const seen = new Set();
  // Classic DDG result anchors: <a class="result__a" href="…">Title</a>
  const re = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]{2,400}?)<\/a>/giu;
  let m;
  while ((m = re.exec(raw)) !== null && out.length < WEB_SEARCH_MAX_RESULTS * 3) {
    const url = unwrapDdgRedirect(m[1]).replace(/#.*$/u, "");
    if (!isHttpUrl(url) || seen.has(url)) continue;
    if (/duckduckgo\.com\//iu.test(url)) continue;
    seen.add(url);
    const title = m[2].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
    if (!title) continue;
    // Snippet: 600 chars after the anchor, first plain-ish text chunk.
    const tail = raw.slice(re.lastIndex, re.lastIndex + 800);
    const snipM = tail.match(/result__snippet[^>]*>([\s\S]{10,400}?)<\//iu) ||
      tail.match(/class=["'][^"']*snippet[^"']*["'][^>]*>([\s\S]{10,400}?)<\//iu);
    let snippet = snipM
      ? snipM[1].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim()
      : "";
    if (title && snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
    out.push({
      title: title.slice(0, 200),
      url,
      snippet: snippet.slice(0, WEB_SEARCH_SNIPPET_MAX),
    });
  }
  return out;
}

/**
 * Build the DDG HTML search endpoint (shared URL shape).
 * @param {string} query
 */
export function ddgSearchUrl(query) {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query || "").trim())}`;
}
