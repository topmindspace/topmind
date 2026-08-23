import type { AppSettings, AppSettingsPatch } from "../types";

// All nested settings sections — a partial patch to any of them must never
// wipe sibling keys. Missing keys here silently degrade to whole-section replace.
const NESTED_KEYS = ["ai", "editor", "ui", "weread", "x", "clipBridge", "workspaces", "window", "plugins", "capture", "ingest"] as const;

/** Deep-merge known nested settings objects so partial patches never wipe siblings. */
export function mergeSettingsPatch(base: AppSettingsPatch, patch: AppSettingsPatch): AppSettingsPatch {
  const next: AppSettingsPatch = { ...base, ...patch };
  for (const key of NESTED_KEYS) {
    const b = base[key];
    const p = patch[key];
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const baseObj = b && typeof b === "object" && !Array.isArray(b) ? b : {};
      if (key === "ai") {
        const baseAi = baseObj as AppSettings["ai"] | Record<string, unknown>;
        const patchAi = p as Partial<AppSettings["ai"]> & { manual?: Record<string, string> };
        next.ai = {
          ...baseAi,
          ...patchAi,
          manual: {
            ...((baseAi as { manual?: Record<string, string> }).manual || {}),
            ...(patchAi.manual || {}),
          },
        } as AppSettings["ai"];
      } else if (key === "plugins") {
        const basePl = baseObj as AppSettings["plugins"] | Record<string, unknown>;
        const patchPl = p as NonNullable<Partial<AppSettings["plugins"]>>;
        next.plugins = {
          ...basePl,
          ...patchPl,
          externalEnabled: {
            ...((basePl as { externalEnabled?: Record<string, boolean> }).externalEnabled || {}),
            ...(patchPl.externalEnabled || {}),
          },
        } as AppSettings["plugins"];
      } else {
        (next as Record<string, unknown>)[key] = { ...baseObj, ...p };
      }
    }
  }
  return next;
}

export function applyOptimistic(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
  return mergeSettingsPatch(settings, patch) as AppSettings;
}
