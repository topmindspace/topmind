/**
 * Brand / chrome style contracts — no purple AI gradients; capture CTA class exists.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v4 = readFileSync(path.join(root, "src/styles/v4.css"), "utf8");
const titleBar = readFileSync(path.join(root, "src/components/shell/TitleBar.tsx"), "utf8");
const stream = readFileSync(
  path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
  "utf8",
);

test("AI gradient styles stay on brand axis (no indigo/purple hex)", () => {
  assert.doesNotMatch(v4, /#6366f1|#8b5cf6|#7c3aed|#4f46e5/iu);
  assert.match(v4, /\.v4-ai-btn-gradient\s*\{/u);
  assert.match(v4, /brand-deep|brand-mid|brand-aqua/u);
});

test("title bar capture uses aqua capture CTA class", () => {
  assert.match(v4, /\.v4-titlebar-btn-capture\s*\{/u);
  assert.match(v4, /accent-inbox/u);
  assert.match(titleBar, /v4-titlebar-btn-capture/u);
  assert.match(titleBar, /titleBar\.capture/u);
});

test("stream composer uses focus chrome class", () => {
  assert.match(v4, /\.v4-stream-composer:focus-within/u);
  assert.match(stream, /v4-stream-composer/u);
});

test("titlebar capture remains sole aqua solid capture class usage in shell", () => {
  assert.match(titleBar, /v4-titlebar-btn-capture/u);
  // Stream must not reintroduce solid capture CTA class
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/u);
});
