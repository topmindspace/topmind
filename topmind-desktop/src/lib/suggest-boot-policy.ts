/**
 * AI 建议 cold-start / soft-refresh policy (pure).
 *
 * Product model:
 * - Suggestions are runtime confirm candidates — not a second content truth store.
 * - autoPrepare off → kernel generateSuggestions skipped (pending writes still load).
 * - Soft refresh throttled; force always runs.
 * - Kernel durable fingerprints (activity window) skip AI re-call when nothing changed
 *   across process restarts — see lib/suggest-fingerprint.mjs.
 * - Session merge (mergeSuggestRefreshItems) keeps mid-session list stable.
 * - Personal Todo (memory/todo.md) is independent (TodoStore).
 */

export const SUGGEST_SOFT_THROTTLE_MS = 2000;

export type SuggestRefreshDecision = {
  /** Call workspace.generateSuggestions */
  runKernelSuggest: boolean;
  /** Always load pending writes when true */
  runPendingWrites: boolean;
  /** Soft vs force merge mode for ActionStore */
  soft: boolean;
  reason:
    | "auto_prepare_off"
    | "soft_throttled"
    | "agent_busy"
    | "cold_or_soft_refresh"
    | "force_refresh";
};

/**
 * Decide what a refresh tick should do.
 * Pure — ActionStore can call this before network work.
 */
export function decideSuggestRefresh(opts: {
  autoPrepare: boolean;
  force?: boolean;
  lastRefreshAt: number;
  now?: number;
  everLoaded: boolean;
  itemCount: number;
  throttleMs?: number;
  /**
   * Agent stream in progress — soft/auto ticks skip kernel suggest (token + UI).
   * Force (user 💡 refresh) still runs.
   */
  agentStreaming?: boolean;
}): SuggestRefreshDecision {
  const force = opts.force === true;
  const now = opts.now ?? Date.now();
  const throttleMs = opts.throttleMs ?? SUGGEST_SOFT_THROTTLE_MS;
  const runPendingWrites = true;

  if (
    !force &&
    now - opts.lastRefreshAt < throttleMs &&
    opts.itemCount > 0 &&
    opts.everLoaded
  ) {
    return {
      runKernelSuggest: false,
      runPendingWrites: false,
      soft: true,
      reason: "soft_throttled",
    };
  }

  if (!opts.autoPrepare) {
    return {
      runKernelSuggest: false,
      runPendingWrites,
      soft: !force,
      reason: "auto_prepare_off",
    };
  }

  if (force) {
    return {
      runKernelSuggest: true,
      runPendingWrites,
      soft: false,
      reason: "force_refresh",
    };
  }

  // Soft path yields to user-primary agent stream (poll / boot / events)
  if (opts.agentStreaming === true) {
    return {
      runKernelSuggest: false,
      runPendingWrites,
      soft: true,
      reason: "agent_busy",
    };
  }

  return {
    runKernelSuggest: true,
    runPendingWrites,
    soft: true,
    reason: "cold_or_soft_refresh",
  };
}
