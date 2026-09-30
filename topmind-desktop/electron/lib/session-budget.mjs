/**
 * Session-internal adaptive budget.
 *
 * One budget does not fit every turn: a greeting needs no agent steps; a
 * lookup needs a couple of tool calls; a multi-file task needs more. This
 * module derives steps / auto-continues / context tightness from the turn
 * kind and the live goal shape so mid-size models stay within their comfort
 * zone and long tasks still get room to finish.
 *
 * No vectors, no semantic search — pure heuristics over text + goal state.
 */
import { classifyTurn } from "./agent-goal-protocol.mjs";

/** Hard caps (never exceeded, regardless of heuristics). */
export const BUDGET_MAX_STEPS = 80;
export const BUDGET_MAX_CONTINUES = 6;

/**
 * @typedef {object} SessionBudget
 * @property {number} maxAgentSteps     - tool-call budget for this invoke
 * @property {number} maxAutoContinues  - how many goal-aware continues
 * @property {number} contextTighten    - 0..1 multiplier hint for compact (1 = normal)
 * @property {"light"|"query"|"task"} turnKind
 * @property {string} reason            - why this budget (for logs)
 */

/**
 * Estimate "task weight" from the user text + goal state.
 * Longer, multi-clause, write-oriented instructions deserve more room.
 * @param {string} userText
 * @param {{ plan?: string[], criteria?: string[], doneCriteria?: string[] }} [goal]
 */
function estimateWorkload(userText, goal) {
  const s = String(userText || "").trim();
  let w = 0;
  // Length band (chars ≈ instruction complexity)
  w += s.length > 200 ? 3 : s.length > 80 ? 2 : s.length > 30 ? 1 : 0;
  // Multi-clause / list-like
  if (/[，,；;。.].{0,40}[，,；;。.]/u.test(s)) w += 1;
  if (/\d+[.)、]\s*\S/u.test(s) || /\n\s*[-*]\s+/u.test(s)) w += 1;
  // Write / multi-file verbs
  if (/(?:整理|归档|批量|全部|每个|所有|迁移|重构|研究|调研|综述|对比)/u.test(s)) w += 2;
  // Explicit multi-part deliverables
  if (/(?:并|以及|还有|然后|接着|最后)/u.test(s)) w += 1;
  // Goal plan / criteria add real surface area
  w += Math.min(3, (goal?.plan?.length || 0) + (goal?.criteria?.length || 0));
  return w;
}

/**
 * Resolve the adaptive budget for one invoke.
 * User settings override when explicitly larger (user asked for more room).
 *
 * @param {{
 *   userText: string,
 *   goal?: { plan?: string[], criteria?: string[], doneCriteria?: string[] },
 *   settings?: { maxAgentSteps?: number },
 *   contextWindow?: number,
 *   priorToolFailures?: number,
 * }} p
 * @returns {SessionBudget}
 */
export function resolveSessionBudget(p) {
  const userText = String(p?.userText || "");
  const turnKind = classifyTurn(userText);
  const settingsSteps = Number(p?.settings?.maxAgentSteps);

  // Light turns: no agent loop room — a conversational reply is enough.
  if (turnKind === "light") {
    return {
      maxAgentSteps: 0,
      maxAutoContinues: 0,
      contextTighten: 0.7,
      turnKind,
      reason: "light-turn",
    };
  }

  const workload = estimateWorkload(userText, p?.goal);
  const failures = Math.max(0, Number(p?.priorToolFailures) || 0);

  /** Base steps by kind + workload. */
  let steps;
  let continues;
  let tighten = 1;
  if (turnKind === "query") {
    // Lookups: 2–6 tool calls is plenty (evidence is also host-injected).
    steps = Math.min(6, 2 + workload);
    continues = 0;
    tighten = 0.85;
  } else {
    // Tasks: scale with workload; 8 is a small edit, 32 is a multi-file job.
    steps = Math.min(32, 8 + workload * 4);
    continues = workload >= 4 ? 4 : workload >= 2 ? 2 : 1;
    if (workload >= 6) {
      steps = Math.min(48, steps + 8);
      continues = Math.min(BUDGET_MAX_CONTINUES, continues + 1);
    }
  }

  // Tool failures: give one more step band so retries are not starved.
  if (failures > 0 && turnKind === "task") {
    steps = Math.min(56, steps + failures * 2);
  }

  // Unknown / huge context windows stay safer (avoid mid-task compaction storms).
  const cw = Number(p?.contextWindow) || 0;
  if (cw > 0 && cw < 32_000) {
    tighten = Math.min(tighten, 0.7);
    steps = Math.max(4, Math.floor(steps * 0.75));
  }

  // Explicit user setting wins when it asks for more room (never shrinks below it).
  if (Number.isFinite(settingsSteps) && settingsSteps > 0) {
    steps = Math.max(steps, Math.min(BUDGET_MAX_STEPS, Math.floor(settingsSteps)));
  }

  return {
    maxAgentSteps: Math.max(1, Math.floor(steps)),
    maxAutoContinues: Math.min(BUDGET_MAX_CONTINUES, Math.floor(continues)),
    contextTighten: Math.max(0.4, Math.min(1, tighten)),
    turnKind,
    reason: `workload=${workload}${failures ? ` failures=${failures}` : ""}`,
  };
}
