/**
 * Pure hot-path helpers used by the desktop renderer.
 * Callable without Electron so tests can drive the shipped functions.
 */

export type NotifyBatch = { text: string; reasoning: string };

/**
 * One `publish` per animation frame for a burst of text/reasoning deltas.
 * `flush` publishes immediately (stream end, tool event, reset).
 * `clear` drops the pending burst without publishing (superseded turn).
 */
export function createNotifyBatcher(opts: {
  publish: (batch: NotifyBatch) => void;
  scheduleFrame?: (fn: () => void) => number;
  cancelFrame?: (id: number) => void;
}) {
  let pending: NotifyBatch = { text: "", reasoning: "" };
  let frame: number | null = null;

  function flushBody() {
    if (!pending.text && !pending.reasoning) return;
    const batch = pending;
    pending = { text: "", reasoning: "" };
    opts.publish(batch);
  }

  function cancelScheduled() {
    if (frame == null) return;
    const id = frame;
    frame = null;
    if (opts.cancelFrame) opts.cancelFrame(id);
    else if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  }

  function schedule() {
    if (frame != null) return;
    if (!pending.text && !pending.reasoning) return;
    if (opts.scheduleFrame) {
      frame = opts.scheduleFrame(() => {
        frame = null;
        flushBody();
      });
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(() => {
        frame = null;
        flushBody();
      });
      return;
    }
    flushBody();
  }

  return {
    append(text: string, reasoning: string) {
      if (text) pending.text += text;
      if (reasoning) pending.reasoning += reasoning;
      schedule();
    },
    flush() {
      cancelScheduled();
      flushBody();
    },
    clear() {
      cancelScheduled();
      pending = { text: "", reasoning: "" };
    },
  };
}

/**
 * One interval, started at most once. While `isHidden` is true the timer
 * is not running, so hidden windows do not wake to poll.
 */
export function createHiddenAwareInterval(opts: {
  intervalMs: number;
  isHidden: () => boolean;
  onTick: () => void;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
}) {
  const setIntervalFn = opts.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn =
    opts.clearIntervalFn ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  let timer: unknown = null;

  function stop() {
    if (timer == null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  function start() {
    if (timer != null) return;
    if (opts.isHidden()) return;
    timer = setIntervalFn(() => {
      if (opts.isHidden()) {
        stop();
        return;
      }
      opts.onTick();
    }, opts.intervalMs);
  }

  return {
    start,
    stop,
    get ticking() {
      return timer != null;
    },
  };
}

/** Collapse a burst of raw events into one trailing call. */
export function createDebouncedTask(
  delayMs: number,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  cancel: (id: unknown) => void = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
) {
  let handle: unknown = null;
  return {
    schedule(task: () => void) {
      if (handle != null) cancel(handle);
      handle = schedule(() => {
        handle = null;
        task();
      }, delayMs);
    },
    cancel() {
      if (handle != null) cancel(handle);
      handle = null;
    },
  };
}

/**
 * At most one scheduled frame. Extra calls before the frame runs are dropped
 * (the latest task is not queued — the first scheduled task runs once).
 * Selection-scroll uses this so layout work is not per wheel tick.
 */
export function createRafGate(
  schedule: (fn: () => void) => number = (fn) => requestAnimationFrame(fn),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let id = 0;
  return {
    run(task: () => void) {
      if (id) return;
      const handle = schedule(() => {
        id = 0;
        task();
      });
      id = handle || 1;
    },
    cancel() {
      if (!id) return;
      cancel(id);
      id = 0;
    },
  };
}
