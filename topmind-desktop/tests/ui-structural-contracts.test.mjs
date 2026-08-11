/**
 * UI structural contracts — guards core visual/interaction invariants.
 *
 * Consolidated from P0/Wave2/Wave3 remediation tests. Asserts shipped source
 * patterns that are stable baseline: chrome hierarchy, single CTA, token ladder,
 * stream vocabulary, suggest demotion, format collapse, settings/overlay chrome,
 * sidebar collapse, shared kit, extension brand sync.
 *
 * The dead-code checker (check:dead-code.mjs) guards negative patterns
 * (no reintroduction of removed components); this file guards positive patterns
 * (required structures still present).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveStatusBarBusy } from "../src/lib/status-bar-busy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

function read(rel, base = root) {
  return readFileSync(path.join(base, rel), "utf8");
}

// ── Chrome hierarchy & single CTA ──────────────────────────────────────

test("TitleBar: L1 capture+AI solid, L2 suggest/todo, L3 tools; single capture solid", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  assert.match(titleBar, /data-chrome-tier=["']l1["']/);
  assert.match(titleBar, /data-chrome-tier=["']l2["']/);
  assert.match(titleBar, /data-chrome-tier=["']l3["']/);
  assert.match(titleBar, /v4-titlebar-btn-capture/);
  assert.match(titleBar, /v4-titlebar-btn-ai/);
  // L2 must not have capture solid
  const l2 = titleBar.slice(
    titleBar.indexOf("v4-titlebar-tier-l2"),
    titleBar.indexOf('data-chrome-tier="l3"'),
  );
  assert.doesNotMatch(l2, /v4-titlebar-btn-capture/);
});

test("List views demote capture to outline (no competing solid CTA)", () => {
  for (const rel of [
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/OutputsView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
  ]) {
    const src = read(rel);
    const tags = [...src.matchAll(/<Button[^>]*openOverlay\(["']quick-capture["']\)[^>]*>/g)];
    for (const m of tags) {
      assert.match(m[0], /variant=["'](outline|ghost)["']/, `${rel}: ${m[0]}`);
    }
  }
});

test("No purple/indigo marketing colors in UI or extension", () => {
  const onboarding = read("src/components/shell/OnboardingScreen.tsx");
  assert.doesNotMatch(onboarding, /#6366f1|#8b5cf6|#7c3aed|indigo|purple/i);
  const css = read("browser-extension/popup.css", repoRoot);
  assert.doesNotMatch(css, /#6366f1|#8b5cf6|#7c3aed/i);
});

// ── Token ladder ───────────────────────────────────────────────────────

test("Light tokens: surface != elevated; hairline and shadows defined", () => {
  const tokens = read("src/styles/tokens.css");
  const light = tokens.split(/\.dark\s*\{/)[0];
  const surface = light.match(/--color-surface:\s*([^;]+);/)?.[1]?.trim();
  const elevated = light.match(/--color-surface-elevated:\s*([^;]+);/)?.[1]?.trim();
  assert.ok(surface && elevated);
  assert.notEqual(surface.toLowerCase(), elevated.toLowerCase());
  assert.match(light, /--color-border-subtle-dim:\s*rgba\(60,\s*58,\s*50,\s*0\.0[5-9]/);
  assert.match(light, /--shadow-card:/);
  assert.match(light, /--shadow-elevated-hairline:/);
  assert.match(light, /--shadow-float:/);
});

// ── Stream vocabulary & compose ────────────────────────────────────────

test("Stream compose uses composeSubmit; placeholder avoids L1 vocabulary", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-compose-submit/);
  assert.match(stream, /streamDetail\.composeSubmit/);
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/);
  assert.doesNotMatch(stream, /titleBar\.capture/);

  const zh = JSON.parse(read("src/locales/zh-CN/workspace.json"));
  const en = JSON.parse(read("src/locales/en-US/workspace.json"));
  assert.notEqual(zh.streamDetail.composePlaceholder, "\u8bb0\u4e00\u4e0b");
  assert.notEqual(en.streamDetail.composePlaceholder, "Note it");
  assert.equal(zh.streamDetail.composeSubmit, "\u8bb0\u4e0b");
});

// ── Suggest / Todo / AI calm ───────────────────────────────────────────

test("ActionBar demotes when canvas strip active; format toolbar defaults collapsed", () => {
  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /focusMode/);
  assert.match(bar, /focusMode|SuggestEntryStrip|preparing/);
  assert.match(bar, /return null/);

  const editor = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(editor, /const \[showFormat,\s*setShowFormat\]\s*=\s*useState\(\s*false\s*\)/);
});

test("StatusBar: single-path named chip (tasks > todo > suggest)", () => {
  const multi = deriveStatusBarBusy({
    ready: true, streaming: false, activeTaskCount: 1, todoMaintaining: true, suggestLoading: true,
  });
  assert.equal(multi.showTaskChip, true);
  assert.equal(multi.showTodoChip, false);
  assert.equal(multi.showSuggestChip, false);

  const todoOnly = deriveStatusBarBusy({
    ready: true, streaming: false, activeTaskCount: 0, todoMaintaining: true, suggestLoading: true,
  });
  assert.equal(todoOnly.showTodoChip, true);
  assert.equal(todoOnly.showSuggestChip, false);
});

// ── Settings / overlays / sidebar ──────────────────────────────────────

test("Settings + overlays use v4 elevated shell; sidebar plugins default collapsed", () => {
  const settings = read("src/components/overlays/SettingsDialog.tsx") + read("src/components/overlays/SettingsLayout.tsx");
  assert.match(settings, /data-settings-dialog|v4-settings-dialog/);
  assert.match(settings, /surface-elevated|bg-surface-elevated/);
  assert.match(settings, /variant=["']ghost["']/);

  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-plugins-section/);
  assert.match(sidebar, /useState\(\s*true\s*\)/);
  assert.match(sidebar, /data-sidebar-plugins-collapsed/);
});

test("FilterChip is chip-weight; EmptyState one-primary-CTA; CaptureModeBar chip language", () => {
  const view = read("src/components/ui/view.tsx");
  assert.match(view, /data-filter-chip/);
  assert.match(view, /h-\[var\(--control-h-chip\)\]/);
  assert.match(view, /export function EmptyState/);

  const bar = read("src/components/overlays/CaptureModeBar.tsx");
  assert.match(bar, /data-capture-mode-bar|data-filter-chip/);
});

// ── Extension brand sync ───────────────────────────────────────────────

test("Browser extension popup CSS mirrors Design System brand + capture CTA", () => {
  const css = read("browser-extension/popup.css", repoRoot);
  assert.match(css, /--mh-capture:\s*#12897b/i);
  assert.match(css, /--mh-elevated:\s*#ffffff/i);
  assert.match(css, /--mh-bg:\s*#f7f6f4/i);
  const html = read("browser-extension/popup.html", repoRoot);
  assert.match(html, /btn-capture|data-capture-cta/);
});

// ── DESIGN.md documents key patterns ───────────────────────────────────

test("DESIGN.md documents core UI patterns", () => {
  const design = read("DESIGN.md");
  assert.match(design, /shadow-card|surface-elevated/);
  assert.match(design, /SuggestEntryStrip|ActionBar.*demote/i);
  assert.match(design, /showFormat|data-chrome-tier|TitleBar/);
  assert.match(design, /deriveStatusBarBusy/);
  assert.match(design, /FilterChip|data-filter-chip/);
});
