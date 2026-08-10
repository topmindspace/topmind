/**
 * Task store pure helpers + clearCompleted keeps queued.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keepActiveTasks,
  computeTaskPanelDragPosition,
} from "../src/stores/task-store.ts";
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
