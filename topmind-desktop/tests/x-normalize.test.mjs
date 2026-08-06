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
