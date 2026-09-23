/**
 * Structure guards: global entry + auto-hide + no vanish root cause on soft path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("ActionStore refresh uses mergeSuggestRefreshItems soft preserve", () => {
  const store = read("src/stores/action-store.ts");
  assert.match(store, /mergeSuggestRefreshItems/);
  assert.match(store, /sessionSuggestionCache/);
  // Soft flag from decideSuggestRefresh (force → soft:false); not hard-coded !force only
  assert.match(store, /soft:\s*decision\.soft|soft:\s*!force/);
  assert.match(store, /decideSuggestRefresh/);
});

test("AI workspace has suggest tab; StatusBar has suggest count", () => {
  // 2026-09: suggest trigger removed from TitleBar — AI workspace tab is the entry.
  const ws = read("src/components/ai/AiWorkspace.tsx");
  assert.match(ws, /data-ai-workspace-tab=\{item\.id\}/);
  assert.match(ws, /id: "suggest"/);
  const sb = read("src/components/shell/StatusBar.tsx");
  assert.match(sb, /data-status-suggest-count/);
  // SuggestEntryStrip was deleted; count lives in StatusBar, not the canvas
  const area = read("src/components/shell/EditorArea.tsx");
  assert.doesNotMatch(area, /SuggestEntryStrip/);
});

test("AI workspace tab triggers suggest pane", () => {
  // 2026-09: TitleBar no longer has suggest trigger; AI workspace tab opens suggest.
  const ws = read("src/components/ai/AiWorkspace.tsx");
  assert.match(ws, /data-ai-workspace-tab=\{item\.id\}/);
  assert.match(ws, /id: "suggest"/);
  assert.match(ws, /Lightbulb/);
  const surf = read("src/lib/suggest-surface.ts");
  assert.match(surf, /openAiWorkspace\("suggest"\)/);
});

test("SuggestPopover is primary confirm surface mounted in Shell", () => {
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /SuggestPopover/);
  const pop = read("src/components/ai/SuggestPopover.tsx");
  assert.match(pop, /data-suggest-popover/);
  assert.match(pop, /acceptItem|dismissItem/);
  assert.match(pop, /data-action-bar/);
});

test("openSuggestSurface opens the AI workspace 建议 pane", () => {
  const surf = read("src/lib/suggest-surface.ts");
  assert.match(surf, /setPanelOpen\(true\)/);
  assert.match(surf, /openAiWorkspace\("suggest"\)/);
});

test("SuggestPopover is the confirm list; ActionBar is gone", () => {
  const pop = read("src/components/ai/SuggestPopover.tsx");
  assert.match(pop, /dismissItem|kindChipKey|data-suggest-popover/);
  const panel = read("src/components/ai/AiPanel.tsx");
  assert.doesNotMatch(panel, /ActionBar/);
});
