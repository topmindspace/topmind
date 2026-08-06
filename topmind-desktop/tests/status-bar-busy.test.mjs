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

test("streaming: AI pill busy; suggest chip suppressed while streaming", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: true,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: true,
  });
  assert.equal(v.aiPillBusy, true);
  assert.equal(v.aiLabelMode, "working");
  assert.equal(v.showSuggestChip, false);
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
});
