/**
 * Agent step budget shown in Settings. Must match
 * `electron/lib/settings-core.mjs` AGENT_STEPS_* (locked by tests).
 */
export const AGENT_STEPS_MIN = 3;
export const AGENT_STEPS_DEFAULT = 32;
export const AGENT_STEPS_MAX = 80;

/** Selectable values; always includes min / default / max. */
export const AGENT_STEP_OPTION_VALUES = [3, 8, 16, 24, 32, 48, 80] as const;

/** Settings control fallback when `maxAgentSteps` is missing — never a stale 12. */
export function fallbackMaxAgentSteps(value: number | string | null | undefined): number {
  if (value == null || value === "") return AGENT_STEPS_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return AGENT_STEPS_DEFAULT;
  return Math.max(AGENT_STEPS_MIN, Math.min(AGENT_STEPS_MAX, Math.round(n)));
}
