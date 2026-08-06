/**
 * Serialize enhanced URL renders (max 1 concurrent) to protect Chromium memory.
 */
let chain = Promise.resolve();
let active = 0;

export function getRenderQueueStats() {
  return { active, pending: active > 0 ? 1 : 0 };
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function enqueueRender(fn) {
  const run = chain.then(async () => {
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
    }
  });
  // Prevent unbroken rejection chains from stalling the queue
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
