/**
 * Stream ↔ 个人清单 affordance without merging into ActionBar 建议.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Stream has personal list open path distinct from AI maintain and ActionBar", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  assert.match(view, /personal-todos|handleOpenPersonalTodos|personalTodos/);
  assert.match(view, /ListTodo/);
  assert.match(view, /todo:open-popover/);
  // AI maintain remains separate
  assert.match(view, /ai-todos|handleMaintainTodos|aiMaintainTodos/);
  // No second ActionBar on canvas
  assert.doesNotMatch(view, /<ActionBar[\s/>]/);
});

test("ActionBar product layer is 建议 not 个人清单", () => {
  const bar = readFileSync(path.join(root, "src/components/ai/ActionBar.tsx"), "utf8");
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(bar, /建议/);
  assert.doesNotMatch(bar, /用户概念：「待办」/);
  assert.match(store, /TodoPopover|个人清单|TodoStore/);
  assert.doesNotMatch(store, /管理「待办」概念/);
});

test("zh/en locales expose personalTodos keys", () => {
  const zh = JSON.parse(
    readFileSync(path.join(root, "src/locales/zh-CN/workspace.json"), "utf8"),
  );
  const en = JSON.parse(
    readFileSync(path.join(root, "src/locales/en-US/workspace.json"), "utf8"),
  );
  assert.ok(zh.streamDetail.personalTodos);
  assert.ok(zh.streamDetail.personalTodosTip);
  assert.ok(zh.streamDetail.suggestionsAiOffline);
  assert.ok(en.streamDetail.personalTodos);
  assert.ok(en.streamDetail.suggestionsAiOffline);
});
