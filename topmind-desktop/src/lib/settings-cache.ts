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
  // Deep-merge known nested bags so layout-only shell writes do not wipe locale etc.
  // when callers pass partial nested objects after a prior setCachedSettings.
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
  cache = next;
  return cache;
}
