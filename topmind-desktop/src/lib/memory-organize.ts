/**
 * Confirm-only 我的情况 organize — generates suggestions, never writes profile.
 * TaskStore shows progress; SuggestPopover opens when the job finishes.
 */
import { useViewStore } from "../stores/view-store";
import { useTaskStore } from "../stores/task-store";
import { emitLocal } from "../plugins/host";

/**
 * Run shipped memory_organize / topic_classify activity ops as a TaskStore job.
 * StatusBar + TaskPanel show progress/result; suggestions land on SuggestPopover
 * when the job finishes (no silent profile write).
 */
export async function runMemoryOrganizeConfirm(): Promise<{ merged: number; summary: string }> {
  emitLocal("task-panel:open");
  await useTaskStore.getState().createTask("memory_organize");
  return { merged: 0, summary: "" };
}

/** Expand the live `memory/` group in the category tree — not a new primary nav. */
export function revealMemoryFolderInTree(): void {
  const vs = useViewStore.getState();
  vs.setSidebarView("category");
  vs.expandNodes(["section/memory"]);
}
