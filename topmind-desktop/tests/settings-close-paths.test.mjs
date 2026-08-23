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

test("OverlayHost close paths await the guard before closeOverlay", () => {
  const src = read("src/components/shell/OverlayHost.tsx");
  assert.match(src, /await runOverlayCloseGuard\(\);\s*\n\s*closeOverlay\(\)/);
  // Esc shortcut, navigate, sidebar-view and scrim all use the guarded close
  const guarded = src.match(/void requestCloseOverlay\(\)|\(\) => void requestCloseOverlay\(\)/gu) || [];
  assert.ok(guarded.length >= 4, `expected >=4 guarded close call sites, got ${guarded.length}`);
  // No direct closeOverlay call remains on the scrim
  assert.doesNotMatch(src, /onClick=\{closeOverlay\}/);
});

test("flushPending re-queues the batch on failure (no silent drop)", () => {
  const src = read("src/components/overlays/useSettingsController.ts");
  assert.match(src, /pendingPatch\.current = mergeSettingsPatch\(batch, pendingPatch\.current\)/);
  // unmount flush reuses the same apply path (side effects applied)
  assert.match(src, /void flushRef\.current\(\)/);
});

test("rotateToken patches only clipBridge (no full-settings clobber)", () => {
  const src = read("src/components/settings/GeneralPanel.tsx");
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
