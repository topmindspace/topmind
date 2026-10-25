/** Geometry shared by stored preferences and the renderer's visible layout. */
export const PANEL_WIDTHS = Object.freeze({
  sidebar: Object.freeze({ min: 180, max: 480, default: 240 }),
  ai: Object.freeze({ min: 280, max: 800, default: 420 }),
});
export function normalizePanelWidth(value, panel, fallback = PANEL_WIDTHS[panel].default) {
  const limits = PANEL_WIDTHS[panel];
  return typeof value === "number" && Number.isFinite(value) && value >= limits.min && value <= limits.max ? value : fallback;
}

/** Automatic fitting never writes back the user's preferred widths. */
export function resolveWorkbenchLayout({ viewportWidth, sidebarWidth, aiPanelWidth, sidebarVisible, aiVisible, focusMode = false }) {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1440;
  const rail = focusMode ? 0 : 48;
  const aiOpen = !focusMode && aiVisible;
  let sidebarOpen = !focusMode && sidebarVisible;
  // At high zoom, keep the canvas and one companion usable. The navigation
  // toggle can explicitly prioritize the sidebar by closing AI.
  if (aiOpen && sidebarOpen && width < rail + 400 + PANEL_WIDTHS.sidebar.min + PANEL_WIDTHS.ai.min + 2) sidebarOpen = false;
  const dividers = Number(sidebarOpen) + Number(aiOpen);
  const paneMinimum = (sidebarOpen ? PANEL_WIDTHS.sidebar.min : 0) + (aiOpen ? PANEL_WIDTHS.ai.min : 0);
  const canvasMinimum = Math.min(400, Math.max(0, width - rail - dividers - paneMinimum));
  const budget = Math.max(0, width - rail - dividers - canvasMinimum);
  const sidebarMax = Math.max(PANEL_WIDTHS.sidebar.min, Math.min(PANEL_WIDTHS.sidebar.max, budget - (aiOpen ? PANEL_WIDTHS.ai.min : 0)));
  const sidebar = sidebarOpen ? Math.min(normalizePanelWidth(sidebarWidth, "sidebar"), sidebarMax) : 0;
  const aiMax = Math.max(PANEL_WIDTHS.ai.min, Math.min(PANEL_WIDTHS.ai.max, budget - sidebar));
  const ai = aiOpen ? Math.min(normalizePanelWidth(aiPanelWidth, "ai"), aiMax) : 0;
  return { showSidebar: sidebarOpen, showAiPanel: aiOpen, sidebarWidth: sidebar, aiPanelWidth: ai, sidebarMax, aiMax, canvasWidth: Math.max(0, width - rail - dividers - sidebar - ai) };
}
