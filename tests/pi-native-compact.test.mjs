/**
 * Pi transcript compaction, goal follow-ups and task ledger.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGoalFollowUps,
  createLedgerPrepareRequest,
} from "../topmind-desktop/electron/ai-pi-runtime.mjs";
import {
  createGoalState,
  applyGoalUpdate,
  buildTaskLedger,
  PLAN_OPEN,
  PLAN_CLOSE,
} from "../lib/agent-goal-protocol.mjs";

test("createGoalFollowUps injects continue once while criteria stay open", async () => {
  let state = createGoalState("整理交付稿");
  state = applyGoalUpdate(state, {
    text: `${PLAN_OPEN}\ngoal: 整理交付稿\nsteps: 1) 读 2) 写\ndone-when:\n- 成稿存在\n${PLAN_CLOSE}`,
  });
  const maybeFollowUp = createGoalFollowUps({ goalState: () => state, locale: "zh-CN", max: 1 });
  const first = maybeFollowUp();
  assert.equal(typeof first, "string");
  assert.match(first, /成稿存在/);
  const second = maybeFollowUp();
  assert.equal(second, null, "max=1 follow-up only");
});

test("createGoalFollowUps stays silent when criteria are closed", async () => {
  let state = createGoalState("g");
  state = applyGoalUpdate(state, { text: "done" });
  const maybeFollowUp = createGoalFollowUps({ goalState: () => state, locale: "en-US" });
  assert.equal(maybeFollowUp(), null);
});

test("createLedgerPrepareRequest re-injects sticky ledger when missing", async () => {
  let state = createGoalState("目标甲");
  state = applyGoalUpdate(state, { text: "写 20-专题/x/n.md" });
  const prep = createLedgerPrepareRequest({ goalState: () => state, locale: "zh-CN" });
  const update = await prep({
    context: { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
  });
  assert.ok(update?.context?.messages?.length >= 2);
  const last = update.context.messages[update.context.messages.length - 1];
  assert.match(last.content[0].text, /TASK-LEDGER/);
  // Already present → no-op
  const ledger = buildTaskLedger(state, "zh-CN");
  const again = await prep({
    context: { messages: [{ role: "user", content: [{ type: "text", text: ledger }] }] },
  });
  assert.equal(again, undefined);
});

test("over-window transcript folds deterministically and keeps the task ledger", async () => {
  const { maybeCompactPiMessages } = await import("../topmind-desktop/electron/ai-pi-runtime.mjs");
  const ledger = buildTaskLedger(createGoalState("目标甲"), "zh-CN");
  const list = [
    { role: "system", content: "Be brief", timestamp: 0 },
    { role: "user", content: [{ type: "text", text: ledger }], timestamp: 1 },
  ];
  for (let i = 0; i < 20; i++) {
    list.push({
      role: i % 2 === 0 ? "assistant" : "user",
      content: [{ type: "text", text: `轮${i} ${"字".repeat(2000)}` }],
      timestamp: i + 2,
    });
  }
  const folded = maybeCompactPiMessages(list, { contextWindow: 4000, modelId: "fake" });
  assert.equal(folded.compacted, true);
  assert.equal(folded.messages[0].role, "system");
  const texts = folded.messages.map((m) => {
    if (typeof m.content === "string") return m.content;
    return (m.content || []).map((b) => b.text || "").join("");
  });
  assert.ok(texts.some((t) => t.includes("TASK-LEDGER")));
  assert.ok(folded.messages.length < list.length);
});

test("rememberDistillHint / consumeDistillHint is single-use", async () => {
  const { rememberDistillHint, consumeDistillHint } = await import(
    "../topmind-desktop/electron/lib/ai-tool-evidence.mjs"
  );
  rememberDistillHint({ readFiles: ["a.md"], modifiedFiles: ["b.md"] });
  const hit = consumeDistillHint();
  assert.deepEqual(hit.modifiedFiles, ["b.md"]);
  assert.equal(consumeDistillHint(), null);
  rememberDistillHint({ readFiles: [], modifiedFiles: [] });
  assert.equal(consumeDistillHint(), null);
});
