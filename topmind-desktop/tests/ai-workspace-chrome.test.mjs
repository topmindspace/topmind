/**
 * AI workspace column — equal-weight right pane (对话 / 建议 / 清单 / 应用).
 * TitleBar icons and openSuggestSurface must open a pane here, not bury confirm in chat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAiWorkspaceTab, AI_WORKSPACE_TABS, useViewStore } from "../src/stores/view-store.ts";
import { useActionStore } from "../src/stores/action-store.ts";
import { openAiWorkspace, toggleAiWorkspacePane, revealChatThreadOnSend } from "../src/lib/ai-workspace.ts";
import { toggleSuggestSurface } from "../src/lib/suggest-surface.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("AI workspace tabs are the four shipped panes", () => {
  assert.deepEqual([...AI_WORKSPACE_TABS], ["chat", "suggest", "todo", "apps"]);
  assert.equal(isAiWorkspaceTab("suggest"), true);
  assert.equal(isAiWorkspaceTab("rail"), false);
  assert.equal(typeof openAiWorkspace, "function");
  assert.equal(typeof toggleAiWorkspacePane, "function");
});

test("toggleSuggestSurface opens suggest when the AI column is collapsed; visible pane toggles closed", () => {
  const viewSnap = {
    aiPanelOpen: useViewStore.getState().aiPanelOpen,
    aiWorkspaceTab: useViewStore.getState().aiWorkspaceTab,
  };
  const actionSnap = {
    panelOpen: useActionStore.getState().panelOpen,
    items: useActionStore.getState().items,
    everLoaded: useActionStore.getState().everLoaded,
    refresh: useActionStore.getState().refresh,
  };
  try {
    useActionStore.setState({
      panelOpen: true,
      everLoaded: true,
      items: [{ id: "s1", title: "t", summary: "s" }],
      refresh: async () => {},
    });
    useViewStore.setState({ aiPanelOpen: false, aiWorkspaceTab: "chat" });

    toggleSuggestSurface({ refresh: false });
    assert.equal(useViewStore.getState().aiPanelOpen, true, "collapsed column + panelOpen must OPEN");
    assert.equal(useViewStore.getState().aiWorkspaceTab, "suggest");
    assert.equal(useActionStore.getState().panelOpen, true);

    toggleSuggestSurface({ refresh: false });
    assert.equal(useViewStore.getState().aiPanelOpen, false, "visible suggest pane toggles closed");
    assert.equal(useActionStore.getState().panelOpen, false);

    toggleAiWorkspacePane("todo");
    assert.equal(useViewStore.getState().aiPanelOpen, true);
    assert.equal(useViewStore.getState().aiWorkspaceTab, "todo");
    toggleAiWorkspacePane("apps");
    assert.equal(useViewStore.getState().aiPanelOpen, true);
    assert.equal(useViewStore.getState().aiWorkspaceTab, "apps");
  } finally {
    useViewStore.setState(viewSnap);
    useActionStore.setState(actionSnap);
  }
});

test("Shell mounts AiWorkspace as the right column", () => {
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /data-ai-workspace-column/);
  assert.match(shell, /<AiWorkspace/);
  assert.doesNotMatch(shell, /<AiPanel\s*\/>/);
});

test("DESIGN suggestion kinds include retire/update, not append-only promote_memory", () => {
  const design = read("DESIGN.md");
  assert.match(design, /retire_profile/);
  assert.match(design, /update_profile/);
  assert.match(design, /append_profile/);
  assert.match(design, /不是 append-only/);
  assert.doesNotMatch(design, /追加到契约画像文件（默认 memory\/profile\.md）/);
  assert.match(design, /个人清单/);
  assert.match(design, /建议/);
  assert.match(design, /≠ 建议|不是.*建议|清单 pane（专注模式浮动 `TodoPopover`）· \*\*≠\*\* 建议/u);
});

test("each criterion-1 capability has one primary home in shipped chrome", () => {
  // 2026-09 v4: Sidebar header has Profile + Search + 记一下;
  // TitleBar has view-switch dropdown + breadcrumb + AI toggle.
  const sidebar = read("src/components/shell/Sidebar.tsx");
  const title = read("src/components/shell/TitleBar.tsx");
  const ai = read("src/components/ai/AiWorkspace.tsx");
  const design = read("DESIGN.md");
  // 记一下 is in sidebar header (normal button, accent icon)
  assert.match(sidebar, /SidebarHeaderActions/);
  assert.match(sidebar, /RiPencilLine/);
  assert.match(sidebar, /v4-search-trigger/);
  // View switch (动态/Inbox/交付) is a sidebar destinations row; TitleBar
  // hosts compact fallback when the sidebar is collapsed.
  assert.match(read("src/components/shell/PrimaryNav.tsx"), /PRIMARY_NAV_OPTIONS/);
  assert.match(sidebar, /data-sidebar-primary-nav/);
  assert.doesNotMatch(read("src/components/shell/StatusBar.tsx"), /<PrimaryNav/);
  assert.match(ai, /data-ai-workspace-tab=\{item\.id\}/);
  assert.match(ai, /id: "chat"/);
  assert.match(ai, /id: "suggest"/);
  assert.match(ai, /id: "todo"/);
  assert.match(ai, /id: "apps"/);
  assert.doesNotMatch(title, /function WorkspaceSwitcher/);
  assert.match(design, /没有\*\*横跨三列的产品栏|没有横跨三列的产品栏|\*\*没有\*\*横跨三列的产品栏/);
});

test("workbench is three through-going columns; product chrome is not a spanning header", () => {
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /data-through-columns/);
  assert.match(shell, /data-center-column/);
  const titleIdx = shell.indexOf("<TitleBar");
  const dropIdx = shell.indexOf("<FileDropZone");
  assert.ok(titleIdx > dropIdx, "canvas chrome lives inside the column row, not above FileDropZone");
  assert.doesNotMatch(shell, /grid-rows-\[var\(--density-chrome-y/);
  const title = read("src/components/shell/TitleBar.tsx");
  assert.match(title, /data-canvas-chrome/);
  assert.match(title, /data-column-chrome="center"/);
  assert.match(title, /v4-column-chrome/);
  assert.match(read("src/components/shell/Sidebar.tsx"), /v4-column-chrome/);
  assert.match(read("src/components/ai/AiWorkspace.tsx"), /v4-column-chrome/);
  // 2026-09-16: TitleBar has AI toggle; PrimaryNav is sidebar destinations (+ compact when collapsed)
  assert.match(title, /PrimaryNav variant="compact"|v4-titlebar-btn-ai/);
  assert.match(title, /v4-titlebar-btn-ai/);
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-column-chrome="left"/);
  const ai = read("src/components/ai/AiWorkspace.tsx");
  assert.match(ai, /data-column-chrome="right"/);
});

test("AiWorkspace renders four tabs and embeds suggest/todo/apps", () => {
  const src = read("src/components/ai/AiWorkspace.tsx");
  assert.match(src, /data-ai-workspace-tabs/);
  assert.match(src, /data-ai-workspace-tab=\{item\.id\}/);
  assert.match(src, /embedded/);
  assert.match(src, /TodoListBody/);
  assert.match(src, /AppsLaunchList/);
  assert.match(src, /hideComposer/);
  assert.match(src, /<ChatInput/);
});

test("send from a non-chat pane reveals the 对话 thread (composer stays pinned)", () => {
  const viewSnap = {
    aiPanelOpen: useViewStore.getState().aiPanelOpen,
    aiWorkspaceTab: useViewStore.getState().aiWorkspaceTab,
  };
  try {
    useViewStore.setState({ aiPanelOpen: true, aiWorkspaceTab: "suggest" });
    revealChatThreadOnSend();
    assert.equal(useViewStore.getState().aiPanelOpen, true);
    assert.equal(useViewStore.getState().aiWorkspaceTab, "chat");
    useViewStore.setState({ aiPanelOpen: true, aiWorkspaceTab: "todo" });
    revealChatThreadOnSend();
    assert.equal(useViewStore.getState().aiWorkspaceTab, "chat");
  } finally {
    useViewStore.setState(viewSnap);
  }
  const input = read("src/components/ai/ChatInput.tsx");
  assert.match(input, /revealChatThreadOnSend/);
  assert.match(input, /handleSubmit/);
  const ws = read("src/components/ai/AiWorkspace.tsx");
  const composerIdx = ws.lastIndexOf("<ChatInput");
  const paneIdx = ws.indexOf("data-ai-workspace-pane");
  assert.ok(composerIdx > paneIdx, "composer stays column-pinned below panes");
  const chat = read("src/components/ai/AiWorkspace.tsx");
  assert.match(chat, /tab === "chat" \? <AiPanel hideComposer \/>/);
});

test("TitleBar suggests/todo/apps are in AI workspace tabs; switcher is not in TitleBar", () => {
  const title = read("src/components/shell/TitleBar.tsx");
  // 2026-09 v2: suggest/todo/apps live in AiWorkspace tabs, not TitleBar
  assert.doesNotMatch(title, /data-ai-workspace-open="suggest"/);
  assert.doesNotMatch(title, /data-ai-workspace-open="todo"/);
  assert.doesNotMatch(title, /data-ai-workspace-open="apps"/);
  assert.doesNotMatch(title, /function WorkspaceSwitcher/);
  assert.doesNotMatch(title, /<WorkspaceSwitcher/);
  const ai = read("src/components/ai/AiWorkspace.tsx");
  assert.match(ai, /id: "suggest"/);
  assert.match(ai, /id: "todo"/);
  assert.match(ai, /id: "apps"/);
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-workspace/);
  assert.doesNotMatch(sidebar, /<WorkspaceSwitcher/);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /<WorkspaceSwitcher/);
});

test("openSuggestSurface opens the suggest workspace tab", () => {
  const src = read("src/lib/suggest-surface.ts");
  assert.match(src, /openAiWorkspace\("suggest"\)/);
});

test("RuntimeBadge names the Pi loop (and SDK fallback)", () => {
  const src = read("src/components/ai/RuntimeBadge.tsx");
  assert.match(src, /data-ai-loop=\{/);
  assert.match(src, /pi-agent-core/);
  assert.match(src, /ai-sdk/);
});

test("focus-mode mounts floating SuggestPopover and TodoPopover because the AI column is hidden", () => {
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /focusMode \? <SuggestPopover/);
  assert.match(shell, /<TodoPopover/);
  assert.match(shell, /setTodoFocusOpen/);
});
