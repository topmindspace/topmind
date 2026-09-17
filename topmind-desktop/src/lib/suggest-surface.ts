/**
 * Unified 建议 surface — confirm list lives in the AI workspace 建议 pane.
 *
 * Entry: StatusBar suggest-count chip (count>0) opens the right AI workspace
 * on the suggest tab (peer column, not a chat-only rail).
 * Focus-mode still falls back to the floating SuggestPopover (AI column hidden).
 * 个人清单 is the AI workspace 清单 pane (TodoPopover only in focus mode).
 */
import { useActionStore } from "../stores/action-store";
import { useViewStore } from "../stores/view-store";

/** Local bus name used by task-store / organize paths. Handlers call openSuggestSurface. */
export const OPEN_SUGGEST_SURFACE_EVENT = "suggest-surface:open";

/**
 * Open the one 建议 confirm surface (AI workspace 建议 pane + ActionStore).
 * Does not re-emit bus events (no loops).
 *
 * Refresh policy (2026-09-17d):
 * - Empty / never-loaded open → **soft** refresh. Force-on-empty re-offered
 *   every already-written period digest on every cold open — the #1 source of
 *   「已经处置过，仍然要提示」.
 * - Explicit `refresh: true` (StatusBar chip when count > 0) → force.
 * - Re-open with items → soft re-sync only.
 */
export function openSuggestSurface(opts?: { refresh?: boolean }): void {
  const store = useActionStore.getState();
  store.setPanelOpen(true);
  store.setExpanded(true);
  useViewStore.getState().openAiWorkspace("suggest");

  if (opts?.refresh === true) {
    void store.refresh({ force: true });
    return;
  }
  if (opts?.refresh === false) return;
  // Soft: pending writes always load; suggestions merge without force re-analysis
  void store.refresh();
}

/**
 * Toggle the 建议 confirm surface — used by header Lightbulb + StatusBar count chip.
 * When opening, delegates to openSuggestSurface (which handles refresh logic).
 * When closing, simply sets panelOpen=false (no refresh needed).
 */
export function toggleSuggestSurface(opts?: { refresh?: boolean }): void {
  const view = useViewStore.getState();
  const onSuggestPane = view.aiPanelOpen && view.aiWorkspaceTab === "suggest";
  // Close only when the 建议 pane is actually visible. Collapsed AI column
  // (or leftover panelOpen from auto-prep) must OPEN, not no-op/close.
  if (onSuggestPane) {
    useActionStore.getState().setPanelOpen(false);
    view.setAiPanelOpen(false);
    return;
  }
  openSuggestSurface(opts);
}

/** Product lock: single confirm surface (AI workspace 建议 pane + shared ActionStore). */
export function isUnifiedSuggestConfirmSurface(): true {
  return true;
}
