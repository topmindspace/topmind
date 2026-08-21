/**
 * organize-week product path wiring (structure + pure event names).
 * Structural only — do not import organize-week.ts (pulls store graph under node:test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ORGANIZE_WEEK_EVENT is stable", () => {
  const lib = readFileSync(path.join(root, "src/lib/organize-week.ts"), "utf8");
  assert.match(lib, /export const ORGANIZE_WEEK_EVENT = "organize:week"/);
});

test("command action emits organize:week (not only open task panel)", () => {
  const actions = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/actions.ts"),
    "utf8",
  );
  assert.match(actions, /topmind-workspace\.action\.organize-week/);
  assert.match(actions, /organize:week/);
  // Must not stop at task-panel:open alone for organize-week
  const block = actions.slice(
    actions.indexOf("topmind-workspace.action.organize-week"),
    actions.indexOf("topmind-workspace.action.organize-week") + 400,
  );
  assert.match(block, /organize:week/);
});

test("Shell listens for organize:week and runOrganizeWeek exists", () => {
  const shell = readFileSync(path.join(root, "src/components/shell/Shell.tsx"), "utf8");
  assert.match(shell, /organize:week/);
  assert.match(shell, /runOrganizeWeek/);
  const lib = readFileSync(path.join(root, "src/lib/organize-week.ts"), "utf8");
  assert.match(lib, /export async function runOrganizeWeek/);
  assert.match(lib, /createTask\("reconcile"\)/);
  // Unified 建议 surface (not raw setAiPanelOpen alone)
  assert.match(lib, /openSuggestSurface/);
  assert.match(lib, /select\(\{\s*kind:\s*"stream"/);
  // Product-complete: activity ops merge into ActionBar (not Kernel-only)
  assert.match(lib, /runActivityOps/);
  assert.match(lib, /useActionStore/);
});

test("ActionStore exposes runActivityOps + op cache survival", () => {
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(store, /runActivityOps/);
  assert.match(store, /mergeSuggestions/);
  assert.match(store, /memory_organize/);
  assert.match(store, /topic_classify/);
  assert.match(store, /opSuggestionCache/);
  assert.match(store, /create_topic/);
});

test("Stream surface has append; quiet entry is global strip (no second ActionBar)", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  const area = readFileSync(path.join(root, "src/components/shell/EditorArea.tsx"), "utf8");
  const sb = readFileSync(path.join(root, "src/components/shell/StatusBar.tsx"), "utf8");
  assert.match(view, /appendStreamEntry/);
  assert.doesNotMatch(view, /SuggestionStrip/);
  assert.doesNotMatch(view, /<ActionBar[\s/>]/);
  // Suggestion count now in StatusBar (2026-08: SuggestEntryStrip removed from canvas)
  assert.doesNotMatch(area, /SuggestEntryStrip/);
  assert.match(sb, /data-status-suggest-count/);
  // Stream organize still opens unified surface
  assert.match(view, /openSuggestSurface/);
});

test("appendStreamEntry RPC uses Kernel only (no monorepo lib import)", () => {
  const pathOps = readFileSync(path.join(root, "electron/lib/workspace-path-ops.mjs"), "utf8");
  const blockStart = pathOps.indexOf("async appendStreamEntry");
  assert.ok(blockStart >= 0);
  const block = pathOps.slice(blockStart, blockStart + 1200);
  assert.match(block, /loadKernelApi/);
  assert.match(block, /appendToStreamEntry/);
  assert.match(block, /kernelDurableWrite/);
  assert.doesNotMatch(block, /from\s+["'](?:\.\.\/)+lib\//);
  assert.doesNotMatch(block, /import\s*\(\s*["'](?:\.\.\/)+lib\//);
});

test("task-store opens unified suggest surface when reconcile yields candidates", () => {
  const store = readFileSync(path.join(root, "src/stores/task-store.ts"), "utf8");
  // Unified path expands ActionBar (not panel-open alone)
  assert.match(store, /suggest-surface:open/);
  assert.match(store, /SUGGESTIONS_REFRESH_EVENT/);
  assert.doesNotMatch(store, /PendingTaskType/);
  // ai_digest uses activity ops path
  assert.match(store, /runActivityOps/);
});

test("organize-week runs reconcile + runActivityOps without a post-merge refresh", () => {
  const lib = readFileSync(path.join(root, "src/lib/organize-week.ts"), "utf8");
  assert.match(lib, /createTask\("reconcile"\)/);
  assert.match(lib, /runActivityOps/);
  assert.match(lib, /engineJobSuggestionFollowUp/);
  assert.match(lib, /openSuggestSurface\(\{\s*refresh:\s*false\s*\}\)/);
  const callIdx = lib.indexOf(".runActivityOps(");
  assert.ok(callIdx >= 0);
  const thenIdx = lib.indexOf(".then", callIdx);
  assert.ok(thenIdx >= 0);
  const catchIdx = lib.indexOf(".catch", thenIdx);
  const thenBlock = lib.slice(thenIdx, catchIdx > thenIdx ? catchIdx : thenIdx + 400);
  assert.doesNotMatch(thenBlock, /suggestions:refresh/);
  assert.doesNotMatch(thenBlock, /SUGGESTIONS_REFRESH_EVENT/);
  assert.match(thenBlock, /engineJobSuggestionFollowUp/);
});

test("ActionBar is 建议 surface not 个人清单 dual-label", () => {
  const bar = readFileSync(path.join(root, "src/components/ai/ActionBar.tsx"), "utf8");
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(bar, /建议/);
  assert.doesNotMatch(bar, /用户概念：「待办」/);
  assert.match(store, /个人清单|TodoPopover/);
  assert.match(store, /memory_organize|topic_classify/);
});
