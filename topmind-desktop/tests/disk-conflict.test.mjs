/**
 * Disk conflict resolution (keep-local / take-disk / merge) — pure contract.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(
  pathToFileURL(path.join(__dirname, "..", "src", "lib", "disk-conflict.ts")).href
);
const { resolveDiskConflict, needsDiskConflictPrompt } = mod;

describe("disk-conflict", () => {
  test("auto-resolves when local equals disk", () => {
    const r = resolveDiskConflict({ base: "a", local: "b", disk: "b" }, "keep-local");
    assert.equal(r.auto, true);
    assert.equal(r.autoKind, "identical");
    assert.equal(r.body, "b");
    assert.equal(r.dirty, false);
  });

  test("auto-takes disk when local equals base (no real edits)", () => {
    const r = resolveDiskConflict({ base: "a", local: "a", disk: "a\nnew" }, "keep-local");
    assert.equal(r.auto, true);
    assert.equal(r.autoKind, "local-eq-base");
    assert.equal(r.body, "a\nnew");
    assert.equal(r.dirty, false);
  });

  test("auto-keeps local when disk equals base", () => {
    const r = resolveDiskConflict({ base: "a", local: "a\nmine", disk: "a" }, "keep-local");
    assert.equal(r.auto, true);
    assert.equal(r.autoKind, "disk-eq-base");
    assert.equal(r.body, "a\nmine");
  });

  test("keep-local preserves local body", () => {
    const r = resolveDiskConflict({ base: "base", local: "mine", disk: "theirs" }, "keep-local");
    assert.equal(r.auto, false);
    assert.equal(r.body, "mine");
    assert.equal(r.dirty, true);
  });

  test("take-disk replaces with disk body", () => {
    const r = resolveDiskConflict({ base: "base", local: "mine", disk: "theirs" }, "take-disk");
    assert.equal(r.auto, false);
    assert.equal(r.body, "theirs");
    assert.equal(r.dirty, false);
  });

  test("merge keeps local and appends disk-only lines", () => {
    const r = resolveDiskConflict(
      { base: "b", local: "line1\nline2", disk: "line1\nline2\ndiskOnly" },
      "merge",
    );
    assert.equal(r.auto, false);
    assert.match(r.body, /^line1\nline2/u);
    assert.match(r.body, /topmind:merged-from-disk/);
    assert.match(r.body, /diskOnly/);
    assert.equal(r.dirty, true);
  });

  test("needsDiskConflictPrompt returns prompt on real conflict", () => {
    assert.equal(
      needsDiskConflictPrompt({ base: "b", local: "x", disk: "y" }),
      "prompt",
    );
    assert.equal(
      needsDiskConflictPrompt({ base: "b", local: "b", disk: "b" }),
      "auto",
    );
  });
});
