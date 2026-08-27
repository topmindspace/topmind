/**
 * Confirm-only 我的情况 organize — generates suggestions, never writes profile.
 * Lands on the unified SuggestPopover surface.
 */
import { useActionStore } from "../stores/action-store";
import { useViewStore } from "../stores/view-store";
import { openSuggestSurface } from "./suggest-surface";

/**
 * Run shipped memory_organize / topic_classify activity ops and open the
 * confirm surface. Does not call writeback or save profile.
 */
export async function runMemoryOrganizeConfirm(): Promise<{ merged: number; summary: string }> {
  const result = await useActionStore.getState().runActivityOps({ force: true });
  openSuggestSurface({ refresh: false });
  return result;
}

/** Expand the live `memory/` group in the category tree — not a new primary nav. */
export function revealMemoryFolderInTree(): void {
  const vs = useViewStore.getState();
  vs.setSidebarView("category");
  vs.expandNodes(["section/memory"]);
}
