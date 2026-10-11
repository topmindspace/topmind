/**
 * Pure helpers for X (Twitter) payloads — no network, no Electron.
 * Used by XService and unit tests.
 */

/** Normalize heterogeneous tweet payloads (API v2 / xurl) into a stable shape. */
export function normalizeTweet(t, usersById = {}) {
  if (!t || typeof t !== "object") return null;
  const id = t.id || t.id_str || t.tweet_id;
  const text = t.text || t.full_text || t.content || "";
  const authorId = t.author_id || t.authorId;
  const user = (authorId && usersById[authorId]) || {};
  const username = t.username || t.author || t.user?.username || user.username || "unknown";
  const created = t.created_at || t.createdAt || t.date || null;
  const handle = String(username).replace(/^@/u, "");
  const url = t.url || (id ? `https://x.com/${handle}/status/${id}` : "");
  return {
    id: id ? String(id) : undefined,
    text: String(text),
    username: handle,
    author_id: authorId,
    created_at: created,
    url,
    public_metrics: t.public_metrics || t.metrics || undefined,
  };
}

/** Extract tweets from API v2 / xurl JSON envelopes. */
export function extractTweets(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.map((t) => normalizeTweet(t)).filter(Boolean);
  const data = payload.data;
  const users = {};
  for (const u of payload.includes?.users || []) {
    if (u?.id) users[u.id] = u;
  }
  if (Array.isArray(data)) return data.map((t) => normalizeTweet(t, users)).filter(Boolean);
  if (data && typeof data === "object") {
    const one = normalizeTweet(data, users);
    return one ? [one] : [];
  }
  if (Array.isArray(payload.tweets)) return payload.tweets.map((t) => normalizeTweet(t)).filter(Boolean);
  return [];
}

/** Count grapheme-ish length for 280 limit (code points). */
export function tweetLength(text) {
  return [...String(text || "")].length;
}

export function isOverTweetLimit(text, limit = 280) {
  return tweetLength(text) > limit;
}

/** Official X API origin. v2 paths start with `/2/…`. */
export const X_API_ORIGIN = "https://api.x.com";
export const X_API_V2 = `${X_API_ORIGIN}/2`;
export const X_OFFICIAL_MCP_URL = "https://api.x.com/mcp";

export function clampXMaxResults(n, { min = 10, max = 100 } = {}) {
  const num = Number(n);
  const base = Number.isFinite(num) && num > 0 ? num : min;
  return Math.max(min, Math.min(max, Math.round(base)));
}

/** Official recent-search path (min max_results=10). */
export function searchRecentQueryPath(query, maxResults = 10) {
  const params = new URLSearchParams({
    query: String(query),
    max_results: String(clampXMaxResults(maxResults, { min: 10, max: 100 })),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  return `/2/tweets/search/recent?${params}`;
}

export function userByUsernamePath(handle) {
  return `/2/users/by/username/${encodeURIComponent(String(handle).replace(/^@/u, ""))}?user.fields=username,name`;
}

/** Official user-timeline path (min max_results=5). */
export function userTweetsPath(userId, maxResults = 10) {
  const params = new URLSearchParams({
    max_results: String(clampXMaxResults(maxResults, { min: 5, max: 100 })),
    "tweet.fields": "created_at,public_metrics,author_id",
    exclude: "replies",
  });
  return `/2/users/${encodeURIComponent(String(userId))}/tweets?${params}`;
}

/** Official xurl shortcut: `xurl search "query"`. */
export function xurlSearchShortcutArgs(query) {
  return ["search", String(query)];
}

/** Official xurl REST search (same query as Bearer). */
export function xurlSearchRestArgs(query, maxResults = 10) {
  return [searchRecentQueryPath(query, maxResults)];
}

/** Official xurl shortcut: `xurl post "text"`. */
export function xurlPostShortcutArgs(text) {
  return ["post", String(text)];
}

/** Official xurl REST create: `xurl -X POST /2/tweets -d '{"text":…}'`. */
export function xurlPostRestArgs(text, replyToId) {
  const payload = { text: String(text) };
  if (replyToId) payload.reply = { in_reply_to_tweet_id: String(replyToId) };
  return ["-X", "POST", "/2/tweets", "-d", JSON.stringify(payload)];
}

export function parsePostedTweetId(result) {
  if (!result || typeof result !== "object") return undefined;
  const id = result.data?.id || result.id || result.tweet_id;
  return id ? String(id) : undefined;
}

export function formatTweetEntry(t) {
  const date = t?.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : "";
  const handle = String(t?.username || "unknown").replace(/^@/u, "");
  const text = String(t?.text || "").replace(/\n/g, "\n> ");
  const parts = [`## @${handle}${date ? ` · ${date}` : ""}\n`, `> ${text}\n`];
  if (t?.url) parts.push(`\n🔗 [原文](${t.url})\n`);
  parts.push("");
  return parts.join("\n");
}

/** Collect already-archived tweet ids from frontmatter `tweet_ids` and status URLs. */
export function collectArchivedTweetIds(markdown) {
  const ids = new Set();
  const text = String(markdown || "");
  const fm = text.match(/tweet_ids:\s*\[([^\]]*)\]/u);
  if (fm) {
    for (const m of fm[1].matchAll(/\d+/gu)) ids.add(m[0]);
  }
  for (const m of text.matchAll(/status\/(\d+)/gu)) ids.add(m[1]);
  return ids;
}

/**
 * Incremental archive: when appending, skip tweets whose id is already in the note.
 * @returns {{ toWrite: object[], skipped: object[] }}
 */
export function decideArchiveTweets(tweets, existingIds, { append = false } = {}) {
  const incoming = (Array.isArray(tweets) ? tweets : []).map((t) => normalizeTweet(t)).filter(Boolean);
  if (!append) return { toWrite: incoming, skipped: [] };
  const seen = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const toWrite = [];
  const skipped = [];
  for (const t of incoming) {
    if (t.id && seen.has(String(t.id))) skipped.push(t);
    else toWrite.push(t);
  }
  return { toWrite, skipped };
}

export function mergeTweetIdList(prevIds, added, keep = 500) {
  const out = [];
  const seen = new Set();
  for (const id of [...(added || []), ...(prevIds || [])]) {
    const s = String(id || "");
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= keep) break;
  }
  return out;
}

export function defaultXTopicName(year = new Date().getFullYear()) {
  return `${year}-X推文收集`;
}

export function defaultPostedTopicName(year = new Date().getFullYear()) {
  return `${year}-我的推文`;
}
