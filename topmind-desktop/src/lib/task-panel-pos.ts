/**
 * Floating TaskPanel position helpers — pure, unit-tested.
 * Stored as { x, y } meaning CSS `right` / `bottom` offsets.
 */

export type TaskPanelPos = { x: number; y: number };

export const TASK_PANEL_POS_KEY = "topmind:task-panel-pos";
export const DEFAULT_TASK_PANEL_POS: TaskPanelPos = { x: 24, y: 24 };

export function clampTaskPanelPos(pos: TaskPanelPos): TaskPanelPos {
  return {
    x: Math.max(0, Number.isFinite(pos.x) ? pos.x : DEFAULT_TASK_PANEL_POS.x),
    y: Math.max(0, Number.isFinite(pos.y) ? pos.y : DEFAULT_TASK_PANEL_POS.y),
  };
}

export function parseTaskPanelPos(raw: string | null | undefined): TaskPanelPos {
  if (!raw) return { ...DEFAULT_TASK_PANEL_POS };
  try {
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return clampTaskPanelPos({ x: parsed.x, y: parsed.y });
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_TASK_PANEL_POS };
}

export function serializeTaskPanelPos(pos: TaskPanelPos): string {
  return JSON.stringify(clampTaskPanelPos(pos));
}

/** Load from localStorage (or any getItem-like). */
export function loadTaskPanelPos(
  getItem: (key: string) => string | null = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
): TaskPanelPos {
  return parseTaskPanelPos(getItem(TASK_PANEL_POS_KEY));
}

/** Persist to localStorage (or any setItem-like). */
export function saveTaskPanelPos(
  pos: TaskPanelPos,
  setItem: (key: string, value: string) => void = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
): TaskPanelPos {
  const next = clampTaskPanelPos(pos);
  setItem(TASK_PANEL_POS_KEY, serializeTaskPanelPos(next));
  return next;
}

/** True when the user has dragged a custom position (vs. dock default). */
export function hasCustomTaskPanelPos(
  getItem: (key: string) => string | null = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
): boolean {
  return getItem(TASK_PANEL_POS_KEY) != null;
}

/**
 * Dock position: sit just above the status-bar task trigger (right-aligned).
 * Pure given trigger rect + viewport so it stays unit-testable.
 */
export function computeDockTaskPanelPos(input: {
  triggerRight: number;
  triggerTop: number;
  viewportW: number;
  viewportH: number;
  panelW?: number;
}): TaskPanelPos {
  const panelW = input.panelW ?? 340;
  const gap = 8;
  const x = Math.max(0, input.viewportW - input.triggerRight);
  const y = Math.max(0, input.viewportH - input.triggerTop + gap);
  // Keep the panel's right edge near the trigger's right edge.
  const xAligned = Math.max(0, x - Math.max(0, panelW - 80));
  return clampTaskPanelPos({ x: xAligned, y });
}
