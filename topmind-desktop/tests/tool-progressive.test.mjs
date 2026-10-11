/**
 * Progressive tool exposure — turn-kind gated tool surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterToolsForTurn,
  advertisedToolNames,
  resolveTurnKind,
} from "../electron/lib/tool-progressive.mjs";
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "../electron/lib/ai-tool-names.mjs";

const all = {};
for (const n of [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE]) all[n] = { execute: () => ({}) };

test("light turns expose no domain tools", () => {
  assert.equal(resolveTurnKind("hi"), "light");
  const f = filterToolsForTurn(all, "light");
  assert.equal(Object.keys(f).length, 0);
  assert.deepEqual(advertisedToolNames("light"), []);
});

test("query turns expose read tools only — never writes", () => {
  assert.equal(resolveTurnKind("我最近的任务"), "query");
  const f = filterToolsForTurn(all, "query");
  const names = Object.keys(f);
  assert.ok(names.includes("list_todos"));
  assert.ok(names.includes("list_recent_memories"));
  assert.ok(names.includes("web_search"));
  for (const w of AI_TOOL_NAMES_WRITE) {
    assert.ok(!names.includes(w), `query must not expose write tool ${w}`);
  }
  assert.deepEqual(advertisedToolNames("query").sort(), [...AI_TOOL_NAMES_READ].sort());
});

test("task turns expose the full surface", () => {
  assert.equal(resolveTurnKind("把这篇润色并保存"), "task");
  const f = filterToolsForTurn(all, "task");
  assert.equal(Object.keys(f).length, AI_TOOL_NAMES_READ.length + AI_TOOL_NAMES_WRITE.length);
  assert.ok(f.save_file);
  assert.ok(f.list_todos);
});
