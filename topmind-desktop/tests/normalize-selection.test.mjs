/**
 * Drives shipped normalizeSelection — null / unknown kinds land on the in-workspace home.
 * Explicit 动态 and the other living kinds stay unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSelection } from "../src/types.ts";

test("normalizeSelection maps missing / unknown kinds to the in-workspace home", () => {
  assert.deepEqual(normalizeSelection(null), { kind: "home" });
  assert.deepEqual(normalizeSelection(undefined), { kind: "home" });
  assert.deepEqual(normalizeSelection({ kind: "home" }), { kind: "home" });
  assert.deepEqual(normalizeSelection({ kind: "dashboard" }), { kind: "home" });
});

test("normalizeSelection keeps known kinds, including explicit stream", () => {
  assert.deepEqual(normalizeSelection({ kind: "stream" }), { kind: "stream" });
  assert.deepEqual(normalizeSelection({ kind: "inbox" }), { kind: "inbox" });
  assert.deepEqual(normalizeSelection({ kind: "archive" }), { kind: "archive" });
  assert.deepEqual(normalizeSelection({ kind: "memory" }), { kind: "memory" });
  assert.equal(normalizeSelection({ kind: "file", path: "a.md" }).kind, "file");
});
