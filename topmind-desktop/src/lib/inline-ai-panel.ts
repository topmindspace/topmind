/**
 * Pure helpers for inline-AI panel trigger, placement, and preview sizing.
 * Kept out of React so tests drive the shipped functions.
 */

export const INLINE_AI_PREVIEW_DEFAULT_MAX_H = 360;
export const INLINE_AI_PREVIEW_RESIZE_MAX = 720;
export const INLINE_AI_PREVIEW_MIN_H = 72;

export type InlineAiPhase = "idle" | "running" | "preview" | "error";

/** Selection auto-open is on only when the persisted flag is true.
 *  Toolbar / context / in-flight preview still show regardless. */
export function shouldAutoOpenInlineAi(
  autoPopup: boolean,
  opts?: { pinned?: boolean; phase?: InlineAiPhase },
): boolean {
  if (opts?.pinned) return true;
  const phase = opts?.phase;
  if (phase === "running" || phase === "preview") return true;
  return autoPopup === true;
}

export function estimatePreviewRows(text: string, maxRows = 32): number {
  const lines = String(text || "").split("\n");
  let count = 0;
  for (const line of lines) {
    count += Math.max(1, Math.ceil(line.length / 56));
  }
  return Math.min(maxRows, Math.max(6, count + 1));
}

export function clampSelectionAiPanel(input: {
  dragPos: { x: number; y: number } | null;
  target: { top: number; left: number; bottom: number };
  panelW: number;
  panelH: number;
  viewportW: number;
  viewportH: number;
}): { top: number; left: number } {
  const { dragPos, target, panelW, panelH, viewportW, viewportH } = input;
  const estPanelH = Math.min(panelH > 0 ? panelH : 120, Math.max(48, viewportH - 32));
  if (dragPos) {
    return {
      top: Math.max(8, Math.min(dragPos.y, viewportH - estPanelH)),
      left: Math.max(8, Math.min(dragPos.x, viewportW - panelW - 8)),
    };
  }
  const preferAboveTop = target.top - estPanelH - 8;
  const spaceAbove = target.top;
  const spaceBelow = viewportH - target.bottom;
  let top: number;
  if (spaceAbove >= estPanelH + 16) {
    top = Math.max(8, preferAboveTop);
  } else if (spaceBelow >= estPanelH + 16) {
    top = Math.min(target.bottom + 8, viewportH - estPanelH - 8);
  } else {
    top =
      spaceAbove >= spaceBelow
        ? Math.max(8, preferAboveTop)
        : Math.min(target.bottom + 8, viewportH - estPanelH - 8);
  }
  const left = Math.max(8, Math.min(target.left, viewportW - panelW - 8));
  return { top: Math.max(8, top), left };
}
