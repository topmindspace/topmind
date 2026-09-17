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

describe("AI todo writes respect graded yaml confirm", () => {
  it("user ensure seeds todo.md; AI add lands immediately (graded confirm)", () => {
    ensureTodoFile(ws);
    const rel = resolveTodoRelPath(ws);
    const abs = path.join(ws, rel);
    assert.equal(fs.existsSync(abs), true);

    const r = addTodoItem(ws, "Graded confirm lands this todo", { actor: "ai", confirmed: false });
    assert.equal(r.ok, true, `graded confirm: todo content lands, got ${JSON.stringify(r)}`);
    assert.equal(r.pending, false);
    const body = fs.readFileSync(abs, "utf8");
    assert.match(body, /Graded confirm lands this todo/);
  });

  it("user actor still writes immediately under yaml confirm", () => {
    const r = addTodoItem(ws, "I typed this todo", { actor: "user" });
    assert.equal(r.ok, true);
    assert.equal(r.pending, false);
    const abs = path.join(ws, resolveTodoRelPath(ws));
    assert.match(fs.readFileSync(abs, "utf8"), /I typed this todo/);
  });

  it("AI snapshotTodoList lands under graded confirm", () => {
    const items = readTodoList(ws)?.items || [];
    snapshotTodoList(ws, items, "2026-W40");
    const snap = path.join(ws, "memory", "periodic", "todo-history", "2026-W40.md");
    assert.equal(fs.existsSync(snap), true, "graded confirm: snapshot lands");
  });

  it("AI archiveStaleTodos lands under graded confirm", () => {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const todoAbs = path.join(ws, resolveTodoRelPath(ws));
    const prev = fs.readFileSync(todoAbs, "utf8");
    fs.writeFileSync(
      todoAbs,
      `${prev}\n\n<!-- created: ${oldDate} -->\n- [ ] stale confirm-archive item\n`,
      "utf8",
    );
    const r = archiveStaleTodos(ws);
    assert.equal(r.ok, true, JSON.stringify(r));
    const histDir = path.join(ws, "memory", "periodic", "todo-history");
    const files = fs.existsSync(histDir) ? fs.readdirSync(histDir) : [];
    assert.equal(files.some((f) => f.endsWith("-archived.md")), true);
  });
});
