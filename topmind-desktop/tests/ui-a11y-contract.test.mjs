/**
 * Static a11y contracts for high-traffic UI surfaces.
 * Complements DESIGN.md Quiet Paper keyboard / dialog rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("Dialog has focus trap + aria-labelledby", () => {
  const src = read("src/components/ui/Dialog.tsx");
  assert.match(src, /aria-labelledby/);
  assert.match(src, /aria-modal/);
  assert.match(src, /Tab/);
  assert.match(src, /previousFocusRef|previousFocus/);
});

test("CommandPalette is combobox + listbox with activedescendant", () => {
  const src = read("src/components/overlays/CommandPalette.tsx");
  assert.match(src, /role="combobox"/);
  assert.match(src, /aria-activedescendant/);
  assert.match(src, /role="listbox"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /command-palette-opt-/);
});

test("GlobalSearch is combobox + listbox with activedescendant", () => {
  const src = read("src/components/overlays/GlobalSearch.tsx");
  assert.match(src, /role="combobox"/);
  assert.match(src, /aria-activedescendant/);
  assert.match(src, /global-search-opt-/);
  assert.match(src, /aria-modal="true"/);
});

test("RuntimeBadge offline opens settings AI panel", () => {
  const src = read("src/components/ai/RuntimeBadge.tsx");
  assert.match(src, /openOverlay\("settings"/);
  assert.match(src, /topicId:\s*"ai"/);
  assert.match(src, /ai\.runtimeOfflineLabel/);
});

test("OverlayHost restores focus and locks body scroll", () => {
  const src = read("src/components/shell/OverlayHost.tsx");
  assert.match(src, /body\.style\.overflow/);
  assert.match(src, /prevFocusRef|previousFocus/);
  assert.match(src, /role="presentation"/);
});

test("FilterChip exposes aria-pressed", () => {
  const src = read("src/components/ui/view.tsx");
  assert.match(src, /aria-pressed=\{Boolean\(active\)\}/);
});

test("QuickCapture mode chips use CaptureModeBar (FilterChip language)", () => {
  const src = read("src/components/overlays/CaptureForm.tsx");
  assert.match(src, /CaptureModeBar/);
  assert.match(src, /from ["']\.\/CaptureModeBar["']/);
  const bar = read("src/components/overlays/CaptureModeBar.tsx");
  assert.match(bar, /role="tablist"/);
  assert.match(bar, /aria-label=\{t\("overlays:capture\.modeAriaLabel"\)\}/);
  assert.match(bar, /text-3xs font-medium/);
});

test("quick-capture-helpers exports pure title cleaners", () => {
  const src = read("src/components/overlays/quick-capture-helpers.ts");
  assert.match(src, /export function cleanCaptureTitle/);
  assert.match(src, /export function deriveTitleFromContent/);
  assert.match(src, /export function methodLabel/);
  assert.match(src, /export const FETCH_FULL/);
});

test("Settings Field description uses UI floor text-3xs", () => {
  const src = read("src/components/settings/fields.tsx");
  assert.match(src, /mt-1 text-3xs leading-snug text-text-quaternary/);
  assert.match(src, /v4-switch/);
  assert.match(src, /aria-label=\{label\}/);
});

test("tree-node-icons exports TreeNodeIcon", () => {
  const src = read("src/components/sidebar/tree-node-icons.tsx");
  assert.match(src, /export function TreeNodeIcon/);
  assert.match(src, /export function TreeFileIcon/);
});

test("TreeView uses shared selectionKey from tree-reveal", () => {
  const src = read("src/components/sidebar/TreeView.tsx");
  assert.match(src, /from ["']\.\.\/\.\.\/lib\/tree-reveal["']/);
  assert.match(src, /TreeNodeIcon/);
  assert.doesNotMatch(src, /function NodeIcon\b/);
  assert.doesNotMatch(src, /function selectionKey\b/);
});

test("weread-format pure helpers exist", () => {
  const src = read("src/plugins/topmind-weread/weread-format.ts");
  assert.match(src, /export function formatDuration/);
  assert.match(src, /export function formatSyncTime/);
});

test("TreeView uses TreeNodeContextMenu module", () => {
  const src = read("src/components/sidebar/TreeView.tsx");
  assert.match(src, /TreeNodeContextMenu/);
  assert.match(src, /from ["']\.\/tree-node-context-menu["']/);
  assert.doesNotMatch(src, /ContextMenuLabel/);
  const menu = read("src/components/sidebar/tree-node-context-menu.tsx");
  assert.match(menu, /export function TreeNodeContextMenu/);
  assert.match(menu, /export type TreeNodeMenuHandlers/);
});

test("Weread hub uses WereadStatsPanel", () => {
  const src = read("src/plugins/topmind-weread/hub-view.tsx");
  assert.match(src, /WereadStatsPanel/);
  assert.doesNotMatch(src, /function StatChip\b/);
  const panel = read("src/plugins/topmind-weread/WereadStatsPanel.tsx");
  assert.match(panel, /export function WereadStatsPanel/);
  assert.match(panel, /formatDuration/);
});
