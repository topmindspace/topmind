/**
 * Local bus event names for AI rail strips (suggestions + pending writes).
 * Emitted after apply / reconcile / AI write; strips subscribe to refresh.
 *
 * Unified open path lives in `suggest-surface.ts` (do not re-export here —
 * that creates a cycle: action-store → ai-rail-events → suggest-surface → action-store).
 */
export const SUGGESTIONS_REFRESH_EVENT = "suggestions:refresh";
export const PENDING_WRITES_CHANGED_EVENT = "pending-writes:changed";

/** Optional payload for suggestions refresh. */
export type SuggestionsRefreshPayload = {
  reason?:
    | "mount"
    | "apply"
    | "ignore"
    | "reconcile"
    | "manual"
    | "workspace"
    | "organize-week"
    | "stream-append"
    | "ai_digest";
};

/** Detect whether a tool/write result should invalidate the pending strip. */
export function shouldInvalidatePendingWrites(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (r.needsConfirm === true || r.pending === true) return true;
  if (r.ok === true && (r.wroteFiles === true || typeof r.targetPath === "string")) return true;
  // Batch evidence after multi-file AI turn
  if (r.batchEvidence && typeof r.batchEvidence === "object") return true;
  const evidence = r.evidence;
  if (evidence && typeof evidence === "object") {
    const ev = evidence as Record<string, unknown>;
    if (ev.needsConfirm === true || ev.pending === true) return true;
  }
  return false;
}
