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

export const SUGGEST_SOFT_THROTTLE_MS = 5000;

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
  /**
   * Safety-poll tick — only refresh pending writes, skip kernel suggest
   * to avoid unnecessary IPC round-trips every poll cycle.
   * Force (user 💡 refresh) still runs.
   */
  pollOnly?: boolean;
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
    // Still fetch pending writes even when throttled — user confirm path
    // must stay responsive; kernel suggest is the expensive part to skip.
    return {
      runKernelSuggest: false,
      runPendingWrites: true,
      soft: true,
      reason: "soft_throttled",
    };
  }

  if (!opts.autoPrepare && !force) {
    return {
      runKernelSuggest: false,
      runPendingWrites,
      soft: false,
      reason: "auto_prepare_off",
    };
  }

  // Safety-poll tick: only refresh pending writes, skip kernel suggest.
  // Kernel suggest is event-driven (file changes, apply, manual refresh) —
  // the poll is a safety net for pending writes only.
  if (opts.pollOnly === true && !force) {
    return {
      runKernelSuggest: false,
      runPendingWrites,
      soft: true,
      reason: "soft_throttled",
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
