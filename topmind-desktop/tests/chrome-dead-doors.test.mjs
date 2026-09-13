/**
 * Dead-door + honesty tests for the 2026-09 v4 three-column chrome.
 * Drive shipped helpers (not copies): handleAppsMenuToggle, toggleWorkspaceSwitcher,
 * createWorkspaceActions().run, primaryViewSwitchKind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useViewStore } from "../src/stores/view-store.ts";
import { handleAppsMenuToggle, openAiWorkspace } from "../src/lib/ai-workspace.ts";
import { toggleWorkspaceSwitcher } from "../src/lib/workspace-switcher.ts";
import { createWorkspaceActions } from "../src/plugins/topmind-workspace/actions.ts";
import { primaryViewSwitchKind } from "../src/lib/titlebar-identity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function appsPaneShown() {
  const s = useViewStore.getState();
  // Same gate Shell uses: showAiPanel = !focusMode && aiPanelOpen
  return !s.focusMode && s.aiPanelOpen && s.aiWorkspaceTab === "apps";
}

test("应用 command opens the apps pane when the AI column is closed", () => {
  const snap = {
    aiPanelOpen: useViewStore.getState().aiPanelOpen,
    aiWorkspaceTab: useViewStore.getState().aiWorkspaceTab,
    focusMode: useViewStore.getState().focusMode,
  };
  try {
    useViewStore.setState({ aiPanelOpen: false, aiWorkspaceTab: "chat", focusMode: false });
    handleAppsMenuToggle();
    assert.equal(appsPaneShown(), true, "collapsed column must OPEN the apps pane");

    useViewStore.setState({ aiPanelOpen: false, aiWorkspaceTab: "todo", focusMode: false });
    openAiWorkspace("apps");
    assert.equal(appsPaneShown(), true);
  } finally {
    useViewStore.setState(snap);
  }
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /handleAppsMenuToggle/);
  assert.match(shell, /APPS_MENU_TOGGLE_EVENT/);
  assert.match(shell, /showAiPanel = !focusMode && aiPanelOpen/);
  const ai = read("src/components/ai/AiWorkspace.tsx");
  assert.doesNotMatch(ai, /APPS_MENU_TOGGLE_EVENT/);
  assert.doesNotMatch(ai, /titlebar:apps-toggle/);
});

test("应用 command leaves focus mode so the apps pane can mount", () => {
  const snap = {
    aiPanelOpen: useViewStore.getState().aiPanelOpen,
    aiWorkspaceTab: useViewStore.getState().aiWorkspaceTab,
    focusMode: useViewStore.getState().focusMode,
  };
  try {
    useViewStore.setState({ focusMode: true, aiPanelOpen: false, aiWorkspaceTab: "chat" });
    handleAppsMenuToggle();
    const s = useViewStore.getState();
    assert.equal(s.focusMode, false, "openAiWorkspace(apps) must leave zen");
    assert.equal(s.aiPanelOpen, true);
    assert.equal(s.aiWorkspaceTab, "apps");
    assert.equal(appsPaneShown(), true);

    useViewStore.setState({ focusMode: true, aiPanelOpen: true, aiWorkspaceTab: "suggest" });
    openAiWorkspace("apps");
    assert.equal(appsPaneShown(), true);

    // 建议 / 清单 keep focus — they have floating fallbacks.
    useViewStore.setState({ focusMode: true, aiPanelOpen: false, aiWorkspaceTab: "chat" });
    openAiWorkspace("suggest");
    assert.equal(useViewStore.getState().focusMode, true);
    assert.equal(useViewStore.getState().aiWorkspaceTab, "suggest");
  } finally {
    useViewStore.setState(snap);
  }
});

test("workspace-switcher chord opens the menu while the sidebar host is unmounted", () => {
  const snap = {
    sidebarCollapsed: useViewStore.getState().sidebarCollapsed,
    focusMode: useViewStore.getState().focusMode,
    workspaceSwitcherOpen: useViewStore.getState().workspaceSwitcherOpen,
  };
  try {
    useViewStore.setState({
      sidebarCollapsed: true,
      focusMode: true,
      workspaceSwitcherOpen: false,
    });
    toggleWorkspaceSwitcher();
    assert.equal(useViewStore.getState().workspaceSwitcherOpen, true);
    toggleWorkspaceSwitcher();
    assert.equal(useViewStore.getState().workspaceSwitcherOpen, false);
  } finally {
    useViewStore.setState(snap);
  }
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /toggleWorkspaceSwitcher/);
  assert.match(shell, /<WorkspaceSwitcher/);
  const switcher = read("src/components/shell/WorkspaceSwitcher.tsx");
  assert.doesNotMatch(switcher, /titlebar:workspace-switcher-toggle/);
  assert.match(switcher, /workspaceSwitcherOpen/);
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-workspace/);
  assert.doesNotMatch(sidebar, /<WorkspaceSwitcher/);
});

test("createWorkspaceActions memory goto emits navigate:select { kind: memory }", () => {
  const actions = createWorkspaceActions();
  const memory = actions.find((a) => a.id === "topmind-workspace.goto.memory");
  assert.ok(memory, "missing goto.memory action");
  assert.match(String(memory.labelKey || ""), /gotoMemory/);
  const emitted = [];
  memory.run(
    { events: { emit: (event, payload) => { emitted.push({ event, payload }); } } },
    { kind: "stream" },
  );
  assert.deepEqual(emitted, [{ event: "navigate:select", payload: { kind: "memory" } }]);
});

test("stream composer tertiary capture link is not the L1 记一下 / Note it word", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/workspace.json"));
  const en = JSON.parse(read("src/locales/en-US/workspace.json"));
  assert.notEqual(zh.streamDetail.composeFullCapture, "记一下");
  assert.notEqual(zh.streamDetail.composeFullCapture, "打开记一下");
  assert.doesNotMatch(zh.streamDetail.composeFullCapture, /记一下/);
  assert.notEqual(en.streamDetail.composeFullCapture, "Note it");
  assert.doesNotMatch(en.streamDetail.composeFullCapture, /Note it/);
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /composeFullCapture/);
});

test("view-switch closed-state icon does not impersonate 动态 on file/topic/memory/archive", () => {
  assert.equal(primaryViewSwitchKind("stream"), "stream");
  assert.equal(primaryViewSwitchKind("inbox"), "inbox");
  assert.equal(primaryViewSwitchKind("outputs"), "outputs");
  assert.equal(primaryViewSwitchKind("file"), null);
  assert.equal(primaryViewSwitchKind("topic"), null);
  assert.equal(primaryViewSwitchKind("memory"), null);
  assert.equal(primaryViewSwitchKind("archive"), null);
  const title = read("src/components/shell/TitleBar.tsx");
  assert.match(title, /primaryViewSwitchKind/);
  assert.doesNotMatch(title, /activeView\?\.icon \?\? RiBroadcastLine/);
});

test("DESIGN §0.0.4 does not name SidebarHeaderActions as the 动态 home", () => {
  const design = read("DESIGN.md");
  assert.match(design, /中栏 TitleBar 视图切换/);
  assert.doesNotMatch(design, /左栏 `SidebarHeaderActions` \+ 中栏 TitleBar 视图切换/);
});

test("unreachable ActionBar is gone; focus-mode 建议 door is Shell SuggestPopover", () => {
  assert.equal(existsSync(path.join(root, "src/components/ai/ActionBar.tsx")), false);
  const panel = read("src/components/ai/AiPanel.tsx");
  assert.doesNotMatch(panel, /ActionBar/);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /focusMode \? <SuggestPopover/);
});
