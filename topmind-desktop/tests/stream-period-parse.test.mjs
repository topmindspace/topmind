/**
 * Shared period-note parse + day grouping (StreamView / StreamDetailView).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "../src/lib/stream-period-parse.ts");

// tsx registers TS; desktop tests run via tsx --test
const mod = await import(pathToFileURL(src).href);
const { parsePeriodNote, groupEntriesByDay, dayKeyFromEntry, STRUCTURAL_HEADINGS } = mod;

describe("stream-period-parse", () => {
  it("keeps day sections newest-first; soft-extracts structural list items", () => {
    const md = `---
title: w
---
## 进行中
- open task

## 2026-07-24
- 10:00 a

## 2026-07-25
- 09:00 b
`;
    const entries = parsePeriodNote(md);
    // day sections + soft entry from 进行中
    assert.ok(entries.length >= 2);
    assert.equal(entries[0].heading, "2026-07-25");
    assert.ok(entries.some((e) => e.heading === "2026-07-24"));
    assert.ok(entries.some((e) => e.heading === "进行中" || /open task/u.test(e.preview + e.body)));
    assert.ok(STRUCTURAL_HEADINGS.has("进行中"));
  });

  it("surfaces bullets under 记录 so feed is never blank", () => {
    const md = `# week\n\n## 进行中\n\n## 记录\n\n- 10:00 记一下甲\n- 11:00 记一下乙\n`;
    const entries = parsePeriodNote(md);
    assert.ok(entries.length >= 2, `expected soft entries, got ${entries.length}`);
    assert.ok(entries.some((e) => /甲/u.test(e.preview + e.body)));
  });

  it("handles CRLF frontmatter", () => {
    const md = "---\r\ntitle: x\r\n---\r\n\r\n## 07-22 周二\r\n- 09:00 hello\r\n";
    const entries = parsePeriodNote(md);
    assert.equal(entries.length, 1);
    assert.match(entries[0].heading, /07-22/);
  });

  it("groups by ISO day", () => {
    const entries = parsePeriodNote(`## 2026-07-24\n- a\n\n## 2026-07-24 晚\n- b\n\n## 2026-07-25\n- c\n`);
    const groups = groupEntriesByDay(entries, "Other");
    assert.equal(groups.length, 2);
    assert.equal(groups[0].dayKey, "2026-07-25");
    assert.equal(groups[1].dayKey, "2026-07-24");
    assert.equal(groups[1].entries.length, 2);
  });

  it("dayKeyFromEntry handles Chinese dates", () => {
    const { dayKey, dayLabel } = dayKeyFromEntry({
      heading: "7月24日 随笔",
      body: "x",
      sortKey: "x",
      preview: "x",
      rest: "",
    });
    assert.equal(dayKey, "cn-7-24");
    assert.equal(dayLabel, "7月24日");
  });

  it("soft-splits day sections into per-bullet + append cards", () => {
    const {
      softSplitContentEntries,
      isDayLikeHeading,
      normalizeStreamEscapes,
      splitMainAndAppendChunks,
    } = mod;
    assert.equal(isDayLikeHeading("08-03 周一"), true);
    assert.equal(isDayLikeHeading("进行中"), false);

    const body = [
      "- 10:00 first moment",
      "- 11:00 second",
      "",
      "#### 续 · 2026-08-03 12:00",
      "",
      "follow-up text",
    ].join("\n");
    const soft = softSplitContentEntries("08-03 周一", body);
    assert.equal(soft.length, 2, `expected 2 posts (续 nested on previous), got ${soft.length}`);
    assert.ok(soft.some((e) => /first moment/u.test(e.body)));
    const second = soft.find((e) => /11:00 second/u.test(e.body));
    assert.ok(second);
    assert.equal((second.replies || []).length, 1);
    assert.match(second.replies[0].body, /follow-up text/);

    const unesc = normalizeStreamEscapes("- \\[ \\] open task");
    assert.match(unesc, /\[ \]/);
    assert.doesNotMatch(unesc, /\\\[/);

    // Escaped list / heading markers from paste noise (display-only normalize)
    const listEsc = normalizeStreamEscapes("\\- first\n\\* second\n\\# Title");
    assert.match(listEsc, /^- first/m);
    assert.match(listEsc, /^\* second/m);
    assert.match(listEsc, /^# Title/m);
    assert.doesNotMatch(listEsc, /\\-/);

    const messyPeriod = parsePeriodNote(
      "---\r\ntitle: x\r\n---\r\n\r\n## 08-08\r\n\r\n\\- escaped one\r\n\\- escaped two\r\n",
    );
    assert.ok(messyPeriod.length >= 2, `expected soft-split bullets, got ${messyPeriod.length}`);
    assert.ok(messyPeriod.some((e) => /escaped one/u.test(e.body + e.preview)));

    const { main, appendChunks } = splitMainAndAppendChunks(body);
    assert.match(main, /first moment/);
    assert.equal(appendChunks.length, 1);
  });

  it("keeps named non-day ## as a single article entry (does not soft-split lists)", () => {
    const md = [
      "## 产品方案草稿",
      "",
      "这是一篇长笔记正文，用来讨论方案细节与边界。",
      "",
      "- 要点 A",
      "- 要点 B",
      "",
      "#### 续 · 2026-08-03 12:00",
      "",
      "后续补充",
    ].join("\n");
    const entries = parsePeriodNote(md);
    const named = entries.filter((e) => e.heading === "产品方案草稿");
    assert.equal(named.length, 1, `expected one 文章卡, got ${named.length}`);
    assert.match(named[0].body, /要点 A/);
    assert.equal((named[0].replies || []).length, 1);
    assert.match(named[0].replies[0].body, /后续补充/);
    assert.doesNotMatch(named[0].body, /后续补充/);
  });

  it("fixture-like W32 day has separate moment cards not one blob", () => {
    const md = `---
title: 2026-W32
---
## 08-03 周一

- 10:00 今日目标：验证
- 10:45 偏好：安静 chrome
- 15:00 待办：剪藏

#### 续 · 2026-08-03 11:17（对「08-03 周一」）

增补探针

#### 续 · 2026-08-03 11:27（对「08-03 周一」）

主视图优化
`;
    const entries = parsePeriodNote(md);
    const day = entries.filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 3, `expected 3 moment posts (续 nested), got ${day.length}`);
    const lastInFile = day.find((e) => /15:00/.test(e.body));
    assert.ok(lastInFile);
    assert.equal((lastInFile.replies || []).length, 2);
    const groups = groupEntriesByDay(entries, "Other");
    const g = groups.find((x) => x.dayLabel.includes("08-03"));
    assert.ok(g && g.entries.length === 3);
  });

  it("wrapped prose with no list markers is one entry (not one card per newline)", () => {
    const md = [
      "## 08-03 周一",
      "",
      "This is a long paragraph that wraps",
      "across several lines because the author",
      "hit enter without using list markers.",
      "",
      "Second paragraph after a blank line stays on the same post.",
    ].join("\n");
    const entries = parsePeriodNote(md);
    const day = entries.filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 1, `expected one prose post, got ${day.length}`);
    assert.match(day[0].body, /long paragraph/);
    assert.match(day[0].body, /Second paragraph/);
    assert.doesNotMatch(day[0].body, /^\s*[-*+]\s/m);
  });

  it("timed list items stay separate; extra paragraphs stay on the same moment", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 a",
      "- 11:00 b",
      "",
    ].join("\n");
    const timed = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(timed.length, 2);
    assert.match(timed.find((e) => /10:00/.test(e.body)).body, /10:00 a/);
    assert.match(timed.find((e) => /11:00/.test(e.body)).body, /11:00 b/);

    const continued = parsePeriodNote(
      [
        "## 08-03 周一",
        "",
        "- 10:00 lead",
        "",
        "second paragraph of the same moment",
      ].join("\n"),
    ).filter((e) => e.heading === "08-03 周一");
    assert.equal(continued.length, 1, `expected one continued moment, got ${continued.length}`);
    assert.match(continued[0].body, /10:00 lead/);
    assert.match(continued[0].body, /second paragraph/);
  });

  it("prose-first day keeps an embedded list on the same post", () => {
    const md = [
      "## 08-03 周一",
      "",
      "Today I thought about the plan:",
      "",
      "- point a",
      "- point b",
      "",
      "That is the conclusion.",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 1, `expected one prose post with list, got ${day.length}`);
    assert.match(day[0].body, /Today I thought/);
    assert.match(day[0].body, /- point a/);
    assert.match(day[0].body, /conclusion/);
  });

  it("nested list items stay on the parent first-level card", () => {
    const { splitFirstLevelListItems } = mod;
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 parent moment",
      "  - nested A",
      "  - nested B",
      "- 11:00 sibling",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 2, `expected 2 first-level cards, got ${day.length}`);
    const parent = day.find((e) => /parent moment/.test(e.body));
    assert.ok(parent);
    assert.match(parent.body, /nested A/);
    assert.match(parent.body, /nested B/);
    assert.ok(day.some((e) => /11:00 sibling/.test(e.body)));
    const split = splitFirstLevelListItems("- a\n  - a1\n  - a2\n- b\n");
    assert.equal(split.length, 2);
    assert.match(split[0], /a1/);
  });

  it("reverses posts newest-first but keeps 续 nested on the preceding item", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 first",
      "- 11:00 second",
      "",
      "#### 续 · 2026-08-03 12:00",
      "",
      "follow",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 2);
    assert.match(day[0].body, /11:00 second/);
    assert.equal((day[0].replies || []).length, 1);
    assert.match(day[0].replies[0].body, /follow/);
    assert.match(day[1].body, /10:00 first/);
    assert.equal((day[1].replies || []).length, 0);
  });

  it("续 between bullets does not swallow the next 记下", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 first",
      "#### 续 · 2026-08-03 12:00",
      "comment",
      "- 12:00 third",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 2, `expected 2 posts, got ${day.length}`);
    const first = day.find((e) => /10:00 first/.test(e.body));
    const third = day.find((e) => /12:00 third/.test(e.body));
    assert.ok(first && third);
    assert.equal((first.replies || []).length, 1);
    assert.match(first.replies[0].body, /comment/);
    assert.doesNotMatch(first.replies[0].body, /12:00 third/);
  });

  it("handwritten timed nested bullets become replies; untimed outlines stay in body", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 shopping",
      "  - milk",
      "  - 14:22 bought oat milk instead",
      "- 11:00 sibling",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    const shop = day.find((e) => /shopping/.test(e.body));
    assert.ok(shop);
    assert.match(shop.body, /milk/);
    assert.doesNotMatch(shop.body, /oat milk/);
    assert.equal((shop.replies || []).length, 1);
    assert.match(shop.replies[0].body, /oat milk/);
  });

  it("nested official append (marker + timed bullet) attaches to parent without #### 续", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 first",
      "  <!-- topmind:append heading=\"first\" at=\"2026-08-03T12:00:00.000Z\" -->",
      "  - 12:00 a reply",
      "- 11:00 second",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    const first = day.find((e) => /10:00 first/.test(e.body));
    assert.ok(first);
    assert.equal((first.replies || []).length, 1);
    assert.match(first.replies[0].body, /a reply/);
    assert.ok(first.startLine != null && first.endLine != null);
    assert.ok(first.endLine > first.startLine);
  });

  it("untimed list/task body of #### 续 stays on the parent; timed 记下 still splits", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 原条正文",
      "#### 续 · 2026-08-03 12:00",
      "",
      "- 补充一条列表",
      "- [ ] 补充待办",
      "- 13:00 later moment",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 2);
    const parent = day.find((e) => /原条正文/.test(e.body));
    const later = day.find((e) => /later moment/.test(e.body));
    assert.ok(parent && later);
    assert.match((parent.replies || []).map((r) => r.body).join("\n"), /补充一条列表/);
    assert.match((parent.replies || []).map((r) => r.body).join("\n"), /补充待办/);
    assert.doesNotMatch((parent.replies || []).map((r) => r.body).join("\n"), /later moment/);
  });

  it("legacy #### 续 still parses after HTML comments are removed", () => {
    const md = [
      "## 08-03 周一",
      "",
      "- 10:00 first",
      "#### 续 · 2026-08-03 12:00（对「first」）",
      "",
      "no machine marker",
    ].join("\n");
    const day = parsePeriodNote(md).filter((e) => e.heading === "08-03 周一");
    assert.equal(day.length, 1);
    assert.equal((day[0].replies || []).length, 1);
    assert.match(day[0].replies[0].body, /no machine marker/);
  });
});
