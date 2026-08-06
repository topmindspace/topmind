/**
 * Unit tests for sidebar tree reveal helpers.
 * Logic mirrored from src/lib/tree-reveal.ts (pure, no TS runtime in node:test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

function expandIdsForSelection(sel) {
  switch (sel.kind) {
    case "inbox":
      return ["section/inbox"];
    case "outputs":
      return ["section/outputs"];
    case "archive":
      return ["section/archive"];
    case "category":
      return [`cat/${sel.category}`];
    case "topic": {
      const cat = sel.topicId.split("/")[0];
      return cat ? [`cat/${cat}`, sel.topicId] : [sel.topicId];
    }
    case "file": {
      const pathStr = sel.path.replace(/\\/g, "/");
      const parts = pathStr.split("/").filter(Boolean);
      if (parts.length === 0) return [];
      const root = parts[0];
      if (/^00([- ]|$)/u.test(root) || /inbox/iu.test(root)) return ["section/inbox"];
      if (/^88([- ]|$)/u.test(root) || /outputs?/iu.test(root)) return ["section/outputs"];
      if (/^99([- ]|$)/u.test(root) || /archive/iu.test(root)) return ["section/archive"];
      if (sel.topicId) {
        const cat = sel.topicId.split("/")[0];
        return cat ? [`cat/${cat}`, sel.topicId] : [sel.topicId];
      }
      if (parts.length === 2 && parts[1].endsWith(".md")) return [`cat/${parts[0]}`];
      if (parts.length >= 3) {
        return [`cat/${parts[0]}`, `${parts[0]}/${parts[1]}`];
      }
      if (parts.length === 1) return [`cat/${parts[0]}`];
      return [`cat/${parts[0]}`, `${parts[0]}/${parts[1]}`];
    }
    default:
      return [];
  }
}

function defaultExpandIds(treeRoots) {
  const ids = [];
  for (const n of treeRoots) {
    if (n.kind === "category") ids.push(n.id);
    if (n.kind === "group" && Array.isArray(n.children) && n.children.length > 0) ids.push(n.id);
  }
  return ids;
}

function recentFilePathsFromHistory(history, historyIndex, limit = 12) {
  const slice = history.slice(0, historyIndex + 1);
  const seen = new Set();
  const out = [];
  for (let i = slice.length - 1; i >= 0; i--) {
    const s = slice[i];
    if (s.kind !== "file") continue;
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    out.push(s.path);
    if (out.length >= limit) break;
  }
  return out;
}

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
