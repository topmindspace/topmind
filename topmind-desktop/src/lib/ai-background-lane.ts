/**
 * Background AI lane — serialize token-heavy prep paths.
 *
 * Lanes:
 * - **Background** (this module): suggest prepare · todo maintain · future prep ops
 * - **User-primary** (NOT here): agent stream (AiStore) · inline complete
 *
 * Why:
 * - Concurrent LLM calls thrash rate limits and race StatusBar exclusive chips
 * - Boot stampede (autoPrepare + autoMaintainTodos) must not pile on
 * - Agent chat stays responsive: never enters this lane
 *
 * Semantics:
 * - Max 1 background job running (FIFO chain)
 * - Failures do not break the chain
 * - Snapshot for StatusBar multi-work tooltips
 */

export type BackgroundAiKind = "suggest" | "todo" | (string & {});

export type BackgroundAiSnapshot = {
  active: BackgroundAiKind | null;
  /** Jobs waiting behind the active one (order preserved) */
  queued: BackgroundAiKind[];
  busy: boolean;
};

type Queued = {
  kind: BackgroundAiKind;
};

let active: BackgroundAiKind | null = null;
const waiting: Queued[] = [];
/** Chain of background work — never reject the chain itself */
let chain: Promise<void> = Promise.resolve();

let listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeBackgroundAi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBackgroundAiSnapshot(): BackgroundAiSnapshot {
  return {
    active,
    queued: waiting.map((w) => w.kind),
    busy: active !== null || waiting.length > 0,
  };
}

/**
 * Run `fn` on the background AI lane (serialized).
 * Always eventually runs; previous job failure does not skip later jobs.
 */
export function enqueueBackgroundAi<T>(
  kind: BackgroundAiKind,
  fn: () => Promise<T>,
): Promise<T> {
  const slot: Queued = { kind };
  waiting.push(slot);
  notify();

  const run = chain.then(async () => {
    // Move from waiting → active
    const idx = waiting.indexOf(slot);
    if (idx >= 0) waiting.splice(idx, 1);
    active = kind;
    notify();
    try {
      return await fn();
    } finally {
      if (active === kind) active = null;
      notify();
    }
  });

  // Keep chain alive regardless of success/failure
  chain = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

/** Test helper */
export function __resetBackgroundAiLaneForTests() {
  active = null;
  waiting.length = 0;
  chain = Promise.resolve();
  listeners = new Set();
}
