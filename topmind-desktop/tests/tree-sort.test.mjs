import test from "node:test";
import assert from "node:assert/strict";
import { sortTreeSiblings } from "../src/lib/tree-sort.ts";

test("sortTreeSiblings mtime-desc is default order preference", () => {
  const nodes = [
    { id: "a", label: "old.md", kind: "file", meta: { mtime: "2020-01-01T00:00:00.000Z" } },
    { id: "b", label: "new.md", kind: "file", meta: { mtime: "2024-06-01T00:00:00.000Z" } },
    { id: "c", label: "mid.md", kind: "file", meta: { mtime: "2022-01-01T00:00:00.000Z" } },
  ];
  const ordered = sortTreeSiblings(nodes, "mtime-desc");
  assert.deepEqual(
    ordered.map((n) => n.id),
    ["b", "c", "a"],
  );
});

test("sortTreeSiblings name-asc", () => {
  const nodes = [
    { id: "1", label: "zeta", kind: "file", meta: {} },
    { id: "2", label: "alpha", kind: "file", meta: {} },
  ];
  const ordered = sortTreeSiblings(nodes, "name-asc");
  assert.equal(ordered[0].label, "alpha");
});

test("categories keep id order among themselves", () => {
  const nodes = [
    { id: "cat/20-研究", label: "20-研究", kind: "category", children: [] },
    { id: "cat/10-日常", label: "10-日常", kind: "category", children: [] },
  ];
  const ordered = sortTreeSiblings(nodes, "mtime-desc");
  assert.equal(ordered[0].id, "cat/10-日常");
});

test("top-level layout is fixed: inbox → categories(NN) → outputs → archive", () => {
  const nodes = [
    { id: "section/archive", label: "99-归档", kind: "group", children: [] },
    { id: "cat/20-研究", label: "20-研究", kind: "category", children: [] },
    { id: "section/outputs", label: "88-输出", kind: "group", children: [] },
    { id: "cat/10-日常", label: "10-日常", kind: "category", children: [] },
    { id: "section/inbox", label: "00-收件箱", kind: "group", children: [] },
  ];
  for (const mode of ["mtime-desc", "mtime-asc", "name-asc", "name-desc"]) {
    const ordered = sortTreeSiblings(nodes, mode);
    assert.deepEqual(
      ordered.map((n) => n.id),
      ["section/inbox", "cat/10-日常", "cat/20-研究", "section/outputs", "section/archive"],
      `mode ${mode}`,
    );
  }
});

test("sort mode only reorders files under a category, not categories", () => {
  const files = [
    { id: "a.md", label: "a.md", kind: "file", meta: { mtime: "2020-01-01T00:00:00.000Z" } },
    { id: "b.md", label: "b.md", kind: "file", meta: { mtime: "2024-01-01T00:00:00.000Z" } },
  ];
  assert.equal(sortTreeSiblings(files, "mtime-desc")[0].id, "b.md");
  assert.equal(sortTreeSiblings(files, "name-asc")[0].id, "a.md");
});
