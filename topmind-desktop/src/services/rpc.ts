/** v4 RPC Proxy — single gateway replacing 306-line ipc.ts. */

import { guardRpcResult } from "./rpc-shape";

function bridge(): topmindBridge | undefined {
  return typeof window !== "undefined" ? window.topmind : undefined;
}

export function hasBridge(): boolean {
  return Boolean(bridge());
}

export async function invoke<T = unknown>(method: string, params?: unknown): Promise<T> {
  const m = bridge();
  if (!m) throw new Error(`[rpc] ${method}: preload bridge not injected.`);
  const result = (await m.invoke(method, params)) as T;
  // Dev / opt-in shallow shape check on the typed API boundary
  return guardRpcResult(method, result) as T;
}

export function subscribe(event: string, handler: (payload: unknown) => void): () => void {
  const m = bridge();
  return m ? m.subscribe(event, handler) : () => {};
}
