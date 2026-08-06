/**
 * Pure WeRead note helpers — parse / fingerprint / format.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEREAD_SKILL_VERSION,
  parseNotebooks,
  parseHighlights,
  parseReviews,
  contentFingerprint,
  formatNotesMarkdown,
  bookTopicName,
  slimStatsSnapshot,
  formatReadDuration,
} from "../electron/lib/weread-notes.mjs";

test("skill version is 1.0.4", () => {
  assert.equal(WEREAD_SKILL_VERSION, "1.0.4");
});

test("parseNotebooks uses noteCount+reviewCount as exportable (not bookmarkCount first)", () => {
  const rows = parseNotebooks({
    books: [
      {
        book: { bookId: "1", title: "三体", author: "刘慈欣" },
        noteCount: 10,
        reviewCount: 3,
        bookmarkCount: 50,
        sort: 100,
      },
      {
        book: { bookId: "2", title: "空书" },
        noteCount: 0,
        reviewCount: 0,
        bookmarkCount: 9,
        sort: 90,
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bookId, "1");
  assert.equal(rows[0].noteCount, 10);
  assert.equal(rows[0].reviewCount, 3);
  assert.equal(rows[0].remoteExportableCount, 13);
  assert.equal(rows[0].remoteStatCount, 63);
});

test("parseHighlights maps chapters by chapterUid", () => {
  const hs = parseHighlights({
    updated: [
      { bookmarkId: "b1", chapterUid: 2, markText: "hello", range: "1-5" },
    ],
    chapters: [{ chapterUid: 2, title: "第二章" }],
  });
  assert.equal(hs.length, 1);
  assert.equal(hs[0].chapterName, "第二章");
  assert.equal(hs[0].markText, "hello");
});

test("parseReviews unwraps review.review", () => {
  const rs = parseReviews({
    reviews: [
      { review: { reviewId: "r1", content: "想法A", abstract: "原文", range: "1-5" } },
    ],
  });
  assert.equal(rs.length, 1);
  assert.equal(rs[0].content, "想法A");
  assert.equal(rs[0].abstract, "原文");
});

test("contentFingerprint stable for same content", () => {
  const a = contentFingerprint(
    [{ bookmarkId: "b1", markText: "x" }],
    [{ reviewId: "r1", content: "y" }],
  );
  const b = contentFingerprint(
    [{ bookmarkId: "b1", markText: "x" }],
    [{ reviewId: "r1", content: "y" }],
  );
  const c = contentFingerprint(
    [{ bookmarkId: "b2", markText: "x" }],
    [{ reviewId: "r1", content: "y" }],
  );
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 16);
});

test("formatNotesMarkdown links thoughts by range and lists orphan thoughts", () => {
  const md = formatNotesMarkdown(
    { title: "测试书" },
    [{ chapterName: "一", markText: "划线句", range: "10-20", bookmarkId: "b1" }],
    [
      { reviewId: "r1", content: "关联想法", range: "10-20" },
      { reviewId: "r2", content: "整本书评", chapterName: "" },
    ],
  );
  assert.match(md, /# 测试书 - 划线笔记/);
  assert.match(md, /划线句/);
  assert.match(md, /关联想法/);
  assert.match(md, /整本书评/);
});

test("bookTopicName sanitizes and prefixes year", () => {
  const name = bookTopicName({ title: '三体: "黑暗森林"' }, 2026);
  assert.equal(name, "2026-三体 黑暗森林");
});

test("formatReadDuration and slimStatsSnapshot", () => {
  assert.equal(formatReadDuration(3661), "1小时1分钟");
  assert.equal(formatReadDuration(45), "不足1分钟");
  const slim = slimStatsSnapshot(
    {
      totalReadTime: 7200,
      readDays: 5,
      dayAverageReadTime: 600,
      compare: 0.2,
      preferCategoryWord: "偏好文学",
      readStat: [{ stat: "读过", counts: "3本" }],
      readLongest: [{ book: { title: "A", author: "B", bookId: "9" }, readTime: 100 }],
    },
    "monthly",
  );
  assert.equal(slim.mode, "monthly");
  assert.equal(slim.totalReadTime, 7200);
  assert.equal(slim.topBooks[0].title, "A");
  assert.ok(slim.fetchedAt);
});

test("weread-service uses official skill version and pagination helpers", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../electron/weread-service.mjs", import.meta.url)), "utf8");
  assert.match(src, /WEREAD_SKILL_VERSION|1\.0\.4/);
  assert.match(src, /lastSort/);
  assert.match(src, /\/review\/list\/mine/);
  assert.match(src, /external-capture/);
  assert.match(src, /listNotebooks/);
  assert.doesNotMatch(src, /source_type:\s*["']weread-sync["']/);
});
