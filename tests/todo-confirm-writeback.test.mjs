/**
 * AI todo writes honor workspace writeback.mode=confirm.
 * Drives shipped addTodoItem / writeTodoList (not a reimplementation).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureTodoFile,
  addTodoItem,
  readTodoList,
  resolveTodoRelPath,
  snapshotTodoList,
  archiveStaleTodos,
} from "../lib/todo-engine.mjs";

let tmp;
let ws;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-todo-confirm-"));
  ws = path.join(tmp, "ws");
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: confirm\n",
    "utf8",
  );
});

after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("AI todo writes respect yaml confirm", () => {
  it("user ensure seeds todo.md; AI add without confirmed stays pending", () => {
    ensureTodoFile(ws);
    const rel = resolveTodoRelPath(ws);
    const abs = path.join(ws, rel);
    assert.equal(fs.existsSync(abs), true);
    const before = readTodoList(ws);
    const beforeCount = before?.items?.length || 0;

    const r = addTodoItem(ws, "AI should not silent-write this", { actor: "ai", confirmed: false });
    assert.equal(r.ok, false, `expected pending, got ${JSON.stringify(r)}`);
    assert.equal(r.pending, true);
    assert.equal(r.writebackEvidence?.pending || r.writebackEvidence?.needsConfirm, true);
    assert.equal(r.writebackEvidence?.wroteFiles, false);
    assert.equal(r.item, null);

    const after = readTodoList(ws);
    assert.equal(after?.items?.length || 0, beforeCount, "confirm mode must not land the AI todo");
    const body = fs.readFileSync(abs, "utf8");
    assert.doesNotMatch(body, /AI should not silent-write this/);
  });

  it("user actor still writes immediately under yaml confirm", () => {
    const r = addTodoItem(ws, "I typed this todo", { actor: "user" });
    assert.equal(r.ok, true);
    assert.equal(r.pending, false);
    const abs = path.join(ws, resolveTodoRelPath(ws));
    assert.match(fs.readFileSync(abs, "utf8"), /I typed this todo/);
  });

  it("AI snapshotTodoList does not silent-write todo-history under yaml confirm", () => {
    const items = readTodoList(ws)?.items || [];
    snapshotTodoList(ws, items, "2026-W40");
    const snap = path.join(ws, "memory", "periodic", "todo-history", "2026-W40.md");
    assert.equal(fs.existsSync(snap), false, "confirm mode must not land AI todo snapshot");
  });

  it("AI archiveStaleTodos does not silent-write todo-history under yaml confirm", () => {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const todoAbs = path.join(ws, resolveTodoRelPath(ws));
    const prev = fs.readFileSync(todoAbs, "utf8");
    fs.writeFileSync(
      todoAbs,
      `${prev}\n\n<!-- created: ${oldDate} -->\n- [ ] stale confirm-archive item\n`,
      "utf8",
    );
    const r = archiveStaleTodos(ws);
    assert.equal(r.ok, false);
    assert.equal(r.pending, true);
    assert.equal(r.writebackEvidence?.wroteFiles, false);
    const histDir = path.join(ws, "memory", "periodic", "todo-history");
    const files = fs.existsSync(histDir) ? fs.readdirSync(histDir) : [];
    assert.equal(files.some((f) => f.endsWith("-archived.md")), false);
    assert.match(fs.readFileSync(todoAbs, "utf8"), /stale confirm-archive item/);
  });
});
