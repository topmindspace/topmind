/**
 * Behavioral tests for the goal-aware autopilot loop decisions (G1–G8).
 * These exercise the pure protocol helpers the Desktop/Obsidian loops call —
 * not source-regex assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGoalUpdate,
  assessGoalCompletion,
  buildContinuePrompt,
  buildTaskLedger,
  createGoalState,
  decideAutoContinue,
  isTaskLedgerText,
  mergeGoalState,
  parseGoalEvaluatorResult,
  reconcileGoalVerdicts,
  resolveMaxAutoContinues,
  PLAN_CLOSE,
  PLAN_OPEN,
} from "../lib/agent-goal-protocol.mjs";

function withPlan(goal = "整理交付稿") {
  let s = createGoalState(goal);
  s = applyGoalUpdate(s, {
    text: `${PLAN_OPEN}\ngoal: ${goal}\nsteps: 1) 读 2) 写 3) 核\ndone-when:\n- 成稿存在\n- 结构完整\n${PLAN_CLOSE}`,
  });
  return s;
}

test("G1: merge keeps open criteria when inner rebuild is empty", () => {
  const outer = withPlan();
  assert.equal(outer.doneCriteria.length, 2);
  const inner = createGoalState("整理交付稿"); // fresh rebuild, no [PLAN]
  const merged = mergeGoalState(outer, inner);
  assert.equal(merged.doneCriteria.length, 2);
  assert.equal(merged.plan.length, 3);
});

test("G2: folding history restores plan after a fake empty run", () => {
  let s = createGoalState("整理交付稿");
  // Simulate history containing a prior [PLAN] block.
  s = applyGoalUpdate(s, {
    text: `先前工作\n${PLAN_OPEN}\ngoal: 整理交付稿\nsteps: 1) 读\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}\n已读 20-专题/a/topic.md`,
  });
  assert.equal(s.doneCriteria.length, 1);
  assert.ok(s.pathReceipts.length >= 1);
});

test("G5: high-confidence done-mark stops even at step limit", () => {
  const s = withPlan();
  const done = { ...s, doneCriteria: [], status: "done" };
  const assessment = assessGoalCompletion({
    state: done,
    lastBody: `${PLAN_OPEN}x${PLAN_CLOSE} 全部完成 [DONE]\n路径回执 88-交付/a.md`,
    stepLimitHit: true,
    toolCallCount: 3,
  });
  assert.equal(assessment.finished, true);
  assert.equal(assessment.reason, "done-mark");
  const decision = decideAutoContinue({
    assessment,
    autoContinues: 0,
    maxAutoContinues: 4,
    hasTools: true,
    error: false,
    cancelled: false,
  });
  // done-mark must not force a continue loop.
  assert.equal(decision.continue, false);
});

test("G6: budget exhaustion is modeled as incomplete, not working", () => {
  const s = withPlan();
  // Loop code sets this when autoContinues >= max.
  const terminal = {
    ...s,
    status: /** @type {const} */ ("incomplete"),
    blockReason: "budget_exhausted",
  };
  const assessment = assessGoalCompletion({
    state: terminal,
    lastBody: "还在处理…",
    stepLimitHit: true,
    toolCallCount: 2,
  });
  assert.equal(assessment.finished, false);
  assert.equal(assessment.reason, "incomplete");
});

test("G7: NEEDS-USER blocks and auto-continue stops", () => {
  let s = createGoalState("写交付");
  s = applyGoalUpdate(s, { text: "请确认是否覆盖旧稿 [NEEDS-USER 覆盖确认]" });
  assert.equal(s.status, "blocked");
  const assessment = assessGoalCompletion({ state: s, lastBody: "等待确认", toolCallCount: 0 });
  assert.equal(assessment.finished, false);
  const decision = decideAutoContinue({
    assessment,
    autoContinues: 0,
    maxAutoContinues: 4,
    hasTools: true,
  });
  assert.equal(decision.continue, false);
});

test("G3/G4 inputs: continue prompt carries goal + criteria + receipts", () => {
  const s = withPlan();
  s.pathReceipts.push("20-专题/2026-主题/a.md");
  const p = buildContinuePrompt("zh-CN", s);
  assert.match(p, /整理交付稿/);
  assert.match(p, /成稿存在/);
  assert.match(p, /20-专题\/2026-主题\/a\.md/);
  const ledger = buildTaskLedger(s, "zh-CN");
  assert.ok(isTaskLedgerText(ledger));
});

test("open criteria widen continue budget to 4 (resolveMaxAutoContinues)", () => {
  const s = withPlan();
  const assessment = assessGoalCompletion({ state: s, lastBody: "继续", toolCallCount: 1 });
  assert.equal(assessment.reason, "open-criteria");
  assert.equal(resolveMaxAutoContinues({ assessment, baseMax: 2 }), 4);
});

test("evaluator cannot override worker [INCOMPLETE] honesty", () => {
  const rec = reconcileGoalVerdicts({
    heuristic: { finished: false, reason: "incomplete-mark", confidence: "high" },
    evaluator: parseGoalEvaluatorResult('{"verdict":"met","reason":"ok"}'),
  });
  assert.equal(rec.finished, false);
});
