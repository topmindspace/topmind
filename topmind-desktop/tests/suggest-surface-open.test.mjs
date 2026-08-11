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

test("TitleBar uses toggleSuggestSurface; StatusBar count chip calls toggleSuggestSurface", () => {
  const title = read("src/components/shell/TitleBar.tsx");
  assert.match(title, /toggleSuggestSurface/);
  assert.match(title, /data-suggest-header-trigger/);
  // TitleBar should NOT import openSuggestSurface (uses toggle helper now)
  assert.doesNotMatch(title, /import.*openSuggestSurface/);
  // StatusBar now hosts the suggestion count chip (replaces removed SuggestEntryStrip)
  const sb = read("src/components/shell/StatusBar.tsx");
  assert.match(sb, /data-status-suggest-count/);
  assert.match(sb, /toggleSuggestSurface/);
  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /openSuggestSurface/);
});

test("StatusBar hosts both suggest busy chip and count chip (2026-08: strip removed from canvas)", () => {
  const sb = read("src/components/shell/StatusBar.tsx");
  // Loading/busy state stays
  assert.match(sb, /data-status-suggest-busy/);
  // Count chip now in StatusBar (replaces removed canvas SuggestEntryStrip)
  assert.match(sb, /data-status-suggest-count/);
  // TitleBar badge still exists
  const title = read("src/components/shell/TitleBar.tsx");
  assert.match(title, /data-suggest-header-badge/);
  // EditorArea no longer imports SuggestEntryStrip
  const area = read("src/components/shell/EditorArea.tsx");
  assert.doesNotMatch(area, /SuggestEntryStrip/);
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
