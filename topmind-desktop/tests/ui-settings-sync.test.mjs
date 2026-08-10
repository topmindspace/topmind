/**
 * Settings → live shell UI sync pure helpers.
 * Guards the "stale full ui spread clobber shell resize" bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLiveUiFromSettingsPatch,
  applyLiveUiSnapshot,
  isSidebarViewMode,
  UI_SETTINGS_APPLIED_EVENT,
} from "../src/lib/ui-settings-sync.ts";

test("isSidebarViewMode accepts product modes only", () => {
  assert.equal(isSidebarViewMode("stream"), true);
  assert.equal(isSidebarViewMode("category"), true);
  assert.equal(isSidebarViewMode("galaxy"), false);
});

test("extractLiveUiFromSettingsPatch only uses own keys on patch delta", () => {
  const snap = extractLiveUiFromSettingsPatch({
    aiPanelOpen: false,
    sidebarView: "kanban",
  });
  assert.equal(snap.aiPanelOpen, false);
  assert.equal(snap.sidebarView, "kanban");
  // widths NOT on patch → not extracted even if fullUi would have them
  assert.equal(snap.sidebarWidth, undefined);
  assert.equal(snap.aiPanelWidth, undefined);
  assert.equal(snap.sidebarCollapsed, undefined);
});

test("extract ignores fullUi widths when patch only toggles aiPanelOpen (clobber guard)", () => {
  // Simulates old bug: merge fullUi+patch then apply all layout fields
  const staleFull = {
    sidebarWidth: 240,
    aiPanelWidth: 360,
    sidebarCollapsed: false,
    aiPanelOpen: true,
    sidebarView: "stream",
  };
  const snap = extractLiveUiFromSettingsPatch({ aiPanelOpen: false }, staleFull);
  assert.deepEqual(snap, { aiPanelOpen: false });
});

test("extract includes widths only when own-present on patch (resetLayout)", () => {
  const snap = extractLiveUiFromSettingsPatch({
    sidebarWidth: 240,
    aiPanelWidth: 360,
    sidebarCollapsed: false,
    aiPanelOpen: true,
    sidebarView: "stream",
  });
  assert.equal(snap.sidebarWidth, 240);
  assert.equal(snap.aiPanelWidth, 360);
  assert.equal(snap.sidebarCollapsed, false);
  assert.equal(snap.aiPanelOpen, true);
  assert.equal(snap.sidebarView, "stream");
});

test("extractLiveUi ignores out-of-range widths even when present", () => {
  const snap = extractLiveUiFromSettingsPatch({ sidebarWidth: 10, aiPanelWidth: 9999 });
  assert.equal(snap.sidebarWidth, undefined);
  assert.equal(snap.aiPanelWidth, undefined);
});

test("locale-only patch extracts nothing live (no shell layout touch)", () => {
  const snap = extractLiveUiFromSettingsPatch({ locale: "en-US" });
  assert.deepEqual(snap, {});
});

test("applyLiveUiSnapshot updates store and reports applied", () => {
  const calls = [];
  const store = {
    setSidebarWidth: (w) => calls.push(["w", w]),
    setSidebarCollapsed: (v) => calls.push(["c", v]),
    setSidebarView: (m) => calls.push(["v", m]),
    setAiPanelOpen: (v) => calls.push(["ai", v]),
    setAiPanelWidth: (w) => calls.push(["aw", w]),
  };
  const applied = applyLiveUiSnapshot(
    { aiPanelOpen: false, sidebarView: "stream", sidebarWidth: 280 },
    store,
  );
  assert.equal(applied, true);
  assert.deepEqual(calls, [
    ["w", 280],
    ["v", "stream"],
    ["ai", false],
  ]);
  assert.equal(UI_SETTINGS_APPLIED_EVENT, "ui:settings-applied");
});

test("applyLiveUiSnapshot empty snap is no-op", () => {
  let n = 0;
  const store = {
    setSidebarWidth: () => { n++; },
    setSidebarCollapsed: () => { n++; },
    setSidebarView: () => { n++; },
    setAiPanelOpen: () => { n++; },
    setAiPanelWidth: () => { n++; },
  };
  assert.equal(applyLiveUiSnapshot({}, store), false);
  assert.equal(n, 0);
});
