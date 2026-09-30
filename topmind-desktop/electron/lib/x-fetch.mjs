/**
 * X (Twitter) status / article capture — structured path (no HTML scrape).
 *
 * Mirrors topstream-ai quality: fxtwitter JSON → author, title, text, media,
 * and long-form article bodies. HTML scrape on x.com is an SPA shell and
 * produces wrong titles / empty bodies — never use it for /status/ URLs.
 */

const TIMEOUT_MS = 12_000;
const MAX_MD = 200_000;
const UA =
  "Mozilla/5.0 (compatible; topmind-capture/4.14; +https://github.com/topmindspace/topmind) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class XFetchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "XFetchError";
    this.status = status;
    this.code = "x_error";
  }
}

function clip(s, n) {
  const t = String(s || "").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

/**
 * Parse x.com / twitter.com status or article URL.
 * @param {string} raw
 * @returns {{ screenName?: string, statusId?: string, articleId?: string, canonical: string } | null}
 */
export function parseXStatusOrArticle(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") {
    return null;
  }
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  // /i/article/<id>
  if (parts[0] === "i" && parts[1] === "article" && parts[2]) {
    const id = parts[2].replace(/\D/g, "") || parts[2];
    return { articleId: id, canonical: `https://x.com/i/article/${id}` };
  }
  // /:user/status/:id  (also /:user/status/:id/photo/1 etc.)
  const statusIdx = parts.indexOf("status");
  if (statusIdx > 0 && parts[statusIdx + 1]) {
    const screenName = parts[statusIdx - 1];
    const statusId = String(parts[statusIdx + 1]).replace(/\D/g, "");
    if (screenName && statusId) {
      return {
        screenName,
        statusId,
        canonical: `https://x.com/${screenName}/status/${statusId}`,
      };
    }
  }
  return null;
}

/**
 * Convert Draft.js article content to Markdown (X long-form).
 *
 * fxtwitter entityMap is `[{ key, value: { type, data, mutability } }, …]`
 * (NOT a plain object and NOT index-keyed). Media ids live in
 * `data.mediaItems[].mediaId` / `data.mediaId`, and video posters live under
 * `media_info.preview_image.original_img_url`.
 *
 * @param {{ blocks?: Array<Record<string, unknown>>, entityMap?: unknown }} content
 * @param {Array<Record<string, unknown>>} [mediaEntities]
 */
export function draftJsToMarkdown(content, mediaEntities = []) {
  const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
  const mediaByKey = new Map();
  for (const ent of mediaEntities) {
    const info = ent.media_info || ent;
    const url =
      (typeof info.original_img_url === "string" && info.original_img_url) ||
      (typeof info.url === "string" && info.url) ||
      (typeof info.preview_image?.original_img_url === "string" &&
        info.preview_image.original_img_url) ||
      (typeof info.thumbnail_url === "string" && info.thumbnail_url) ||
      null;
    const id = String(ent.media_id || ent.id || "");
    if (url && id) mediaByKey.set(id, url);
  }

  const entityMap = normalizeEntityMap(content?.entityMap);

  const lines = [];
  const usedMediaIds = new Set();
  for (const b of blocks) {
    const type = String(b.type || "unstyled");
    let text = String(b.text || "");
    const ranges = Array.isArray(b.entityRanges) ? b.entityRanges : [];
    const sorted = [...ranges].sort((a, c) => Number(c.offset) - Number(a.offset));
    for (const r of sorted) {
      const ent = entityMap[String(r.key)] || entityMap[r.key];
      if (!ent) continue;
      const et = String(ent.type || "").toUpperCase();
      const data = ent.data || {};
      const mediaId = firstMediaId(data);
      if (et.includes("MEDIA") || et.includes("IMAGE") || mediaId) {
        const mid = mediaId || "";
        const img =
          mediaByKey.get(mid) ||
          (typeof data.url === "string" ? data.url : "") ||
          (typeof data.original_img_url === "string" ? data.original_img_url : "");
        if (img) {
          if (mid) usedMediaIds.add(mid);
          text = `${text.slice(0, r.offset)}![image](${img})${text.slice(r.offset + r.length)}`;
        }
      } else if (et.includes("LINK") || data.url) {
        const href = String(data.url || data.href || "");
        const label = text.slice(r.offset, r.offset + r.length) || href;
        if (href) {
          text = `${text.slice(0, r.offset)}[${label}](${href})${text.slice(r.offset + r.length)}`;
        }
      }
    }
    text = text.trim();
    if (!text && type !== "atomic") continue;
    if (type === "header-one") lines.push(`# ${text}`);
    else if (type === "header-two") lines.push(`## ${text}`);
    else if (type === "header-three") lines.push(`### ${text}`);
    else if (type === "blockquote") lines.push(`> ${text}`);
    else if (type === "unordered-list-item") lines.push(`- ${text}`);
    else if (type === "ordered-list-item") lines.push(`1. ${text}`);
    else if (type === "code-block") lines.push("```\n" + text + "\n```");
    else if (type === "atomic") {
      if (text) lines.push(text);
    } else lines.push(text);
  }

  // Append any media that never appeared in a block (orphan media) so images
  // are not silently dropped when entity ranges fail to resolve.
  const orphans = [];
  for (const [id, url] of mediaByKey) {
    if (usedMediaIds.has(id)) continue;
    if (lines.join("\n").includes(url)) continue;
    orphans.push(`![image](${url})`);
  }
  if (orphans.length) lines.push(orphans.join("\n\n"));

  return lines.join("\n\n").trim();
}

/**
 * Normalize fxtwitter / Draft.js entityMap shapes to `{ [key]: entity }`.
 * Accepts: plain object, index-keyed array, or `[{key,value}]` wrappers.
 */
function normalizeEntityMap(raw) {
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw;
  const out = {};
  raw.forEach((entry, index) => {
    if (entry && typeof entry === "object" && "key" in entry && "value" in entry) {
      const key = String(entry.key);
      out[key] = entry.value || {};
      // Also index by array position for payloads whose ranges use list offsets.
      out[String(index)] = out[String(index)] || entry.value || {};
      return;
    }
    out[String(index)] = entry || {};
  });
  return out;
}

/** Media id from draft entity data — top-level or nested mediaItems[]. */
function firstMediaId(data) {
  if (!data || typeof data !== "object") return "";
  const direct = data.mediaId || data.media_id || data.id;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const items = Array.isArray(data.mediaItems) ? data.mediaItems : [];
  for (const item of items) {
    const id = item?.mediaId || item?.media_id || item?.id;
    if (id != null && String(id).trim()) return String(id).trim();
  }
  return "";
}

function coverFromArticle(article) {
  const cover = article.cover_media;
  const info = cover?.media_info || cover;
  const url =
    (typeof info?.original_img_url === "string" && info.original_img_url) ||
    (typeof info?.url === "string" && info.url) ||
    (typeof info?.preview_image?.original_img_url === "string" &&
      info.preview_image.original_img_url) ||
    null;
  return url || null;
}

async function fetchFxTweet(screenName, statusId) {
  const endpoint = `https://api.fxtwitter.com/${encodeURIComponent(screenName)}/status/${encodeURIComponent(statusId)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new XFetchError(
        res.status === 404 ? "该 X 动态不存在或不可用" : "无法读取该 X 内容",
        res.status === 404 ? 404 : 400,
      );
    }
    const data = await res.json();
    if (!data?.tweet) throw new XFetchError("X 内容为空或不可用");
    return data.tweet;
  } catch (e) {
    if (e instanceof XFetchError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new XFetchError("X 抓取超时，请稍后重试");
    throw new XFetchError("无法读取该 X 内容");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize fxtwitter tweet into the capture fetch shape.
 * @param {Record<string, unknown>} tweet
 * @param {string} canonical
 */
export function tweetToCaptureResult(tweet, canonical, maxLen = 200_000) {
  const author = tweet.author || {};
  const authorName =
    (typeof author.name === "string" && author.name) ||
    (typeof author.screen_name === "string" && author.screen_name) ||
    undefined;
  const handle = typeof author.screen_name === "string" ? author.screen_name.replace(/^@/, "") : undefined;
  const article = tweet.article;

  /** @type {string} */
  let body;
  /** @type {string} */
  let title;
  /** @type {string | undefined} */
  let description;
  /** @type {string | undefined} */
  let image;

  if (article && typeof article === "object") {
    title = clip(String(article.title || "").trim() || "X 文章", 120);
    const content = article.content || {};
    const mediaEntities = Array.isArray(article.media_entities) ? article.media_entities : [];
    body = draftJsToMarkdown(content, mediaEntities);
    const cover = coverFromArticle(article);
    if (cover && !body.includes(cover)) {
      body = `![cover](${cover})\n\n${body}`.trim();
    }
    image = cover || undefined;
    const preview = String(article.preview_text || "").trim();
    description = clip(
      preview || body.replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\s+/g, " "),
      200,
    );
    if (!body.trim()) body = preview || String(tweet.text || "");
  } else {
    const text = String(tweet.text || tweet.raw_text || "").trim();
    const media = tweet.media || {};
    const images = [];
    const pushImg = (u) => {
      const s = typeof u === "string" ? u.trim() : "";
      if (s && /^https?:\/\//iu.test(s) && !images.includes(s)) images.push(s);
    };
    // photos: prefer original url, fall back to https variant
    for (const p of Array.isArray(media.photos) ? media.photos : []) {
      pushImg(p?.url || p?.media_url_https || p?.thumbnail_url);
    }
    // videos / gifs → poster thumbnail still belongs in the note
    for (const v of Array.isArray(media.videos) ? media.videos : []) {
      pushImg(v?.thumbnail_url || v?.url || v?.poster);
    }
    for (const v of Array.isArray(media.gifs) ? media.gifs : []) {
      pushImg(v?.thumbnail_url || v?.url);
    }
    // tweet-level media entities (some payloads only fill this)
    for (const ent of Array.isArray(tweet.media_entities) ? tweet.media_entities : []) {
      const info = ent?.media_info || ent || {};
      pushImg(info.original_img_url || info.url || info.thumbnail_url);
    }
    const parts = [];
    if (images[0]) parts.push(`![image](${images[0]})`);
    if (text) parts.push(text);
    for (const img of images.slice(1)) parts.push(`![image](${img})`);
    body = parts.join("\n\n").trim() || text;
    title = clip(text.replace(/\s+/g, " ") || `@${handle || "x"} 的动态`, 120);
    description = clip(text, 200);
    image = images[0] || undefined;
  }

  if (body.length > maxLen) {
    body = `${body.slice(0, maxLen)}\n\n...(内容已截断)`;
  }

  const wordCount = countWords(body);
  return {
    title,
    text: body,
    url: canonical,
    description,
    author: authorName && handle && authorName !== handle ? `${authorName} (@${handle})` : authorName || (handle ? `@${handle}` : undefined),
    siteName: "X",
    image,
    method: "x-status",
    wordCount,
    canonical,
    truncated: body.includes("...(内容已截断)"),
    extractedChars: body.replace(/\n\n\.\.\.\(内容已截断\)\s*$/u, "").length,
    maxLen,
    likelySpa: false,
    rawBytes: 0,
    sourceKind: "x",
  };
}

function countWords(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  const cjk = (s.match(/[一-鿿㐀-䶿]/gu) || []).length;
  const latin = s
    .replace(/[一-鿿㐀-䶿]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean).length;
  return cjk + latin;
}

/**
 * Fetch an X status URL into capture shape (highest quality path).
 * @param {string} rawUrl
 * @param {{ maxLen?: number }} [opts]
 */
export async function fetchXStatus(rawUrl, opts = {}) {
  const maxLen = Math.min(Math.max(Number(opts.maxLen) || 200_000, 5_000), 200_000);
  const parsed = parseXStatusOrArticle(rawUrl);
  if (!parsed) {
    throw new XFetchError("不是有效的 X 动态链接");
  }
  if (parsed.statusId && parsed.screenName) {
    const tweet = await fetchFxTweet(parsed.screenName, parsed.statusId);
    return tweetToCaptureResult(tweet, parsed.canonical, maxLen);
  }
  if (parsed.articleId) {
    // fxtwitter has no article endpoint; fall through to caller HTML path.
    const err = new XFetchError("X 文章暂不支持结构化抓取，请用网页提取");
    err.code = "x_article_fallback";
    throw err;
  }
  throw new XFetchError("不是有效的 X 动态链接");
}

export { fetchFxTweet, coverFromArticle };
