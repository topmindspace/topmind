/**
 * pathOfTreeNode — resolve workspace-relative paths from tree nodes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pathOfTreeNode } from "../src/lib/tree-path";
import type { TreeNode } from "../src/plugins/types";

test("pathOfTreeNode: file selection", () => {
  const node = {
    id: "a/b.md",
    label: "b.md",
    kind: "file",
    selection: { kind: "file", path: "a/b.md" },
  } as TreeNode;
  assert.equal(pathOfTreeNode(node), "a/b.md");
});

test("pathOfTreeNode: topic selection (not file-only)", () => {
  const node = {
    id: "10-日常/2026-主题",
    label: "2026-主题",
    kind: "topic",
    selection: { kind: "topic", topicId: "10-日常/2026-主题" },
  } as TreeNode;
  assert.equal(pathOfTreeNode(node), "10-日常/2026-主题");
});

test("pathOfTreeNode: category via selection or cat/ id", () => {
  const viaSel = {
    id: "cat/20-工作",
    label: "20-工作",
    kind: "category",
    selection: { kind: "category", category: "20-工作" },
  } as TreeNode;
  assert.equal(pathOfTreeNode(viaSel), "20-工作");
  const viaId = {
    id: "cat/30-研究",
    label: "30-研究",
    kind: "category",
  } as TreeNode;
  assert.equal(pathOfTreeNode(viaId), "30-研究");
});

test("pathOfTreeNode: folder lazyPath or folder/ prefix", () => {
  const lazy = {
    id: "folder/99-归档/backups",
    label: "backups",
    kind: "folder",
    meta: { lazyPath: "99-归档/backups" },
  } as TreeNode;
  assert.equal(pathOfTreeNode(lazy), "99-归档/backups");
  const prefix = {
    id: "folder/88-输出",
    label: "88-输出",
    kind: "folder",
  } as TreeNode;
  assert.equal(pathOfTreeNode(prefix), "88-输出");
});

test("pathOfTreeNode: group / unknown → null", () => {
  const group = {
    id: "section/inbox",
    label: "Inbox",
    kind: "group",
  } as TreeNode;
  assert.equal(pathOfTreeNode(group), null);
});
