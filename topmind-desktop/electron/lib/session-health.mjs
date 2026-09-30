/**
 * Session health — failure-rate circuit breaker.
 *
 * An agent that keeps calling the same broken tool burns the step budget and
 * the user's patience. This tracker watches tool outcomes per session and
 * trips when the loop is clearly thrashing: then the host should stop
 * auto-continuing and hand back an honest incomplete + the retry hint.
 *
 * Pure state machine — no I/O. Call `recordToolOutcome` after each tool run;
 * `shouldTrip` before spending another continue.
 */

/** Sliding window size (last N tool calls). */
const WINDOW = 12;
/** Trip when this share of the window failed. */
const TRIP_FAILURE_RATE = 0.6;
/** Absolute floor: need at least this many failures before tripping. */
const TRIP_MIN_FAILURES = 4;
/** Consecutive same-tool failures that also trip (one stubborn tool). */
const TRIP_SAME_TOOL = 3;

/**
 * @typedef {object} SessionHealthState
 * @property {Array<{ name: string, ok: boolean }>} recent
 * @property {number} totalCalls
 * @property {number} totalFailures
 * @property {string|null} lastFailedTool
 * @property {boolean} tripped
 * @property {string|null} tripReason
 */

/**
 * @returns {SessionHealthState}
 */
export function createSessionHealth() {
  return {
    recent: [],
    totalCalls: 0,
    totalFailures: 0,
    lastFailedTool: null,
    tripped: false,
    tripReason: null,
  };
}

/**
 * Record one tool outcome. Mutates a shallow copy.
 * @param {SessionHealthState} state
 * @param {{ name: string, ok: boolean }} outcome
 * @returns {SessionHealthState}
 */
export function recordToolOutcome(state, outcome) {
  const name = String(outcome?.name || "unknown");
  const ok = Boolean(outcome?.ok);
  const recent = [...(state.recent || []), { name, ok }].slice(-WINDOW);
  const totalCalls = (state.totalCalls || 0) + 1;
  const totalFailures = (state.totalFailures || 0) + (ok ? 0 : 1);
  const lastFailedTool = ok ? state.lastFailedTool || null : name;

  let tripped = Boolean(state.tripped);
  let tripReason = state.tripReason || null;

  if (!tripped) {
    const failures = recent.filter((r) => !r.ok).length;
    const rate = recent.length > 0 ? failures / recent.length : 0;
    if (recent.length >= TRIP_MIN_FAILURES && failures >= TRIP_MIN_FAILURES && rate >= TRIP_FAILURE_RATE) {
      tripped = true;
      tripReason = `failure-rate ${(rate * 100).toFixed(0)}% (${failures}/${recent.length})`;
    } else if (!ok) {
      // Same tool failing repeatedly in the window.
      let streak = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].name === name && !recent[i].ok) streak += 1;
        else break;
      }
      if (streak >= TRIP_SAME_TOOL) {
        tripped = true;
        tripReason = `same-tool-streak ${name}×${streak}`;
      }
    }
  }

  return {
    recent,
    totalCalls,
    totalFailures,
    lastFailedTool,
    tripped,
    tripReason,
  };
}

/**
 * Should the host stop auto-continuing and close honestly?
 * @param {SessionHealthState} state
 */
export function shouldTrip(state) {
  return Boolean(state?.tripped);
}

/**
 * Human summary for logs / the incomplete footer.
 * @param {SessionHealthState} state
 * @returns {string}
 */
export function describeHealth(state) {
  if (!state) return "";
  const f = state.totalFailures || 0;
  const c = state.totalCalls || 0;
  if (state.tripped) {
    return `circuit-open: ${state.tripReason || "unknown"} (calls=${c} fail=${f})`;
  }
  return `circuit-closed (calls=${c} fail=${f})`;
}
