/**
 * Ambient types for `#kernel/agent-goal-protocol.mjs` (vendored Kernel module).
 * Mirrors lib/agent-goal-protocol.mjs exports used by the Obsidian chat loop.
 */

export type GoalStatus =
  | "idle"
  | "planning"
  | "working"
  | "verifying"
  | "done"
  | "incomplete"
  | "blocked";

export interface GoalState {
  goal: string;
  plan: string[];
  criteria: string[];
  doneCriteria: string[];
  pathReceipts: string[];
  status: GoalStatus;
  blockReason: string | null;
}

export interface GoalAssessment {
  finished: boolean;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export declare const PLAN_OPEN: string;
export declare const PLAN_CLOSE: string;
export declare const DONE_MARK: string;
export declare const INCOMPLETE_MARK: string;
export declare const NEEDS_USER_MARK: string;
export declare const TASK_LEDGER_HEADER: string;

export declare function isMetaInstructionText(text: string): boolean;
export declare function mergeGoalState(outer: GoalState, inner: GoalState | null | undefined): GoalState;
export declare function buildGoalEvaluatorPrompt(input: {
  state: GoalState;
  lastBody: string;
  toolSummaries?: string[];
}): string;
export declare function parseGoalEvaluatorResult(text: string): {
  verdict: "met" | "not_met" | "impossible";
  reason: string;
  openCriteria: string[];
} | null;
export declare function reconcileGoalVerdicts(input: {
  heuristic: GoalAssessment;
  evaluator?: { verdict: string; reason: string; openCriteria?: string[] } | null;
}): GoalAssessment & { source: "evaluator" | "heuristic" };

export declare function createGoalState(userGoal: string): GoalState;
export declare function parsePlanBlock(
  text: string,
): { plan: string[]; criteria: string[] } | null;
export declare function harvestPathReceipts(text: string, into?: string[]): string[];
export declare function applyGoalUpdate(
  state: GoalState,
  update: { text?: string; toolName?: string; toolOk?: boolean },
): GoalState;
export declare function assessGoalCompletion(input: {
  state: GoalState;
  lastBody: string;
  stepLimitHit?: boolean;
  toolCallCount?: number;
}): GoalAssessment;
export declare function decideAutoContinue(input: {
  assessment: GoalAssessment;
  autoContinues: number;
  maxAutoContinues: number;
  hasTools: boolean;
  error?: boolean;
  cancelled?: boolean;
}): { continue: boolean; reason: string };
export declare function buildContinuePrompt(
  locale: string,
  state: GoalState,
  opts?: { extra?: string },
): string;
export declare function buildTaskLedger(state: GoalState, locale?: string): string;
export declare function isTaskLedgerText(text: string): boolean;
export declare function buildGoalProtocolPrompt(locale: "zh" | "en"): string;
export declare function resolveMaxAutoContinues(input: {
  assessment: GoalAssessment;
  baseMax?: number;
}): number;
