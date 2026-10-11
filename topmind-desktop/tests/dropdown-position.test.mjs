/**
 * placeContextMenu — cursor-anchored flip/clamp used by ContextMenu.
 * Must share pad rules with computeDropdownPosition (dropdown-position.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  placeContextMenu,
  computeDropdownPosition,
} from "../src/lib/dropdown-position.ts";

test("placeContextMenu keeps menu inside the viewport near bottom-right", () => {
  const r = placeContextMenu({
    x: 1260,
    y: 780,
    panel: { width: 220, height: 200 },
    minWidth: 200,
    viewport: { width: 1280, height: 800 },
  });
  assert.ok(r.left + 220 <= 1280 - 8);
  assert.ok(r.top + 200 <= 800 - 8);
  assert.ok(r.left >= 8);
  assert.ok(r.top >= 8);
  assert.equal(r.placement, "top");
});

test("placeContextMenu opens downward from an open area", () => {
  const r = placeContextMenu({
    x: 100,
    y: 100,
    panel: { width: 200, height: 160 },
    minWidth: 200,
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(r.left, 100);
  assert.equal(r.top, 100);
  assert.equal(r.placement, "bottom");
});

test("computeDropdownPosition still flips near the bottom edge", () => {
  const r = computeDropdownPosition({
    trigger: { top: 700, left: 40, right: 160, bottom: 740, width: 120, height: 40 },
    panel: { width: 200, height: 240 },
    matchTriggerWidth: false,
    minWidth: 160,
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(r.placement, "top");
  assert.ok(r.top < 700);
});
