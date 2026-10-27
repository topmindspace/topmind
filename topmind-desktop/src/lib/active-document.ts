import type { Selection } from "../types";

/** A side panel can own keyboard focus without replacing the visible article. */
export function activeDocumentPath(state: { selection: Selection; splitSecondaryPath?: string | null; focusedEditorPath?: string | null }): string | null {
  if (state.selection.kind !== "file") return null;
  const primary = state.selection.path;
  const focused = state.focusedEditorPath;
  return focused && (focused === primary || focused === state.splitSecondaryPath) ? focused : primary;
}
