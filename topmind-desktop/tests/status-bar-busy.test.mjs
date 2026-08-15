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

test("tasks + todo: single-path — task chip wins; AI pill busy for tasks", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 2,
    todoMaintaining: true,
    suggestLoading: false,
  });
  assert.equal(v.showTaskChip, true);
  assert.equal(v.showTodoChip, false, "todo chip demoted when tasks present");
  assert.equal(v.aiPillBusy, true);
  assert.equal(v.aiLabelMode, "working");
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
  assert.match(src, /animate-spin/);
});

test("StatusBar icon semantics + click targets (DESIGN ListTodo = personal list)", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  // Todo busy chip opens personal list popover
  assert.match(src, /data-status-todo-busy[\s\S]*?todo:open-popover|todo:open-popover[\s\S]*?data-status-todo-busy/);
  assert.match(src, /todo:open-popover/);
  // Background tasks must NOT use ListTodo (reserved for personal list)
  // Task chip uses Loader2; todo chip uses ListTodo
  assert.match(src, /showTaskChip[\s\S]*?Loader2/);
  assert.match(src, /showTodoChip[\s\S]*?ListTodo|data-status-todo-busy[\s\S]*?ListTodo/);
  // ListChecks was the old ambiguous todo busy icon
  assert.doesNotMatch(src, /ListChecks/);
});
