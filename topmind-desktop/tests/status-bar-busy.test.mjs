/**
 * StatusBar busy derivation — no dual「AI 工作中」+「AI 整理待办中」for todo-only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveStatusBarBusy } from "../src/lib/status-bar-busy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("suggest applying: dedicated apply chip, count chip hidden", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: false,
    suggestCount: 4,
    suggestApplying: true,
  });
  assert.equal(v.showApplyChip, true);
  assert.equal(v.showSuggestCountChip, false);
  assert.equal(v.showSuggestChip, false);
  assert.equal(v.aiPillBusy, false);
  assert.ok(v.activeKinds.includes("apply"));
});

test("todo-only: dedicated todo chip, AI pill not generic working", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: true,
    suggestLoading: false,
  });
  assert.equal(v.showTodoChip, true);
  assert.equal(v.showInlineChip, false);
  assert.equal(v.aiPillBusy, false, "must not dual-label with AI 工作中");
  assert.equal(v.aiLabelMode, "ready");
  assert.equal(v.hasNamedBusyChip, true);
});

test("suggest-only: dedicated suggest chip, AI pill not working", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: true,
  });
  assert.equal(v.showSuggestChip, true);
  assert.equal(v.aiPillBusy, false);
  assert.equal(v.showTodoChip, false);
});

test("streaming + suggest: AI pill busy; suggest chip still visible (honest multi)", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: true,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: true,
  });
  assert.equal(v.aiPillBusy, true);
  assert.equal(v.aiLabelMode, "working");
  // Prep chip stays visible alongside agent — no invisible background work
  assert.equal(v.showSuggestChip, true);
  assert.equal(v.multiActive, true);
  assert.deepEqual(v.activeKinds, ["agent", "suggest"]);
});

test("tasks + todo: single-path — task chip wins; AI pill stays ready", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 2,
    todoMaintaining: true,
    suggestLoading: false,
  });
  assert.equal(v.showTaskChip, true);
  assert.equal(v.showTodoChip, false, "todo chip demoted when tasks present");
  assert.equal(v.aiPillBusy, false, "exclusive task must not also mark the AI pill working");
  assert.equal(v.aiLabelMode, "ready");
});

test("task-only: named task chip, suggestion count hidden, pill not working", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 1,
    todoMaintaining: false,
    suggestLoading: false,
    suggestCount: 3,
  });
  assert.equal(v.showTaskChip, true);
  assert.equal(v.showSuggestCountChip, false);
  assert.equal(v.aiPillBusy, false);
});

test("apply wins over a running task: one named chip, pill not working", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 2,
    todoMaintaining: false,
    suggestLoading: false,
    suggestApplying: true,
    suggestCount: 2,
  });
  assert.equal(v.showApplyChip, true);
  assert.equal(v.showTaskChip, false);
  assert.equal(v.showSuggestCountChip, false);
  assert.equal(v.aiPillBusy, false);
});

test("todo + suggest: single-path — todo chip wins over suggest", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: true,
    suggestLoading: true,
  });
  assert.equal(v.showTodoChip, true);
  assert.equal(v.showSuggestChip, false, "suggest chip demoted when todo maintains");
  assert.equal(v.aiPillBusy, false);
  assert.equal(v.multiActive, true);
  assert.ok(v.activeKinds.includes("todo") && v.activeKinds.includes("suggest"));
});

test("agent + todo + suggest: multiActive lists all; named chips capped", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: true,
    activeTaskCount: 0,
    todoMaintaining: true,
    suggestLoading: true,
    inlineBusy: true,
  });
  assert.equal(v.multiActive, true);
  assert.equal(v.concurrentCount, 4);
  assert.equal(v.aiPillBusy, true);
  assert.equal(v.showTodoChip, true, "todo is primary prep chip");
  assert.equal(v.showSuggestChip, false, "suggest demoted under todo");
  assert.equal(v.showInlineChip, false, "inline demoted under stream/prep");
});

test("idle ready: no chips, not busy", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: false,
  });
  assert.equal(v.aiPillBusy, false);
  assert.equal(v.hasNamedBusyChip, false);
  assert.equal(v.showSuggestCountChip, false);
  assert.equal(v.aiLabelMode, "ready");
});

test("offline: no busy chrome", () => {
  const v = deriveStatusBarBusy({
    ready: false,
    streaming: true,
    activeTaskCount: 1,
    todoMaintaining: true,
    suggestLoading: true,
    inlineBusy: true,
  });
  assert.equal(v.aiLabelMode, "offline");
  assert.equal(v.aiPillBusy, false);
  assert.equal(v.showTodoChip, false);
  assert.equal(v.showInlineChip, false);
});

test("StatusBar wires deriveStatusBarBusy (no dual aiBusy OR todo)", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  assert.match(src, /deriveStatusBarBusy/);
  assert.match(src, /busy\.showTodoChip/);
  assert.match(src, /busy\.aiPillBusy/);
  // Must not force AI working whenever todoMaintaining alone
  assert.doesNotMatch(
    src,
    /aiBusy\s*=\s*streaming\s*\|\|\s*activeTasks\.length\s*>\s*0\s*\|\|\s*todoMaintaining/,
  );
  assert.match(src, /data-status-todo-busy/);
  assert.match(src, /data-status-ai-pill/);
  assert.match(src, /data-status-inline-busy/);
  assert.match(src, /data-status-suggest-apply/);
  assert.match(src, /suggestApplying/);
  assert.match(src, /animate-spin/);
});

test("StatusBar icon semantics + click targets (DESIGN ListTodo = personal list)", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  // Todo busy chip opens personal list popover
  assert.match(src, /data-status-todo-busy[\s\S]*?todo:open-popover|todo:open-popover[\s\S]*?data-status-todo-busy/);
  assert.match(src, /todo:open-popover/);
  // Background tasks must NOT use ListTodo (reserved for personal list)
  // Task toggle: Loader2 while running, Activity when idle (persistent toggle, 2026-08-22)
  assert.match(src, /data-status-task-toggle[\s\S]*?Loader2/);
  assert.match(src, /data-status-task-toggle[\s\S]*?Activity/);
  assert.match(src, /showTodoChip[\s\S]*?ListTodo|data-status-todo-busy[\s\S]*?ListTodo/);
  // ListChecks was the old ambiguous todo busy icon
  assert.doesNotMatch(src, /ListChecks/);
  // Persistent toggle entry: pressed state reflects panel open, toggles (not open-only)
  assert.match(src, /data-status-task-toggle/);
  assert.match(src, /aria-pressed=\{taskPanelOpen\}/);
  assert.match(src, /onToggleTaskPanel/);
  assert.match(src, /toggleSuggestSurface|openSuggestSurface/);
  // Running chrome follows the single named-chip priority, not raw task count.
  assert.match(src, /busy\.showTaskChip \?/);
  assert.match(src, /data-status-workspace-path/);
  const pathIdx = src.indexOf("data-status-workspace-path");
  const pathSlice = src.slice(Math.max(0, pathIdx - 220), pathIdx + 160);
  assert.match(pathSlice, /truncate/);
  assert.match(pathSlice, /health\.workspaceRoot/);
  assert.doesNotMatch(pathSlice, /hidden sm:inline/);
  assert.doesNotMatch(src, /case ["']home["']|case ["']stream["']|case ["']inbox["']/);
  assert.match(src, /selection\.kind !== ["']file["']/);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /focusMode \? null : \(\s*<StatusBar/);
});

test("agent + task: multiActive, task chip, not todo chip", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: true,
    activeTaskCount: 1,
    todoMaintaining: false,
    suggestLoading: false,
  });
  assert.equal(v.showTaskChip, true);
  assert.equal(v.showTodoChip, false);
  assert.equal(v.aiPillBusy, true);
  assert.equal(v.multiActive, true);
  assert.deepEqual(v.activeKinds, ["agent", "task"]);
});

test("task chrome sources do not use ListTodo", () => {
  const panel = read("src/components/ai/TaskPanel.tsx");
  const body = read("src/components/ai/task-list-body.tsx");
  assert.doesNotMatch(panel, /ListTodo/);
  assert.doesNotMatch(body, /ListTodo/);
});
