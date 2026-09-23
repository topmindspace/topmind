/**
 * Unified 建议 entry + single confirm surface (ActionBar).
 * No second full suggestion list on Stream canvas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openSuggestSurface,
  OPEN_SUGGEST_SURFACE_EVENT,
  isUnifiedSuggestConfirmSurface,
} from "../src/lib/suggest-surface.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("openSuggestSurface is shipped export and event name is stable", () => {
  assert.equal(typeof openSuggestSurface, "function");
  assert.equal(OPEN_SUGGEST_SURFACE_EVENT, "suggest-surface:open");
  assert.equal(isUnifiedSuggestConfirmSurface(), true);
});

test("openSuggestSurface opens the AI workspace 建议 pane (peer column)", () => {
  const src = read("src/lib/suggest-surface.ts");
  assert.match(src, /setPanelOpen\(true\)/);
  assert.match(src, /setExpanded\(true\)/);
  assert.match(src, /openAiWorkspace\("suggest"\)/);
  // Must not mount a list component
  assert.doesNotMatch(src, /createElement\s*\(\s*ActionBar|render.*ActionBar/);
});

test("EditorArea no longer mounts SuggestEntryStrip (moved to StatusBar 2026-08)", () => {
  const area = read("src/components/shell/EditorArea.tsx");
  assert.doesNotMatch(area, /SuggestEntryStrip/);
  // Suggestion count chip now lives in StatusBar
  const sb = read("src/components/shell/StatusBar.tsx");
  assert.match(sb, /data-status-suggest-count/);
});

test("StatusBar suggest count chip opens toggleSuggestSurface", () => {
  const sb = read("src/components/shell/StatusBar.tsx");
  assert.match(sb, /data-status-suggest-count/);
  assert.match(sb, /toggleSuggestSurface|openSuggestSurface/);
});

test("建议 pane is confirm-gated and distinct from 清单", () => {
  const pop = read("src/components/ai/SuggestPopover.tsx");
  const ai = read("src/components/ai/AiWorkspace.tsx");
  const design = read("DESIGN.md");
  assert.match(pop, /acceptItem|dismissItem/);
  assert.match(ai, /suggest/);
  assert.match(ai, /todo/);
  assert.match(design, /建议.*pane|AI 工作区 \*\*建议\*\* pane/u);
  assert.match(design, /清单 pane/);
  assert.doesNotMatch(design, /统一待办条/);
});

test("SuggestPopover is the full confirm list; ActionBar is gone", () => {
  const pop = read("src/components/ai/SuggestPopover.tsx");
  assert.match(pop, /data-suggest-popover|data-action-bar/);
  assert.match(pop, /acceptItem|dismissItem/);
  const panel = read("src/components/ai/AiPanel.tsx");
  assert.doesNotMatch(panel, /ActionBar/);
});

test("Stream canvas does not mount second full suggestion list or duplicate strip", () => {
  const view = read(
    "src/plugins/topmind-workspace/views/StreamDetailView.tsx",
  );
  assert.doesNotMatch(view, /<ActionBar[\s/>]/);
  assert.doesNotMatch(view, /<SuggestEntryStrip/);
  // Still mentions unified path / openSuggestSurface for organize
  assert.match(view, /openSuggestSurface/);
  assert.doesNotMatch(view, /data-stream-ai-strip/);
});

test("organize-week uses openSuggestSurface for AI panel path", () => {
  const lib = read("src/lib/organize-week.ts");
  assert.match(lib, /openSuggestSurface/);
});

test("task-store surfaces candidates via suggest-surface:open (expands ActionBar)", () => {
  const store = read("src/stores/task-store.ts");
  assert.match(store, /suggest-surface:open/);
  // Reconcile + ai_digest paths must not open panel alone without unified surface
  const reconcileBlock = store.slice(
    store.indexOf('case "reconcile"'),
    store.indexOf('case "ai_digest"'),
  );
  const digestBlock = store.slice(store.indexOf('case "ai_digest"'));
  assert.match(reconcileBlock, /suggest-surface:open/);
  assert.match(digestBlock, /suggest-surface:open/);
  assert.doesNotMatch(reconcileBlock, /emitLocal\("ai-panel:open"\)/);
  assert.doesNotMatch(digestBlock, /emitLocal\("ai-panel:open"\)/);
});

test("AiPanel does not mount ActionBar", () => {
  const panel = read("src/components/ai/AiPanel.tsx");
  assert.doesNotMatch(panel, /<ActionBar/);
});
