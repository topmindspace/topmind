/**
 * Chrome overflow partition — priority + exclusive ⋯ collapse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionChromeActions } from "../src/lib/chrome-overflow.tsx";

test("wide rail keeps all actions visible", () => {
  const actions = [
    { id: "a", label: "Capture", priority: 10, onClick: () => {} },
    { id: "b", label: "Organize", priority: 20, onClick: () => {} },
    { id: "c", label: "Reload", priority: 40, onClick: () => {} },
  ];
  const { visible, overflow } = partitionChromeActions(actions, 520);
  assert.equal(overflow.length, 0);
  assert.equal(visible.length, 3);
});

test("narrow rail overflows lower priority first", () => {
  const actions = [
    { id: "a", label: "Capture", priority: 10, onClick: () => {} },
    { id: "b", label: "Organize this week", priority: 20, onClick: () => {} },
    { id: "c", label: "Reload", priority: 40, onClick: () => {} },
  ];
  const { visible, overflow } = partitionChromeActions(actions, 90);
  assert.ok(visible.length >= 1);
  assert.ok(overflow.length >= 1);
  // Highest priority should stay if any remain visible
  if (visible.length) {
    assert.ok(visible[0].priority <= (overflow[0]?.priority ?? 99));
  }
});

test("forceOverflow always goes to menu", () => {
  const actions = [
    { id: "a", label: "Main", priority: 10, onClick: () => {} },
    { id: "b", label: "Extra", priority: 5, forceOverflow: true, onClick: () => {} },
  ];
  const { visible, overflow } = partitionChromeActions(actions, 800);
  assert.ok(overflow.some((a) => a.id === "b"));
  assert.ok(visible.some((a) => a.id === "a"));
});
