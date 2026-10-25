export const PANEL_WIDTHS: Readonly<Record<"sidebar" | "ai", Readonly<{ min: number; max: number; default: number }>>>;
export function normalizePanelWidth(value: unknown, panel: "sidebar" | "ai", fallback?: number): number;
export function resolveWorkbenchLayout(input: {
  viewportWidth: number; sidebarWidth: number; aiPanelWidth: number;
  sidebarVisible: boolean; aiVisible: boolean; focusMode?: boolean;
}): { showSidebar: boolean; showAiPanel: boolean; sidebarWidth: number; aiPanelWidth: number; sidebarMax: number; aiMax: number; canvasWidth: number };
