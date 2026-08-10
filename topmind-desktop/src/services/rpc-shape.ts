/**
 * Renderer-side shallow RPC result shape check (dev / opt-in).
 * Mirrors electron/lib/rpc-shape.mjs for the typed invoke path.
 * Keep representative shapes in sync with the main-process helper.
 */

/**
 * Representative method → required top-level keys (shallow).
 * Keep in sync with electron/lib/rpc-shape.mjs and production service returns.
 */
export const RPC_RESULT_SHAPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // pathOps.getFileMeta → { frontmatter, bodyPreview, size, mtime }
  "workspace.getFileMeta": Object.freeze(["frontmatter", "bodyPreview", "size", "mtime"]),
  // scanOps.search → { results, count, ... }
  "workspace.search": Object.freeze(["results"]),
  // scanOps.listCategories → { categories, rootPath, ... }
  "workspace.listCategories": Object.freeze(["categories", "rootPath"]),
  // SystemService.getSettings → AppSettings
  "system.getSettings": Object.freeze(["theme", "writebackMode"]),
  // getRuntimeStatus → { ready, message, providers }
  "ai.getRuntimeStatus": Object.freeze(["ready", "message"]),
  // listSessions returns AiSession[] — empty schema allows array root
  "ai.listSessions": Object.freeze([] as string[]),
});

export function isRpcShapeCheckEnabled(
  env: { NODE_ENV?: string; TOPMIND_RPC_SHAPE_CHECK?: string } = (
    typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env
  ) || {},
): boolean {
  // Vite: import.meta.env.DEV / PROD; also honor explicit flag when present on process in tests.
  const procEnv =
    typeof process !== "undefined" ? process.env : ({} as NodeJS.ProcessEnv);
  const flag = String(
    procEnv.TOPMIND_RPC_SHAPE_CHECK ?? env.TOPMIND_RPC_SHAPE_CHECK ?? "",
  ).trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  if (typeof import.meta !== "undefined") {
    const viteEnv = (import.meta as { env?: { DEV?: boolean; PROD?: boolean; MODE?: string } }).env;
    if (viteEnv?.PROD === true) return false;
    if (viteEnv?.DEV === true) return true;
  }
  return procEnv.NODE_ENV !== "production";
}

export function assertObjectKeys(
  value: unknown,
  requiredKeys: readonly string[],
):
  | { ok: true }
  | { ok: false; missing: string[]; actualType: string; actualKeys: string[] } {
  const keys = requiredKeys || [];
  if (keys.length === 0) {
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
  const actualKeys = Object.keys(value as object);
  const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
  if (missing.length > 0) {
    return { ok: false, missing, actualType: "object", actualKeys };
  }
  return { ok: true };
}

export function checkRpcResult(
  method: string,
  result: unknown,
  opts: { shapes?: Record<string, readonly string[]> } = {},
): {
  checked: boolean;
  ok: boolean;
  method: string;
  missing?: string[];
  actualType?: string;
  actualKeys?: string[];
} {
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

export function guardRpcResult<T>(
  method: string,
  result: T,
  opts: {
    enabled?: boolean;
    throwOnMismatch?: boolean;
    log?: (msg: string, detail?: object) => void;
    shapes?: Record<string, readonly string[]>;
  } = {},
): T {
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
