/**
 * Unit tests for shipped sidebar tree reveal helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expandIdsForSelection,
  defaultExpandIds,
  recentFilePathsFromHistory,
} from "../src/lib/tree-reveal.ts";

test("expandIdsForSelection opens category + topic for nested file", () => {
  const ids = expandIdsForSelection({
    kind: "file",
    path: "10-日常/2024-笔记/hello.md",
  });
  assert.deepEqual(ids, ["cat/10-日常", "10-日常/2024-笔记"]);
});

test("expandIdsForSelection respects topicId hint", () => {
  const ids = expandIdsForSelection({
    kind: "file",
    path: "10-日常/2024-笔记/hello.md",
    topicId: "10-日常/2024-笔记",
  });
  assert.deepEqual(ids, ["cat/10-日常", "10-日常/2024-笔记"]);
});

test("expandIdsForSelection maps inbox / outputs / archive", () => {
  assert.deepEqual(expandIdsForSelection({ kind: "file", path: "00-收件箱/a.md" }), ["section/inbox"]);
  assert.deepEqual(expandIdsForSelection({ kind: "inbox" }), ["section/inbox"]);
  assert.deepEqual(expandIdsForSelection({ kind: "file", path: "88-输出/x.md" }), ["section/outputs"]);
  assert.deepEqual(expandIdsForSelection({ kind: "archive" }), ["section/archive"]);
});

test("defaultExpandIds opens categories and non-empty groups", () => {
  const ids = defaultExpandIds([
    { id: "section/inbox", kind: "group", children: [{ id: "f1" }] },
    { id: "cat/10-日常", kind: "category", children: [] },
    { id: "section/archive", kind: "group", children: [] },
  ]);
  assert.ok(ids.includes("section/inbox"));
  assert.ok(ids.includes("cat/10-日常"));
  assert.ok(!ids.includes("section/archive"));
});

test("defaultExpandIds does not expand empty inbox", () => {
  const ids = defaultExpandIds([
    { id: "section/inbox", kind: "group", children: [] },
  ]);
  assert.ok(!ids.includes("section/inbox"));
});

test("recentFilePathsFromHistory is unique newest-first", () => {
  const history = [
    { kind: "stream" },
    { kind: "file", path: "a.md" },
    { kind: "file", path: "b.md" },
    { kind: "file", path: "a.md" },
  ];
  const paths = recentFilePathsFromHistory(history, 3, 10);
  assert.deepEqual(paths, ["a.md", "b.md"]);
});
