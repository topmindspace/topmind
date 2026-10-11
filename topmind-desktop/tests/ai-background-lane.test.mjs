/**
 * Background AI lane — serialize suggest/todo prep; snapshot for multi-work UI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueBackgroundAi,
  getBackgroundAiSnapshot,
  __resetBackgroundAiLaneForTests,
} from "../src/lib/ai-background-lane.ts";

test.beforeEach(() => {
  __resetBackgroundAiLaneForTests();
});

test("serializes two background jobs — second waits for first", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((r) => {
    releaseFirst = r;
  });

  const p1 = enqueueBackgroundAi("suggest", async () => {
    order.push("suggest-start");
    await firstGate;
    order.push("suggest-end");
    return "s";
  });
  // Let microtasks schedule p1 into active
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(getBackgroundAiSnapshot().active, "suggest");

  const p2 = enqueueBackgroundAi("todo", async () => {
    order.push("todo-run");
    return "t";
  });
  await Promise.resolve();
  assert.deepEqual(getBackgroundAiSnapshot().queued, ["todo"]);
  assert.equal(getBackgroundAiSnapshot().busy, true);

  releaseFirst();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a, "s");
  assert.equal(b, "t");
  assert.deepEqual(order, ["suggest-start", "suggest-end", "todo-run"]);
  assert.equal(getBackgroundAiSnapshot().busy, false);
  assert.equal(getBackgroundAiSnapshot().active, null);
});

test("failed job does not block the next", async () => {
  const p1 = enqueueBackgroundAi("suggest", async () => {
    throw new Error("boom");
  });
  const p2 = enqueueBackgroundAi("todo", async () => "ok");
  await assert.rejects(p1, /boom/);
  assert.equal(await p2, "ok");
});

test("decideSuggestRefresh yields soft kernel to agent stream", async () => {
  const { decideSuggestRefresh } = await import("../src/lib/suggest-boot-policy.ts");
  const soft = decideSuggestRefresh({
    autoPrepare: true,
    force: false,
    lastRefreshAt: 0,
    everLoaded: true,
    itemCount: 1,
    agentStreaming: true,
  });
  assert.equal(soft.runKernelSuggest, false);
  assert.equal(soft.reason, "agent_busy");
  assert.equal(soft.runPendingWrites, true);

  const force = decideSuggestRefresh({
    autoPrepare: true,
    force: true,
    lastRefreshAt: 0,
    everLoaded: true,
    itemCount: 1,
    agentStreaming: true,
  });
  assert.equal(force.runKernelSuggest, true);
  assert.equal(force.reason, "force_refresh");
});
