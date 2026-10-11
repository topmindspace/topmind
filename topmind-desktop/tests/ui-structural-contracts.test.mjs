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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveStatusBarBusy } from "../src/lib/status-bar-busy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

function read(rel, base = root) {
  return readFileSync(path.join(base, rel), "utf8");
}

// ── Chrome hierarchy & single CTA ──────────────────────────────────────

test("ActivityBar owns key nav; TitleBar keeps AI toggle (no destination fallback)", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  // Destinations are ActivityBar-only — no compact destination row on the title bar.
  assert.doesNotMatch(titleBar, /<PrimaryNav|from ["'][^"']*PrimaryNav["']/);
  assert.doesNotMatch(titleBar, /data-go-workspace-home/);
  assert.match(titleBar, /v4-titlebar-btn-ai/);
  // Destination component retired 2026-09-28 — file must not come back.
  assert.equal(existsSync(path.join(root, "src/components/shell/PrimaryNav.tsx")), false);
  assert.doesNotMatch(read("src/components/shell/StatusBar.tsx"), /<PrimaryNav/);
  assert.doesNotMatch(titleBar, /v4-titlebar-btn-capture/);
  assert.doesNotMatch(titleBar, /data-chrome-tier=["']l2["']/);
  assert.doesNotMatch(titleBar, /data-chrome-tier=["']l3["']/);
  assert.match(titleBar, /data-breadcrumb-title/);
  assert.match(titleBar, /data-page-title/);
  assert.match(titleBar, /data-titlebar-actions-slot/);
  assert.match(titleBar, /resolveTitleBarIdentity/);

  // ActivityBar is the key-nav rail: three groups (views / apps menu / chrome).
  // home ≡ stream — one icon; search lives on the Sidebar header.
  const activityBar = read("src/components/shell/ActivityBar.tsx");
  assert.match(activityBar, /data-activity-bar/);
  // No brand logo — top band is a traffic-light reserve only.
  assert.doesNotMatch(activityBar, /data-activity-logo/);
  assert.doesNotMatch(activityBar, /favicon\.svg/);
  assert.match(activityBar, /data-activity-traffic-reserve/);
  assert.match(activityBar, /data-activity-group="views"/);
  assert.match(activityBar, /data-activity-group="apps"/);
  assert.match(activityBar, /data-activity-group="chrome"/);
  assert.match(activityBar, /RiHome4Line/); // home ≡ stream
  assert.match(activityBar, /RiInbox2Line/);
  assert.match(activityBar, /RiShareForwardLine/);
  assert.match(activityBar, /RiUserLine/);
  assert.match(activityBar, /RiPencilLine/); // capture
  assert.match(activityBar, /RiApps2Line/); // apps menu
  assert.match(activityBar, /openLaunchablePlugin/); // launches apps directly
  assert.match(activityBar, /RiFocus3Line/); // focus
  assert.match(activityBar, /RiSettingsLine/); // settings
  assert.doesNotMatch(activityBar, /RiSearchLine/); // search is on sidebar header
  assert.doesNotMatch(activityBar, /RiNewspaperLine/); // single home icon
  // Shell mounts it as the leftmost column.
  assert.match(read("src/components/shell/Shell.tsx"), /ActivityBar/);
  assert.match(read("src/components/shell/Shell.tsx"), /data-activity-bar-column/);

  // Sidebar header: workspace name + search only.
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-ws-name/);
  assert.match(sidebar, /data-sidebar-search/);
  assert.doesNotMatch(sidebar, /data-sidebar-primary-nav/);
  assert.doesNotMatch(sidebar, /data-sidebar-capture/);
  assert.match(sidebar, /data-sidebar-secondary-header/);
  // View tools still live on the secondary header.
  const secondary = sidebar.slice(
    sidebar.indexOf("data-sidebar-secondary-header"),
    sidebar.indexOf("data-sidebar-pins"),
  );
  assert.match(secondary, /<ViewSwitcher/);
  assert.match(secondary, /data-sidebar-tree-tools/);
  assert.match(sidebar, /<TreeToolbar/);
});

test("WorkspaceSwitcher: top-header identity; theme/settings on ActivityBar; menu hosts language + focus", () => {
  const ws = read("src/components/shell/WorkspaceSwitcher.tsx");
  // Identity row lives on the sidebar top header (data-sidebar-workspace portal).
  assert.match(ws, /data-workspace-switcher-row/);
  assert.match(ws, /data-workspace-name/);
  assert.match(ws, /copyWorkspacePath/);
  // Theme / settings moved to ActivityBar — not duplicated beside the name.
  assert.doesNotMatch(ws, /data-workspace-theme/);
  assert.doesNotMatch(ws, /data-workspace-settings/);
  assert.match(ws, /pickLocale/);
  assert.match(ws, /focusMode/);
  assert.match(ws, /preferPlacement="bottom"/);
  // Theme cluster no longer lives inside the popup.
  assert.doesNotMatch(ws, /preferencesSection/);
  // Sidebar: workspace portal on the header; no footer bar.
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-workspace/);
  assert.doesNotMatch(sidebar, /border-t border-border-subtle-dim px-1\.5 py-1\.5/);
  // ActivityBar owns theme + settings (theme opens the horizontal chip menu).
  const activity = read("src/components/shell/ActivityBar.tsx");
  assert.match(activity, /RiSettingsLine/);
  assert.match(activity, /ThemeMenuButton/);
  const themeMenu = read("src/components/shell/ThemeMenuButton.tsx");
  assert.match(themeMenu, /setThemePreference/);
  assert.match(themeMenu, /setThemeTonePreference/);
  assert.match(themeMenu, /setThemeSeedPreference/);
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

test("menu, sheet, dialog, toast, and run card are not one elevated color", () => {
  const tokens = read("src/styles/tokens.css");
  const css = read("src/styles/v4.css");
  const shell = read("src/components/shell/Shell.tsx");
  const card = read("src/components/ai/ChatMessage.tsx");
  const dialog = read("src/components/ui/Dialog.tsx");
  assert.match(tokens, /--color-surface-container-high:\s*(?:var\(--color-surface-elevated\)|color-mix)/);
  assert.match(tokens, /--color-surface-container-highest:\s*color-mix/);
  // Ladder must climb toward white / elevated-hover — never invert dark.
  assert.doesNotMatch(tokens, /--color-surface-container-highest:\s*color-mix\(in srgb,\s*var\(--color-surface-elevated\)[^)]*var\(--color-(?:background|text-primary)\)/);
  assert.match(tokens, /--color-dialog-bg:\s*color-mix/);
  assert.doesNotMatch(tokens, /--color-dialog-bg:\s*var\(--color-surface-elevated\)/);
  assert.match(css, /\.v4-menu-surface[\s\S]*?background:\s*var\(--color-surface-container-high\)/);
  assert.match(css, /\.v4-overlay-sheet[\s\S]*?background:\s*var\(--color-surface-container-highest\)/);
  assert.match(css, /\.v4-dialog-surface[\s\S]*?background:\s*var\(--color-dialog-bg\)/);
  assert.match(css, /\.v4-menu-item:hover[\s\S]*?background:\s*var\(--color-state-hover\)/);
  assert.doesNotMatch(css, /\.v4-menu-item:hover[\s\S]{0,120}surface-muted/);
  assert.match(shell, /bg-inverse-surface/);
  assert.match(card, /bg-surface-container[\s\S]{0,180}data-goal-ledger/);
  assert.match(dialog, /v4-dialog-surface/);
  const design = read("DESIGN.md");
  assert.doesNotMatch(design, /surface-elevated（弹层 \/ 菜单 \/ 对话框）/);
  assert.match(design, /surface-container-high（菜单）/);
  assert.match(design, /dialog-bg（对话框/);
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
  // 2026-09 ActivityBar: destinations / capture / search / settings on the rail;
  // sidebar keeps only view tools (secondary header).
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.doesNotMatch(sidebar, /data-sidebar-plugins-section/);
  assert.doesNotMatch(sidebar, /sidebarSlots/);
  assert.doesNotMatch(sidebar, /SidebarHeaderActions/);
  assert.match(sidebar, /data-sidebar-secondary-header/);
  assert.match(sidebar, /data-sidebar-tree-tools/);
  assert.doesNotMatch(sidebar, /data-sidebar-view-switcher/);
  assert.match(read("src/components/shell/ActivityBar.tsx"), /data-activity-bar/);

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
  assert.ok(composerIdx > 0 && toggleIdx > 0 && feedIdx > 0);
  // Render order in the main return is composer → layout toggle → feed body.
  // (Helper components like StreamFeedBody may sit above StreamDetailView.)
  const retSlice = stream.slice(stream.indexOf("export function StreamDetailView"));
  assert.ok(
    retSlice.indexOf("data-stream-inline-composer") < retSlice.indexOf("<FeedLayoutToggle"),
    "layout toggle must not live in page-title actions",
  );
  assert.ok(retSlice.includes("StreamFeedBody"));
  assert.ok(
    retSlice.indexOf("<FeedLayoutToggle") < retSlice.indexOf("<StreamFeedBody"),
    "feed body must render after the layout toggle",
  );
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
  // FilterChip is a thin Chip wrapper — geometry lives in Chip, not a second
  // hand-rolled `inline-flex h-* rounded-[var(--radius-xs)]` cluster.
  assert.match(view, /export function FilterChip/);
  assert.match(view, /from ["']\.\/Chip["']/);
  assert.match(view, /tone=\{active \? "accent" : "neutral"\}/);
  assert.match(view, /export function EmptyState/);

  const chip = read("src/components/ui/Chip.tsx");
  assert.match(chip, /h-\[var\(--control-h-chip/);
  assert.match(chip, /rounded-\[var\(--radius-xs\)\]/);

  const bar = read("src/components/overlays/CaptureModeBar.tsx");
  assert.match(bar, /data-capture-mode-bar|data-filter-chip/);
  assert.match(bar, /from ["']\.\.\/ui\/Chip["']/);
});

// ── Extension brand sync ───────────────────────────────────────────────

test("Browser extension popup CSS mirrors Design System brand + capture CTA", () => {
  const css = read("browser-extension/popup.css", repoRoot);
  // DS 4.0 "ZCode Neutral + MD3-informed" mirror
  assert.match(css, /--mh-capture:\s*#115e59/i);
  assert.match(css, /--mh-elevated:\s*#ffffff/i);
  assert.match(css, /--mh-bg:\s*#f4f4f4/i);
  assert.match(css, /--mh-accent:\s*#0369a1/i);
  assert.match(css, /--mh-brand-deep:\s*#075985/i);
  assert.match(css, /--mh-brand-mid:\s*#0ea5e9/i);
  assert.match(css, /--mh-bg:\s*#161616/i);
  assert.doesNotMatch(css, /#31548e|#5a7fb8|#f7f6f4|#efeeeb|#0284c7|#12897b/i);
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
  assert.match(dialog, /v4-overlay-sheet v4-dialog-surface w-full max-w-lg p-5/);
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

// ── Cross-surface icon contract (DESIGN §0.0.2) ─────────────────────────

test("icon contract: forbidden glyphs never appear; chat is RiChatAiLine / bot", () => {
  // Desktop: robot glyph is forbidden for conversation identity.
  const chatMessage = read("src/components/ai/ChatMessage.tsx");
  assert.doesNotMatch(chatMessage, /RiRobot2Line/, "chat avatar must not use robot glyph");
  assert.match(chatMessage, /RiChatAiLine/);
  // Stop is an interrupt, not a destructive action.
  const chatInput = read("src/components/ai/ChatInput.tsx");
  assert.doesNotMatch(chatInput, /variant="destructive"[\s\S]{0,80}cancelStream/, "stop must not be destructive");

  // Obsidian: message-circle is forbidden for chat; pencil is capture-only.
  function resolveObsidian() {
    const cands = [
      path.resolve(repoRoot, "..", "topmind-obsidian"),
      path.resolve(repoRoot, "topmind-obsidian"),
      path.resolve(repoRoot, "obsidian-plugin"),
    ];
    for (const c of cands) {
      try {
        readFileSync(path.join(c, "src", "views", "sidebar-dock-view.ts"));
        return c;
      } catch {
        /* try next */
      }
    }
    return null;
  }
  const obs = resolveObsidian();
  if (obs) {
    const dock = readFileSync(path.join(obs, "src", "views", "sidebar-dock-view.ts"), "utf8");
    assert.doesNotMatch(dock, /setIcon\([^,]+,\s*"message-circle"\)/, "chat empty state must use bot");
    assert.match(dock, /setIcon\([^,]+,\s*"bot"\)/);
    // Edit/open-in-editor must not reuse capture pencil.
    const stream = readFileSync(path.join(obs, "src", "views", "stream-workbench-view.ts"), "utf8");
    assert.match(stream, /setIcon\(editBtn,\s*"square-pen"\)/);
    assert.doesNotMatch(stream, /setIcon\(editBtn,\s*"pencil"\)/);
    // Dock order: chat first (agent spine).
    assert.match(dock, /\{\s*id:\s*"chat"[\s\S]{0,80}id:\s*"suggestions"/);
  }
});

test("selected controls use the neutral wash and have no side or bottom accent bar", () => {
  const css = read("src/styles/v4.css");
  const tokens = read("src/styles/tokens.css");
  const design = read("DESIGN.md");
  const view = read("src/components/ui/view.tsx");
  const outline = read("src/components/editor/EditorOutlinePanel.tsx");
  const activity = read("src/components/shell/ActivityBar.tsx");
  const chat = read("src/components/ai/ChatMessage.tsx");
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  const recent = read("src/components/shell/EditorRecentBar.tsx");

  // Side strip: inset Npx 0 0 0 accent. Bottom strip: inset 0 -Npx 0 0 accent.
  // A full inset ring (inset 0 0 0 1px) and a top input shadow are not strips.
  const accentStrip = /inset\s+[1-9]\d*px\s+0\s+0\s+0[^;]*accent|inset\s+0\s+-[1-9]\d*px\s+0\s+0[^;]*accent|shadow-\[inset_[1-9]\d*px_0_0_0_[^\]]*accent|shadow-\[inset_0_-[1-9]\d*px[^\]]*accent/;
  const blocks = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(css))) blocks.push({ selector: match[1], body: match[2] });
  const selectedSel = /is-selected|\[data-active|\.is-active|recent-tab-active/;
  const offenders = blocks
    .filter((b) => selectedSel.test(b.selector) && (accentStrip.test(b.body) || /border-(?:left|bottom)\s*:\s*[1-9]\d*px[^;]*accent/.test(b.body)))
    .map((b) => b.selector.trim().slice(0, 80));
  assert.deepEqual(offenders, []);

  const sources = [css, view, outline, activity, chat, recent];
  for (const src of sources) assert.doesNotMatch(src, accentStrip);

  // Selected tabs and other controls: a side or bottom accent strip in a class
  // string (the editor-tab underline was one). Full rings and progress tracks
  // do not use bottom-0 / left-0 with a short accent bar.
  const classStrip = /bottom-0\s+h-(?:0\.5|px|\[2px\])[^"'\n]*bg-accent|inset-x-\S+\s+bottom-0\s+h-|left-0\s+w-(?:0\.5|\[2px\]|\[3px\])[^"'\n]*bg-accent-color|Active indicator bar/;
  function walk(dir, out = []) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, name.name);
      if (name.isDirectory()) walk(abs, out);
      else if (/\.(tsx|css)$/.test(name.name)) out.push(abs);
    }
    return out;
  }
  const stripHits = [];
  for (const file of walk(path.join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    if (classStrip.test(text)) stripHits.push(path.relative(root, file));
  }
  assert.deepEqual(stripHits, []);
  const recentActive = recent.slice(recent.indexOf("v4-recent-tab v4-drop-target"), recent.indexOf("tab.pinned && !active"));
  assert.match(recentActive, /v4-recent-tab-active bg-surface-selected text-text-primary/);
  assert.doesNotMatch(recentActive, /bg-accent|shadow-sm|h-0\.5/);
  const recentRule = blocks.find((b) => b.selector.includes(".v4-recent-tab-active") && b.body.includes("surface-selected"));
  assert.ok(recentRule, "selected editor tab uses the neutral wash");
  assert.match(recentRule.body, /box-shadow:\s*none/);
  assert.match(recentRule.body, /color:\s*var\(--color-text-primary\)/);

  const treeBlock = blocks.find((b) => b.selector.includes(".v4-tree-node.is-selected") && b.body.includes("surface-selected"));
  assert.ok(treeBlock, "tree selection keeps the neutral wash");
  assert.match(treeBlock.body, /color:\s*var\(--color-text-primary\)/);
  assert.match(treeBlock.body, /box-shadow:\s*none/);
  const title = blocks.find((b) => b.selector.includes(".v4-titlebar-btn[data-active") && b.body.includes("surface-selected"));
  assert.ok(title, "title-bar active control uses the neutral wash");
  assert.match(title.body, /color:\s*var\(--color-text-primary\)/);
  assert.match(title.body, /box-shadow:\s*none/);
  const panel = blocks.find((b) => b.selector.includes(".v4-titlebar-panel-toggle[data-active") && b.body.includes("box-shadow"));
  assert.ok(panel);
  assert.match(panel.body, /box-shadow:\s*none/);

  const row = view.slice(view.indexOf("export function listRowClass"), view.indexOf("export function RowList"));
  assert.match(row, /bg-surface-selected text-text-primary/);
  assert.doesNotMatch(row, /inset_|accent-container/);
  const outlineRow = outline.slice(outline.indexOf("const isActive = activeId"), outline.indexOf("<span className=\"min-w-0 flex-1 truncate\">"));
  assert.match(outlineRow, /is-selected bg-surface-selected text-text-primary/);
  assert.doesNotMatch(outlineRow, /inset_|text-accent-color/);
  // ActivityBar rail active state is a filled container, not an accent strip.
  assert.match(activity, /data-active=\{item\.active\}|aria-pressed=\{item\.active\}/);
  assert.doesNotMatch(activity, /inset\s+[1-9]\d*px\s+0\s+0\s+0/);

  // Exceptions that are not a selection bar.
  assert.match(css, /\.v4-tiptap blockquote[\s\S]{0,180}border-left:\s*3px/);
  assert.match(css, /\.v4-stream-md blockquote[\s\S]{0,220}border-left:\s*2\.5px/);
  assert.match(css, /\.v4-palette-row\[data-active="true"\][\s\S]{0,160}inset 0 0 0 1px/);
  // Field inset shadow retired 2026-09-29 (quiet wash fill, no gray rectangle).
  assert.doesNotMatch(tokens, /--shadow-input-inset/);
  assert.match(tokens, /--shadow-focus-inset:\s*inset 0 0 0 1px/);
  assert.match(chat, /border-l-2 border-accent-border-subtle/);
  assert.match(stream, /data-stream-nested-appends/);
  // Nested appends are indent-only (4.2 declutter) — no accent selection-style bar.
  assert.doesNotMatch(stream, /border-l-2 border-accent-border-subtle/);
  assert.doesNotMatch(design, /accent inset bar/);
  assert.match(design, /无侧边或底部衬条/);
  assert.match(tokens, /no side or bottom accent bar/);
});

test("CountBadge stays radius-xs; Button uses MD3 state layers", () => {
  const badge = read("src/components/ui/CountBadge.tsx");
  assert.match(badge, /rounded-\[var\(--radius-xs\)\]/);
  assert.doesNotMatch(badge, /rounded-full/);
  const button = read("src/components/ui/Button.tsx");
  // State layer overlay, not hover color-swap on the base fill.
  assert.match(button, /after:absolute after:inset-0/);
  assert.match(button, /state-on-primary-hover|state-hover/);
  assert.doesNotMatch(button, /hover:bg-primary-hover/);
});
