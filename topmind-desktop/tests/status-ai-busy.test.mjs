/**
 * StatusBar must surface AI / background work so users know something is running.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("StatusBar shows task / todo / suggest / streaming busy affordances", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  assert.match(src, /useTaskStore/);
  assert.match(src, /useTodoStore/);
  assert.match(src, /useActionStore/);
  assert.match(src, /deriveStatusBarBusy/);
  assert.match(src, /statusBar\.aiWorking/);
  assert.match(src, /statusBar\.taskRunning/);
  assert.match(src, /statusBar\.todoMaintaining/);
  assert.match(src, /statusBar\.suggestLoading/);
  // Persistent task-panel toggle replaces the transient open-only chip
  assert.match(src, /onToggleTaskPanel/);
  assert.match(src, /aria-pressed=\{taskPanelOpen\}/);
  assert.match(src, /animate-spin|animate-pulse-soft/);
  // Dedicated todo chip uses busy.showTodoChip — not dual with aiPillBusy for todo-only
  assert.match(src, /busy\.showTodoChip/);
  assert.match(src, /busy\.aiPillBusy/);
});

test("StatusBar AI pill is panel toggle when ready (no second 会话 open button)", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  // Primary control toggles panel
  assert.match(src, /toggleAiPanel/);
  assert.match(src, /data-status-ai-pill/);
  assert.match(src, /data-status-ai-panel/);
  // Offline → settings
  assert.match(src, /openOverlay\("settings"/);
  // No redundant second status-bar open-only session control
  assert.doesNotMatch(src, /sessionOpenTip/);
  assert.doesNotMatch(src, /statusBar\.sessionGenerating/);
  // Ready path uses toggle, not force-open only
  assert.match(src, /toggleAiPanel\(\)/);
  // Only one data-status-ai-pill control
  assert.equal((src.match(/data-status-ai-pill/g) || []).length, 1);
});

test("essential busy motion keeps looping under Windows reduced-motion", () => {
  const tokens = read("src/styles/tokens.css");
  const reduce = tokens.slice(tokens.indexOf("prefers-reduced-motion"));
  assert.match(reduce, /animation-iteration-count:\s*1\s*!important/);
  // Carve-out: spin / progress / busy chips must still loop
  assert.match(reduce, /\.animate-spin/);
  assert.match(reduce, /animation-iteration-count:\s*infinite\s*!important/);
  assert.match(reduce, /\.v4-ai-progress-slide/);
  const v4 = read("src/styles/v4.css");
  assert.match(v4, /\.v4-ai-busy-icon\.animate-spin/);
  assert.match(v4, /animation:\s*spin /);
  const status = read("src/components/shell/StatusBar.tsx");
  // Loader2 on task/inline chips must keep animate-spin (not pulse-only)
  assert.match(status, /Loader2[\s\S]{0,80}animate-spin/);
  assert.doesNotMatch(status, /Loader2[^>]{0,80}v4-ai-busy-icon animate-spin/);
  const inline = read("src/components/editor/SelectionAiBar.tsx");
  assert.match(inline, /animate-spin/);
  assert.match(inline, /v4-ai-progress-slide/);
  const capture = read("src/components/overlays/CaptureForm.tsx");
  assert.match(capture, /data-capture-ai-busy/);
  assert.match(capture, /v4-ai-progress-slide/);
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-polish-busy/);
  assert.match(stream, /v4-ai-progress-slide/);
});

test("statusBar busy strings exist in zh-CN and en-US", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/shell.json"));
  const en = JSON.parse(read("src/locales/en-US/shell.json"));
  for (const key of [
    "aiWorking",
    "aiWorkingTip",
    "taskRunning",
    "todoMaintaining",
    "suggestLoading",
    "inlineAiWorking",
    "inlineAiWorkingTip",
    "inlineAiLeaveConfirm",
    "aiPanelShowTip",
    "aiPanelHideTip",
  ]) {
    assert.equal(typeof zh.statusBar[key], "string", `zh missing ${key}`);
    assert.equal(typeof en.statusBar[key], "string", `en missing ${key}`);
  }
});
