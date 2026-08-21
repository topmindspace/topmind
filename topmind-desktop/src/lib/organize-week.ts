/**
 * Product action: 整理本周 — stream-first organize path.
 *
 * 1. Navigate to stream (optional)
 * 2. Enqueue reconcile engine task
 * 3. Refresh activity-window suggestions + run memory/topic AI ops (confirm only)
 * 4. StatusBar chip / SuggestPopover — never auto-apply high-impact
 *
 * Pure orchestration of store/event side-effects (no React).
 */
import { useTaskStore } from "../stores/task-store";
import { useViewStore } from "../stores/view-store";
import { useActionStore } from "../stores/action-store";
import { emitLocal } from "../plugins/host";
import { openSuggestSurface } from "./suggest-surface";
import { engineJobSuggestionFollowUp } from "./engine-job-follow-up";

export type OrganizeWeekOptions = {
  /** Open floating TaskPanel (default true). */
  openTaskPanel?: boolean;
  /** Open AI rail (default true). */
  openAiPanel?: boolean;
  /** Select stream primary surface (default true). */
  selectStream?: boolean;
  /** Run memory_organize + topic_classify and merge into the suggest confirm list (default true). */
  runActivityOps?: boolean;
  /** Force re-process AI ops even if content fingerprint unchanged. */
  forceOps?: boolean;
};

/**
 * Kick off the organize-week product path.
 * Returns the created task id when a reconcile task was enqueued.
 */
export async function runOrganizeWeek(opts: OrganizeWeekOptions = {}): Promise<string> {
  const {
    openTaskPanel = true,
    openAiPanel = true,
    selectStream = true,
    runActivityOps = true,
    forceOps = false,
  } = opts;

  if (selectStream) {
    useViewStore.getState().select({ kind: "stream" });
  }
  if (openAiPanel) {
    // Open unified 建议 confirm surface (SuggestPopover), not a second list
    openSuggestSurface();
  }
  if (openTaskPanel) {
    emitLocal("task-panel:open");
  }

  const taskId = await useTaskStore.getState().createTask("reconcile");

  // Activity-window suggest + confirm-shaped memory/topic ops (non-blocking for reconcile task).
  // Do NOT emit suggestions:refresh after merge — refresh would race and is already inside runActivityOps.
  if (runActivityOps) {
    void useActionStore
      .getState()
      .runActivityOps({ force: forceOps })
      .then((r) => {
        const follow = engineJobSuggestionFollowUp({
          type: "ai_digest",
          merged: r.merged,
        });
        if (follow.openSuggestSurface) {
          openSuggestSurface({ refresh: false });
        }
      })
      .catch(() => {
        /* offline / no AI — reconcile still useful */
      });
  } else {
    emitLocal("suggestions:refresh", { reason: "organize-week" });
  }

  return taskId;
}

/** Local bus event name — Shell may also listen for external hosts. */
export const ORGANIZE_WEEK_EVENT = "organize:week";
