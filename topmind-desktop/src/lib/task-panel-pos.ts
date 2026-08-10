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
