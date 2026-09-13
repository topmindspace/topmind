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
 * Always ensures a refresh when the list is empty / never loaded so open is never a
 * silent no-op; force when empty so soft throttle cannot skip the first paint.
 */
export function openSuggestSurface(opts?: { refresh?: boolean }): void {
  const store = useActionStore.getState();
  store.setPanelOpen(true);
  store.setExpanded(true);
  useViewStore.getState().openAiWorkspace("suggest");

  const empty = store.items.length === 0;
  const neverLoaded = !store.everLoaded;
  const forceRefresh = opts?.refresh === true || empty || neverLoaded;

  if (forceRefresh) {
    // force bypasses soft throttle; still respects autoPrepare for suggestion scan
    // (pending writes always load inside refresh)
    void store.refresh({ force: true });
  } else if (opts?.refresh !== false) {
    // Soft re-sync when re-opening with existing items
    void store.refresh();
  }
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
