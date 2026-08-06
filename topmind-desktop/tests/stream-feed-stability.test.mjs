/**
 * Stream feed soft-refresh stability — pure helpers + source contracts.
 * Drives shipped streamEntryStableKey (identity-only) through real remap paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldReplaceStreamBody,
  isStreamSoftRefreshEvent,
  streamEntryStableKey,
  remapExpandedIndices,
  STREAM_AI_STRIP_MIN_CLASS,
} from "../src/lib/stream-feed-stability.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shouldReplaceStreamBody only when content actually changes", () => {
  assert.equal(shouldReplaceStreamBody("a", "a"), false);
  assert.equal(shouldReplaceStreamBody("a", "b"), true);
  assert.equal(shouldReplaceStreamBody(null, "x"), true);
  assert.equal(shouldReplaceStreamBody("x", null), true);
});

test("isStreamSoftRefreshEvent covers suggestion and file-changed paths", () => {
  assert.equal(isStreamSoftRefreshEvent("file-changed"), true);
  assert.equal(isStreamSoftRefreshEvent("suggestions"), true);
  assert.equal(isStreamSoftRefreshEvent("silent"), true);
  assert.equal(isStreamSoftRefreshEvent("boot"), false);
});

test("streamEntryStableKey is identity-only (ignores index)", () => {
  const e = { heading: "07-22", sortKey: "07-22", preview: "hello", body: "hello\nworld" };
  // Same identity regardless of array position
  assert.equal(streamEntryStableKey(e, 0), streamEntryStableKey(e, 1));
  assert.equal(streamEntryStableKey(e), streamEntryStableKey(e, 99));
  assert.doesNotMatch(streamEntryStableKey(e, 0), /::\d+$/u);
  const other = { heading: "07-23", sortKey: "07-23", preview: "other" };
  assert.notEqual(streamEntryStableKey(e, 0), streamEntryStableKey(other, 0));
});

test("expand idx 0 survives one new entry prepended via real streamEntryStableKey+remap", () => {
  // Simulate feed: user expanded first card, then compose prepends a new entry
  const oldEntries = [
    { heading: "记录", sortKey: "记录", preview: "original first", body: "original first" },
    { heading: "记录", sortKey: "记录", preview: "second", body: "second" },
  ];
  const newEntries = [
    { heading: "记录", sortKey: "记录", preview: "brand new", body: "brand new" }, // prepended
    { heading: "记录", sortKey: "记录", preview: "original first", body: "original first" },
    { heading: "记录", sortKey: "记录", preview: "second", body: "second" },
  ];
  const prevKeys = oldEntries.map((e, i) => streamEntryStableKey(e, i));
  const nextKeys = newEntries.map((e, i) => streamEntryStableKey(e, i));
  // User had expanded index 0 ("original first")
  const remapped = remapExpandedIndices(prevKeys, nextKeys, new Set([0]));
  // After prepend, "original first" is at index 1
  assert.equal(remapped.has(0), false, "new first card must not inherit expand");
  assert.ok(remapped.has(1), "original expanded card must stay expanded at new index");
  assert.equal(remapped.size, 1);
});

test("remapExpandedIndices with shipped keys survives reorder", () => {
  const entries = [
    { heading: "A", sortKey: "A", preview: "alpha" },
    { heading: "B", sortKey: "B", preview: "beta" },
    { heading: "C", sortKey: "C", preview: "gamma" },
  ];
  const reordered = [entries[1], entries[0], entries[2]];
  const prevKeys = entries.map((e, i) => streamEntryStableKey(e, i));
  const nextKeys = reordered.map((e, i) => streamEntryStableKey(e, i));
  // Expanded A (idx 0) and C (idx 2)
  const remapped = remapExpandedIndices(prevKeys, nextKeys, new Set([0, 2]));
  // A is now at 1, C still at 2
  assert.ok(remapped.has(1));
  assert.ok(remapped.has(2));
  assert.equal(remapped.has(0), false);
});

test("StreamDetailView soft path never setLoading(true) on silent reload", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  const loadFn = view.slice(
    view.indexOf("const loadPeriodContent = useCallback"),
    view.indexOf("const loadPeriods = useCallback"),
  );
  assert.doesNotMatch(loadFn, /setLoading\(\s*true\s*\)/);
  assert.match(loadFn, /shouldReplaceStreamBody/);
  assert.match(loadFn, /silent/);
  // Quiet 建议 entry lives on global SuggestEntryStrip (EditorArea), not Stream body
  const area = readFileSync(path.join(root, "src/components/shell/EditorArea.tsx"), "utf8");
  const strip = readFileSync(path.join(root, "src/components/ai/SuggestEntryStrip.tsx"), "utf8");
  assert.match(area, /SuggestEntryStrip/);
  assert.match(strip, /STREAM_AI_STRIP_MIN_CLASS|data-suggest-entry-strip/);
  assert.ok(STREAM_AI_STRIP_MIN_CLASS.length > 0);
});

test("ActionStore soft refresh does not force loading when everLoaded", () => {
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(store, /loading:\s*!hadItems|hadItems/);
  assert.match(store, /sameSet/);
  assert.match(store, /const keep = get\(\)\.items/);
});
