/** Keep a floating panel inside a narrow or resized window. */
export function clampPopoverX(
  requestedX: number,
  viewportWidth: number,
  panelWidth: number,
  margin = 8,
): number {
  const renderedWidth = Math.min(panelWidth, Math.max(0, viewportWidth - 24));
  return Math.max(margin, Math.min(requestedX, viewportWidth - renderedWidth - margin));
}

export function anchoredPopoverX(viewportWidth: number, panelWidth: number): number {
  return clampPopoverX(viewportWidth - panelWidth - 16, viewportWidth, panelWidth);
}
