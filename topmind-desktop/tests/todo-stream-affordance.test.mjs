/**
 * Stream ↔ 个人清单 affordance without merging into ActionBar 建议.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Stream header: no 清单 / AI 待办 duplicate; maintain lives in 清单 pane", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  assert.doesNotMatch(view, /personal-todos|handleOpenPersonalTodos|personalTodos/);
  assert.doesNotMatch(view, /handleMaintainTodos|id:\s*["']ai-todos["']/);
  assert.doesNotMatch(view, /<ActionBar[\s/>]/);
  const title = readFileSync(path.join(root, "src/components/shell/TitleBar.tsx"), "utf8");
  // 2026-09 v2: todo lives in AiWorkspace tabs, not TitleBar
  assert.doesNotMatch(title, /data-ai-workspace-open="todo"/);
  const ai = readFileSync(path.join(root, "src/components/ai/AiWorkspace.tsx"), "utf8");
  assert.match(ai, /id: "todo"/);
  const body = readFileSync(path.join(root, "src/components/todo/TodoListBody.tsx"), "utf8");
  assert.match(body, /data-todo-pane-chrome/);
  assert.match(body, /data-todo-maintain/);
});

test("ActionStore product layer is 建议 not 个人清单", () => {
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(store, /TodoPopover|个人清单|TodoStore/);
  assert.doesNotMatch(store, /管理「待办」概念/);
});

test("zh/en locales keep stream offline copy; personalTodos keys stay gone", () => {
  const zh = JSON.parse(
    readFileSync(path.join(root, "src/locales/zh-CN/workspace.json"), "utf8"),
  );
  const en = JSON.parse(
    readFileSync(path.join(root, "src/locales/en-US/workspace.json"), "utf8"),
  );
  assert.ok(zh.streamDetail.suggestionsAiOffline);
  assert.ok(en.streamDetail.suggestionsAiOffline);
  assert.equal(zh.streamDetail.personalTodos, undefined);
  assert.equal(en.streamDetail.personalTodos, undefined);
});
