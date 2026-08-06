/**
 * Inline AI busy registry + StatusBar wiring + pre-nav ConfirmDialog guard.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveStatusBarBusy } from "../src/lib/status-bar-busy.ts";
import {
  wouldAbandonInlineAi,
  useInlineAiStore,
  getInlineAiBusySummary,
} from "../src/lib/inline-ai-busy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("inline-only: dedicated chip, AI pill not dual working", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: false,
    inlineBusy: true,
    inlineLabel: "正在润色…",
  });
  assert.equal(v.showInlineChip, true);
  assert.equal(v.aiPillBusy, false, "must not dual-label with AI 工作中");
  assert.equal(v.hasNamedBusyChip, true);
  assert.equal(v.aiLabelMode, "ready");
});

test("streaming wins over inline chip", () => {
  const v = deriveStatusBarBusy({
    ready: true,
    streaming: true,
    activeTaskCount: 0,
    todoMaintaining: false,
    suggestLoading: false,
    inlineBusy: true,
  });
  assert.equal(v.showInlineChip, false);
  assert.equal(v.aiPillBusy, true);
});

test("file-anchor: same file ok; leave file blocks", () => {
  useInlineAiStore.getState().clearAll();
  useInlineAiStore.getState().begin({
    id: "t1",
    kind: "selection",
    label: "润色中",
    anchor: { type: "file", path: "20-专题/a.md" },
    blocksNavigation: true,
  });
  assert.equal(
    wouldAbandonInlineAi(
      { kind: "file", path: "20-专题/a.md" },
      { kind: "file", path: "20-专题/a.md", focusHeading: "x" },
    ),
    false,
  );
  assert.equal(
    wouldAbandonInlineAi(
      { kind: "file", path: "20-专题/a.md" },
      { kind: "stream" },
    ),
    true,
  );
  useInlineAiStore.getState().clearAll();
});

test("stream-anchor: leave stream blocks; stay on stream ok", () => {
  useInlineAiStore.getState().clearAll();
  useInlineAiStore.getState().begin({
    id: "p1",
    kind: "polish",
    label: "正在润色…",
    anchor: { type: "stream" },
    blocksNavigation: true,
  });
  // Opening a file from stream must block BEFORE navigation
  assert.equal(
    wouldAbandonInlineAi({ kind: "stream" }, { kind: "file", path: "10-动态/w.md" }),
    true,
  );
  assert.equal(
    wouldAbandonInlineAi({ kind: "stream" }, { kind: "stream" }),
    false,
  );
  useInlineAiStore.getState().clearAll();
});

test("getInlineAiBusySummary reflects sessions", () => {
  useInlineAiStore.getState().clearAll();
  assert.equal(getInlineAiBusySummary().busy, false);
  useInlineAiStore.getState().begin({
    id: "x",
    kind: "polish",
    label: "正在润色…",
    anchor: { type: "stream" },
    blocksNavigation: true,
  });
  const s = getInlineAiBusySummary();
  assert.equal(s.busy, true);
  assert.equal(s.label, "正在润色…");
  assert.equal(s.blocksNavigation, true);
  useInlineAiStore.getState().clearAll();
});

test("StatusBar wires inline busy chip", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  assert.match(src, /useInlineAiStore/);
  assert.match(src, /busy\.showInlineChip/);
  assert.match(src, /data-status-inline-busy/);
  assert.match(src, /statusBar\.inlineAiWorking/);
});

test("view-store defers nav to pending confirm (never navigate-then-block)", () => {
  const src = read("src/stores/view-store.ts");
  assert.match(src, /wouldAbandonInlineAi/);
  assert.match(src, /requestNavConfirm/);
  assert.match(src, /applySelectForced/);
  assert.doesNotMatch(src, /window\.confirm|confirmLeaveInlineAi/);
});

test("InlineAiLeaveHost uses ConfirmDialog (product chrome)", () => {
  const host = read("src/components/shell/InlineAiLeaveHost.tsx");
  assert.match(host, /ConfirmDialog/);
  assert.match(host, /clearAll/);
  assert.match(host, /applySelectForced|applyHistoryForced/);
  assert.doesNotMatch(host, /window\.confirm/);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /InlineAiLeaveHost/);
});

test("SelectionAiBar registers file anchor + running chrome", () => {
  // Session/anchor logic lives in useSelectionAi; running chrome in SelectionAiBar
  const src =
    read("src/components/editor/useSelectionAi.ts") +
    read("src/components/editor/SelectionAiBar.tsx");
  assert.match(src, /useInlineAiStore/);
  assert.match(src, /type:\s*["']file["']/);
  assert.match(src, /blocksNavigation:\s*true/);
  assert.match(src, /animate-shimmer/);
});

test("Stream polish uses stream anchor (not period path)", () => {
  const src = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(src, /type:\s*["']stream["']/);
  assert.match(src, /useInlineAiStore/);
});

test("Sidebar softRefresh force-rehydrates expanded children", () => {
  const src = read("src/components/shell/Sidebar.tsx");
  assert.match(src, /setChildrenCache\(new Map\(\)\)/);
  assert.match(src, /listDir/);
  assert.match(src, /data-sidebar-refresh/);
});

test("Stream feed uses day cohesion + smart expand helpers", () => {
  const src = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(src, /groupDayFeedRows/);
  assert.match(src, /streamEntryNeedsExpand/);
  assert.match(src, /data-stream-day-body|data-stream-entry-kind/);
  assert.match(src, /data-stream-article-open|openArticle/);
});

test("statusBar inline i18n keys exist zh + en", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/shell.json"));
  const en = JSON.parse(read("src/locales/en-US/shell.json"));
  for (const key of [
    "inlineAiWorking",
    "inlineAiWorkingTip",
    "inlineAiLeaveConfirm",
    "inlineAiLeaveTitle",
    "inlineAiLeaveForce",
    "inlineAiLeaveStay",
  ]) {
    assert.equal(typeof zh.statusBar[key], "string", `zh missing ${key}`);
    assert.equal(typeof en.statusBar[key], "string", `en missing ${key}`);
  }
});
