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
