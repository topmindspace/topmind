/**
 * Last-known AppSettings — makes Settings dialog paint instantly
 * while the IPC refresh settles (avoids full-panel spinner on re-open).
 */
import type { AppSettings } from "../types";

let cache: AppSettings | null = null;

export function getCachedSettings(): AppSettings | null {
  return cache;
}

export function setCachedSettings(next: AppSettings | null): void {
  cache = next;
}

export function patchCachedSettings(patch: Partial<AppSettings>): AppSettings | null {
  if (!cache) return null;
  const next = { ...cache, ...patch } as AppSettings;
  // Deep-merge the nested bags current callers actually pass partial objects
  // for (ui layout / editor prefs / ai). Other sections must be passed whole —
  // a partial clipBridge/weread here would silently wipe sibling keys.
  if (patch.ui && typeof patch.ui === "object" && !Array.isArray(patch.ui)) {
    next.ui = { ...(cache.ui || {}), ...patch.ui };
  }
  if (patch.editor && typeof patch.editor === "object" && !Array.isArray(patch.editor)) {
    next.editor = { ...(cache.editor || {}), ...patch.editor } as AppSettings["editor"];
  }
  if (patch.ai && typeof patch.ai === "object" && !Array.isArray(patch.ai)) {
    const baseAi = cache.ai || ({} as AppSettings["ai"]);
    const patchAi = patch.ai as AppSettings["ai"];
    next.ai = {
      ...baseAi,
      ...patchAi,
      manual: { ...(baseAi.manual || {}), ...(patchAi.manual || {}) },
    } as AppSettings["ai"];
  }
  if (patch.clipBridge && typeof patch.clipBridge === "object" && !Array.isArray(patch.clipBridge)) {
    next.clipBridge = { ...(cache.clipBridge || {}), ...patch.clipBridge } as AppSettings["clipBridge"];
  }
  cache = next;
  return cache;
}
