/**
 * Goal-oriented agent protocol — pure helpers shared by Desktop + Obsidian.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGoalUpdate,
  assessGoalCompletion,
  buildContinuePrompt,
  buildGoalEvaluatorPrompt,
  buildGoalProtocolPrompt,
  buildResultFooter,
  buildTaskLedger,
  createGoalState,
  decideAutoContinue,
  harvestPathReceipts,
  isTaskLedgerText,
  mergeGoalState,
  parseGoalEvaluatorResult,
  parsePlanBlock,
  reconcileGoalVerdicts,
  rejectBareDone,
  resolveMaxAutoContinues,
  restoreSessionGoal,
  isContinuationTurn,
  prepareTurnGoal,
  DONE_MARK,
  INCOMPLETE_MARK,
  PLAN_CLOSE,
  PLAN_OPEN,
} from "../lib/agent-goal-protocol.mjs";

test("parsePlanBlock reads steps and done-when criteria", () => {
  const text = [
    "先看结构再改。",
    PLAN_OPEN,
    "goal: 把笔记整理成交付稿",
    "steps: 1) 读原文 2) 改结构 3) 写交付",
    "done-when:",
    "- 88-交付下有成稿",
    "- 结构包含结论段",
    PLAN_CLOSE,
    "继续执行。",
  ].join("\n");
  const plan = parsePlanBlock(text);
  assert.ok(plan);
  assert.equal(plan.plan.length, 3);
  assert.equal(plan.criteria.length, 2);
  assert.match(plan.criteria[0], /88-交付/);
});

test("harvestPathReceipts picks workspace-relative paths once", () => {
  const into = [];
  harvestPathReceipts("已写 20-专题/2026-主题/note.md 与 88-交付/2026-01-01-a.md", into);
  harvestPathReceipts("又写了 20-专题/2026-主题/note.md", into);
  assert.equal(into.length, 2);
  assert.ok(into[0].includes("20-专题"));
});

test("applyGoalUpdate folds plan + receipts + DONE", () => {
  let s = createGoalState("整理笔记");
  s = applyGoalUpdate(s, {
    text: `${PLAN_OPEN}\ngoal: x\nsteps: 1) a 2) b\ndone-when:\n- 文件存在\n${PLAN_CLOSE}`,
  });
  assert.equal(s.plan.length, 2);
  assert.equal(s.doneCriteria.length, 1);
  s = applyGoalUpdate(s, { text: `完成。路径 10-动态/2026-W01.md ${DONE_MARK}` });
  assert.equal(s.status, "done");
  assert.equal(s.doneCriteria.length, 0);
  assert.ok(s.pathReceipts.some((p) => p.includes("10-动态")));
});

test("assessGoalCompletion: open criteria block finish; DONE marks finish", () => {
  const open = createGoalState("g");
  const withPlan = applyGoalUpdate(open, {
    text: `${PLAN_OPEN}\ngoal: g\nsteps: 1) a\ndone-when:\n- 产出存在\n${PLAN_CLOSE}`,
  });
  const miss = assessGoalCompletion({ state: withPlan, lastBody: "我做完了" });
  assert.equal(miss.finished, false);
  assert.equal(miss.reason, "open-criteria");

  const doneState = applyGoalUpdate(withPlan, { text: `ok ${DONE_MARK}` });
  const hit = assessGoalCompletion({ state: doneState, lastBody: `ok ${DONE_MARK}` });
  assert.equal(hit.finished, true);
  assert.equal(hit.confidence, "high");
});

test("assessGoalCompletion: step-limit is never finished", () => {
  const s = createGoalState("g");
  const a = assessGoalCompletion({ state: s, lastBody: "……", stepLimitHit: true });
  assert.equal(a.finished, false);
  assert.equal(a.reason, "step-limit");
});

test("decideAutoContinue continues on open criteria within budget", () => {
  const s = applyGoalUpdate(createGoalState("g"), {
    text: `${PLAN_OPEN}\ngoal: g\nsteps: 1) a\ndone-when:\n- x\n${PLAN_CLOSE}`,
  });
  const assessment = assessGoalCompletion({ state: s, lastBody: "…" });
  const d = decideAutoContinue({
    assessment,
    autoContinues: 0,
    maxAutoContinues: resolveMaxAutoContinues({ assessment }),
    hasTools: true,
  });
  assert.equal(d.continue, true);
  const stop = decideAutoContinue({
    assessment,
    autoContinues: 4,
    maxAutoContinues: 4,
    hasTools: true,
  });
  assert.equal(stop.continue, false);
  assert.equal(stop.reason, "continue-budget");
});

test("resolveMaxAutoContinues widens budget for open criteria", () => {
  const s = applyGoalUpdate(createGoalState("g"), {
    text: `${PLAN_OPEN}\ngoal: g\nsteps: 1) a\ndone-when:\n- x\n${PLAN_CLOSE}`,
  });
  const assessment = assessGoalCompletion({ state: s, lastBody: "…" });
  assert.equal(resolveMaxAutoContinues({ assessment, baseMax: 2 }), 4);
  assert.equal(resolveMaxAutoContinues({ assessment: { finished: true, reason: "done-mark", confidence: "high" }, baseMax: 2 }), 2);
});

test("buildContinuePrompt carries goal, open criteria, receipts", () => {
  let s = createGoalState("整理交付稿");
  s = applyGoalUpdate(s, {
    text: `${PLAN_OPEN}\ngoal: 整理交付稿\nsteps: 1) 读 2) 写\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}\n路径 88-交付/a.md`,
  });
  const p = buildContinuePrompt("zh-CN", s);
  assert.match(p, /整理交付稿/);
  assert.match(p, /成稿存在/);
  assert.match(p, /88-交付\/a\.md/);
  assert.match(p, /\[DONE\]/);
});

test("task ledger is sticky and survives parse", () => {
  let s = createGoalState("g");
  s = applyGoalUpdate(s, { text: "写 20-专题/x/n.md" });
  const led = buildTaskLedger(s, "zh-CN");
  assert.ok(isTaskLedgerText(led));
  assert.match(led, /目标：g/);
  assert.match(led, /20-专题/);
});

test("goal protocol prompt covers plan/verify/drawing stages", () => {
  const zh = buildGoalProtocolPrompt("zh");
  const en = buildGoalProtocolPrompt("en");
  assert.match(zh, /done-when/);
  assert.match(zh, /绘图|插画|创作/);
  assert.match(zh, /\[DONE\]/);
  assert.match(en, /acceptance|done-when/i);
  assert.match(en, /illustration|creative/i);
  assert.match(`${zh}${en}`, new RegExp(INCOMPLETE_MARK.replace(/[[]/g, "\\[")));
});

test("mergeGoalState keeps outer plan/criteria when inner rebuild is empty (G1 clobber)", () => {
  let outer = createGoalState("整理交付稿");
  outer = applyGoalUpdate(outer, {
    text: `${PLAN_OPEN}\ngoal: 整理交付稿\nsteps: 1) 读 2) 写\ndone-when:\n- 成稿存在\n- 结构完整\n${PLAN_CLOSE}`,
  });
  assert.equal(outer.doneCriteria.length, 2);
  // Inner per-run rebuild with empty plan (auto-continue often does not re-emit [PLAN]).
  const inner = createGoalState("整理交付稿");
  const merged = mergeGoalState(outer, inner);
  assert.equal(merged.plan.length, 2, "plan must survive empty inner rebuild");
  assert.equal(merged.doneCriteria.length, 2, "open criteria must survive");
  assert.equal(merged.status, "working", "open criteria must not demote to idle");
  // Inner terminal done wins.
  const doneInner = { ...inner, status: "done", doneCriteria: [] };
  const mergedDone = mergeGoalState(outer, doneInner);
  assert.equal(mergedDone.status, "done");
  assert.equal(mergedDone.doneCriteria.length, 0);
});

test("mergeGoalState unions path receipts and prefers inner terminal incomplete", () => {
  let outer = createGoalState("g");
  outer = applyGoalUpdate(outer, { text: "写 20-专题/x/a.md" });
  const inner = { ...createGoalState("g"), status: "incomplete", blockReason: "budget_exhausted", pathReceipts: ["20-专题/x/b.md"] };
  const merged = mergeGoalState(outer, inner);
  assert.equal(merged.status, "incomplete");
  assert.equal(merged.blockReason, "budget_exhausted");
  assert.ok(merged.pathReceipts.includes("20-专题/x/a.md"), `receipts=${JSON.stringify(merged.pathReceipts)}`);
  assert.ok(merged.pathReceipts.includes("20-专题/x/b.md"));
});

test("NEEDS-USER marks goal blocked with reason (G7)", () => {
  let s = createGoalState("整理交付");
  s = applyGoalUpdate(s, { text: "我需要你确认是否覆盖 88-交付/旧稿.md [NEEDS-USER 确认覆盖范围]" });
  assert.equal(s.status, "blocked");
  assert.match(s.blockReason || "", /确认覆盖/);
  const zh = buildGoalProtocolPrompt("zh");
  const en = buildGoalProtocolPrompt("en");
  assert.match(zh, /NEEDS-USER/);
  assert.match(en, /NEEDS-USER/);
});

test("quoted [DONE] in meta-instruction text never marks goal done (P0-1)", () => {
  let s = createGoalState("整理交付稿");
  s = applyGoalUpdate(s, {
    text: `${PLAN_OPEN}\ngoal: 整理交付稿\nsteps: 1) 读\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}`,
  });
  assert.equal(s.doneCriteria.length, 1);
  // Continue prompt / instruction quotes the marker as documentation.
  const instruction =
    "[System] 继续完成原目标；完成后只写用户可见结论并标记 `[DONE]` 或 `[INCOMPLETE reason]`。验收项：成稿存在";
  s = applyGoalUpdate(s, { text: instruction });
  assert.notEqual(s.status, "done", "instruction quoting [DONE] must not complete the goal");
  assert.equal(s.doneCriteria.length, 1, "criteria must remain open");
  // Real worker claim still works.
  s = applyGoalUpdate(s, { text: "已完成，见 88-交付/a.md [DONE]" });
  assert.equal(s.status, "done");
});

test("bare [DONE] after tools is not success without a path receipt", () => {
  let s = createGoalState("写交付稿");
  s = applyGoalUpdate(s, {
    text: `${PLAN_OPEN}\ngoal: 写交付稿\nsteps: 1) 写\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}`,
  });
  s = applyGoalUpdate(s, { text: `全部完成 ${DONE_MARK}` });
  assert.equal(s.status, "done");
  const bare = assessGoalCompletion({
    state: s,
    lastBody: `全部完成 ${DONE_MARK}`,
    toolCallCount: 2,
  });
  assert.equal(bare.finished, false);
  assert.equal(bare.reason, "missing-path-receipts");
  const folded = rejectBareDone(s, { toolCallCount: 2, lastBody: `全部完成 ${DONE_MARK}` });
  assert.equal(folded.status, "incomplete");
  assert.equal(folded.blockReason, "missing-path-receipts");
  assert.deepEqual(folded.doneCriteria, ["成稿存在"]);
  const decision = decideAutoContinue({
    assessment: bare,
    autoContinues: 0,
    maxAutoContinues: 2,
    hasTools: true,
  });
  assert.equal(decision.continue, true, "missing receipts stay in the verify loop");
  const phraseOnly = assessGoalCompletion({
    state: s,
    lastBody: `全部完成 路径回执 ${DONE_MARK}`,
    toolCallCount: 2,
  });
  assert.equal(phraseOnly.finished, false);
  assert.equal(phraseOnly.reason, "missing-path-receipts");
  const phraseFolded = rejectBareDone(s, {
    toolCallCount: 2,
    lastBody: `全部完成 路径回执 ${DONE_MARK}`,
  });
  assert.equal(phraseFolded.status, "incomplete");
  assert.notEqual(phraseFolded.status, "done");
  const withPath = assessGoalCompletion({
    state: { ...s, pathReceipts: ["88-交付/a.md"] },
    lastBody: `全部完成 ${DONE_MARK}`,
    toolCallCount: 2,
  });
  assert.equal(withPath.finished, true);
  assert.equal(withPath.reason, "done-mark");
  const overridden = reconcileGoalVerdicts({
    heuristic: bare,
    evaluator: { verdict: "met", reason: "looks done", openCriteria: [] },
  });
  assert.equal(overridden.finished, false);
  assert.equal(overridden.reason, "missing-path-receipts");
});

test("idle inner rebuild does not drop a blocked ledger", () => {
  let outer = createGoalState("整理交付");
  outer = applyGoalUpdate(outer, {
    text: `${PLAN_OPEN}\ngoal: 整理交付\nsteps: 1) 读\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}`,
  });
  outer = { ...outer, status: "blocked", blockReason: "确认覆盖" };
  const merged = mergeGoalState(outer, createGoalState("整理交付"));
  assert.equal(merged.status, "blocked");
  assert.equal(merged.blockReason, "确认覆盖");
  assert.equal(merged.plan.length, 1);
  assert.equal(merged.doneCriteria.length, 1);
});

test("继续 after a bare [DONE] keeps the saved goal, open criteria, and incomplete", () => {
  const saved = {
    goal: "整理交付稿",
    plan: ["读原文", "写成稿"],
    criteria: ["成稿存在"],
    doneCriteria: ["成稿存在"],
    openCriteria: ["成稿存在"],
    pathReceipts: [],
    status: "incomplete",
    blockReason: "missing-path-receipts",
  };
  const messages = [
    { role: "user", content: "整理交付稿" },
    { role: "assistant", content: `全部完成 ${DONE_MARK}` },
    { role: "user", content: "继续" },
  ];
  // Pi still seeds goal "继续" and would have folded the bare [DONE] to done.
  const piSeed = applyGoalUpdate(createGoalState("继续"), { text: `全部完成 ${DONE_MARK}` });
  assert.equal(piSeed.goal, "继续");
  assert.equal(piSeed.status, "done");
  assert.equal(piSeed.doneCriteria.length, 0);
  const next = prepareTurnGoal({ saved, messages, piState: piSeed });
  assert.equal(next.goal, "整理交付稿");
  assert.deepEqual(next.doneCriteria, ["成稿存在"]);
  assert.equal(next.status, "incomplete");
  const prelude = prepareTurnGoal({ saved, messages });
  assert.equal(prelude.goal, "整理交付稿");
  assert.deepEqual(prelude.doneCriteria, ["成稿存在"]);
  assert.equal(prelude.status, "incomplete");
});

test("继续 and the host resume prompt keep the saved ledger", () => {
  const prior = {
    ...createGoalState("整理交付稿"),
    plan: ["读原文", "写成稿"],
    criteria: ["成稿存在"],
    doneCriteria: ["成稿存在"],
    openCriteria: ["成稿存在"],
    pathReceipts: ["20-专题/2026-主题/note.md"],
    status: /** @type {const} */ ("working"),
  };
  const resume = [
    "[系统] 任务被用户暂停后恢复，可能尚未完成。请继续完成用户原始目标；若已完成则给出简短结论与路径回执。",
    "原目标：整理交付稿",
    "计划：\n1. 读原文\n2. 写成稿",
    "未完成验收项：\n- 成稿存在",
    "先更新/执行剩余步骤，再收尾。收尾时输出结论 + 路径回执 + [DONE]；若无法完成则 [INCOMPLETE 原因]。",
  ].join("\n");
  assert.equal(isContinuationTurn(resume), true);
  assert.equal(isContinuationTurn("继续"), true);
  for (const text of [resume, "继续"]) {
    const restored = restoreSessionGoal(prior, text);
    assert.equal(restored.goal, "整理交付稿", text.slice(0, 12));
    assert.deepEqual(restored.plan, ["读原文", "写成稿"]);
    assert.deepEqual(restored.doneCriteria, ["成稿存在"]);
    assert.ok(restored.pathReceipts.includes("20-专题/2026-主题/note.md"));
    assert.notEqual(restored.status, "idle");
  }
  const other = restoreSessionGoal(prior, "写一篇完全不同的周报");
  assert.equal(other.plan.length, 0);
  assert.equal(other.goal, "写一篇完全不同的周报");
});

test("result footer keeps receipts out of Verified and empty segments empty", () => {
  const footer = buildResultFooter({
    status: "done",
    pathReceipts: ["88-交付/a.md"],
    openCriteria: [],
    checksRun: [],
    assumptions: [],
  });
  assert.deepEqual(footer.changes, ["88-交付/a.md"]);
  assert.deepEqual(footer.verified, []);
  assert.deepEqual(footer.assumed, []);
  assert.deepEqual(footer.couldNot, []);
  const blocked = buildResultFooter({
    status: "blocked",
    pathReceipts: [],
    openCriteria: ["成稿存在"],
    blockReason: "确认覆盖",
  });
  assert.deepEqual(blocked.couldNot, ["成稿存在", "确认覆盖"]);
  assert.equal(buildResultFooter({ status: "working", pathReceipts: ["a.md"] }), null);
});

test("external goal evaluator parse + reconcile (industry /goal)", () => {
  let s = createGoalState("写交付稿");
  s = applyGoalUpdate(s, {
    text: `${PLAN_OPEN}\ngoal: 写交付稿\nsteps: 1) 写\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}`,
  });
  const prompt = buildGoalEvaluatorPrompt({ state: s, lastBody: "done", toolSummaries: ["save_file 88-交付/a.md"] });
  assert.match(prompt, /ACCEPTANCE CRITERIA/);
  assert.match(prompt, /met\|not_met\|impossible/);
  const parsed = parseGoalEvaluatorResult('{"verdict":"not_met","reason":"missing file","openCriteria":["成稿存在"]}');
  assert.equal(parsed.verdict, "not_met");
  assert.deepEqual(parsed.openCriteria, ["成稿存在"]);
  assert.equal(parseGoalEvaluatorResult("no json"), null);
  // Evaluator not_met keeps working even if heuristic said closing.
  const rec = reconcileGoalVerdicts({
    heuristic: { finished: true, reason: "closing-answer", confidence: "medium" },
    evaluator: parsed,
  });
  assert.equal(rec.finished, false);
  assert.equal(rec.source, "evaluator");
  // Worker [INCOMPLETE] is never overridden by evaluator met.
  const rec2 = reconcileGoalVerdicts({
    heuristic: { finished: false, reason: "incomplete-mark", confidence: "high" },
    evaluator: { verdict: "met", reason: "looks fine", openCriteria: [] },
  });
  assert.equal(rec2.finished, false);
});
