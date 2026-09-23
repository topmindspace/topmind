/**
 * Durable todo.md headings follow workspace contract locale (zh vs en).
 * Drives public ensureTodoFile / writeTodoList / readTodoList — no private exports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureTodoFile,
  writeTodoList,
  readTodoList,
  resolveTodoPath,
} from "../lib/todo-engine.mjs";

function seedWs(locale) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "todo-locale-"));
  for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档", "memory"]) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
  }
  const localeLine =
    locale != null
      ? `  locale: ${locale}\n`
      : "";
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    `contract_version: 4\nworkspace:\n  template: stream\n${localeLine}stream:\n  packing: weekly\n`,
    "utf8",
  );
  return ws;
}

function rmWs(ws) {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("todo seed/serialize locale headings", () => {
  it("ensureTodoFile seeds Chinese headings by default (zh-CN / missing)", () => {
    const ws = seedWs(null);
    try {
      ensureTodoFile(ws);
      const raw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(raw, /title:\s*我的待办/);
      assert.match(raw, /^# 我的待办/m);
      assert.doesNotMatch(raw, /My Todos/);
    } finally {
      rmWs(ws);
    }
  });

  it("ensureTodoFile seeds English headings when contract locale is en-US", () => {
    const ws = seedWs("en-US");
    try {
      const contract = {
        contract_version: 4,
        workspace: { template: "stream", locale: "en-US" },
      };
      ensureTodoFile(ws, contract);
      const raw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(raw, /title:\s*My Todos/);
      assert.match(raw, /^# My Todos/m);
      assert.doesNotMatch(raw, /我的待办/);
    } finally {
      rmWs(ws);
    }
  });

  it("writeTodoList serializes Completed / empty comment in English", () => {
    const ws = seedWs("en-US");
    try {
      const contract = {
        contract_version: 4,
        workspace: { template: "stream", locale: "en" },
      };
      ensureTodoFile(ws, contract);
      writeTodoList(
        ws,
        [
          { id: "a1", text: "Ship locale prompts", done: false, source: "manual" },
          { id: "b2", text: "Done already", done: true, source: "manual", completedAt: "2026-08-01" },
        ],
        contract,
      );
      const raw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(raw, /# My Todos/);
      assert.match(raw, /## Completed/);
      assert.match(raw, /Ship locale prompts/);
      assert.match(raw, /- \[x\] Done already/);
      assert.doesNotMatch(raw, /## 已完成/);
      assert.doesNotMatch(raw, /# 我的待办/);

      const empty = writeTodoList(ws, [], contract);
      assert.equal(empty.ok, true);
      const emptyRaw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(emptyRaw, /empty list: add your first todo/i);
      assert.doesNotMatch(emptyRaw, /空列表：添加你的第一个待办/);
    } finally {
      rmWs(ws);
    }
  });

  it("writeTodoList keeps Chinese headings under zh contract", () => {
    const ws = seedWs("zh-CN");
    try {
      const contract = {
        contract_version: 4,
        workspace: { template: "stream", locale: "zh-CN" },
      };
      ensureTodoFile(ws, contract);
      writeTodoList(
        ws,
        [
          { id: "c3", text: "写周报", done: false, source: "manual" },
          { id: "d4", text: "已完成项", done: true, source: "manual", completedAt: "2026-08-01" },
        ],
        contract,
      );
      const raw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(raw, /# 我的待办/);
      assert.match(raw, /## 已完成/);
      assert.doesNotMatch(raw, /# My Todos/);
      assert.doesNotMatch(raw, /## Completed/);

      const list = readTodoList(ws);
      assert.ok(list);
      assert.equal(list.items.length, 2);
    } finally {
      rmWs(ws);
    }
  });

  it("rewriting existing Chinese file under en locale switches headings", () => {
    const ws = seedWs("zh-CN");
    try {
      // Seed as zh
      ensureTodoFile(ws, {
        contract_version: 4,
        workspace: { locale: "zh-CN" },
      });
      let raw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(raw, /我的待办/);

      // Next serialize with en contract → English headings (locale follows contract)
      writeTodoList(
        ws,
        [{ id: "e5", text: "Follow contract locale", done: false, source: "manual" }],
        { workspace: { locale: "en-US" } },
        { prevContent: raw },
      );
      raw = fs.readFileSync(resolveTodoPath(ws), "utf8");
      assert.match(raw, /# My Todos/);
      assert.match(raw, /title:\s*My Todos/);
      assert.match(raw, /Follow contract locale/);
    } finally {
      rmWs(ws);
    }
  });
});
