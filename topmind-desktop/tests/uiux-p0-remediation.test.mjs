/**
 * UI/UX P0 remediation contracts — dual CTA, tokens ladder, stream vocabulary,
 * suggest demotion, Todo calm, editor format collapse, i18n tooltip keys.
 * Asserts shipped sources (no reimplementation of UI logic).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function loadJson(rel) {
  return JSON.parse(read(rel));
}

// ── AC1: Capture CTA hierarchy ──────────────────────────────────────────

test("titlebar is the only aqua solid capture pattern (v4-titlebar-btn-capture)", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  const v4 = read("src/styles/v4.css");
  assert.match(v4, /\.v4-titlebar-btn-capture\s*\{/u);
  assert.match(titleBar, /v4-titlebar-btn-capture/u);
  assert.match(titleBar, /titleBar\.capture/u);
  // Capture class must not appear on list views (Inbox / Stream)
  const inbox = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.doesNotMatch(inbox, /v4-titlebar-btn-capture/);
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/);
});

test("Inbox header capture is demoted off solid default Button", () => {
  const inbox = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  // Header + empty-state openOverlay quick-capture must use outline (not bare size=sm default solid)
  const captureOpens = [
    ...inbox.matchAll(
      /<Button([^>]*?)onClick=\{\(\)\s*=>\s*openOverlay\(["']quick-capture["']\)\}[^>]*>/gu,
    ),
  ];
  // Also allow prop order with onClick before variant
  const alt = [
    ...inbox.matchAll(
      /<Button[^>]*openOverlay\(["']quick-capture["']\)[^>]*>/gu,
    ),
  ];
  const matches = captureOpens.length > 0 ? captureOpens : alt;
  assert.ok(matches.length >= 1, "expected at least one quick-capture Button in Inbox");
  for (const m of matches) {
    const tag = m[0];
    assert.match(tag, /variant=["']outline["']/, `Inbox capture must be outline, got: ${tag}`);
    assert.doesNotMatch(tag, /variant=["']default["']/);
  }
});

test("Stream compose solid submit uses composeSubmit (记下), not L1 capture copy", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-compose-submit/);
  assert.match(stream, /streamDetail\.composeSubmit/);
  assert.match(stream, /streamDetail\.composeLabel/);
  // Must not put titleBar.capture or solid capture class on compose submit
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/);
  assert.doesNotMatch(stream, /titleBar\.capture/);
});

test("Stream composeLabel is not L1 记一下 / Note it vocabulary", () => {
  const zh = loadJson("src/locales/zh-CN/workspace.json");
  const en = loadJson("src/locales/en-US/workspace.json");
  assert.equal(typeof zh.streamDetail.composeLabel, "string");
  assert.equal(typeof en.streamDetail.composeLabel, "string");
  assert.notEqual(zh.streamDetail.composeLabel, "记一下");
  assert.notEqual(en.streamDetail.composeLabel, "Note it");
  // Submit stays 记下 / Save path
  assert.equal(zh.streamDetail.composeSubmit, "记下");
  assert.ok(en.streamDetail.composeSubmit.length > 0);
});

// ── AC2: Light surface ladder ───────────────────────────────────────────

test("light tokens: surface and surface-elevated are distinct fills", () => {
  const tokens = read("src/styles/tokens.css");
  // Parse light (pre-.dark) elevated and surface assignments
  const lightBlock = tokens.split(/\.dark\s*\{/u)[0];
  const surface = lightBlock.match(/--color-surface:\s*([^;]+);/u)?.[1]?.trim();
  const elevated = lightBlock.match(/--color-surface-elevated:\s*([^;]+);/u)?.[1]?.trim();
  assert.ok(surface, "surface defined");
  assert.ok(elevated, "surface-elevated defined");
  assert.notEqual(
    surface.toLowerCase(),
    elevated.toLowerCase(),
    `light surface (${surface}) must not equal elevated (${elevated})`,
  );
});

test("light tokens: hairline dim is stronger than collapsed 0.045 and shadow-card exists", () => {
  const tokens = read("src/styles/tokens.css");
  const lightBlock = tokens.split(/\.dark\s*\{/u)[0];
  assert.match(lightBlock, /--color-border-subtle-dim:\s*rgba\(62,\s*54,\s*38,\s*0\.0[6-9]/u);
  assert.match(lightBlock, /--shadow-card:/u);
  assert.match(lightBlock, /--shadow-elevated-hairline:/u);
  assert.match(lightBlock, /--shadow-float:/u);
});

// ── AC3: Stream cards quieter than overlays ─────────────────────────────

test("stream feed cards use shadow-card not elevated-hairline", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-entry-card/);
  assert.match(stream, /shadow-\[var\(--shadow-card\)\]/);
  // Cards block should not use elevated-hairline (composer may still)
  const cardRegion = stream.slice(
    stream.indexOf("data-stream-entry-card"),
    stream.indexOf("data-stream-entry-card") + 800,
  );
  assert.doesNotMatch(cardRegion, /shadow-elevated-hairline/);
});

test("stream composer remains elevated hero surface", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-inline-composer/);
  assert.match(stream, /v4-stream-composer/);
  const composer = stream.slice(
    stream.indexOf("data-stream-inline-composer") - 400,
    stream.indexOf("data-stream-inline-composer") + 80,
  );
  assert.match(composer, /shadow-elevated-hairline|bg-surface-elevated/);
});

// ── AC4: Suggest / Todo / AI calm ───────────────────────────────────────

test("ActionBar demotes when canvas SuggestEntryStrip would be active", () => {
  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /focusMode/);
  assert.match(bar, /canvasStripActive|SuggestEntryStrip|preparing/);
  assert.match(bar, /return null/);
  // Must still mount path in AiPanel
  const panel = read("src/components/ai/AiPanel.tsx");
  assert.match(panel, /<ActionBar\s*\/>/);
});

test("Todo maintain idle is ghost, gradient only while maintaining", () => {
  const todo = read("src/components/todo/TodoPopover.tsx");
  assert.match(todo, /data-todo-maintain/);
  // Idle path: no unconditional v4-ai-chip-gradient className string alone
  assert.match(todo, /maintaining === ["']maintaining["']/);
  assert.match(todo, /v4-ai-chip-gradient/);
  // Ghost idle styling present
  assert.match(todo, /hover:text-accent-color|text-text-quaternary/);
  // Class is conditional — gradient only when maintaining
  assert.match(
    todo,
    /maintaining === ["']maintaining["']\s*\?\s*["']v4-ai-chip-gradient["']/,
  );
});

test("AI empty state limits multi-CTA prompts", () => {
  const panel = read("src/components/ai/AiPanel.tsx");
  assert.match(panel, /data-ai-empty/);
  // Single contextual prompt — one-element array, no multi-CTA list
  assert.match(panel, /const prompts = \[quickPromptFor\(/);
});

// ── AC5: Editor chrome + i18n tooltip ───────────────────────────────────

test("FileEditorView format toolbar defaults collapsed", () => {
  const view = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(view, /useState\(\s*false\s*\)/);
  // More specific: showFormat initial false
  assert.match(view, /showFormat[^\n]*useState\(\s*false\s*\)|useState\(\s*false\s*\)[^\n]*showFormat|const \[showFormat,\s*setShowFormat\]\s*=\s*useState\(\s*false\s*\)/);
});

test("workspace:menu.moveToTopicTooltip exists in zh-CN and en-US and is used by FileEditor", () => {
  const zh = loadJson("src/locales/zh-CN/workspace.json");
  const en = loadJson("src/locales/en-US/workspace.json");
  assert.equal(typeof zh.menu.moveToTopicTooltip, "string");
  assert.equal(typeof en.menu.moveToTopicTooltip, "string");
  assert.ok(zh.menu.moveToTopicTooltip.length > 0);
  assert.ok(en.menu.moveToTopicTooltip.length > 0);
  assert.doesNotMatch(en.menu.moveToTopicTooltip, /[\u4e00-\u9fff]/);
  // No dotted-key residue
  assert.doesNotMatch(zh.menu.moveToTopicTooltip, /menu\.moveToTopic/);
  assert.doesNotMatch(en.menu.moveToTopicTooltip, /menu\.moveToTopic/);

  const view = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(view, /workspace:menu\.moveToTopicTooltip/);
});
