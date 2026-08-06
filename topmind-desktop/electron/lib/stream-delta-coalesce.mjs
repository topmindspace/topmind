/**
 * Frame-scale coalescing for AI stream text/reasoning deltas.
 *
 * High-frequency token chunks are batched into ≤1 flush per interval
 * (default ~16ms ≈ one frame) so IPC to the renderer is bounded.
 * Non-delta events flush pending buffers first so ordering stays correct.
 */

/**
 * @typedef {"text" | "reasoning"} DeltaKind
 */

/**
 * @param {{
 *   intervalMs?: number,
 *   emit: (event: object) => void,
 *   now?: () => number,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 *   clearSchedule?: (id: unknown) => void,
 * }} opts
 */
export function createDeltaCoalescer(opts) {
  const intervalMs = Math.max(0, Number(opts.intervalMs ?? 16));
  const emit = opts.emit;
  const now = opts.now || (() => Date.now());
  const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule = opts.clearSchedule || ((id) => clearTimeout(/** @type {any} */ (id)));

  /** @type {Record<DeltaKind, string>} */
  const buffers = { text: "", reasoning: "" };
  /** @type {unknown} */
  let timer = null;
  let flushCount = 0;
  let deltaCount = 0;

  function flushKind(/** @type {DeltaKind} */ kind) {
    const delta = buffers[kind];
    if (!delta) return;
    buffers[kind] = "";
    flushCount += 1;
    emit({ type: kind, delta });
  }

  function flushAll() {
    if (timer != null) {
      clearSchedule(timer);
      timer = null;
    }
    flushKind("reasoning");
    flushKind("text");
  }

  function scheduleFlush() {
    if (timer != null) return;
    if (intervalMs === 0) {
      flushAll();
      return;
    }
    timer = schedule(() => {
      timer = null;
      flushAll();
    }, intervalMs);
  }

  /**
   * Push a text or reasoning delta into the coalesce buffer.
   * @param {DeltaKind} kind
   * @param {string} delta
   */
  function pushDelta(kind, delta) {
    if (delta == null || delta === "") return;
    deltaCount += 1;
    buffers[kind] = (buffers[kind] || "") + String(delta);
    scheduleFlush();
  }

  /**
   * Emit a non-delta event. Flushes pending deltas first so UI order is preserved.
   * @param {object} event
   */
  function pushEvent(event) {
    if (!event || typeof event !== "object") return;
    const type = /** @type {{ type?: string, delta?: string }} */ (event).type;
    if (type === "text" || type === "reasoning") {
      pushDelta(/** @type {DeltaKind} */ (type), /** @type {{ delta?: string }} */ (event).delta || "");
      return;
    }
    flushAll();
    emit(event);
  }

  /**
   * Force flush remaining buffers (call on stream end / error / cancel).
   */
  function flush() {
    flushAll();
  }

  function stats() {
    return {
      deltaCount,
      flushCount,
      pendingText: buffers.text.length,
      pendingReasoning: buffers.reasoning.length,
    };
  }

  return {
    pushDelta,
    pushEvent,
    flush,
    stats,
    /** @internal test helper */
    _now: now,
  };
}
