import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { loadContractRegistry } from "../../core/contract-registry.mjs";
import { executeTool } from "../../core/tool-executor.mjs";

let registry;
let workspace;

test.before(async () => {
  registry = await loadContractRegistry();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-todo-"));
  const userWorkspaceRoot = path.join(base, "workspace");
  await fs.mkdir(path.join(userWorkspaceRoot, "00 Inbox"), { recursive: true });
  await fs.mkdir(path.join(userWorkspaceRoot, "10 动态"), { recursive: true });
  await fs.mkdir(path.join(userWorkspaceRoot, "99 Archive"), { recursive: true });
  await fs.mkdir(path.join(userWorkspaceRoot, "88 Outputs"), { recursive: true });
  workspace = {
    base,
    userWorkspaceRoot,
    pathContext: { engineRoot: path.resolve(import.meta.dirname, "..", "..", ".."), userWorkspaceRoot },
  };
});

test.after(async () => {
  if (workspace) await fs.rm(workspace.base, { recursive: true, force: true });
});

test("memory domain exposes todo satellite commands", () => {
  const tool = registry.byKind.get("memory");
  assert.ok(tool);
  const names = Object.keys(tool.commands);
  assert.ok(names.includes("list-todos"));
  assert.ok(names.includes("add-todo"));
  assert.ok(names.includes("toggle-todo"));
});

test("add-todo then list-todos then toggle-todo round-trip", async () => {
  const add = await executeTool({
    registry,
    kind: "memory",
    command: "add-todo",
    payload: {
      items: JSON.stringify(["交季度报告", "订机票"]),
      dueDate: "2026-10-01",
      writebackMode: "auto",
    },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(add.ok, true);
  assert.equal(add.parsed.data.addedCount, 2);
  assert.equal(add.parsed.data.targetPath, "memory/todo.md");

  const listed = await executeTool({
    registry,
    kind: "memory",
    command: "list-todos",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.parsed.data.activeCount, 2);
  assert.equal(listed.parsed.data.items.length, 2);

  const toggled = await executeTool({
    registry,
    kind: "memory",
    command: "toggle-todo",
    payload: { idOrText: "交季度报告", writebackMode: "auto" },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(toggled.ok, true);
  assert.equal(toggled.parsed.data.nowCompleted, true);

  const after = await executeTool({
    registry,
    kind: "memory",
    command: "list-todos",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(after.parsed.data.activeCount, 1);
  assert.equal(after.parsed.data.completedCount, 1);
});

test("add-todo preview is a true dry-run — no disk write", async () => {
  const before = await executeTool({
    registry,
    kind: "memory",
    command: "list-todos",
    payload: { completed: true },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  const beforeCount = before.parsed.data.total;

  const preview = await executeTool({
    registry,
    kind: "memory",
    command: "add-todo",
    payload: {
      text: "dry-run-should-not-persist",
      dryRun: true,
      writebackMode: "auto",
    },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.parsed.data.preview, true);
  assert.equal(preview.parsed.data.applied, false);
  assert.equal(preview.parsed.data.addedCount ?? preview.parsed.data.wouldAdd?.length, 1);
  assert.ok(Array.isArray(preview.parsed.data.wouldAdd));
  assert.match(preview.parsed.data.wouldAdd[0], /dry-run-should-not-persist/u);

  const after = await executeTool({
    registry,
    kind: "memory",
    command: "list-todos",
    payload: { completed: true },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(after.parsed.data.total, beforeCount, "preview must not mutate todo list");
  assert.ok(
    !after.parsed.data.items.some((i) => String(i.text).includes("dry-run-should-not-persist")),
    "preview item must not be written to disk",
  );
});

test("add-todo dedupes and rejects empty input", async () => {
  const first = await executeTool({
    registry,
    kind: "memory",
    command: "add-todo",
    payload: { text: "交季度报告", writebackMode: "auto" },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(first.parsed.data.addedCount, 0);
  assert.ok(first.parsed.data.skipped.some((s) => s.reason === "duplicate"));

  const empty = await executeTool({
    registry,
    kind: "memory",
    command: "add-todo",
    payload: { writebackMode: "auto" },
    pathContext: workspace.pathContext,
    reviewed: false,
  });
  assert.equal(empty.ok, false);
  assert.match(String(empty.stderr || empty.error || ""), /content|required|必填|缺少/iu);
});
