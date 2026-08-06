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
      countStreamAppends,
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
    assert.ok(soft.length >= 3, `expected bullets+append, got ${soft.length}`);
    assert.ok(soft.some((e) => /first moment/u.test(e.body)));
    assert.ok(soft.some((e) => e.isAppend || countStreamAppends(e.body) > 0));

    const unesc = normalizeStreamEscapes("- \\[ \\] open task");
    assert.match(unesc, /\[ \]/);
    assert.doesNotMatch(unesc, /\\\[/);

    const { main, appendChunks } = splitMainAndAppendChunks(body);
    assert.match(main, /first moment/);
    assert.equal(appendChunks.length, 1);
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
    assert.ok(day.length >= 4, `expected 3 bullets + 2 appends, got ${day.length}`);
    const groups = groupEntriesByDay(entries, "Other");
    const g = groups.find((x) => x.dayLabel.includes("08-03"));
    assert.ok(g && g.entries.length >= 4);
  });
});
