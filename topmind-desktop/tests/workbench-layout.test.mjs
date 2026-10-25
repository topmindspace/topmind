import test from "node:test";
import assert from "node:assert/strict";
import { normalizePanelWidth, resolveWorkbenchLayout } from "../electron/lib/workbench-layout.mjs";
import { useViewStore } from "../src/stores/view-store.ts";

test("all supported desktop panel preferences preserve a 400px canvas", () => {
  for (const viewportWidth of [1180, 1280, 1440, 1920]) {
    for (const sidebarWidth of [180, 240, 480]) for (const aiPanelWidth of [280, 420, 800]) {
      const input = Object.freeze({ viewportWidth, sidebarWidth, aiPanelWidth, sidebarVisible: true, aiVisible: true });
      const layout = resolveWorkbenchLayout(input);
      assert.ok(layout.canvasWidth >= 400, JSON.stringify({ input, layout }));
      assert.ok(layout.sidebarWidth >= 180 && layout.aiPanelWidth >= 280);
      assert.ok(layout.sidebarWidth + layout.aiPanelWidth + layout.canvasWidth + 50 <= viewportWidth);
      assert.equal(input.aiPanelWidth, aiPanelWidth, "fitting must not mutate saved preferences");
    }
  }
});

test("narrow CSS viewports prioritize canvas and AI without losing navigation preferences", () => {
  const input = { viewportWidth: 590, sidebarWidth: 240, aiPanelWidth: 800, sidebarVisible: true, aiVisible: true };
  const narrow = resolveWorkbenchLayout(input);
  assert.equal(narrow.showSidebar, false);
  assert.equal(narrow.aiPanelWidth, 280);
  assert.equal(narrow.canvasWidth, 261);
  assert.equal(input.sidebarVisible, true);
  const wide = resolveWorkbenchLayout({ ...input, viewportWidth: 1920 });
  assert.equal(wide.showSidebar, true);
  assert.equal(wide.aiPanelWidth, 800);
});

test("focus mode gives the canvas the entire width", () => {
  const layout = resolveWorkbenchLayout({ viewportWidth: 1180, sidebarWidth: 480, aiPanelWidth: 800, sidebarVisible: true, aiVisible: true, focusMode: true });
  assert.equal(layout.canvasWidth, 1180);
  assert.equal(layout.showSidebar, false);
  assert.equal(layout.showAiPanel, false);
});

test("invalid live widths retain the previous valid preference", () => {
  useViewStore.setState({ sidebarWidth: 240, aiPanelWidth: 420 });
  for (const value of [NaN, Infinity, -1, 9000]) {
    useViewStore.getState().setSidebarWidth(value);
    useViewStore.getState().setAiPanelWidth(value);
  }
  assert.equal(useViewStore.getState().sidebarWidth, 240);
  assert.equal(useViewStore.getState().aiPanelWidth, 420);
  assert.equal(normalizePanelWidth("480", "ai", 420), 420);
});

test("explicit chat actions leave focus mode so their destination is visible", () => {
  useViewStore.setState({ focusMode: true, aiPanelOpen: true });
  useViewStore.getState().toggleAiPanel();
  assert.equal(useViewStore.getState().focusMode, false);
  assert.equal(useViewStore.getState().aiPanelOpen, true);
  useViewStore.setState({ focusMode: true, aiPanelOpen: false });
  useViewStore.getState().openAiWorkspace("chat");
  assert.equal(useViewStore.getState().focusMode, false);
  assert.equal(useViewStore.getState().aiWorkspaceTab, "chat");
});

test("sidebar actions prioritize visible navigation at high zoom and leave focus mode", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const snapshot = useViewStore.getState();
  try {
    Object.defineProperty(globalThis, "window", { value: { innerWidth: 590 }, configurable: true });
    for (const sidebarCollapsed of [false, true]) {
      useViewStore.setState({ focusMode: false, sidebarCollapsed, aiPanelOpen: true, sidebarWidth: 240, aiPanelWidth: 800 });
      useViewStore.getState().toggleSidebar();
      const state = useViewStore.getState();
      assert.equal(state.sidebarCollapsed, false);
      assert.equal(state.aiPanelOpen, false);
      assert.equal(state.aiPanelWidth, 800, "temporary fitting preserves preferences");
      const layout = resolveWorkbenchLayout({ viewportWidth: 590, sidebarWidth: state.sidebarWidth, aiPanelWidth: state.aiPanelWidth, sidebarVisible: !state.sidebarCollapsed, aiVisible: state.aiPanelOpen });
      assert.equal(layout.showSidebar, true);
    }
    useViewStore.setState({ focusMode: true, sidebarCollapsed: true });
    useViewStore.getState().toggleSidebar();
    assert.equal(useViewStore.getState().focusMode, false);
    assert.equal(useViewStore.getState().sidebarCollapsed, false);
  } finally {
    useViewStore.setState(snapshot);
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  }
});
