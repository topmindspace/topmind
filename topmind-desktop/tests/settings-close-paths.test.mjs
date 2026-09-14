/**
 * Settings close-path & failure-semantics contracts (2026-08-24 round 4).
 * Static source assertions in the style of ui-settings-sync tests:
 *  - every overlay close path routes through the close guard (flush first)
 *  - a failed flush re-queues the batch instead of dropping it
 *  - rotateToken sends only the clipBridge patch
 *  - fileFilter changes emit the sidebar event (live apply)
 *  - packing switch does not hardcode appendHeading
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("SettingsDialog registers the overlay close guard on mount", () => {
  const src = read("src/components/overlays/SettingsDialog.tsx");
  assert.match(src, /setOverlayCloseGuard\(async \(\) => \{/);
  assert.match(src, /await flushPending\(\)/);
  assert.match(src, /return \(\) => setOverlayCloseGuard\(null\)/, "guard cleared on unmount");
});

test("every overlay close path awaits the guard before closeOverlay", () => {
  // 2026-09-14: close paths moved from OverlayHost's inline switch into the
  // shared dispatcher (keyboard + native menu call the same code). The guard
  // consequently lives in exactly one place instead of being repeated per
  // branch — a strictly stronger guarantee, so assert the new shape.
  const commands = read("src/lib/workbench-commands.ts");
  assert.match(
    commands,
    /await runOverlayCloseGuard\(\);\s*\n\s*useViewStore\.getState\(\)\.closeOverlay\(\)/,
  );
  // Esc / overlay-toggle / navigate / sidebar-view all funnel through it
  const guarded = commands.match(/void closeOverlayGuarded\(\)/gu) || [];
  assert.ok(guarded.length >= 4, `expected >=4 guarded close paths, got ${guarded.length}`);

  const host = read("src/components/shell/OverlayHost.tsx");
  // Scrim dismissal is still exported through the guarded wrapper
  assert.match(host, /await runOverlayCloseGuard\(\);\s*\n\s*closeOverlay\(\)/);
  assert.match(host, /if \(scrimDismissesOverlay\(overlay\)\) void requestCloseOverlay\(\)/);
  // No direct closeOverlay call remains on the scrim
  assert.doesNotMatch(host, /onClick=\{closeOverlay\}/);
  // Keyboard goes through the dispatcher, so a new branch cannot skip the guard
  assert.match(host, /runWorkbenchAction\(hit\.action\)/);
});

test("flushPending re-queues the batch on failure (no silent drop)", () => {
  const src = read("src/components/overlays/useSettingsController.ts");
  assert.match(src, /pendingPatch\.current = mergeSettingsPatch\(batch, pendingPatch\.current\)/);
  // unmount flush reuses the same apply path (side effects applied)
  assert.match(src, /void flushRef\.current\(\)/);
});

test("rotateToken patches only clipBridge (no full-settings clobber)", () => {
  // 2026-08-30: the Clip Bridge section moved General → Plugins (IA split)
  const src = read("src/components/settings/PluginsPanel.tsx");
  assert.match(src, /update\(\{ clipBridge: res\.settings\.clipBridge \}\)/);
  assert.doesNotMatch(src, /update\(res\.settings\)/);
});

test("fileFilter change emits sidebar:file-filter-changed for live apply", () => {
  const src = read("src/components/settings/GeneralPanel.tsx");
  assert.match(src, /emitLocal\("sidebar:file-filter-changed", next\)/);
});

test("packing switch sends only the packing key", () => {
  const src = read("src/components/settings/WorkspacePanel.tsx");
  assert.match(src, /stream: \{ packing \},/);
  assert.doesNotMatch(src, /appendHeading: "day"/);
});

test("empty profile filename falls back to profile.md, not the retired 我的情况.md", () => {
  const src = read("src/components/settings/WorkspacePanel.tsx");
  assert.match(src, /DEFAULT_PROFILE_FILE = "profile.md"/);
  assert.doesNotMatch(src, /["']我的情况\.md["']/);
});
