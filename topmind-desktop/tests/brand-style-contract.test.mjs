/**
 * Brand / chrome style contracts — no purple AI gradients; capture lives on ActivityBar.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v4 = readFileSync(path.join(root, "src/styles/v4.css"), "utf8");
const tokens = readFileSync(path.join(root, "src/styles/tokens.css"), "utf8");
const titleBar = readFileSync(path.join(root, "src/components/shell/TitleBar.tsx"), "utf8");
const activityBar = readFileSync(path.join(root, "src/components/shell/ActivityBar.tsx"), "utf8");
const stream = readFileSync(
  path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
  "utf8",
);

test("AI gradient styles stay on brand axis (no indigo/purple hex)", () => {
  assert.doesNotMatch(v4, /#6366f1|#8b5cf6|#7c3aed|#4f46e5/iu);
  assert.match(v4, /\.v4-ai-btn\s*\{/u);
  assert.match(v4, /brand-deep|brand-mid|brand-aqua/u);
});

test("记一下 lives on the ActivityBar as accent text, not a solid TitleBar CTA", () => {
  // Capture is a group-1 ActivityBar item: pencil glyph + capture flag + accent color.
  assert.match(activityBar, /activityBar\.capture/u);
  assert.match(activityBar, /RiPencilLine/u);
  assert.match(activityBar, /capture:\s*true/u);
  // Accent text on the rail — not a filled ink CTA.
  assert.match(activityBar, /item\.capture\s*\?[^:]*text-accent-color/su);
  // Solid capture CTA class is gone from TitleBar and the stream canvas.
  assert.doesNotMatch(titleBar, /v4-titlebar-btn-capture/u);
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/u);
  assert.doesNotMatch(titleBar, /titleBar\.capture/u);
  // accent-inbox remains the capture accent stop (inbox mode maps accent-color → it).
  assert.match(tokens, /--color-accent-inbox/u);
  assert.match(v4, /accent-inbox/u);
});

test("icon-button system: chrome/tool/micro share one hover language", () => {
  assert.match(v4, /\.v4-icon-btn\s*\{/u);
  assert.match(v4, /\.v4-icon-btn-chrome\s*\{/u);
  assert.match(v4, /\.v4-icon-btn-micro\s*\{/u);
  assert.match(v4, /--color-surface-hover/u);
  // Hover always paints the full hit box via surface-hover.
  assert.match(v4, /\.v4-icon-btn:hover[^{]*\{[^}]*surface-hover/su);
  assert.match(v4, /\.v4-titlebar-btn:hover[^{]*\{[^}]*surface-hover/su);
  assert.match(v4, /\.v4-editor-tool-btn:hover[^{]*\{[^}]*surface-hover/su);
  // Chrome tier keeps 32px min box (the 记一下 regression guard).
  const chrome = v4.match(/\.v4-icon-btn-chrome\s*\{[^}]+\}/u)?.[0] || "";
  assert.match(chrome, /32px/u);
  const titlebar = v4.match(/\.v4-titlebar-btn\s*\{[^}]+\}/u)?.[0] || "";
  assert.match(titlebar, /min-width:\s*var\(--density-chrome-control/u);
  assert.doesNotMatch(titlebar, /min-width:\s*0/u);
});

test("stream composer uses focus chrome class", () => {
  assert.match(v4, /\.v4-stream-composer:focus-within/u);
  assert.match(stream, /v4-stream-composer/u);
});

test("solid capture CTA class is not used on TitleBar or stream canvas", () => {
  assert.doesNotMatch(titleBar, /v4-titlebar-btn-capture/u);
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/u);
});
