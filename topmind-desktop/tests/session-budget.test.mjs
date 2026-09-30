/**
 * Adaptive session budget — turn-kind + workload driven.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSessionBudget } from "../electron/lib/session-budget.mjs";

test("light turns get zero agent steps and zero continues", () => {
  const b = resolveSessionBudget({ userText: "hi" });
  assert.equal(b.turnKind, "light");
  assert.equal(b.maxAgentSteps, 0);
  assert.equal(b.maxAutoContinues, 0);
});

test("query turns stay in a small tool band", () => {
  const b = resolveSessionBudget({ userText: "我最近的任务" });
  assert.equal(b.turnKind, "query");
  assert.ok(b.maxAgentSteps >= 2 && b.maxAgentSteps <= 6, `steps=${b.maxAgentSteps}`);
  assert.equal(b.maxAutoContinues, 0);
});

test("task turns scale with workload; big briefs get more room", () => {
  const small = resolveSessionBudget({ userText: "把标题改一下" });
  const big = resolveSessionBudget({
    userText:
      "请整理 00-Inbox 里所有待归档文件，归档旧的，把重要的迁到专题，并写出一份对比综述，最后导出到交付。",
  });
  assert.equal(small.turnKind, "task");
  assert.equal(big.turnKind, "task");
  assert.ok(big.maxAgentSteps > small.maxAgentSteps, "big brief needs more steps");
  assert.ok(big.maxAutoContinues >= small.maxAutoContinues);
  assert.ok(big.maxAgentSteps <= 80);
});

test("user setting expands the cap but never shrinks below heuristics", () => {
  const withSetting = resolveSessionBudget({
    userText: "把标题改一下",
    settings: { maxAgentSteps: 48 },
  });
  assert.ok(withSetting.maxAgentSteps >= 48);
});

test("tiny context window tightens budget", () => {
  const tight = resolveSessionBudget({
    userText: "整理一下收件箱并写一篇短文",
    contextWindow: 16_000,
  });
  assert.ok(tight.contextTighten < 1);
  assert.ok(tight.maxAgentSteps < 32);
});
