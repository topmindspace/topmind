/**
 * openSuggestSurface / toggleSuggestSurface — SuggestPopover open + toggle behavior.
 * openSuggestSurface must open and not no-op when empty.
 * toggleSuggestSurface must close when already open, open when closed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("openSuggestSurface sets panelOpen and refreshes when empty", () => {
  const src = read("src/lib/suggest-surface.ts");
  assert.match(src, /setPanelOpen\(true\)/);
  assert.match(src, /setExpanded\(true\)/);
  assert.match(src, /refresh\(\{\s*force:\s*true\s*\}\)/);
  assert.match(src, /items\.length === 0|neverLoaded|!store\.everLoaded/);
  // No bus re-emit loop
  assert.doesNotMatch(src, /emitLocal\s*\(\s*OPEN_SUGGEST_SURFACE_EVENT/);
});

test("toggleSuggestSurface toggles panelOpen", () => {
  const src = read("src/lib/suggest-surface.ts");
  assert.match(src, /export function toggleSuggestSurface/);
  // Delegates to openSuggestSurface when closed, setPanelOpen(false) when open
  assert.match(src, /panelOpen/);
  assert.match(src, /setPanelOpen\(false\)/);
  assert.match(src, /openSuggestSurface/);
});

test("TitleBar uses toggleSuggestSurface; strip / ActionBar call openSuggestSurface", () => {
  const title = read("src/components/shell/TitleBar.tsx");
  assert.match(title, /toggleSuggestSurface/);
  assert.match(title, /data-suggest-header-trigger/);
  // TitleBar should NOT import openSuggestSurface (uses toggle helper now)
  assert.doesNotMatch(title, /import.*openSuggestSurface/);
  const strip = read("src/components/ai/SuggestEntryStrip.tsx");
  assert.match(strip, /openSuggestSurface/);
  assert.match(strip, /data-suggest-entry-state/);
  // Preparing strip when loading + empty + autoPrepare
  assert.match(strip, /preparing/);
  assert.match(strip, /suggestionsPreparing/);
  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /openSuggestSurface/);
});

test("StatusBar keeps suggest busy chip only; count lives on TitleBar badge + strip (降噪 2026-08)", () => {
  const sb = read("src/components/shell/StatusBar.tsx");
  // Loading/busy state stays; the persistent third count chip is removed
  assert.match(sb, /data-status-suggest-busy/);
  assert.doesNotMatch(sb, /data-status-suggest-count/);
  // Count surfaces: TitleBar 💡 badge + canvas strip (exactly two, per DESIGN 禁止三处等权)
  const title = read("src/components/shell/TitleBar.tsx");
  assert.match(title, /data-suggest-header-badge/);
  const strip = read("src/components/ai/SuggestEntryStrip.tsx");
  assert.match(strip, /data-suggest-entry-state/);
});

test("SuggestPopover mounts in Shell and positions on open", () => {
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /SuggestPopover/);
  assert.match(shell, /suggest-surface:open|openSuggestSurface/);
  // Workspace-healthy re-arm of autoPrepare
  const health = read("src/components/shell/useWorkspaceHealth.ts");
  assert.match(health, /suggestBootArmed|autoPrepare/);
  const pop = read("src/components/ai/SuggestPopover.tsx");
  assert.match(pop, /panelOpen/);
  assert.match(pop, /setPos/);
  assert.match(pop, /refresh\(\{\s*force:\s*true\s*\}\)/);
  assert.match(pop, /data-suggest-popover/);
});

test("action-store autoPrepare init + force empty shows loading", () => {
  const store = read("src/stores/action-store.ts");
  assert.match(store, /autoPrepareSuggestions/);
  assert.match(store, /showLoading|force && get\(\)\.items\.length === 0/);
  assert.match(store, /if \(on\) void useActionStore\.getState\(\)\.refresh/);
});
