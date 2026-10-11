/**
 * Host-side query evidence — forced grounding for task/memory/stream lookups.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueryEvidence, wantsQueryEvidence } from "../electron/lib/query-evidence.mjs";

const fakeTools = {
  list_todos: {
    execute: async () => ({ ok: true, items: [{ text: "买牛奶", done: false }], openCount: 1 }),
  },
  list_recent_memories: {
    execute: async () => ({ ok: true, entries: [{ kind: "profile", text: "喜欢简洁界面" }] }),
  },
};

test("wantsQueryEvidence is true for task/memory lookups and false for greetings", () => {
  assert.equal(wantsQueryEvidence("我最近的任务"), true);
  assert.equal(wantsQueryEvidence("最近记忆"), true);
  assert.equal(wantsQueryEvidence("hi"), false);
  assert.equal(wantsQueryEvidence("你好"), false);
});

test("buildQueryEvidence injects real tool output and forbids invention", async () => {
  const block = await buildQueryEvidence({
    userText: "看看我的待办和最近任务",
    tools: fakeTools,
    locale: "zh-CN",
  });
  assert.ok(block, "must build evidence");
  assert.match(block, /list_todos/u);
  assert.match(block, /买牛奶/u);
  assert.match(block, /禁止用训练知识编造/u);
  assert.match(block, /工作区查询证据/u);
});

test("buildQueryEvidence is null for greetings and missing tools", async () => {
  assert.equal(await buildQueryEvidence({ userText: "hi", tools: fakeTools }), null);
  assert.equal(await buildQueryEvidence({ userText: "我的待办", tools: null }), null);
});

test("buildQueryEvidence includes memories when asked", async () => {
  const block = await buildQueryEvidence({
    userText: "我的记忆里有什么",
    tools: fakeTools,
    locale: "zh-CN",
  });
  assert.ok(block);
  assert.match(block, /list_recent_memories/u);
  assert.match(block, /喜欢简洁界面/u);
});
