/**
 * Pure helpers for inline-AI panel trigger, placement, and preview sizing.
 * Kept out of React so tests drive the shipped functions.
 */

export const INLINE_AI_PREVIEW_DEFAULT_MAX_H = 360;
export const INLINE_AI_PREVIEW_RESIZE_MAX = 720;
export const INLINE_AI_PREVIEW_MIN_H = 72;
/** Preferred panel width (px) — capabilities should breathe horizontally. */
export const INLINE_AI_PANEL_WIDTH = 36 * 16;
/** Never let the floating panel land under app chrome (title/toolbar). */
export const INLINE_AI_CHROME_MIN_TOP = 56;

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
    count += Math.max(1, Math.ceil(line.length / 72));
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
  /** Hard floor under OS/app chrome so the panel never covers the toolbar. */
  chromeMinTop?: number;
}): { top: number; left: number } {
  const { dragPos, target, panelW, panelH, viewportW, viewportH } = input;
  const chromeMinTop = Math.max(8, Number(input.chromeMinTop ?? INLINE_AI_CHROME_MIN_TOP));
  const estPanelH = Math.min(panelH > 0 ? panelH : 120, Math.max(48, viewportH - 32));
  if (dragPos) {
    return {
      top: Math.max(chromeMinTop, Math.min(dragPos.y, viewportH - estPanelH)),
      left: Math.max(8, Math.min(dragPos.x, viewportW - panelW - 8)),
    };
  }
  const preferAboveTop = target.top - estPanelH - 8;
  const spaceAbove = target.top - chromeMinTop;
  const spaceBelow = viewportH - target.bottom;
  let top: number;
  // Prefer below when above would collide with chrome (upper-half selections).
  const aboveOk = spaceAbove >= estPanelH + 16 && preferAboveTop >= chromeMinTop;
  if (aboveOk) {
    top = Math.max(chromeMinTop, preferAboveTop);
  } else if (spaceBelow >= estPanelH + 16) {
    top = Math.min(target.bottom + 8, viewportH - estPanelH - 8);
  } else {
    top =
      spaceAbove >= spaceBelow
        ? Math.max(chromeMinTop, preferAboveTop)
        : Math.min(target.bottom + 8, viewportH - estPanelH - 8);
  }
  const left = Math.max(8, Math.min(target.left, viewportW - panelW - 8));
  return { top: Math.max(chromeMinTop, top), left };
}
