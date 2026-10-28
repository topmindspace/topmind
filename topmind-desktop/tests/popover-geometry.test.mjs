import test from "node:test";
import assert from "node:assert/strict";
import { anchoredPopoverX, clampPopoverX } from "../src/lib/popover-geometry.ts";

test("popover anchor stays fully visible in narrow and desktop windows", () => {
  for (const viewportWidth of [320, 375, 430, 1280]) {
    for (const panelWidth of [360, 400]) {
      const x = anchoredPopoverX(viewportWidth, panelWidth);
      const renderedWidth = Math.min(panelWidth, viewportWidth - 24);
      assert.ok(x >= 8);
      assert.ok(x + renderedWidth <= viewportWidth - 8);
    }
  }
});

test("dragged popover remains visible after window narrows", () => {
  assert.equal(clampPopoverX(880, 320, 360, 4), 20);
  assert.equal(clampPopoverX(-50, 320, 360, 4), 4);
});
