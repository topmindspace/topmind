/**
 * Tests for todo source path contract resolution + accessibility touch gates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("TodoListBody does not hardcode Chinese stream directory 10-动态/", () => {
  const body = readFileSync(path.join(root, "src/components/todo/TodoListBody.tsx"), "utf8");
  // Hardcoded template string is eliminated
  assert.doesNotMatch(body, /10-动态\/\$\{item\.sourcePeriod\}/);
  // Uses resolveTodoSourcePath
  assert.match(body, /resolveTodoSourcePath/);
  // Does not use defaultValue in t(todo.openSource)
  assert.doesNotMatch(body, /t\("todo\.openSource",\s*\{/);
});

test("TodoListBody exports resolveTodoSourcePath and handles paths cleanly", async () => {
  const body = readFileSync(path.join(root, "src/components/todo/TodoListBody.tsx"), "utf8");
  assert.match(body, /export async function resolveTodoSourcePath/);
  // Prioritizes explicit sourcePath
  assert.match(body, /if \(item\.sourcePath\) return item\.sourcePath/);
  // Uses contract API
  assert.match(body, /api\.ws\.listStreamPeriods/);
  assert.match(body, /api\.ws\.getStreamContext/);
});

test("Accessibility: todo, tree, and stream actions are touch-friendly", () => {
  const todoBody = readFileSync(path.join(root, "src/components/todo/TodoListBody.tsx"), "utf8");
  const treeView = readFileSync(path.join(root, "src/components/sidebar/TreeView.tsx"), "utf8");
  const streamDetail = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  const recentBar = readFileSync(
    path.join(root, "src/components/shell/EditorRecentBar.tsx"),
    "utf8",
  );

  // Todo actions have 24px touch target and hover:none visibility
  assert.match(todoBody, /\[@media\(hover:none\)\]:opacity-100/);
  assert.match(todoBody, /h-6 w-6/);

  // TreeView actions have 24px touch target, hover:none visibility, and isActive support
  assert.match(treeView, /\[@media\(hover:none\)\]:inline-flex/);
  assert.match(treeView, /isActive \? "inline-flex opacity-100 pointer-events-auto"/);

  // Stream actions have hover:none visibility
  assert.match(streamDetail, /\[@media\(hover:none\)\]:opacity-100/);

  // RecentBar has roving tabindex + arrow key navigation
  assert.match(recentBar, /handleTablistKeyDown/);
  assert.match(recentBar, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(recentBar, /onKeyDown=\{handleTablistKeyDown\}/);
});

test("Popover focus trap and focus recovery primitives", () => {
  const suggestPopover = readFileSync(
    path.join(root, "src/components/ai/SuggestPopover.tsx"),
    "utf8",
  );
  const todoPopover = readFileSync(
    path.join(root, "src/components/todo/TodoPopover.tsx"),
    "utf8",
  );

  // SuggestPopover has previousFocusRef, focus restore on close, and tab trap
  assert.match(suggestPopover, /previousFocusRef/);
  assert.match(suggestPopover, /getFocusable/);
  assert.match(suggestPopover, /prev\.focus\(\)/);
  assert.match(suggestPopover, /e\.key === "Tab"/);

  // TodoPopover has previousFocusRef, focus restore on close, and tab trap
  assert.match(todoPopover, /previousFocusRef/);
  assert.match(todoPopover, /getFocusable/);
  assert.match(todoPopover, /prev\.focus\(\)/);
  assert.match(todoPopover, /e\.key === "Tab"/);
});
