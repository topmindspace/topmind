/**
 * Pure WeRead note helpers — parse / fingerprint / format.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEREAD_SKILL_VERSION,
  WEREAD_GATEWAY_URL,
  buildGatewayBody,
  inspectGatewayResponse,
  notebooksPageParams,
  reviewsPageParams,
  isExportableBook,
  decideBookSync,
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

test("parseNotebooks reads official notebooks[].bookId beside book{title,author,cover}", () => {
  const rows = parseNotebooks({
    books: [
      {
        bookId: "3300023707",
        book: { title: "被讨厌的勇气", author: "岸见一郎", cover: "https://example/cover.jpg" },
        noteCount: 4,
        reviewCount: 1,
        bookmarkCount: 2,
        sort: 88,
      },
      {
        bookId: "3300000001",
        book: { title: "只有书签" },
        noteCount: 0,
        reviewCount: 0,
        bookmarkCount: 3,
        sort: 10,
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bookId, "3300023707");
  assert.equal(rows[0].title, "被讨厌的勇气");
  assert.equal(rows[0].author, "岸见一郎");
  assert.equal(rows[0].remoteExportableCount, 5);
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

test("official gateway body is flat (api_name + skill_version + lastSort/synckey)", () => {
  const notebooks = buildGatewayBody("/user/notebooks", notebooksPageParams(42, 100));
  assert.equal(notebooks.api_name, "/user/notebooks");
  assert.equal(notebooks.skill_version, WEREAD_SKILL_VERSION);
  assert.equal(notebooks.count, 100);
  assert.equal(notebooks.lastSort, 42);
  assert.equal(notebooks.params, undefined);
  const reviews = buildGatewayBody("/review/list/mine", reviewsPageParams("book-1", 7, 20));
  assert.equal(reviews.bookid, "book-1");
  assert.equal(reviews.synckey, 7);
  assert.equal(reviews.count, 20);
  assert.equal(reviews.params, undefined);
  assert.equal(WEREAD_GATEWAY_URL, "https://i.weread.qq.com/api/agent/gateway");
});

test("inspectGatewayResponse surfaces upgrade_info without failing when data exists", () => {
  const ok = inspectGatewayResponse({
    errcode: 0,
    data: { books: [] },
    upgrade_info: { message: "skill 1.0.5 available" },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.upgradeInfo.message, "skill 1.0.5 available");
  assert.deepEqual(ok.data, { books: [] });
  const bad = inspectGatewayResponse({ errcode: -2012, errmsg: "key" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errcode, -2012);
});

test("isExportableBook requires 划线/想法 — bookmark-only is not exportable", () => {
  assert.equal(isExportableBook({ noteCount: 0, reviewCount: 0, bookmarkCount: 9 }), false);
  assert.equal(isExportableBook({ noteCount: 1, reviewCount: 0 }), true);
  assert.equal(isExportableBook({ noteCount: 0, reviewCount: 2 }), true);
  assert.equal(isExportableBook({ noteCount: 0, reviewCount: 2 }, { includeThoughts: false }), false);
});

test("decideBookSync skips empty, count-match, fingerprint-match; writes changed", () => {
  const empty = decideBookSync({
    remote: { noteCount: 0, reviewCount: 0 },
    local: { localCount: -1, fingerprint: null },
  });
  assert.equal(empty.action, "skip-empty");

  const countSkip = decideBookSync({
    remote: { noteCount: 3, reviewCount: 1 },
    local: { localCount: 4, fingerprint: "old" },
  });
  assert.equal(countSkip.action, "skip-unchanged");
  assert.equal(countSkip.reason, "count-match");

  const highlights = [{ bookmarkId: "b1", markText: "x" }];
  const reviews = [{ reviewId: "r1", content: "y" }];
  const fp = contentFingerprint(highlights, reviews);
  const fpSkip = decideBookSync({
    remote: { noteCount: 1, reviewCount: 1 },
    local: { localCount: 0, fingerprint: fp },
    highlights,
    reviews,
  });
  assert.equal(fpSkip.action, "skip-unchanged");
  assert.equal(fpSkip.reason, "fingerprint-match");
  assert.equal(fpSkip.fingerprint, fp);

  const emptyFetch = decideBookSync({
    remote: { noteCount: 2, reviewCount: 0 },
    local: { localCount: -1, fingerprint: null },
    highlights: [],
    reviews: [],
  });
  assert.equal(emptyFetch.action, "skip-empty");

  const write = decideBookSync({
    remote: { noteCount: 1, reviewCount: 0 },
    local: { localCount: -1, fingerprint: null },
    highlights,
    reviews: [],
  });
  assert.equal(write.action, "write");
  assert.ok(write.fingerprint);

  const fetchNeeded = decideBookSync({
    remote: { noteCount: 2, reviewCount: 0 },
    local: { localCount: 1, fingerprint: null },
  });
  assert.equal(fetchNeeded.action, "fetch");
});

test("weread-service uses official helpers and does not filter by lastSyncAt", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../electron/weread-service.mjs", import.meta.url)), "utf8");
  assert.match(src, /buildGatewayBody/);
  assert.match(src, /inspectGatewayResponse/);
  assert.match(src, /decideBookSync/);
  assert.match(src, /notebooksPageParams/);
  assert.match(src, /reviewsPageParams/);
  assert.match(src, /WEREAD_GATEWAY_URL/);
  assert.match(src, /lastSort/);
  assert.match(src, /\/review\/list\/mine/);
  assert.match(src, /external-capture/);
  assert.match(src, /listNotebooks/);
  assert.doesNotMatch(src, /source_type:\s*["']weread-sync["']/);
  assert.doesNotMatch(src, /params:\s*\{/);
  assert.match(src, /lastSyncAt is display-only/);
  assert.doesNotMatch(src, /if\s*\(.*lastSyncAt/);
  assert.doesNotMatch(src, /upgrade_info\?\.message\)\s*\{[\s\S]{0,80}throw/u);
  const notesSrc = readFileSync(fileURLToPath(new URL("../electron/lib/weread-notes.mjs", import.meta.url)), "utf8");
  assert.match(notesSrc, /n\.bookId\s*\|\|\s*bookInfo\.bookId/);
  const skill = readFileSync(fileURLToPath(new URL("../../skills/topmind-weread/SKILL.md", import.meta.url)), "utf8");
  assert.doesNotMatch(skill, /旧文件进 Archive 备份/);
  assert.match(skill, /create\/update 不备份/);
});
