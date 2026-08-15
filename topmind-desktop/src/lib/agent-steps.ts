/**
 * Agent step budget shown in Settings. Must match
 * `electron/lib/settings-core.mjs` AGENT_STEPS_* (locked by tests).
 */
export const AGENT_STEPS_MIN = 3;
export const AGENT_STEPS_DEFAULT = 20;
export const AGENT_STEPS_MAX = 50;

/** Selectable values; always includes min / default / max. */
export const AGENT_STEP_OPTION_VALUES = [3, 8, 12, 16, 20, 30, 50] as const;

/** Settings control fallback when `maxAgentSteps` is missing — never a stale 12. */
export function fallbackMaxAgentSteps(value: number | string | null | undefined): number {
  if (value == null || value === "") return AGENT_STEPS_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return AGENT_STEPS_DEFAULT;
  return Math.max(AGENT_STEPS_MIN, Math.min(AGENT_STEPS_MAX, Math.round(n)));
}
