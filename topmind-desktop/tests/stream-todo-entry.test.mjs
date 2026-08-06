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

test("StreamDetailView AI todos header calls maintain and opens popover", () => {
  const src = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(src, /handleMaintainTodos/u);
  assert.match(src, /todo:open-popover/u);
  assert.match(src, /useTodoStore\.getState\(\)\.maintain\(\)/u);
  assert.match(src, /id:\s*["']ai-todos["']/u);
  // UX: no duplicate L1 capture in stream header
  assert.doesNotMatch(src, /id:\s*["']capture["']/u);
});

test("sidebar StreamView AI maintain opens popover then maintain()", () => {
  const src = read("src/components/sidebar/StreamView.tsx");
  assert.match(src, /todo:open-popover/u);
  assert.match(src, /useTodoStore\.getState\(\)\.maintain\(\)/u);
  assert.match(src, /sidebar\.stream\.maintainTodos/u);
});

test("TitleBar listens for todo:open-popover", () => {
  const src = read("src/components/shell/TitleBar.tsx");
  assert.match(src, /todo:open-popover/u);
  assert.match(src, /setTodoOpen\(true\)/u);
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
