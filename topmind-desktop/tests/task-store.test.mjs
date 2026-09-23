/**
 * Task store pure helpers + clearCompleted keeps queued.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  keepActiveTasks,
  computeTaskPanelDragPosition,
} from "../src/stores/task-store.ts";
import {
  engineJobSuggestionFollowUp,
  shouldDismissTaskPanel,
} from "../src/lib/engine-job-follow-up.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
import {
  parseTaskPanelPos,
  serializeTaskPanelPos,
  saveTaskPanelPos,
  loadTaskPanelPos,
  clampTaskPanelPos,
  TASK_PANEL_POS_KEY,
  DEFAULT_TASK_PANEL_POS,
} from "../src/lib/task-panel-pos.ts";

test("keepActiveTasks keeps running and queued, drops terminal", () => {
  const tasks = [
    { id: "1", status: "running" },
    { id: "2", status: "queued" },
    { id: "3", status: "completed" },
    { id: "4", status: "failed" },
    { id: "5", status: "cancelled" },
  ];
  const kept = keepActiveTasks(tasks);
  assert.deepEqual(
    kept.map((t) => t.id),
    ["1", "2"],
  );
});

test("keepActiveTasks empty stays empty", () => {
  assert.deepEqual(keepActiveTasks([]), []);
});

test("computeTaskPanelDragPosition uses final mouse delta", () => {
  const start = { mouseX: 100, mouseY: 200, posX: 24, posY: 40 };
  // drag right+down → right/bottom increase when using same sign as panel
  const mid = computeTaskPanelDragPosition(start, 130, 250);
  assert.equal(mid.x, 54);
  assert.equal(mid.y, 90);
  const final = computeTaskPanelDragPosition(start, 180, 300);
  assert.equal(final.x, 104);
  assert.equal(final.y, 140);
  // never negative
  const clamped = computeTaskPanelDragPosition(start, 0, 0);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
});

test("task panel pos parse/serialize round-trip + clamp", () => {
  assert.deepEqual(parseTaskPanelPos(null), DEFAULT_TASK_PANEL_POS);
  assert.deepEqual(parseTaskPanelPos("not-json"), DEFAULT_TASK_PANEL_POS);
  assert.deepEqual(parseTaskPanelPos(JSON.stringify({ x: 80, y: 12 })), { x: 80, y: 12 });
  assert.deepEqual(clampTaskPanelPos({ x: -5, y: 10 }), { x: 0, y: 10 });
  const bag = new Map();
  saveTaskPanelPos({ x: 99, y: 33 }, (k, v) => bag.set(k, v));
  assert.equal(bag.get(TASK_PANEL_POS_KEY), serializeTaskPanelPos({ x: 99, y: 33 }));
  const loaded = loadTaskPanelPos((k) => bag.get(k) ?? null);
  assert.deepEqual(loaded, { x: 99, y: 33 });
  // drag-end must save the FINAL coords (simulate ref-based save)
  const start = { mouseX: 10, mouseY: 10, posX: 20, posY: 20 };
  const end = computeTaskPanelDragPosition(start, 50, 70);
  saveTaskPanelPos(end, (k, v) => bag.set(k, v));
  assert.deepEqual(loadTaskPanelPos((k) => bag.get(k) ?? null), end);
});

test("ai_digest after runActivityOps does not request suggestions:refresh", () => {
  const none = engineJobSuggestionFollowUp({ type: "ai_digest", merged: 0, suggestionCount: 0 });
  assert.equal(none.emitSuggestionsRefresh, false);
  assert.equal(none.openSuggestSurface, false);

  const merged = engineJobSuggestionFollowUp({ type: "ai_digest", merged: 2, suggestionCount: 2 });
  assert.equal(merged.emitSuggestionsRefresh, false);
  assert.equal(merged.openSuggestSurface, true);
  assert.equal(merged.emitWorkspaceFileChanged, false);

  const mem = engineJobSuggestionFollowUp({ type: "memory_organize", merged: 3, suggestionCount: 3 });
  assert.equal(mem.emitSuggestionsRefresh, false);
  assert.equal(mem.openSuggestSurface, true);
});

test("reconcile requests refresh only when changed or candidates exist", () => {
  const idle = engineJobSuggestionFollowUp({ type: "reconcile", changed: false, hasCandidates: false });
  assert.equal(idle.emitSuggestionsRefresh, false);
  assert.equal(idle.openSuggestSurface, false);
  assert.equal(idle.emitWorkspaceFileChanged, false);

  const changed = engineJobSuggestionFollowUp({ type: "reconcile", changed: true, hasCandidates: false });
  assert.equal(changed.emitSuggestionsRefresh, true);
  assert.equal(changed.openSuggestSurface, false);
  assert.equal(changed.emitWorkspaceFileChanged, true);

  const cands = engineJobSuggestionFollowUp({ type: "reconcile", changed: false, hasCandidates: true });
  assert.equal(cands.emitSuggestionsRefresh, true);
  assert.equal(cands.openSuggestSurface, true);
});

test("shouldDismissTaskPanel: Esc always; outside only when idle", () => {
  assert.equal(shouldDismissTaskPanel({ runningOrQueued: true, event: "escape" }), true);
  assert.equal(shouldDismissTaskPanel({ runningOrQueued: false, event: "escape" }), true);
  assert.equal(shouldDismissTaskPanel({ runningOrQueued: true, event: "outside-click" }), false);
  assert.equal(shouldDismissTaskPanel({ runningOrQueued: false, event: "outside-click" }), true);
  assert.equal(shouldDismissTaskPanel({ runningOrQueued: true, event: "outside-scroll" }), false);
  assert.equal(shouldDismissTaskPanel({ runningOrQueued: false, event: "outside-scroll" }), true);
});

test("task-store ai_digest uses follow-up helper; no post-merge suggestions:refresh", () => {
  const store = read("src/stores/task-store.ts");
  assert.match(store, /engineJobSuggestionFollowUp/);
  assert.match(store, /runActivityOps/);
  assert.doesNotMatch(store, /applySuggestion/);
  assert.doesNotMatch(store, /writePeriodDigest/);
  assert.doesNotMatch(store, /maintainTodos/);
  const digestBlock = store.slice(store.indexOf('case "ai_digest"'), store.indexOf('case "memory_organize"'));
  assert.match(digestBlock, /runActivityOps/);
  assert.match(digestBlock, /engineJobSuggestionFollowUp/);
  assert.doesNotMatch(digestBlock, /SUGGESTIONS_REFRESH_EVENT/);
  assert.doesNotMatch(digestBlock, /reason:\s*"ai_digest"/);
  assert.match(digestBlock, /suggest-surface:open/);
  const reconcileBlock = store.slice(store.indexOf('case "reconcile"'), store.indexOf('case "ai_digest"'));
  assert.match(reconcileBlock, /engineJobSuggestionFollowUp/);
  assert.match(reconcileBlock, /SUGGESTIONS_REFRESH_EVENT/);
  assert.match(store, /case "memory_organize"/);
  assert.match(store, /memoryOrganizeStart/);
});

test("task list empty actions are engine jobs; no ListTodo", () => {
  const body = read("src/components/ai/task-list-body.tsx");
  assert.match(body, /createTask\("reconcile"\)/);
  assert.match(body, /createTask\("ai_digest"\)/);
  assert.match(body, /createTask\("memory_organize"\)/);
  assert.doesNotMatch(body, /ListTodo/);
  const creates = body.match(/createTask\("([^"]+)"\)/g) || [];
  assert.deepEqual(creates, [
    'createTask("reconcile")',
    'createTask("ai_digest")',
    'createTask("memory_organize")',
  ]);
});

test("TaskPanel Esc-to-close uses shipped dismiss helper", () => {
  const src = read("src/components/ai/TaskPanel.tsx");
  assert.match(src, /shouldDismissTaskPanel/);
  assert.match(src, /e\.key !== "Escape"|e\.key === "Escape"/);
  assert.match(src, /keydown/);
  assert.match(src, /shouldCloseOnScroll/);
  assert.match(src, /data-task-panel/);
});
