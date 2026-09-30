/**
 * X (Twitter) structured capture tests (no network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseXStatusOrArticle,
  draftJsToMarkdown,
  tweetToCaptureResult,
} from "../electron/lib/x-fetch.mjs";

test("parseXStatusOrArticle reads status urls", () => {
  const a = parseXStatusOrArticle("https://x.com/alice/status/1234567890?s=20");
  assert.equal(a?.screenName, "alice");
  assert.equal(a?.statusId, "1234567890");
  assert.equal(a?.canonical, "https://x.com/alice/status/1234567890");

  const b = parseXStatusOrArticle("https://twitter.com/bob/status/99/photo/1");
  assert.equal(b?.screenName, "bob");
  assert.equal(b?.statusId, "99");

  const c = parseXStatusOrArticle("https://x.com/i/article/777");
  assert.equal(c?.articleId, "777");

  assert.equal(parseXStatusOrArticle("https://example.com/a"), null);
});

test("draftJsToMarkdown renders media and links", () => {
  const md = draftJsToMarkdown(
    {
      blocks: [
        { key: "a", text: "hello world", type: "unstyled", entityRanges: [
          { offset: 6, length: 5, key: 0 },
        ] },
        { key: "b", text: " ", type: "atomic", entityRanges: [
          { offset: 0, length: 1, key: 1 },
        ] },
      ],
      entityMap: {
        0: { type: "LINK", data: { url: "https://ex.com" } },
        1: { type: "MEDIA", data: { mediaId: "m1" } },
      },
    },
    [{ media_id: "m1", media_info: { original_img_url: "https://img.ex/a.png" } }],
  );
  assert.match(md, /\[world\]\(https:\/\/ex\.com\)/);
  assert.match(md, /!\[image\]\(https:\/\/img\.ex\/a\.png\)/);
});

test("tweetToCaptureResult normalizes status with photos and author", () => {
  const r = tweetToCaptureResult(
    {
      text: "hello from x",
      author: { name: "Alice", screen_name: "alice" },
      media: {
        photos: [
          { url: "https://pbs.twimg.com/a.jpg" },
          { url: "https://pbs.twimg.com/b.jpg" },
        ],
      },
    },
    "https://x.com/alice/status/1",
    40_000,
  );
  assert.match(r.title, /hello from x/);
  assert.match(r.author, /Alice/);
  assert.match(r.author, /@alice/);
  assert.equal(r.siteName, "X");
  assert.equal(r.method, "x-status");
  assert.equal(r.image, "https://pbs.twimg.com/a.jpg");
  assert.match(r.text, /!\[image\]\(https:\/\/pbs\.twimg\.com\/a\.jpg\)/);
  assert.match(r.text, /hello from x/);
  assert.match(r.text, /!\[image\]\(https:\/\/pbs\.twimg\.com\/b\.jpg\)/);
  assert.equal(r.likelySpa, false);
});

test("tweetToCaptureResult normalizes long-form article", () => {
  const r = tweetToCaptureResult(
    {
      text: "preview",
      author: { name: "Bob", screen_name: "bob" },
      article: {
        title: "Long form title",
        preview_text: "preview text",
        cover_media: { media_info: { original_img_url: "https://img.ex/cover.png" } },
        content: {
          blocks: [{ key: "a", text: "para one", type: "unstyled", entityRanges: [] }],
          entityMap: {},
        },
        media_entities: [],
      },
    },
    "https://x.com/bob/status/2",
    40_000,
  );
  assert.equal(r.title, "Long form title");
  assert.equal(r.image, "https://img.ex/cover.png");
  assert.match(r.text, /!\[cover\]\(https:\/\/img\.ex\/cover\.png\)/);
  assert.match(r.text, /para one/);
  assert.equal(r.sourceKind, "x");
});

test("draftJsToMarkdown resolves fxtwitter entityMap key/value + mediaItems", () => {
  // Real fxtwitter shape: entityMap is [{key, value:{type,data}}], media id in mediaItems
  const md = draftJsToMarkdown(
    {
      blocks: [
        { key: "a", text: "hello ", type: "unstyled", entityRanges: [] },
        { key: "b", text: " ", type: "atomic", entityRanges: [{ offset: 0, length: 1, key: 0 }] },
        { key: "c", text: "world", type: "unstyled", entityRanges: [] },
      ],
      entityMap: [
        {
          key: "12",
          value: {
            type: "MEDIA",
            data: {
              entityKey: "x",
              mediaItems: [{ localMediaId: "13", mediaCategory: "DraftTweetImage", mediaId: "m1" }],
            },
          },
        },
      ],
    },
    [{ media_id: "m1", media_info: { original_img_url: "https://img.ex/a.jpg" } }],
  );
  assert.match(md, /!\[image\]\(https:\/\/img\.ex\/a\.jpg\)/);
  assert.match(md, /hello/);
  assert.match(md, /world/);
});

test("draftJsToMarkdown keeps orphan media images even without ranges", () => {
  const md = draftJsToMarkdown(
    {
      blocks: [{ key: "a", text: "text only", type: "unstyled", entityRanges: [] }],
      entityMap: [],
    },
    [
      { media_id: "m1", media_info: { original_img_url: "https://img.ex/1.jpg" } },
      { media_id: "m2", media_info: { preview_image: { original_img_url: "https://img.ex/vid.jpg" } } },
    ],
  );
  assert.match(md, /text only/);
  assert.match(md, /!\[image\]\(https:\/\/img\.ex\/1\.jpg\)/);
  assert.match(md, /!\[image\]\(https:\/\/img\.ex\/vid\.jpg\)/);
});

test("tweetToCaptureResult inlines article media entities as images", () => {
  const r = tweetToCaptureResult(
    {
      text: "t",
      author: { name: "A", screen_name: "a" },
      article: {
        title: "T",
        content: {
          blocks: [
            { key: "a", text: "before ", type: "unstyled", entityRanges: [] },
            { key: "b", text: " ", type: "atomic", entityRanges: [{ offset: 0, length: 1, key: 0 }] },
          ],
          entityMap: [
            {
              key: "0",
              value: {
                type: "MEDIA",
                data: { mediaItems: [{ mediaId: "mid-1" }] },
              },
            },
          ],
        },
        media_entities: [
          { media_id: "mid-1", media_info: { original_img_url: "https://pbs.twimg.com/media/x.jpg" } },
          { media_id: "mid-2", media_info: { preview_image: { original_img_url: "https://pbs.twimg.com/v.jpg" } } },
        ],
        cover_media: { media_info: { original_img_url: "https://pbs.twimg.com/c.jpg" } },
      },
    },
    "https://x.com/a/status/9",
    40_000,
  );
  assert.match(r.text, /!\[cover\]\(https:\/\/pbs\.twimg\.com\/c\.jpg\)/);
  assert.match(r.text, /!\[image\]\(https:\/\/pbs\.twimg\.com\/media\/x\.jpg\)/);
  assert.match(r.text, /!\[image\]\(https:\/\/pbs\.twimg\.com\/v\.jpg\)/);
});
