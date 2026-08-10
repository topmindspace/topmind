/**
 * Pure placement math for portaled dropdowns — locks anti-drift behaviour.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeDropdownPosition } from "../src/lib/dropdown-position";

const viewport = { width: 1000, height: 800 };

test("form field: panel width matches trigger (start flush)", () => {
  const pos = computeDropdownPosition({
    trigger: { top: 100, left: 200, right: 400, bottom: 134, width: 200, height: 34 },
    align: "start",
    matchTriggerWidth: true,
    minWidth: 0,
    maxHeight: 280,
    gap: 4,
    pad: 8,
    viewport,
  });
  assert.equal(pos.placement, "bottom");
  assert.equal(pos.top, 138); // 134 + 4
  assert.equal(pos.left, 200);
  assert.equal(pos.width, 200);
});

test("end align pins panel right edge to trigger right", () => {
  const pos = computeDropdownPosition({
    trigger: { top: 100, left: 200, right: 360, bottom: 132, width: 160, height: 32 },
    align: "end",
    matchTriggerWidth: false,
    minWidth: 280,
    viewport,
  });
  assert.equal(pos.left, 360 - pos.width);
  assert.ok(pos.width >= 280);
});

test("top flip uses measured panel height (flush, no float gap)", () => {
  const pos = computeDropdownPosition({
    trigger: { top: 700, left: 40, right: 240, bottom: 734, width: 200, height: 34 },
    panel: { width: 200, height: 180 },
    align: "start",
    matchTriggerWidth: true,
    minWidth: 0,
    maxHeight: 320,
    gap: 4,
    pad: 8,
    viewport,
  });
  assert.equal(pos.placement, "top");
  assert.equal(pos.top, 700 - 4 - 180);
  assert.equal(pos.left, 40);
});

test("wide menu may exceed trigger when matchTriggerWidth false", () => {
  const pos = computeDropdownPosition({
    trigger: { top: 40, left: 10, right: 110, bottom: 72, width: 100, height: 32 },
    panel: { width: 320, height: 100 },
    align: "start",
    matchTriggerWidth: false,
    minWidth: 280,
    viewport,
  });
  assert.ok(pos.width >= 280);
});

test("clamps into viewport padding", () => {
  const pos = computeDropdownPosition({
    trigger: { top: 10, left: 900, right: 990, bottom: 40, width: 90, height: 30 },
    align: "start",
    matchTriggerWidth: true,
    minWidth: 0,
    pad: 8,
    viewport: { width: 1000, height: 600 },
  });
  assert.ok(pos.left + pos.width <= 1000 - 8);
  assert.ok(pos.left >= 8);
});
