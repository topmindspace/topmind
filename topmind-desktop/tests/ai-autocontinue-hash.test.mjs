/**
 * Auto-continue + content-hash optimistic concurrency contract.
 * Source-text contracts (no Electron import) + pure helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "../electron/lib/workspace-path-ops.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("contentHash is stable 16-hex and changes with content", () => {
  const a = contentHash("hello\n");
  const b = contentHash("hello\n");
  const c = contentHash("hello world\n");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test("ai-service auto-continues after stepLimitHit with bounded loop", () => {
  const src = readFileSync(path.join(root, "electron/ai-service.mjs"), "utf8");
  assert.match(src, /MAX_AUTO_CONTINUES/);
  assert.match(src, /stepLimitHit/);
  assert.match(src, /status: "continuing"/);
  assert.match(src, /ai\.continuePrompt/);
});

test("stream runtimes surface stepLimitHit for auto-continue", () => {
  const stream = readFileSync(path.join(root, "electron/ai-stream.mjs"), "utf8");
  assert.match(stream, /stepLimitHit/);
  assert.match(stream, /stepLimitHit,/);
  const pi = readFileSync(path.join(root, "electron/ai-pi-runtime.mjs"), "utf8");
  assert.match(pi, /stepLimitHit/);
  assert.match(pi, /stepLimitHit,/);
});

test("edit_file accepts expectedHash and read_file returns contentHash", () => {
  const tools = readFileSync(path.join(root, "electron/ai-tools.mjs"), "utf8");
  assert.match(tools, /expectedHash/);
  assert.match(tools, /contentHash/);
  const pathOps = readFileSync(path.join(root, "electron/lib/workspace-path-ops.mjs"), "utf8");
  assert.match(pathOps, /contentHash\(old\)/);
  assert.match(pathOps, /contentHash\(next\)/);
  assert.match(pathOps, /expectedHash/);
});
