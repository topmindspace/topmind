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
const sidebar = readFileSync(path.join(root, "src/components/shell/Sidebar.tsx"), "utf8");
const stream = readFileSync(
  path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
  "utf8",
);

test("AI gradient styles stay on brand axis (no indigo/purple hex)", () => {
  assert.doesNotMatch(v4, /#6366f1|#8b5cf6|#7c3aed|#4f46e5/iu);
  assert.match(v4, /\.v4-ai-btn\s*\{/u);
  assert.match(v4, /brand-deep|brand-mid|brand-aqua/u);
});

test("sidebar 记一下 is a quiet chrome button with accent icon, not a solid TitleBar CTA", () => {
  assert.match(v4, /\.v4-sidebar-capture\s*\{/u);
  assert.match(v4, /\.v4-capture-accent-icon\s*\{/u);
  assert.match(v4, /accent-inbox/u);
  assert.match(sidebar, /v4-sidebar-capture/u);
  assert.match(sidebar, /titleBar\.capture/u);
  assert.match(sidebar, /RiPencilLine/u);
  assert.doesNotMatch(sidebar, /v4-titlebar-btn-capture/u);
  assert.doesNotMatch(titleBar, /v4-titlebar-btn-capture/u);
  assert.doesNotMatch(titleBar, /titleBar\.capture/u);
  // Hit box must stay chrome-sized — min-width:0 collapses the hover rect.
  const captureRule = v4.match(/\.v4-sidebar-capture\s*\{[^}]+\}/u)?.[0] || "";
  assert.doesNotMatch(captureRule, /min-width:\s*0/u);
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
