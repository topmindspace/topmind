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

test("TitleBar: L1 capture+AI solid, L2 suggest/todo, L3 tools; single capture solid", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  assert.match(titleBar, /data-chrome-tier=["']l1["']/);
  assert.match(titleBar, /data-chrome-tier=["']l2["']/);
  assert.match(titleBar, /data-chrome-tier=["']l3["']/);
  assert.match(titleBar, /v4-titlebar-btn-capture/);
  assert.match(titleBar, /v4-titlebar-btn-ai/);
  // L2 must not have capture solid
  const l2 = titleBar.slice(
    titleBar.indexOf("v4-titlebar-tier-l2"),
    titleBar.indexOf('data-chrome-tier="l3"'),
  );
  assert.doesNotMatch(l2, /v4-titlebar-btn-capture/);
});

test("TitleBar wide rail renders a theme control (not only the compact ⋯ menu)", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  const compactIdx = titleBar.indexOf("{!compactTools ? (");
  assert.ok(compactIdx >= 0, "expected !compactTools branch");
  const afterCompact = titleBar.slice(compactIdx);
  // Wide rail: cycle button (data-titlebar-theme + pickTheme). Compact ⋯:
  // explicit auto/light/dark via themeMenuSection. Bound the wide branch by
  // the first `) : (` so the compact menu is not mistaken for the wide control.
  const elseRel = afterCompact.indexOf(") : (");
  assert.ok(elseRel > 0, "expected compact fallback branch");
  const wide = afterCompact.slice(0, elseRel);
  assert.match(wide, /data-titlebar-theme/);
  assert.match(wide, /pickTheme/);
  const compact = afterCompact.slice(elseRel);
  assert.match(compact, /themeMenuSection/);
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
  assert.match(light, /--color-accent-color:\s*#0284c7/);
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
});

// ── Suggest / Todo / AI calm ───────────────────────────────────────────

test("ActionBar demotes outside focus mode; format toolbar defaults expanded", () => {
  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /focusMode/);
  assert.match(bar, /return null/);

  const editor = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(editor, /const \[showFormat,\s*setShowFormat\]\s*=\s*useState\(\s*true\s*\)/);
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

  // 2026-08-30: 左栏回归纯内容导航 — 插件入口统一在标题栏 Apps 菜单。
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.doesNotMatch(sidebar, /data-sidebar-plugins-section/);
  assert.doesNotMatch(sidebar, /sidebarSlots/);

  const titleBar = read("src/components/shell/TitleBar.tsx");
  assert.match(titleBar, /AppsMenu/);
  const appsMenu = read("src/components/shell/AppsMenu.tsx");
  assert.match(appsMenu, /data-titlebar-apps/);
  assert.match(appsMenu, /listLaunchablePlugins/);
  // 菜单组件不写死插件 id（打开方式/就绪判定都在 lib/apps-menu）
  assert.doesNotMatch(appsMenu, /topmind-ledger|topmind-weread|topmind-x|topmind-ingest/);
  const appsLib = read("src/lib/apps-menu.ts");
  assert.match(appsLib, /resolveLaunchableOpenTarget/);
  assert.match(appsLib, /PLUGIN_APP_KIND/);
  assert.match(appsLib, /pluginReadiness/);
  // 菜单数据实时性：打开时拉取 settings + 订阅插件设置变化（不依赖启动快照）
  assert.match(appsMenu, /api\.sys\.settings\(\)/);
  assert.match(appsMenu, /plugins:settings-changed/);
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
  const headerStart = stream.indexOf("<PageHeader");
  assert.ok(headerStart >= 0);
  const headerSlice = stream.slice(headerStart);
  const headerEnd = headerSlice.search(/\/>/);
  const headerBlock = headerSlice.slice(0, headerEnd >= 0 ? headerEnd + 2 : 800);
  assert.ok(
    !headerBlock.includes("<FeedLayoutToggle"),
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

test("DESIGN.md documents core UI patterns", () => {
  const design = read("DESIGN.md");
  assert.match(design, /shadow-card|surface-elevated/);
  assert.match(design, /状态栏(?:建议)?计数 chip/);
  assert.doesNotMatch(design, /有 `items` 时画布顶 `SuggestEntryStrip`/);
  assert.doesNotMatch(design, /AI 轨 `ActionBar` 仅为计数跳转/);
  assert.match(design, /showFormat|data-chrome-tier|TitleBar/);
  assert.match(design, /deriveStatusBarBusy/);
  assert.match(design, /FilterChip|data-filter-chip/);
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
  const hook = read("src/components/editor/useSelectionAi.ts");
  assert.match(hook, /shouldAutoOpenInlineAi/);
  assert.match(hook, /INLINE_AI_PREVIEW_DEFAULT_MAX_H/);
  assert.match(hook, /applyEditorPrefs\(\{ inlineAiAutoPopup/);
  const bar = read("src/components/editor/SelectionAiBar.tsx");
  assert.match(bar, /clampSelectionAiPanel/);
  const diff = read("src/components/editor/SelectionAiDiff.tsx");
  assert.match(diff, /data-inline-ai-preview/);
  assert.match(diff, /estimatePreviewRows/);
  const long = "line\n".repeat(40);
  assert.ok(estimatePreviewRows(long) >= 20);
  const pos = clampSelectionAiPanel({
    dragPos: null,
    target: { top: 80, left: 40, bottom: 100 },
    panelW: 400,
    panelH: 200,
    viewportW: 800,
    viewportH: 600,
  });
  assert.ok(pos.top >= 8);
  assert.ok(pos.left >= 8);
  assert.ok(pos.left + 400 <= 800);
});
