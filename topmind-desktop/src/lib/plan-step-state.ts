/**
 * Run Card plan-step pin state (GoalState has no per-step telemetry).
 * Derive a stable pin from acceptance progress + run status so the ledger
 * never over-claims "done" (floor, not round) and surfaces a running pin.
 */

export type PlanStepState = "done" | "running" | "pending" | "failed";

export function derivePlanStepState(input: {
  index: number;
  total: number;
  status: string;
  criteriaTotal: number;
  openCount: number;
}): PlanStepState {
  const { index, total, status, criteriaTotal, openCount } = input;
  if (total <= 0 || index < 0 || index >= total) return "pending";

  if (status === "done") return "done";

  // Completed criteria ratio → completed steps (floor: never claim all done
  // until criteria are actually exhausted).
  let doneCount = 0;
  if (criteriaTotal > 0) {
    const closed = Math.max(0, criteriaTotal - Math.max(0, openCount));
    doneCount = Math.floor((closed / criteriaTotal) * total);
    // A fully-closed criteria set on a non-done run still marks all steps done.
    if (openCount <= 0 && status !== "incomplete" && status !== "blocked") {
      doneCount = total;
    }
  } else if (status === "working" || status === "verifying") {
    // No criteria to meter against — pin the first step as running.
    doneCount = 0;
  } else if (status === "incomplete" || status === "blocked") {
    // Unknown progress on an unfinished run: leave pins pending except we
    // mark the current frontier as failed/blocked below.
    doneCount = 0;
  }

  if (index < doneCount) return "done";
  if (index > doneCount) return "pending";

  // Frontier step
  if (status === "working" || status === "verifying") return "running";
  if (status === "incomplete") return "failed";
  return "pending";
}

/** Human-facing plan delta for Pause/Resume (added / removed / reordered). */
export function diffPlan(
  before: string[] | undefined,
  after: string[] | undefined,
): { added: string[]; removed: string[]; changed: boolean } {
  const a = before || [];
  const b = after || [];
  const beforeSet = new Set(a);
  const afterSet = new Set(b);
  const added = b.filter((s) => !beforeSet.has(s));
  const removed = a.filter((s) => !afterSet.has(s));
  return { added, removed, changed: added.length > 0 || removed.length > 0 || a.join("\n") !== b.join("\n") };
}
