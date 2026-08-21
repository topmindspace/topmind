/**
 * Unified 建议 surface — global header-centric confirm panel.
 *
 * Entry: TitleBar Lightbulb + StatusBar suggest-count chip (count>0).
 * Focus-mode AI-rail ActionBar is a fallback when the status bar is hidden.
 * Confirm: SuggestPopover (primary) — not buried only in AI chat rail.
 * 个人清单 stays TodoPopover — never merged here.
 *
 * Behavior parity with TodoPopover:
 * - Outside click dismisses (unpinned).
 * - Outside scroll dismisses (unpinned).
 * - Esc dismisses.
 * - Toggle via header Lightbulb / StatusBar count chip.
 */
import { useActionStore } from "../stores/action-store";

/** Local bus name used by task-store / organize paths. Handlers call openSuggestSurface. */
export const OPEN_SUGGEST_SURFACE_EVENT = "suggest-surface:open";

/**
 * Open the one 建议 confirm surface (SuggestPopover via ActionStore.panelOpen).
 * Does not require the AI chat panel. Does not re-emit bus events (no loops).
 *
 * Always ensures a refresh when the list is empty / never loaded so open is never a
 * silent no-op; force when empty so soft throttle cannot skip the first paint.
 */
export function openSuggestSurface(opts?: { refresh?: boolean }): void {
  const store = useActionStore.getState();
  store.setPanelOpen(true);
  store.setExpanded(true);

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
  const open = useActionStore.getState().panelOpen;
  if (open) {
    useActionStore.getState().setPanelOpen(false);
  } else {
    openSuggestSurface(opts);
  }
}

/** Product lock: single confirm surface (popover + shared ActionStore). */
export function isUnifiedSuggestConfirmSurface(): true {
  return true;
}
