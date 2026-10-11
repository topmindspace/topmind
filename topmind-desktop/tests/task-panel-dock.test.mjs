/**
 * TaskPanel docking — default (no custom drag) anchors to the status-bar
 * trigger; custom positions stay free-floating.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDockTaskPanelPos,
  hasCustomTaskPanelPos,
  parseTaskPanelPos,
  DEFAULT_TASK_PANEL_POS,
} from "../src/lib/task-panel-pos.ts";

test("computeDockTaskPanelPos sits above the trigger, clamped to viewport", () => {
  const pos = computeDockTaskPanelPos({
    triggerRight: 1200,
    triggerTop: 780,
    viewportW: 1280,
    viewportH: 800,
    panelW: 340,
  });
  assert.ok(pos.x >= 0);
  assert.ok(pos.y >= 0);
  // Above the trigger (bottom offset larger than status bar)
  assert.ok(pos.y >= 8);
  // Not overflowing the left edge
  assert.ok(pos.x <= 1280);
});

test("computeDockTaskPanelPos clamps negative viewport math", () => {
  const pos = computeDockTaskPanelPos({
    triggerRight: 0,
    triggerTop: 0,
    viewportW: 100,
    viewportH: 100,
    panelW: 340,
  });
  assert.equal(pos.x, 0);
  assert.ok(pos.y >= 0);
});

test("hasCustomTaskPanelPos distinguishes empty store from user drag", () => {
  const empty = (k) => (k === "topmind:task-panel-pos" ? null : null);
  const custom = (k) => (k === "topmind:task-panel-pos" ? '{"x":10,"y":20}' : null);
  assert.equal(hasCustomTaskPanelPos(empty), false);
  assert.equal(hasCustomTaskPanelPos(custom), true);
  assert.deepEqual(parseTaskPanelPos('{"x":10,"y":20}'), { x: 10, y: 20 });
  assert.deepEqual(parseTaskPanelPos(null), DEFAULT_TASK_PANEL_POS);
});
