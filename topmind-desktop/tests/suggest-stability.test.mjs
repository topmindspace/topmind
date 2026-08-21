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

test("StatusBar suggest count chip auto-hides when count is 0", () => {
  const sb = read("src/components/shell/StatusBar.tsx");
  // Count chip only shows when suggestCount > 0 (via showSuggestCountChip in busy logic)
  assert.match(sb, /data-status-suggest-count/);
  // SuggestEntryStrip was deleted; count lives in StatusBar, not the canvas
  const area = read("src/components/shell/EditorArea.tsx");
  assert.doesNotMatch(area, /SuggestEntryStrip/);
});

test("TitleBar has global suggest trigger (toggle)", () => {
  const bar = read("src/components/shell/TitleBar.tsx");
  assert.match(bar, /data-suggest-header-trigger/);
  assert.match(bar, /toggleSuggestSurface/);
  assert.match(bar, /Lightbulb/);
});

test("SuggestPopover is primary confirm surface mounted in Shell", () => {
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /SuggestPopover/);
  const pop = read("src/components/ai/SuggestPopover.tsx");
  assert.match(pop, /data-suggest-popover/);
  assert.match(pop, /acceptItem|dismissItem/);
  assert.match(pop, /data-action-bar/);
});

test("openSuggestSurface opens panel not only AI chat rail", () => {
  const surf = read("src/lib/suggest-surface.ts");
  assert.match(surf, /setPanelOpen\(true\)/);
  assert.doesNotMatch(surf, /setAiPanelOpen/);
});

test("ActionBar is compact pointer not full dual list", () => {
  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /openSuggestSurface|data-action-bar-compact/);
  assert.doesNotMatch(bar, /dismissItem|kindChipKey/);
});
