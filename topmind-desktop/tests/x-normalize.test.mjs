/**
 * Unit tests for electron/lib/x-normalize.mjs (no network, no Electron).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTweet,
  extractTweets,
  tweetLength,
  isOverTweetLimit,
  X_API_ORIGIN,
  X_OFFICIAL_MCP_URL,
  searchRecentQueryPath,
  userByUsernamePath,
  userTweetsPath,
  xurlSearchShortcutArgs,
  xurlSearchRestArgs,
  xurlPostShortcutArgs,
  xurlPostRestArgs,
  parsePostedTweetId,
  formatTweetEntry,
  collectArchivedTweetIds,
  decideArchiveTweets,
  mergeTweetIdList,
} from "../electron/lib/x-normalize.mjs";

test("normalizeTweet maps API v2 shape", () => {
  const t = normalizeTweet(
    {
      id: "123",
      text: "hello world",
      author_id: "u1",
      created_at: "2026-01-01T00:00:00Z",
      public_metrics: { like_count: 1 },
    },
    { u1: { username: "alice" } },
  );
  assert.equal(t.id, "123");
  assert.equal(t.text, "hello world");
  assert.equal(t.username, "alice");
  assert.equal(t.url, "https://x.com/alice/status/123");
  assert.deepEqual(t.public_metrics, { like_count: 1 });
});

test("normalizeTweet strips @ from username and accepts full_text", () => {
  const t = normalizeTweet({
    id_str: "99",
    full_text: "full",
    username: "@bob",
  });
  assert.equal(t.id, "99");
  assert.equal(t.text, "full");
  assert.equal(t.username, "bob");
  assert.equal(t.url, "https://x.com/bob/status/99");
});

test("normalizeTweet returns null for non-objects", () => {
  assert.equal(normalizeTweet(null), null);
  assert.equal(normalizeTweet("x"), null);
});

test("extractTweets handles array, data array, single data, and tweets key", () => {
  assert.equal(extractTweets(null).length, 0);

  const fromArray = extractTweets([{ id: "1", text: "a", username: "x" }]);
  assert.equal(fromArray.length, 1);
  assert.equal(fromArray[0].id, "1");

  const fromData = extractTweets({
    data: [{ id: "2", text: "b", author_id: "u2" }],
    includes: { users: [{ id: "u2", username: "carol" }] },
  });
  assert.equal(fromData.length, 1);
  assert.equal(fromData[0].username, "carol");

  const single = extractTweets({ data: { id: "3", text: "c", username: "d" } });
  assert.equal(single.length, 1);
  assert.equal(single[0].id, "3");

  const legacy = extractTweets({ tweets: [{ id: "4", text: "e", author: "eve" }] });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].username, "eve");
});

test("tweetLength counts code points for emoji / CJK", () => {
  assert.equal(tweetLength("abc"), 3);
  assert.equal(tweetLength("你好"), 2);
  assert.equal(tweetLength("👍"), 1);
  assert.equal(tweetLength(""), 0);
  assert.equal(tweetLength(null), 0);
});

test("isOverTweetLimit respects 280 default", () => {
  assert.equal(isOverTweetLimit("short"), false);
  assert.equal(isOverTweetLimit("x".repeat(280)), false);
  assert.equal(isOverTweetLimit("x".repeat(281)), true);
  assert.equal(isOverTweetLimit("x".repeat(10), 5), true);
});

test("official v2 paths are flat /2/… (no nested params wrapper)", () => {
  assert.equal(X_API_ORIGIN, "https://api.x.com");
  assert.equal(X_OFFICIAL_MCP_URL, "https://api.x.com/mcp");
  const search = searchRecentQueryPath("from:alice", 20);
  assert.match(search, /^\/2\/tweets\/search\/recent\?/);
  assert.match(search, /query=from%3Aalice|query=from%3Aalice/u);
  assert.match(search, /max_results=20/);
  assert.doesNotMatch(search, /params=/);
  assert.match(userByUsernamePath("@bob"), /^\/2\/users\/by\/username\/bob\?/);
  const tl = userTweetsPath("99", 8);
  assert.match(tl, /^\/2\/users\/99\/tweets\?/);
  assert.match(tl, /max_results=8/);
});

test("official xurl args: search shortcut/REST and POST /2/tweets", () => {
  assert.deepEqual(xurlSearchShortcutArgs("hello"), ["search", "hello"]);
  assert.ok(xurlSearchRestArgs("hello", 10)[0].startsWith("/2/tweets/search/recent?"));
  assert.deepEqual(xurlPostShortcutArgs("hi"), ["post", "hi"]);
  const rest = xurlPostRestArgs("hi", "123");
  assert.deepEqual(rest.slice(0, 4), ["-X", "POST", "/2/tweets", "-d"]);
  const body = JSON.parse(rest[4]);
  assert.equal(body.text, "hi");
  assert.equal(body.reply.in_reply_to_tweet_id, "123");
  assert.equal(parsePostedTweetId({ data: { id: "9" } }), "9");
});

test("incremental archive skips already-present tweet ids", () => {
  const existing = collectArchivedTweetIds(
    "---\ntweet_ids: [\"11\", \"22\"]\n---\n\n🔗 [原文](https://x.com/a/status/33)\n",
  );
  assert.ok(existing.has("11"));
  assert.ok(existing.has("22"));
  assert.ok(existing.has("33"));
  const { toWrite, skipped } = decideArchiveTweets(
    [
      { id: "11", text: "old", username: "a" },
      { id: "44", text: "new", username: "b" },
    ],
    existing,
    { append: true },
  );
  assert.equal(toWrite.length, 1);
  assert.equal(toWrite[0].id, "44");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, "11");
  assert.deepEqual(mergeTweetIdList(["11"], ["44", "11"]), ["44", "11"]);
  const md = formatTweetEntry({ username: "bob", text: "line1\nline2", url: "https://x.com/bob/status/1", created_at: "2026-01-02T00:00:00Z" });
  assert.match(md, /@bob/);
  assert.match(md, /> line1\n> line2/);
  assert.match(md, /status\/1/);
});
