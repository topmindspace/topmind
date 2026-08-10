/**
 * Suggestion confirm gate + refresh event wiring (shipped paths).
 * Gate is pure (suggestion-gate.mjs) — same function WorkspaceService uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blockUnconfirmedHighImpact } from "../electron/lib/suggestion-gate.mjs";
import {
  SUGGESTIONS_REFRESH_EVENT,
  PENDING_WRITES_CHANGED_EVENT,
  shouldInvalidatePendingWrites,
} from "../src/lib/ai-rail-events.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("high-impact apply without confirmed is blocked (shipped gate)", () => {
  const high = {
    id: "test-inbox",
    kind: "inbox_review",
    title: "Inbox",
    summary: "stale",
    impact: "high",
    targetPath: "00-收件箱/old.md",
    payload: { path: "00-收件箱/old.md", action: "archive" },
  };
  const blocked = blockUnconfirmedHighImpact(high, false);
  assert.ok(blocked);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.needsConfirm, true);
  assert.equal(blocked.pending, true);
  assert.match(String(blocked.note || ""), /confirmed/i);

  const blockedUndef = blockUnconfirmedHighImpact(high, undefined);
  assert.ok(blockedUndef);
  assert.equal(blockedUndef.needsConfirm, true);

  // confirmed:true → proceed (null)
  assert.equal(blockUnconfirmedHighImpact(high, true), null);
});

test("low-impact is not blocked without confirmed", () => {
  const low = {
    id: "open-profile",
    kind: "open_profile",
    title: "profile",
    summary: "open",
    impact: "low",
    targetPath: "memory/profile.md",
  };
  assert.equal(blockUnconfirmedHighImpact(low, false), null);
  assert.equal(blockUnconfirmedHighImpact(low, undefined), null);
});

test("missing suggestion throws", () => {
  assert.throws(() => blockUnconfirmedHighImpact(null, true), /suggestion required/);
});

test("WorkspaceService.applySuggestion uses blockUnconfirmedHighImpact", () => {
  const src = readFileSync(path.join(root, "electron/workspace-service.mjs"), "utf8");
  assert.match(src, /blockUnconfirmedHighImpact/);
  assert.match(src, /from ["'].*suggestion-gate\.mjs["']/);
  // Must not re-inline a weaker gate
  assert.match(src, /const blocked = blockUnconfirmedHighImpact/);
});

test("event constants match AiPanel / Stream / task-store emit-subscribe wiring", () => {
  assert.equal(SUGGESTIONS_REFRESH_EVENT, "suggestions:refresh");
  assert.equal(PENDING_WRITES_CHANGED_EVENT, "pending-writes:changed");

  const aiPanel = readFileSync(path.join(root, "src/components/ai/AiPanel.tsx"), "utf8");
  assert.match(aiPanel, /ActionBar/);
  const actionStore = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  const actionBar = readFileSync(path.join(root, "src/components/ai/ActionBar.tsx"), "utf8");
  assert.match(actionStore, /onLocal\(SUGGESTIONS_REFRESH_EVENT/);
  assert.match(actionStore, /onLocal\(PENDING_WRITES_CHANGED_EVENT/);
  assert.match(actionStore, /confirmed:\s*true/);
  assert.match(actionStore, /emitLocal\(SUGGESTIONS_REFRESH_EVENT/);
  assert.match(actionStore, /emitLocal\(["']workspace:file-changed["']/);

  const stream = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  assert.match(stream, /suggestions:refresh/);

  const taskStore = readFileSync(path.join(root, "src/stores/task-store.ts"), "utf8");
  assert.match(taskStore, /SUGGESTIONS_REFRESH_EVENT/);
  assert.match(taskStore, /emitLocal\(SUGGESTIONS_REFRESH_EVENT/);

  const aiStore = readFileSync(path.join(root, "src/stores/ai-store.ts"), "utf8");
  assert.match(aiStore, /PENDING_WRITES_CHANGED_EVENT/);
  assert.match(aiStore, /emitLocal\(PENDING_WRITES_CHANGED_EVENT/);
});

test("shouldInvalidatePendingWrites drives pending strip refresh decision", () => {
  assert.equal(shouldInvalidatePendingWrites({ needsConfirm: true }), true);
  assert.equal(shouldInvalidatePendingWrites({ pending: true }), true);
  assert.equal(shouldInvalidatePendingWrites({ ok: true, wroteFiles: true }), true);
  assert.equal(shouldInvalidatePendingWrites({ ok: false }), false);
});

test("GeneralPanel sends partial ui deltas (no full ...ui spread on toggles)", () => {
  const src = readFileSync(path.join(root, "src/components/settings/GeneralPanel.tsx"), "utf8");
  assert.doesNotMatch(src, /update\(\{\s*ui:\s*\{\s*\.\.\.ui,\s*aiPanelOpen/);
  assert.doesNotMatch(src, /update\(\{\s*ui:\s*\{\s*\.\.\.ui,\s*locale/);
  assert.doesNotMatch(src, /update\(\{\s*ui:\s*\{\s*\.\.\.ui,\s*fileFilter/);
  assert.doesNotMatch(src, /update\(\{\s*ui:\s*\{\s*\.\.\.ui,\s*sidebarView/);
  assert.match(src, /update\(\{\s*ui:\s*\{\s*aiPanelOpen\s*\}\s*\}/);
  assert.match(src, /update\(\{\s*ui:\s*\{\s*locale\s*\}\s*\}/);
  assert.match(src, /resetLayout[\s\S]*DEFAULT_UI/);
});
