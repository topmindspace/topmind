/**
 * Stream append write → parse roundtrip: comment on the first bullet, then 记下,
 * must stay attached to the intended parent and not swallow later posts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(__dirname, "../..");
const parseMod = await import(
  pathToFileURL(path.join(__dirname, "../src/lib/stream-period-parse.ts")).href
);
const presentMod = await import(
  pathToFileURL(path.join(__dirname, "../src/lib/stream-entry-present.ts")).href
);
const { parsePeriodNote } = parseMod;
const { groupDayFeedRows } = presentMod;
const { appendToStreamEntryDetailed } = await import(
  pathToFileURL(path.join(engineRoot, "lib/activity-window.mjs")).href
);
const { appendToPeriodBody } = await import(
  pathToFileURL(path.join(engineRoot, "lib/stream-period.mjs")).href
);

function rowsFor(md) {
  const entries = parsePeriodNote(md);
  return groupDayFeedRows(entries.map((e, i) => ({ ...e, index: i })));
}

describe("stream append write/parse roundtrip", () => {
  const seed = [
    "---",
    "title: 2026-W32",
    "---",
    "",
    "## 08-03 周一",
    "",
    "- 10:00 first moment",
    "- 11:00 second moment",
    "- 12:00 third moment",
    "",
  ].join("\n");

  it("comment on first of three stays on first; later 记下 is a new post", () => {
    const parsed = parsePeriodNote(seed);
    const first = parsed.find((e) => /first moment/.test(e.body));
    assert.ok(first);
    assert.ok(Number.isInteger(first.startLine) && Number.isInteger(first.endLine));

    const { body: afterComment, location } = appendToStreamEntryDetailed(seed, {
      heading: first.heading,
      anchorText: first.anchorText || first.preview,
      startLine: first.startLine,
      endLine: first.endLine,
      content: "reply to first",
      date: new Date("2026-08-03T14:22:00"),
    });
    assert.equal(location.asNestedList, true);
    assert.match(afterComment, /reply to first/);

    const rows = rowsFor(afterComment);
    assert.equal(rows.length, 3);
    const firstRow = rows.find((r) => /first moment/.test(r.entry.body));
    const secondRow = rows.find((r) => /second moment/.test(r.entry.body));
    assert.ok(firstRow && secondRow);
    assert.equal(firstRow.appends.length, 1);
    assert.match(firstRow.appends[0].body, /reply to first/);
    assert.equal(secondRow.appends.length, 0);

    const afterLog = appendToPeriodBody(afterComment, {
      content: "fourth moment",
      packing: "weekly",
      appendHeading: "day",
      date: new Date("2026-08-03T16:00:00"),
    });
    const afterRows = rowsFor(afterLog);
    assert.equal(afterRows.length, 4);
    const fourth = afterRows.find((r) => /fourth moment/.test(r.entry.body));
    assert.ok(fourth, "later 记下 must be its own post, not swallowed by 续");
    assert.doesNotMatch(firstRow.appends[0].body, /fourth moment/);
    const firstAgain = afterRows.find((r) => /first moment/.test(r.entry.body));
    assert.equal(firstAgain.appends.length, 1);
    assert.doesNotMatch(firstAgain.appends[0].body, /fourth moment/);
  });

  it("second comment on the same moment is a sibling reply", () => {
    const parsed = parsePeriodNote(seed);
    const first = parsed.find((e) => /first moment/.test(e.body));
    const once = appendToStreamEntryDetailed(seed, {
      heading: first.heading,
      anchorText: first.anchorText,
      startLine: first.startLine,
      endLine: first.endLine,
      content: "reply one",
      date: new Date("2026-08-03T14:22:00"),
    }).body;
    const parsedOnce = parsePeriodNote(once);
    const firstOnce = parsedOnce.find((e) => /first moment/.test(e.body));
    const twice = appendToStreamEntryDetailed(once, {
      heading: firstOnce.heading,
      anchorText: firstOnce.anchorText,
      startLine: firstOnce.startLine,
      endLine: firstOnce.endLine,
      content: "reply two",
      date: new Date("2026-08-03T18:01:00"),
    }).body;
    const rows = rowsFor(twice);
    const firstRow = rows.find((r) => /first moment/.test(r.entry.body));
    assert.equal(firstRow.appends.length, 2);
    assert.match(firstRow.appends[0].body, /reply one/);
    assert.match(firstRow.appends[1].body, /reply two/);
    assert.equal(rows.length, 3);
  });
});
