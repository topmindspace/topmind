/**
 * Stream feed presentation — expand accuracy + day row grouping + article cards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(
  pathToFileURL(path.join(__dirname, "../src/lib/stream-entry-present.ts")).href
);
const {
  classifyStreamEntry,
  streamEntryNeedsExpand,
  groupDayFeedRows,
  streamArticleTitle,
  streamArticleSummary,
  STREAM_EXPAND_CHAR_BUDGET,
} = mod;

describe("stream-entry-present", () => {
  it("short single-line moment does not need expand", () => {
    assert.equal(
      streamEntryNeedsExpand({
        body: "- 10:00 记一下短句",
        rest: "",
        preview: "记一下短句",
      }),
      false,
    );
  });

  it("long multi-line body needs expand", () => {
    // Exceeds STREAM_EXPAND_LINE_BUDGET (8) to trigger expand
    const body = Array.from({ length: 10 }, (_, i) => `line ${i} extra words here`).join("\n");
    assert.equal(
      streamEntryNeedsExpand({ body, rest: "more", preview: "line 0" }),
      true,
    );
  });

  it("short body with many nested appends needs expand", () => {
    assert.equal(
      streamEntryNeedsExpand(
        { body: "- 10:00 short", rest: "", preview: "short" },
        { nestedAppendCount: 3 },
      ),
      true,
    );
  });

  it("classifies day bullet as moment and named section as article", () => {
    assert.equal(
      classifyStreamEntry({
        heading: "08-03 周一",
        body: "- 10:00 hello",
        preview: "hello",
      }),
      "moment",
    );
    assert.equal(
      classifyStreamEntry({
        heading: "产品方案草稿",
        body: "这是一篇长笔记正文，用来讨论方案细节与边界。\n\n第二段内容。",
        preview: "这是一篇长笔记",
      }),
      "article",
    );
  });

  it("groups appends under previous moment", () => {
    const rows = groupDayFeedRows([
      {
        index: 0,
        heading: "08-03",
        body: "- 10:00 a",
        preview: "a",
        rest: "",
        sortKey: "a",
      },
      {
        index: 1,
        heading: "08-03",
        body: "#### 续 · x\nfollow",
        preview: "follow",
        rest: "",
        sortKey: "b",
        isAppend: true,
      },
      {
        index: 2,
        heading: "08-03",
        body: "- 11:00 b",
        preview: "b",
        rest: "",
        sortKey: "c",
      },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].appends.length, 1);
    assert.equal(rows[0].kind, "moment");
    assert.equal(rows[1].kind, "moment");
  });

  it("article title + summary helpers", () => {
    const entry = {
      heading: "研究笔记",
      body: "研究笔记\n\n这是摘要正文部分，用于预览。",
      preview: "研究笔记",
      rest: "这是摘要正文部分，用于预览。",
    };
    assert.equal(streamArticleTitle(entry), "研究笔记");
    assert.ok(streamArticleSummary(entry).includes("摘要"));
    assert.ok(STREAM_EXPAND_CHAR_BUDGET >= 180);
  });

  it("named heading stays article even when body includes 增补", () => {
    assert.equal(
      classifyStreamEntry({
        heading: "产品方案草稿",
        body: "正文\n\n<!-- topmind:append parent=\"x\" -->\n#### 续 · later\nmore",
        preview: "正文",
        isAppend: true,
      }),
      "article",
    );
  });

  it("article summary strips HTML comments for display only", () => {
    const summary = streamArticleSummary({
      heading: "研究笔记",
      body: "研究笔记\n\n<!-- topmind:append parent=\"x\" heading=\"h\" -->\n可见摘要。",
      preview: "研究笔记",
      rest: "<!-- topmind:append parent=\"x\" --> 可见摘要。",
    });
    assert.doesNotMatch(summary, /topmind:append/);
    assert.match(summary, /可见摘要/);
  });

  it("same chunks for both layouts: wrapped prose is one row; timed list is two; continuation stays one", async () => {
    const { pathToFileURL } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const parseMod = await import(
      pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../src/lib/stream-period-parse.ts")).href
    );
    const { parsePeriodNote } = parseMod;

    const prose = parsePeriodNote(
      [
        "## 08-03 周一",
        "",
        "This is a long paragraph that wraps",
        "across several lines because the author",
        "hit enter without using list markers.",
      ].join("\n"),
    );
    assert.equal(prose.length, 1);
    const proseRows = groupDayFeedRows(prose.map((e, i) => ({ ...e, index: i })));
    assert.equal(proseRows.length, 1);
    assert.equal(classifyStreamEntry(prose[0]), "prose");

    const timed = parsePeriodNote("## 08-03 周一\n\n- 10:00 a\n- 11:00 b\n");
    assert.equal(timed.length, 2);
    const timedRows = groupDayFeedRows(timed.map((e, i) => ({ ...e, index: i })));
    assert.equal(timedRows.length, 2);
    assert.equal(classifyStreamEntry(timed[0]), "moment");
    assert.equal(classifyStreamEntry(timed[1]), "moment");

    const continued = parsePeriodNote("## 08-03 周一\n\n- 10:00 lead\n\nsecond paragraph\n");
    assert.equal(continued.length, 1);
    const contRows = groupDayFeedRows(continued.map((e, i) => ({ ...e, index: i })));
    assert.equal(contRows.length, 1);
    assert.match(continued[0].body, /second paragraph/);
  });

  it("StreamDetailView applies data-layout to the same parse/group path (does not re-split)", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
      "utf8",
    );
    assert.match(src, /parsePeriodNote\(content\)/);
    assert.match(src, /groupDayFeedRows\(group\.entries\)/);
    assert.match(src, /data-layout=\{feedLayout\}/);
    const loadFn = src.slice(src.indexOf("const loadPeriodContent"), src.indexOf("const loadPeriods"));
    assert.doesNotMatch(loadFn, /feedLayout/);
    const feed = src.slice(src.indexOf("data-stream-feed"));
    assert.match(feed, /groupDayFeedRows/);
    assert.doesNotMatch(feed, /parsePeriodNote/);
  });
});
