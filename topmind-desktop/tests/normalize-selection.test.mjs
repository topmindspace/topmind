/**
 * Drives shipped normalizeSelection — unknown kinds (including leftover "home") → stream.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSelection } from "../src/types.ts";

test("normalizeSelection maps missing / unknown kinds to stream", () => {
  assert.deepEqual(normalizeSelection(null), { kind: "stream" });
  assert.deepEqual(normalizeSelection(undefined), { kind: "stream" });
  assert.deepEqual(normalizeSelection({ kind: "home" }), { kind: "stream" });
  assert.deepEqual(normalizeSelection({ kind: "dashboard" }), { kind: "stream" });
});

test("normalizeSelection keeps known kinds", () => {
  assert.deepEqual(normalizeSelection({ kind: "inbox" }), { kind: "inbox" });
  assert.deepEqual(normalizeSelection({ kind: "archive" }), { kind: "archive" });
  assert.deepEqual(normalizeSelection({ kind: "memory" }), { kind: "memory" });
  assert.equal(normalizeSelection({ kind: "file", path: "a.md" }).kind, "file");
});

test("types.ts does not special-case the string home", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/types.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /kind === ["']home["']/);
});
