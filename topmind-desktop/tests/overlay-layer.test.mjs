/**
 * Overlay layer: notify only when the open boolean flips; nested acquires
 * keep html[data-overlay-open] until the last release (settings + confirm).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  setOverlayLayer,
  acquireOverlayLayer,
  isOverlayLayerActive,
  onOverlayLayerChange,
  OVERLAY_OPEN_ATTR,
} from "../src/lib/overlay-layer.ts";

test("setOverlayLayer notifies only when active boolean flips", () => {
  setOverlayLayer(false, null);
  const seen = [];
  const unsub = onOverlayLayerChange((v) => seen.push(v));
  setOverlayLayer(true, null);
  setOverlayLayer(true, null);
  setOverlayLayer(false, null);
  setOverlayLayer(false, null);
  unsub();
  assert.deepEqual(seen, [true, false]);
  assert.equal(isOverlayLayerActive(), false);
});

test("nested acquireOverlayLayer keeps the layer until the last release", () => {
  setOverlayLayer(false, null);
  const seen = [];
  const unsub = onOverlayLayerChange((v) => seen.push(v));
  const a = acquireOverlayLayer();
  const b = acquireOverlayLayer();
  assert.equal(isOverlayLayerActive(), true);
  a();
  assert.equal(isOverlayLayerActive(), true);
  b();
  assert.equal(isOverlayLayerActive(), false);
  unsub();
  assert.deepEqual(seen, [true, false]);
});

test("OVERLAY_OPEN_ATTR is data-overlay-open", () => {
  assert.equal(OVERLAY_OPEN_ATTR, "data-overlay-open");
});
