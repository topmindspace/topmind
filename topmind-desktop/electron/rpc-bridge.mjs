/**
 * v4 RPC Bridge — single IPC channel replaces 50+ channels.
 *
 * preload exposes: invoke(method, params) + subscribe(event, handler)
 * main process routes: 'rpc:invoke' → services[service][method](params, ctx)
 */

import { logError } from "./lib/writeback.mjs";
import { guardRpcResult } from "./lib/rpc-shape.mjs";

/**
 * Validate + resolve an RPC target. Pure — exported for tests.
 * @returns {{ fn: Function, params: object }}
 */
export function resolveRpcTarget(services, method, params) {
  // Strict "service.fn" shape — rejects extra segments, empty parts, non-identifiers
  if (typeof method !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/u.test(method)) {
    throw new Error(`Invalid RPC method: ${method}`);
  }
  // params must be a plain object when present (never array/string/null-proto tricks)
  if (params !== undefined && params !== null) {
    if (typeof params !== "object" || Array.isArray(params)) {
      throw new Error(`Invalid RPC params for ${method}: expected object`);
    }
  }

  const [serviceName, fnName] = method.split(".");
  const service = services[serviceName];
  // hasOwnProperty: blocks prototype chain lookups (constructor / __proto__ / hasOwnProperty…)
  if (
    !service ||
    !Object.prototype.hasOwnProperty.call(service, fnName) ||
    typeof service[fnName] !== "function"
  ) {
    throw new Error(`Unknown RPC method: ${method}`);
  }
  return { fn: service[fnName].bind(service), params: params ?? {} };
}

/**
 * Register the single RPC handler.
 * @param {Object} services - { workspace: {...}, ai: {...}, system: {...}, tool: {...} }
 * @param {Function} getContext - returns shared context (workspaceRoot, appSettings, etc.)
 */
export async function registerRpcBridge(services, getContext) {
  // Lazy import: keeps resolveRpcTarget unit-testable outside Electron
  const { ipcMain } = await import("electron");
  ipcMain.handle("rpc:invoke", async (_event, method, params) => {
    const { fn, params: safeParams } = resolveRpcTarget(services, method, params);
    try {
      const ctx = getContext();
      const result = await fn(safeParams, ctx);
      // Dev / opt-in shallow shape check — does not change valid success paths
      return guardRpcResult(method, result, {
        log: (msg, detail) => logError("rpc-shape", msg, detail || {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("rpc", `${method} failed`, { error: message });
      throw err;
    }
  });
}

/**
 * Send an event to the renderer process via the unified event bus.
 */
export function emitToRenderer(window, event, payload) {
  if (window && !window.isDestroyed()) {
    window.webContents.send(event, payload);
  }
}
