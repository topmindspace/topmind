/**
 * Stream / sidebar AI maintain todos entry → real todo store + open popover.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("StreamDetailView PageHeader does not host AI todos; 清单 pane does", () => {
  const src = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.doesNotMatch(src, /handleMaintainTodos/u);
  assert.doesNotMatch(src, /id:\s*["']ai-todos["']/u);
  assert.doesNotMatch(src, /id:\s*["']capture["']/u);
  const body = read("src/components/todo/TodoListBody.tsx");
  assert.match(body, /data-todo-maintain/u);
  assert.match(body, /all-periods-processed/u);
  assert.match(body, /\.maintain\(/u);
});

test("sidebar StreamView AI maintain opens popover then maintain()", () => {
  const src = read("src/components/sidebar/StreamView.tsx");
  assert.match(src, /todo:open-popover/u);
  assert.match(src, /useTodoStore\.getState\(\)/u);
  assert.match(src, /\.maintain\(/u);
  assert.match(src, /all-periods-processed/u);
  assert.match(src, /sidebar\.stream\.maintainTodos/u);
});

test("TitleBar opens the AI workspace 清单 pane (not a second list)", () => {
  // 2026-09 v2: todo/suggest/apps live in AiWorkspace tabs, not TitleBar
  const src = read("src/components/ai/AiWorkspace.tsx");
  assert.match(src, /id: "todo"/u);
  assert.doesNotMatch(read("src/components/shell/TitleBar.tsx"), /data-ai-workspace-open="todo"/u);
  assert.doesNotMatch(read("src/components/shell/TitleBar.tsx"), /setTodoOpen\(true\)/u);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /todo:open-popover/u);
});

test("todo store maintain passes force option to api.todo.maintain", () => {
  const src = read("src/stores/todo-store.ts");
  assert.match(src, /maintain:\s*async\s*\(opts\?:\s*\{\s*force\?:\s*boolean\s*\}\)/u);
  assert.match(src, /api\.todo\.maintain\(opts\)/u);
});

test("TodoListBody exposes force retry for all-periods-processed", () => {
  const src = read("src/components/todo/TodoListBody.tsx");
  assert.match(src, /all-periods-processed/u);
  assert.match(src, /maintain\(\{\s*force:\s*true\s*\}\)/u);
});
