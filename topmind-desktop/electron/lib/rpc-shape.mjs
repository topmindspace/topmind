/**
 * Shallow RPC result shape checks (dev / explicit opt-in).
 *
 * Pure helpers — no Electron deps. Used by rpc-bridge and unit tests.
 * Production success paths for valid payloads are unchanged; mismatches
 * only log (or throw when opts.throwOnMismatch is set).
 */

/**
 * Representative method → required top-level keys (shallow).
 * Keys MUST match production service returns (see workspace-path-ops,
 * workspace-scan-ops, settings-core, ai-model, ai-service). Keep small.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const RPC_RESULT_SHAPES = Object.freeze({
  // pathOps.getFileMeta → { frontmatter, bodyPreview, size, mtime }
  "workspace.getFileMeta": Object.freeze(["frontmatter", "bodyPreview", "size", "mtime"]),
  // scanOps.search / grepWorkspace → { results, count, ... }
  "workspace.search": Object.freeze(["results"]),
  // scanOps.listCategories → { categories, rootPath, ... }
  "workspace.listCategories": Object.freeze(["categories", "rootPath"]),
  // SystemService.getSettings → AppSettings (defaults always include these)
  "system.getSettings": Object.freeze(["theme", "writebackMode"]),
  // getRuntimeStatus → { ready, message, providers }
  "ai.getRuntimeStatus": Object.freeze(["ready", "message"]),
  // listSessions returns AiSession[] — empty schema allows array root
  "ai.listSessions": Object.freeze([]),
});

/**
 * Whether shape checking is enabled for this process.
 * Dev by default; force on with TOPMIND_RPC_SHAPE_CHECK=1; force off with =0.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isRpcShapeCheckEnabled(env = process.env) {
  const flag = String(env.TOPMIND_RPC_SHAPE_CHECK ?? "").trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return env.NODE_ENV !== "production";
}

/**
 * @param {unknown} value
 * @param {readonly string[]} requiredKeys
 * @returns {{ ok: true } | { ok: false, missing: string[], actualType: string, actualKeys: string[] }}
 */
export function assertObjectKeys(value, requiredKeys) {
  const keys = requiredKeys || [];
  if (keys.length === 0) {
    // Empty schema: only reject null/undefined; arrays and objects both ok
    if (value == null) {
      return { ok: false, missing: [], actualType: String(value), actualKeys: [] };
    }
    return { ok: true };
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      missing: [...keys],
      actualType: value == null ? String(value) : Array.isArray(value) ? "array" : typeof value,
      actualKeys: [],
    };
  }
  const actualKeys = Object.keys(/** @type {object} */ (value));
  const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
  if (missing.length > 0) {
    return { ok: false, missing, actualType: "object", actualKeys };
  }
  return { ok: true };
}

/**
 * Check a known RPC method result against its registered shape (if any).
 * Unknown methods always pass (no schema = no check).
 *
 * @param {string} method
 * @param {unknown} result
 * @param {{ shapes?: Record<string, readonly string[]> }} [opts]
 * @returns {{ checked: boolean, ok: boolean, method: string, missing?: string[], actualType?: string, actualKeys?: string[] }}
 */
export function checkRpcResult(method, result, opts = {}) {
  const shapes = opts.shapes || RPC_RESULT_SHAPES;
  const required = shapes[method];
  if (!required) {
    return { checked: false, ok: true, method };
  }
  const verdict = assertObjectKeys(result, required);
  if (verdict.ok) {
    return { checked: true, ok: true, method };
  }
  return {
    checked: true,
    ok: false,
    method,
    missing: verdict.missing,
    actualType: verdict.actualType,
    actualKeys: verdict.actualKeys,
  };
}

/**
 * Dev-mode guard used by the invoke bridge.
 * Logs on mismatch by default; set throwOnMismatch to fail hard in tests.
 *
 * @param {string} method
 * @param {unknown} result
 * @param {{
 *   enabled?: boolean,
 *   throwOnMismatch?: boolean,
 *   log?: (msg: string, detail?: object) => void,
 *   shapes?: Record<string, readonly string[]>,
 * }} [opts]
 * @returns {unknown} result unchanged
 */
export function guardRpcResult(method, result, opts = {}) {
  const enabled = opts.enabled ?? isRpcShapeCheckEnabled();
  if (!enabled) return result;
  const check = checkRpcResult(method, result, { shapes: opts.shapes });
  if (!check.checked || check.ok) return result;
  const detail = {
    method,
    missing: check.missing,
    actualType: check.actualType,
    actualKeys: check.actualKeys,
  };
  const msg = `[rpc-shape] ${method} missing keys: ${(check.missing || []).join(", ") || "(type mismatch)"}`;
  if (opts.throwOnMismatch) {
    const err = new Error(msg);
    Object.assign(err, detail);
    throw err;
  }
  if (typeof opts.log === "function") {
    opts.log(msg, detail);
  } else if (typeof console !== "undefined" && console.warn) {
    console.warn(msg, detail);
  }
  return result;
}
