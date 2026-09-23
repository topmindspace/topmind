/**
 * Durable "user said no" memory for suggest-engine.
 *
 * System plane only: `{workspace}/.topmind/suggest-dismissed.json` (deletable/rebuildable).
 *
 * Why this exists, and how it differs from `suggest-fingerprint.mjs`:
 * - Fingerprints answer "did we already analyze this exact activity window?"
 *   They are cleared by `force` — that is correct, force means "look again".
 * - Dismissals answer "the user already rejected this specific card."
 *   They must SURVIVE `force` (a manual refresh is not a change of mind) and
 *   survive restarts. Hence a separate file, never touched by
 *   `clearSuggestFingerprints`.
 *
 * Suggestion ids are content-addressed (`inbox-{rel}` / `stale-{rel}` /
 * `digest-{period}` / `ai-summary-{period}` / `promote-stream-hint`…), so a
 * dismissal keeps suppressing the same card while the underlying path/period
 * is unchanged, and stops applying by itself once the source is renamed or the
 * period rolls over — which is the wanted behaviour.
 *
 * TTL bounds the "no" so it cannot become a permanent blind spot the user has
 * no way to recover from: a dismissal older than {@link DISMISS_TTL_DAYS} is
 * pruned on read. Deleting the file also resets everything.
 */

import fs from "node:fs";
import path from "node:path";

export const SUGGEST_DISMISSED_REL = ".topmind/suggest-dismissed.json";

/** Dismissals older than this are forgotten (pruned lazily on read/write). */
export const DISMISS_TTL_DAYS = 30;

const TTL_MS = DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * @typedef {{ ids: Record<string, string>, updatedAt?: string }} SuggestDismissedState
 */

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function suggestDismissedPath(workspaceRoot) {
  return path.join(workspaceRoot, SUGGEST_DISMISSED_REL);
}

/**
 * Drop entries older than the TTL. Pure — returns a new map.
 * @param {Record<string, string>} ids
 * @param {number} [nowMs]
 * @returns {Record<string, string>}
 */
export function pruneDismissedIds(ids, nowMs = Date.now()) {
  /** @type {Record<string, string>} */
  const kept = {};
  if (!ids || typeof ids !== "object") return kept;
  for (const [id, iso] of Object.entries(ids)) {
    if (!id) continue;
    const t = Date.parse(String(iso));
    // Unparseable timestamps are kept — better a stale "no" than a resurrected card.
    if (Number.isNaN(t) || nowMs - t < TTL_MS) kept[id] = String(iso);
  }
  return kept;
}

/**
 * @param {string} workspaceRoot
 * @returns {SuggestDismissedState}
 */
export function loadDismissedSuggestions(workspaceRoot) {
  const abs = suggestDismissedPath(workspaceRoot);
  try {
    if (!fs.existsSync(abs)) return { ids: {} };
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    const rawIds =
      raw && typeof raw.ids === "object" && raw.ids && !Array.isArray(raw.ids)
        ? /** @type {Record<string, string>} */ (raw.ids)
        : {};
    return {
      ids: pruneDismissedIds(rawIds),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    };
  } catch {
    return { ids: {} };
  }
}

/**
 * @param {string} workspaceRoot
 * @param {SuggestDismissedState} state
 */
export function saveDismissedSuggestions(workspaceRoot, state) {
  const abs = suggestDismissedPath(workspaceRoot);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const payload = {
      ids: pruneDismissedIds(state.ids || {}),
      updatedAt: new Date().toISOString(),
    };
    // Atomic tmp+rename — a truncated JSON must not silently un-dismiss cards.
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, abs);
  } catch {
    /* system plane best-effort */
  }
}

/**
 * Record one or more rejections. Idempotent; refreshes the timestamp on re-dismiss.
 * @param {string} workspaceRoot
 * @param {string|string[]} ids
 * @returns {number} number of ids written
 */
export function markSuggestionsDismissed(workspaceRoot, ids) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (list.length === 0) return 0;
  const state = loadDismissedSuggestions(workspaceRoot);
  const nowIso = new Date().toISOString();
  for (const id of list) state.ids[id] = nowIso;
  saveDismissedSuggestions(workspaceRoot, state);
  return list.length;
}

/**
 * @param {string} workspaceRoot
 * @param {string} id
 * @param {Map<string, string>} [memoryCache] optional process-level hot cache
 * @returns {boolean}
 */
export function isSuggestionDismissed(workspaceRoot, id, memoryCache) {
  const key = String(id || "").trim();
  if (!key) return false;
  if (memoryCache && memoryCache.has(key)) return true;
  return Object.prototype.hasOwnProperty.call(loadDismissedSuggestions(workspaceRoot).ids, key);
}

/**
 * Drop dismissed cards from a generated batch.
 * Shape-preserving: returns the same array instance when nothing was filtered.
 * @template {{ id?: string }} T
 * @param {string} workspaceRoot
 * @param {T[]} suggestions
 * @param {Map<string, string>} [memoryCache]
 * @returns {T[]}
 */
export function filterDismissedSuggestions(workspaceRoot, suggestions, memoryCache) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (list.length === 0) return list;
  const dismissed = loadDismissedSuggestions(workspaceRoot).ids;
  // Two independent sources — disk is empty most of the time, so the cache must
  // still be consulted. Short-circuit only when neither has anything to say.
  const cacheHas = memoryCache && memoryCache.size > 0 ? memoryCache : null;
  if (Object.keys(dismissed).length === 0 && !cacheHas) return list;
  const kept = list.filter((s) => {
    const id = String(s?.id || "");
    if (!id) return true;
    if (cacheHas && cacheHas.has(id)) return false;
    return !Object.prototype.hasOwnProperty.call(dismissed, id);
  });
  return kept.length === list.length ? list : kept;
}

/**
 * Forget every dismissal (user-facing "reset" / tests). Does NOT touch fingerprints.
 * @param {string} [workspaceRoot]
 * @param {Map<string, string>} [memoryCache]
 */
export function clearDismissedSuggestions(workspaceRoot, memoryCache) {
  if (memoryCache) memoryCache.clear();
  if (!workspaceRoot) return;
  const abs = suggestDismissedPath(workspaceRoot);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}
