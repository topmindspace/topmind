/**
 * Stream ↔ 个人清单 affordance without merging into ActionBar 建议.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Stream header: AI maintain entry; 个人清单 only in TitleBar (降噪 2026-08)", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  // Personal list open path is the TitleBar icon (⌘⇧T) — NOT duplicated in the stream header
  assert.doesNotMatch(view, /personal-todos|handleOpenPersonalTodos|personalTodos/);
  // AI maintain remains separate and opens the todo popover
  assert.match(view, /ai-todos|handleMaintainTodos|aiMaintainTodos/);
  assert.match(view, /todo:open-popover/);
  // No second ActionBar on canvas
  assert.doesNotMatch(view, /<ActionBar[\s/>]/);
  // Single personal-list entry point: TitleBar ListTodo
  const title = readFileSync(path.join(root, "src/components/shell/TitleBar.tsx"), "utf8");
  assert.match(title, /ListTodo/);
  assert.match(title, /todo:toggle-popover/);
});

test("ActionBar product layer is 建议 not 个人清单", () => {
  const bar = readFileSync(path.join(root, "src/components/ai/ActionBar.tsx"), "utf8");
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(bar, /建议/);
  assert.doesNotMatch(bar, /用户概念：「待办」/);
  assert.match(store, /TodoPopover|个人清单|TodoStore/);
  assert.doesNotMatch(store, /管理「待办」概念/);
});

test("zh/en locales expose AI-maintain keys; personalTodos keys removed with header dedupe", () => {
  const zh = JSON.parse(
    readFileSync(path.join(root, "src/locales/zh-CN/workspace.json"), "utf8"),
  );
  const en = JSON.parse(
    readFileSync(path.join(root, "src/locales/en-US/workspace.json"), "utf8"),
  );
  assert.ok(zh.streamDetail.aiMaintainTodos);
  assert.ok(zh.streamDetail.aiMaintainTodosTip);
  assert.ok(zh.streamDetail.suggestionsAiOffline);
  assert.ok(en.streamDetail.aiMaintainTodos);
  assert.ok(en.streamDetail.suggestionsAiOffline);
  // 降噪 2026-08: keys for the removed duplicate header action are gone
  assert.equal(zh.streamDetail.personalTodos, undefined);
  assert.equal(en.streamDetail.personalTodos, undefined);
});
