import type { AppSettings } from "../types";

const NESTED_KEYS = ["ai", "editor", "ui", "weread", "x", "clipBridge", "workspaces", "window", "plugins"] as const;

/** Deep-merge known nested settings objects so partial patches never wipe siblings. */
export function mergeSettingsPatch(base: Partial<AppSettings>, patch: Partial<AppSettings>): Partial<AppSettings> {
  const next: Partial<AppSettings> = { ...base, ...patch };
  for (const key of NESTED_KEYS) {
    const b = base[key];
    const p = patch[key];
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const baseObj = b && typeof b === "object" && !Array.isArray(b) ? b : {};
      if (key === "ai") {
        const baseAi = baseObj as AppSettings["ai"] | Record<string, unknown>;
        const patchAi = p as AppSettings["ai"] & { manual?: Record<string, string> };
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
        const patchPl = p as NonNullable<AppSettings["plugins"]>;
        next.plugins = {
          ...basePl,
          ...patchPl,
          externalEnabled: {
            ...((basePl as { externalEnabled?: Record<string, boolean> }).externalEnabled || {}),
            ...(patchPl.externalEnabled || {}),
          },
        };
      } else {
        (next as Record<string, unknown>)[key] = { ...baseObj, ...p };
      }
    }
  }
  return next;
}

export function applyOptimistic(settings: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return mergeSettingsPatch(settings, patch) as AppSettings;
}
