/**
 * UI structural contracts — guards core visual/interaction invariants.
 *
 * Consolidated from P0/Wave2/Wave3 remediation tests. Asserts shipped source
 * patterns that are stable baseline: chrome hierarchy, single CTA, token ladder,
 * stream vocabulary, suggest demotion, format collapse, settings/overlay chrome,
 * sidebar collapse, shared kit, extension brand sync.
 *
 * The dead-code checker (check:dead-code.mjs) guards negative patterns
 * (no reintroduction of removed components); this file guards positive patterns
 * (required structures still present).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveStatusBarBusy } from "../src/lib/status-bar-busy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

function read(rel, base = root) {
  return readFileSync(path.join(base, rel), "utf8");
}

// ── Chrome hierarchy & single CTA ──────────────────────────────────────

test("TitleBar: AI toggle; sidebar has capture; PrimaryNav on primary header row", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  // Compact fallback only when sidebar is collapsed — not a full view-switcher.
  assert.match(titleBar, /PrimaryNav variant="compact"/);
  assert.match(titleBar, /v4-titlebar-btn-ai/);
  const nav = read("src/components/shell/PrimaryNav.tsx");
  assert.match(nav, /PRIMARY_NAV_OPTIONS/);
  assert.match(nav, /primaryNav\.stream/);
  assert.match(nav, /primaryNav\.inbox/);
  assert.match(nav, /primaryNav\.outputs/);
  assert.match(read("src/components/shell/Sidebar.tsx"), /data-sidebar-primary-nav/);
  assert.doesNotMatch(read("src/components/shell/StatusBar.tsx"), /<PrimaryNav/);
  assert.doesNotMatch(titleBar, /v4-titlebar-btn-capture/);
  assert.doesNotMatch(titleBar, /data-chrome-tier=["']l2["']/);
  assert.doesNotMatch(titleBar, /data-chrome-tier=["']l3["']/);
  assert.match(titleBar, /data-breadcrumb-title/);
  assert.match(titleBar, /data-page-title/);
  assert.match(titleBar, /data-titlebar-actions-slot/);
  assert.match(titleBar, /resolveTitleBarIdentity/);
  const sidebar = read("src/components/shell/Sidebar.tsx");
  const headerFn = sidebar.slice(
    sidebar.indexOf("function SidebarHeaderActions"),
    sidebar.indexOf("function ProfileButton"),
  );
  const profileIdx = headerFn.indexOf("<ProfileButton");
  const searchIdx = headerFn.indexOf("v4-search-trigger");
  const captureIdx = headerFn.indexOf("RiPencilLine");
  assert.ok(profileIdx >= 0 && searchIdx > profileIdx && captureIdx > searchIdx, "header order Profile → Search → 记一下");
  assert.match(headerFn, /titleBar\.capture/);
  assert.match(headerFn, /v4-capture-accent-icon/);
  assert.doesNotMatch(headerFn, /v4-titlebar-btn-capture/);
  assert.match(sidebar, /data-chrome-tier=["']l1["']/);
  const secondary = sidebar.slice(
    sidebar.indexOf("data-sidebar-secondary-header"),
    sidebar.indexOf("data-sidebar-pins"),
  );
  assert.match(secondary, /<ViewSwitcher/);
  assert.match(secondary, /data-sidebar-tree-tools/);
  assert.match(sidebar, /<TreeToolbar/);
  const treeSection = sidebar.slice(sidebar.indexOf("function DataSourceSection"));
  assert.doesNotMatch(treeSection, /<div className="flex items-center gap-0.5 px-1.5 pb-1 pt-0.5">/);
});

test("WorkspaceSwitcher: footer hosts theme + settings; menu hosts language + focus", () => {
  const ws = read("src/components/shell/WorkspaceSwitcher.tsx");
  // Footer peer controls — not buried in the menu.
  assert.match(ws, /data-workspace-switcher-row/);
  assert.match(ws, /data-workspace-theme/);
  assert.match(ws, /data-workspace-settings/);
  assert.match(ws, /themeCycleTip/);
  assert.match(ws, /settingsTip/);
  assert.match(ws, /pickTheme/);
  assert.match(ws, /pickLocale/);
  assert.match(ws, /focusMode/);
  assert.match(ws, /preferPlacement="top"/);
  assert.match(ws, /data-workspace-name/);
  assert.match(ws, /copyWorkspacePath/);
  assert.match(ws, /padBottom=\{32\}/);
  // Theme cluster no longer lives inside the popup.
  assert.doesNotMatch(ws, /preferencesSection/);
});

test("List views demote capture to outline (no competing solid CTA)", () => {
  for (const rel of [
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/OutputsView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
  ]) {
    const src = read(rel);
    const tags = [...src.matchAll(/<Button[^>]*openOverlay\(["']quick-capture["']\)[^>]*>/g)];
    for (const m of tags) {
      assert.match(m[0], /variant=["'](outline|ghost)["']/, `${rel}: ${m[0]}`);
    }
  }
});

test("collection canvases do not keep a PageHeader title+actions strip", () => {
  const views = [
    "src/plugins/topmind-workspace/views/StreamDetailView.tsx",
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/OutputsView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
    "src/plugins/topmind-workspace/views/CategoryView.tsx",
    "src/plugins/topmind-workspace/views/MemoryBrowseView.tsx",
    "src/plugins/topmind-workspace/views/ArchiveView.tsx",
  ];
  for (const rel of views) {
    const src = read(rel);
    assert.doesNotMatch(src, /<PageHeader/, `${rel} still mounts PageHeader`);
    assert.doesNotMatch(src, /v4-titlebar-btn-capture/, `${rel} capture solid`);
    assert.match(src, /useTitleBarChrome/, `${rel} must register TitleBar identity`);
  }
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /TitleBarActions/);
  assert.match(read("src/plugins/topmind-workspace/views/InboxView.tsx"), /data-inbox-refresh/);
  assert.match(read("src/plugins/topmind-workspace/views/InboxView.tsx"), /data-inbox-new-note/);
  assert.match(read("src/plugins/topmind-workspace/views/ArchiveView.tsx"), /data-archive-refresh/);
  assert.doesNotMatch(stream, /id:\s*["']ai-todos["']/);
  assert.doesNotMatch(stream, /handleMaintainTodos/);
  const body = read("src/components/todo/TodoListBody.tsx");
  assert.match(body, /data-todo-pane-chrome/);
  assert.match(body, /data-todo-maintain/);
});

test("No purple/indigo marketing colors in UI or extension", () => {
  const onboarding = read("src/components/shell/OnboardingScreen.tsx");
  assert.doesNotMatch(onboarding, /#6366f1|#8b5cf6|#7c3aed|indigo|purple/i);
  const css = read("browser-extension/popup.css", repoRoot);
  assert.doesNotMatch(css, /#6366f1|#8b5cf6|#7c3aed/i);
});

// ── Token ladder ───────────────────────────────────────────────────────

test("z-index is semantic tokens; no Tailwind numeric z-10 or dead glow tokens", () => {
  const tokens = read("src/styles/tokens.css");
  assert.match(tokens, /--z-local:\s*1/);
  assert.match(tokens, /--z-menu:\s*110/);
  assert.match(tokens, /--z-popover-overlay:\s*120/);
  assert.match(tokens, /--z-dialog:\s*130/);
  assert.doesNotMatch(tokens, /--color-status-\w+-glow/);
  for (const rel of [
    "src/components/ui/menu-select.tsx",
    "src/components/todo/TodoListBody.tsx",
    "src/components/ai/SuggestPopover.tsx",
    "src/components/todo/TodoPopover.tsx",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /\bz-(?:10|20|30|40|50)\b/, `${rel} numeric z-class`);
    assert.doesNotMatch(src, /z-\[\d+\]/, `${rel} hardcoded z-[N]`);
  }
  const menu = read("src/components/ui/menu-select.tsx");
  const todoBody = read("src/components/todo/TodoListBody.tsx");
  assert.match(menu, /z-local/);
  assert.match(todoBody, /z-local/);
});

test("Light tokens: surface != elevated; hairline and shadows defined", () => {
  const tokens = read("src/styles/tokens.css");
  const light = tokens.split(/\.dark\s*\{/)[0];
  const surface = light.match(/--color-surface:\s*([^;]+);/)?.[1]?.trim();
  const elevated = light.match(/--color-surface-elevated:\s*([^;]+);/)?.[1]?.trim();
  assert.ok(surface && elevated);
  assert.notEqual(surface.toLowerCase(), elevated.toLowerCase());
  // DS 3.0 "ZCode Neutral": pure-neutral hairline = black alpha 6%
  assert.match(light, /--color-border-subtle-dim:\s*rgba\(23,\s*23,\s*23,\s*0\.0[5-9]/);
  // Monochrome ink primary CTA + sky accent (no legacy ink-blue brand)
  assert.match(light, /--color-ink:\s*#1a1a1a/);
  // Accent = sky-700 since 2026-09-14. It was sky-600 (#0284c7), which measures
  // 4.10:1 on white and 3.59:1 on chrome — under AA for the link / small-text
  // role this stop carries. Baseline table: DESIGN.md §5.0.1.
  assert.match(light, /--color-accent-color:\s*#0369a1/);
  // Badge axis is its own sky stop and must not collapse into accent (accent
  // flips hue in inbox mode).
  assert.match(light, /--color-badge:\s*#0369a1/);
  assert.match(light, /--color-badge-foreground:\s*#ffffff/);
  assert.doesNotMatch(light, /#31548e|#5a7fb8|#7f9fd4/);
  assert.match(light, /--shadow-card:/);
  assert.match(light, /--shadow-elevated-hairline:/);
  assert.match(light, /--shadow-float:/);
});

// ── Stream vocabulary & compose ────────────────────────────────────────

test("Stream compose uses composeSubmit; placeholder avoids L1 vocabulary", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-compose-submit/);
  assert.match(stream, /streamDetail\.composeSubmit/);
  assert.doesNotMatch(stream, /v4-titlebar-btn-capture/);
  assert.doesNotMatch(stream, /titleBar\.capture/);

  const zh = JSON.parse(read("src/locales/zh-CN/workspace.json"));
  const en = JSON.parse(read("src/locales/en-US/workspace.json"));
  assert.notEqual(zh.streamDetail.composePlaceholder, "\u8bb0\u4e00\u4e0b");
  assert.notEqual(en.streamDetail.composePlaceholder, "Note it");
  assert.equal(zh.streamDetail.composeSubmit, "\u8bb0\u4e0b");
  assert.doesNotMatch(zh.streamDetail.composeFullCapture, /记一下/);
  assert.doesNotMatch(en.streamDetail.composeFullCapture, /Note it/);
});

// ── Suggest / Todo / AI calm ───────────────────────────────────────────

test("ActionBar is deleted; format toolbar defaults expanded; focus 建议 is SuggestPopover", () => {
  const editor = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(editor, /const \[showFormat,\s*setShowFormat\]\s*=\s*useState\(\s*true\s*\)/);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /focusMode \? <SuggestPopover/);
  assert.doesNotMatch(read("src/components/ai/AiPanel.tsx"), /ActionBar/);
});

test("StatusBar: single-path named chip (tasks > todo > suggest)", () => {
  const multi = deriveStatusBarBusy({
    ready: true, streaming: false, activeTaskCount: 1, todoMaintaining: true, suggestLoading: true,
  });
  assert.equal(multi.showTaskChip, true);
  assert.equal(multi.showTodoChip, false);
  assert.equal(multi.showSuggestChip, false);

  const todoOnly = deriveStatusBarBusy({
    ready: true, streaming: false, activeTaskCount: 0, todoMaintaining: true, suggestLoading: true,
  });
  assert.equal(todoOnly.showTodoChip, true);
  assert.equal(todoOnly.showSuggestChip, false);
});

// ── Settings / overlays / sidebar ──────────────────────────────────────

test("OverlayHost is a body-portaled modal; stream sticky chrome has no blur", () => {
  const host = read("src/components/shell/OverlayHost.tsx");
  assert.match(host, /createPortal/);
  assert.match(host, /z-modal/);
  assert.match(host, /acquireOverlayLayer/);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /id="workbench-root"/);
  const gridOpen = shell.indexOf('id="workbench-root"');
  const overlayIdx = shell.indexOf("<OverlayHost");
  assert.ok(gridOpen >= 0 && overlayIdx > gridOpen);
  const workbench = shell.slice(gridOpen, overlayIdx);
  assert.match(workbench, /TitleBar/);
  assert.match(workbench, /FileDropZone/);
  assert.doesNotMatch(workbench, /<OverlayHost/);
  const css = read("src/styles/v4.css");
  const marker = "[data-stream-feed][data-layout=\"list\"] [data-stream-day-toggle]";
  const start = css.indexOf(marker);
  assert.ok(start >= 0, "list day-toggle rule missing");
  const block = css.slice(start, css.indexOf("}", start) + 1);
  assert.doesNotMatch(block, /backdrop-filter\s*:/);
  assert.match(block, /--color-background/);
  assert.match(css, /html\[data-overlay-open\] \[data-stream-feed\] \[data-stream-day-toggle\]/);
  assert.match(css, /isolation:\s*isolate/);
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.doesNotMatch(stream, /sticky top-0/);
  const layer = read("src/lib/overlay-layer.ts");
  assert.match(layer, /OVERLAY_OPEN_ATTR/);
  assert.match(layer, /OverlayPortalContext/);
  assert.match(layer, /acquireOverlayLayer/);
  const dialog = read("src/components/ui/Dialog.tsx");
  assert.match(dialog, /createPortal/);
  assert.match(dialog, /z-dialog/);
  const tokens = read("src/styles/tokens.css");
  assert.match(tokens, /--z-dialog:\s*130/);
});

test("Settings + overlays use v4 elevated shell; sidebar carries no plugin section", () => {
  const settings = read("src/components/overlays/SettingsDialog.tsx") + read("src/components/overlays/SettingsLayout.tsx");
  assert.match(settings, /data-settings-dialog|v4-settings-dialog/);
  assert.match(settings, /surface-elevated|bg-surface-elevated/);
  assert.match(settings, /variant=["']ghost["']/);

  // 左栏回归纯内容导航 — 插件入口在 AI 工作区 应用 pane。
  // 2026-09 v4: Sidebar header Profile → Search → 记一下; TitleBar has view-switcher
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.doesNotMatch(sidebar, /data-sidebar-plugins-section/);
  assert.doesNotMatch(sidebar, /sidebarSlots/);
  assert.match(sidebar, /SidebarHeaderActions/);
  assert.match(sidebar, /data-sidebar-secondary-header/);
  assert.match(sidebar, /data-sidebar-tree-tools/);
  assert.doesNotMatch(sidebar, /data-sidebar-view-switcher/);

  const aiWs = read("src/components/ai/AiWorkspace.tsx");
  assert.match(aiWs, /data-ai-workspace-tab=\{item\.id\}/);
  assert.match(aiWs, /id: "apps"/);
  assert.match(aiWs, /AppsLaunchList/);
  const appsList = read("src/components/shell/AppsLaunchList.tsx");
  assert.match(appsList, /listLaunchablePlugins/);
  assert.doesNotMatch(appsList, /topmind-ledger|topmind-weread|topmind-x|topmind-ingest/);
  const appsLib = read("src/lib/apps-menu.ts");
  assert.match(appsLib, /resolveLaunchableOpenTarget/);
  assert.match(appsLib, /PLUGIN_APP_KIND/);
  assert.match(appsLib, /pluginReadiness/);
  assert.match(appsList, /api\.sys\.settings\(\)/);
  assert.match(appsList, /plugins:settings-changed/);
});

test("Stream and collection canvases expose list/card layout switch + data-layout", () => {
  const feedViews = [
    "src/plugins/topmind-workspace/views/StreamDetailView.tsx",
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/CategoryView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
    "src/plugins/topmind-workspace/views/OutputsView.tsx",
    "src/plugins/topmind-workspace/views/MemoryBrowseView.tsx",
  ];
  for (const rel of feedViews) {
    const src = read(rel);
    assert.ok(src.includes("FeedLayoutToggle"), `${rel} missing FeedLayoutToggle`);
  }
  const collections = [
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/CategoryView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
    "src/plugins/topmind-workspace/views/OutputsView.tsx",
  ];
  for (const rel of collections) {
    const src = read(rel);
    assert.ok(src.includes("CollectionFeed"), `${rel} missing CollectionFeed`);
  }
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.ok(stream.includes("data-stream-feed"));
  assert.ok(stream.includes("data-layout={feedLayout}"));
  assert.ok(stream.includes("data-stream-column") || stream.includes("FeedColumn"));
  assert.ok(stream.includes("data-stream-inline-composer"));
  assert.doesNotMatch(stream, /<PageHeader/);
  assert.ok(
    !stream.includes("<FeedLayoutToggle") || stream.indexOf("<FeedLayoutToggle") > stream.indexOf("data-stream-inline-composer"),
    "layout toggle must not live in page-title actions",
  );
  const composerIdx = stream.indexOf("data-stream-inline-composer");
  const toggleIdx = stream.indexOf("<FeedLayoutToggle");
  const feedIdx = stream.indexOf("data-stream-feed");
  assert.ok(composerIdx > 0 && toggleIdx > composerIdx && feedIdx > toggleIdx);
  assert.ok(stream.includes("data-stream-open-memory"));
  assert.ok(stream.includes('kind: "memory"'));
  const tokens = read("src/styles/tokens.css");
  assert.match(tokens, /--feed-column-max:/);
  const css = read("src/styles/v4.css");
  assert.match(css, /\.v4-feed-column/);
  assert.match(css, /--feed-column-max/);
  const memory = read("src/plugins/topmind-workspace/views/MemoryBrowseView.tsx");
  assert.ok(memory.includes("data-memory-feed"));
  assert.ok(memory.includes("data-layout={feedLayout}"));
  const kit = read("src/components/ui/view.tsx");
  assert.ok(kit.includes("data-feed-layout-toggle"));
  assert.ok(kit.includes("data-layout-option"));
  assert.ok(kit.includes("data-collection-feed"));
  assert.ok(kit.includes('data-layout={layout}'));
  const persist = read("src/components/shell/useShellSettingsSync.ts");
  assert.ok(persist.includes("feedLayout"));
  assert.ok(!persist.includes("topmind:feed-layout"));
  const types = read("src/types.ts");
  assert.ok(types.includes("feedLayout?:"));
  const core = read("electron/lib/settings-core.mjs");
  assert.match(core, /feedLayout:\s*"list"/);
  const persistShell = read("src/components/shell/useShellSettingsSync.ts");
  assert.match(persistShell, /feedLayout:\s*s\.feedLayout/);
  assert.match(persistShell, /api\.sys[\s\S]{0,80}update\(\{\s*ui:/);
  for (const rel of collections) {
    const src = read(rel);
    assert.ok(src.includes("FeedChrome") || src.includes("data-feed-chrome"), `${rel} toggle not above feed`);
  }
});

test("FilterChip is chip-weight; EmptyState one-primary-CTA; CaptureModeBar chip language", () => {
  const view = read("src/components/ui/view.tsx");
  assert.match(view, /data-filter-chip/);
  assert.match(view, /h-\[var\(--control-h-chip\)\]/);
  assert.match(view, /export function EmptyState/);

  const bar = read("src/components/overlays/CaptureModeBar.tsx");
  assert.match(bar, /data-capture-mode-bar|data-filter-chip/);
});

// ── Extension brand sync ───────────────────────────────────────────────

test("Browser extension popup CSS mirrors Design System brand + capture CTA", () => {
  const css = read("browser-extension/popup.css", repoRoot);
  // DS 3.0 "ZCode Neutral" mirror: pure neutrals + sky accent + teal capture
  assert.match(css, /--mh-capture:\s*#12897b/i);
  assert.match(css, /--mh-elevated:\s*#ffffff/i);
  assert.match(css, /--mh-bg:\s*#f7f7f7/i);
  assert.match(css, /--mh-accent:\s*#0284c7/i);
  assert.match(css, /--mh-brand-deep:\s*#075985/i);
  assert.match(css, /--mh-brand-mid:\s*#0ea5e9/i);
  assert.match(css, /--mh-bg:\s*#171717/i);
  assert.doesNotMatch(css, /#31548e|#5a7fb8|#f7f6f4|#efeeeb/i);
  const html = read("browser-extension/popup.html", repoRoot);
  assert.match(html, /btn-capture|data-capture-cta/);
});

// ── DESIGN.md documents key patterns ───────────────────────────────────

test("StatusBar shows full workspace path, not a basename", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  const marker = "data-status-workspace-path";
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, "missing data-status-workspace-path");
  const slice = src.slice(Math.max(0, idx - 280), idx + 180);
  assert.match(slice, /health\.workspaceRoot/);
  assert.doesNotMatch(slice, /\.split\(["'`]\/["'`]/);
  assert.match(src, /statusBar\.enginePath/);
});

test("DESIGN.md documents core UI patterns", () => {
  const design = read("DESIGN.md");
  assert.match(design, /shadow-card|surface-elevated/);
  assert.match(design, /状态栏(?:建议)?计数 chip/);
  assert.doesNotMatch(design, /有 `items` 时画布顶 `SuggestEntryStrip`/);
  assert.doesNotMatch(design, /AI 轨 `ActionBar` 仅为计数跳转/);
  assert.match(design, /showFormat|data-chrome-tier|TitleBar/);
  assert.match(design, /deriveStatusBarBusy/);
  assert.match(design, /FilterChip|data-filter-chip/);
  assert.match(design, /0\.0\.4 能力单家/);
  assert.match(design, /ReasoningBlock/);
  assert.match(design, /默认折叠/);
  assert.match(design, /showFormat=true|默认展开/);
  assert.doesNotMatch(design, /showFormat=false/);
  assert.doesNotMatch(design, /格式工具条 \*\*默认折叠\*\*/);
  assert.doesNotMatch(design, /预览 = Tiptap readOnly/);
  assert.match(design, /静态 HTML/);
  assert.match(design, /feedLayout|列表 \/ 卡片|卡片式/);
  assert.match(design, /单列/);
  assert.match(design, /masonry|Pinterest|瀑布/);
  assert.match(design, /记忆浏览/);
  assert.match(design, /feed-column|--feed-column-max|信息流正文上方/);
  assert.doesNotMatch(design, /页头切换/);
  assert.match(design, /runActivityOps|memory_organize/);
  assert.match(design, /workbench-root|inert/);
  assert.match(design, /backdrop-filter/);
  assert.match(design, /document\.body/);
});

test("ReasoningBlock defaults collapsed; stream status labels exist", () => {
  const chat = read("src/components/ai/ChatMessage.tsx");
  const block = chat.slice(chat.indexOf("function ReasoningBlock"), chat.indexOf("export function ChatMessage"));
  assert.match(block, /useState\(false\)/);
  assert.match(block, /data-open=\{open\}/);
  assert.doesNotMatch(block, /useState\(true\)/);
  const stream = read("src/lib/stream-status.ts");
  for (const key of ["preparing", "thinking", "calling-tool", "writing"]) {
    assert.match(stream, new RegExp(`"${key}"`));
  }
  const leave = read("src/components/shell/InlineAiLeaveHost.tsx");
  assert.match(leave, /inlineAiLeaveConfirm/);
});

test("inline AI auto-open is gated by persisted flag; preview default is not a 160px clip", async () => {
  const {
    shouldAutoOpenInlineAi,
    INLINE_AI_PREVIEW_DEFAULT_MAX_H,
    INLINE_AI_PANEL_WIDTH,
    INLINE_AI_CHROME_MIN_TOP,
    clampSelectionAiPanel,
    estimatePreviewRows,
  } = await import("../src/lib/inline-ai-panel.ts");
  assert.equal(shouldAutoOpenInlineAi(false), false);
  assert.equal(shouldAutoOpenInlineAi(true), true);
  assert.equal(shouldAutoOpenInlineAi(false, { pinned: true }), true);
  assert.equal(shouldAutoOpenInlineAi(false, { phase: "running" }), true);
  assert.equal(shouldAutoOpenInlineAi(false, { phase: "preview" }), true);
  assert.ok(
    INLINE_AI_PREVIEW_DEFAULT_MAX_H >= 280,
    `preview default ${INLINE_AI_PREVIEW_DEFAULT_MAX_H} must not silently clip at 160`,
  );
  // Capabilities breathe horizontally — not a cramped 22rem bubble.
  assert.ok(INLINE_AI_PANEL_WIDTH >= 32 * 16, `panel width ${INLINE_AI_PANEL_WIDTH} too narrow`);
  assert.ok(INLINE_AI_CHROME_MIN_TOP >= 48, "chrome floor must clear title/toolbar");
  const hook = read("src/components/editor/useSelectionAi.ts");
  assert.match(hook, /shouldAutoOpenInlineAi/);
  assert.match(hook, /INLINE_AI_PREVIEW_DEFAULT_MAX_H/);
  assert.match(hook, /applyEditorPrefs\(\{ inlineAiAutoPopup/);
  const bar = read("src/components/editor/SelectionAiBar.tsx");
  assert.match(bar, /clampSelectionAiPanel/);
  assert.match(bar, /INLINE_AI_PANEL_WIDTH/);
  const diff = read("src/components/editor/SelectionAiDiff.tsx");
  assert.match(diff, /data-inline-ai-preview/);
  assert.match(diff, /estimatePreviewRows/);
  const long = "line\n".repeat(40);
  assert.ok(estimatePreviewRows(long) >= 20);
  // Upper-half selection must flip below chrome, never cover the toolbar.
  const upper = clampSelectionAiPanel({
    dragPos: null,
    target: { top: 70, left: 40, bottom: 90 },
    panelW: 576,
    panelH: 240,
    viewportW: 1200,
    viewportH: 800,
  });
  assert.ok(upper.top >= INLINE_AI_CHROME_MIN_TOP, `top ${upper.top} under chrome`);
  const pos = clampSelectionAiPanel({
    dragPos: null,
    target: { top: 80, left: 40, bottom: 100 },
    panelW: 400,
    panelH: 200,
    viewportW: 800,
    viewportH: 600,
  });
  assert.ok(pos.top >= INLINE_AI_CHROME_MIN_TOP);
  assert.ok(pos.left >= 8);
  assert.ok(pos.left + 400 <= 800);
});

test("Dialog sizing: prompts are wide + upper; filename prompts never override narrower", () => {
  const dialog = read("src/components/ui/Dialog.tsx");
  // Panel ladder: confirm/error at max-w-lg, prompts at max-w-xl (wider than
  // the field needs, so the target is comfortable and long paths stay readable).
  assert.match(dialog, /v4-overlay-sheet w-full max-w-lg p-5/);
  assert.match(dialog, /panelClassName=\{maxWidth \?\? "max-w-xl"\}/);
  // Prompts sit in the top third (native rename/save sheet position) and use
  // the shared Input so the field matches every other text field in the app.
  assert.match(dialog, /placement="upper"/);
  assert.match(dialog, /import \{ Input \} from "\.\/Input"/);
  assert.match(dialog, /<Input\n\s+id=\{inputId\}/);
  // Filename callers must not shrink the prompt below the shared default.
  for (const rel of [
    "src/components/sidebar/TreeView.tsx",
    "src/components/ui/workspace-file-menu.tsx",
    "src/plugins/topmind-workspace/views/CategoryView.tsx",
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
  ]) {
    const src = read(rel);
    const prompts = src.match(/<PromptDialog[\s\S]*?\/>/gu) ?? [];
    assert.ok(prompts.length > 0, `${rel} should open a PromptDialog`);
    for (const p of prompts) {
      assert.doesNotMatch(p, /maxWidth=/, `${rel} must not override the prompt width`);
    }
  }
});
