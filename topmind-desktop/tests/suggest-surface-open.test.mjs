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
import { useViewStore } from "../src/stores/view-store.ts";
import { useActionStore } from "../src/stores/action-store.ts";
import { toggleSuggestSurface } from "../src/lib/suggest-surface.ts";
import { toggleAiWorkspacePane } from "../src/lib/ai-workspace.ts";

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

test("toggleSuggestSurface: collapsed AI column + panelOpen opens suggest pane", () => {
  const viewSnap = {
    aiPanelOpen: useViewStore.getState().aiPanelOpen,
    aiWorkspaceTab: useViewStore.getState().aiWorkspaceTab,
  };
  const actionSnap = {
    panelOpen: useActionStore.getState().panelOpen,
    items: useActionStore.getState().items,
    everLoaded: useActionStore.getState().everLoaded,
    refresh: useActionStore.getState().refresh,
  };
  try {
    useActionStore.setState({
      panelOpen: true,
      everLoaded: true,
      items: [{ id: "s1", title: "t", summary: "s" }],
      refresh: async () => {},
    });
    useViewStore.setState({ aiPanelOpen: false, aiWorkspaceTab: "chat" });
    toggleSuggestSurface({ refresh: false });
    assert.equal(useViewStore.getState().aiPanelOpen, true);
    assert.equal(useViewStore.getState().aiWorkspaceTab, "suggest");

    toggleSuggestSurface({ refresh: false });
    assert.equal(useViewStore.getState().aiPanelOpen, false);

    useViewStore.setState({ aiPanelOpen: false, aiWorkspaceTab: "chat" });
    toggleAiWorkspacePane("todo");
    assert.equal(useViewStore.getState().aiWorkspaceTab, "todo");
    toggleAiWorkspacePane("apps");
    assert.equal(useViewStore.getState().aiWorkspaceTab, "apps");
  } finally {
    useViewStore.setState(viewSnap);
    useActionStore.setState(actionSnap);
  }
});

test("StatusBar count chip calls toggleSuggestSurface; AI workspace has suggest tab", () => {
  // 2026-09: suggest trigger removed from TitleBar — AI workspace tabs serve as entry.
  const aiWs = read("src/components/ai/AiWorkspace.tsx");
  assert.match(aiWs, /data-ai-workspace-tab=\{item\.id\}/);
  assert.match(aiWs, /id: "suggest"/);
  // StatusBar now hosts the suggestion count chip (replaces removed SuggestEntryStrip)
  const sb = read("src/components/shell/StatusBar.tsx");
  assert.match(sb, /data-status-suggest-count/);
  assert.match(sb, /toggleSuggestSurface/);
  const pop = read("src/components/ai/SuggestPopover.tsx");
  assert.match(pop, /openSuggestSurface|data-suggest-popover/);
});

test("StatusBar hosts both suggest busy chip and count chip (2026-08: strip removed from canvas)", () => {
  const sb = read("src/components/shell/StatusBar.tsx");
  // Loading/busy state stays
  assert.match(sb, /data-status-suggest-busy/);
  // Count chip now in StatusBar (replaces removed canvas SuggestEntryStrip)
  assert.match(sb, /data-status-suggest-count/);
  // 2026-09: suggest badge removed from TitleBar — count lives in StatusBar + AI workspace tab
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
