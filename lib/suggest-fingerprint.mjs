/**
 * Durable activity fingerprints for suggest-engine AI skip across process restarts.
 *
 * System plane only: `{workspace}/.topmind/suggest-fingerprints.json` (deletable/rebuildable).
 * Policy:
 * - Soft / cold boot: if activity fingerprint unchanged since last successful AI analysis,
 *   skip re-calling the model for that key (no thrash every launch).
 * - Force regenerate (user refresh / force flag): caller may clear or ignore.
 * - Never stores suggestion content — only opaque hashes + timestamps.
 */

import fs from "node:fs";
import path from "node:path";

export const SUGGEST_FINGERPRINT_REL = ".topmind/suggest-fingerprints.json";

/**
 * @typedef {{ hashes: Record<string, string>, updatedAt?: string }} SuggestFingerprintState
 */

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function suggestFingerprintPath(workspaceRoot) {
  return path.join(workspaceRoot, SUGGEST_FINGERPRINT_REL);
}

/**
 * @param {string} workspaceRoot
 * @returns {SuggestFingerprintState}
 */
export function loadSuggestFingerprints(workspaceRoot) {
  const abs = suggestFingerprintPath(workspaceRoot);
  try {
    if (!fs.existsSync(abs)) return { hashes: {} };
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    const hashes =
      raw && typeof raw.hashes === "object" && raw.hashes && !Array.isArray(raw.hashes)
        ? /** @type {Record<string, string>} */ (raw.hashes)
        : {};
    // Also accept flat legacy { "activity#x": "hash" } shape
    if (Object.keys(hashes).length === 0 && raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (k === "hashes" || k === "updatedAt") continue;
        if (typeof v === "string" && v.length > 0) hashes[k] = v;
      }
    }
    return {
      hashes,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    };
  } catch {
    return { hashes: {} };
  }
}

/**
 * @param {string} workspaceRoot
 * @param {SuggestFingerprintState} state
 */
export function saveSuggestFingerprints(workspaceRoot, state) {
  const abs = suggestFingerprintPath(workspaceRoot);
  const dir = path.dirname(abs);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      hashes: state.hashes || {},
      updatedAt: new Date().toISOString(),
    };
    // Atomic tmp+rename — a truncated JSON must not reset skip state.
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, abs);
  } catch {
    /* system plane best-effort */
  }
}

/**
 * True when we already analyzed this activity fingerprint for the given key.
 * @param {string} workspaceRoot
 * @param {string} key e.g. activity#promote | activity#summary
 * @param {string} fingerprint
 * @param {Map<string, string>} [memoryCache] optional process-level hot cache
 */
export function shouldSkipAiForFingerprint(workspaceRoot, key, fingerprint, memoryCache) {
  if (!key || !fingerprint) return false;
  if (memoryCache && memoryCache.get(key) === fingerprint) return true;
  const state = loadSuggestFingerprints(workspaceRoot);
  return state.hashes[key] === fingerprint;
}

/**
 * Record successful AI analysis for key@fingerprint (memory + durable).
 * @param {string} workspaceRoot
 * @param {string} key
 * @param {string} fingerprint
 * @param {Map<string, string>} [memoryCache]
 */
export function markAiFingerprint(workspaceRoot, key, fingerprint, memoryCache) {
  if (!key || !fingerprint) return;
  if (memoryCache) memoryCache.set(key, fingerprint);
  const state = loadSuggestFingerprints(workspaceRoot);
  if (state.hashes[key] === fingerprint) return;
  state.hashes[key] = fingerprint;
  saveSuggestFingerprints(workspaceRoot, state);
}

/**
 * Clear durable + memory fingerprints (force regenerate).
 * @param {string} [workspaceRoot]
 * @param {Map<string, string>} [memoryCache]
 */
export function clearSuggestFingerprints(workspaceRoot, memoryCache) {
  if (memoryCache) memoryCache.clear();
  if (!workspaceRoot) return;
  const abs = suggestFingerprintPath(workspaceRoot);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}
