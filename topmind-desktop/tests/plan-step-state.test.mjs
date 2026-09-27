/**
 * Run Card plan pin derivation — never over-claim done; running/failed pins
 * sit on the frontier. Plan diff for Pause/Resume stays structural.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { derivePlanStepState, diffPlan } from "../src/lib/plan-step-state.ts";

test("done status marks every plan step done", () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(
      derivePlanStepState({ index: i, total: 3, status: "done", criteriaTotal: 2, openCount: 0 }),
      "done",
    );
  }
});

test("criteria progress uses floor — half-closed criteria is not 'all steps done'", () => {
  // 1/2 criteria closed → floor(0.5*4)=2 done, frontier running
  const states = [0, 1, 2, 3].map((i) =>
    derivePlanStepState({ index: i, total: 4, status: "working", criteriaTotal: 2, openCount: 1 }),
  );
  assert.deepEqual(states, ["done", "done", "running", "pending"]);
});

test("working with no criteria pins the first step running", () => {
  assert.equal(
    derivePlanStepState({ index: 0, total: 3, status: "working", criteriaTotal: 0, openCount: 0 }),
    "running",
  );
  assert.equal(
    derivePlanStepState({ index: 1, total: 3, status: "working", criteriaTotal: 0, openCount: 0 }),
    "pending",
  );
});

test("incomplete marks the frontier failed", () => {
  const states = [0, 1, 2].map((i) =>
    derivePlanStepState({ index: i, total: 3, status: "incomplete", criteriaTotal: 3, openCount: 1 }),
  );
  // 2/3 closed → floor(2)=2 done… wait closed=2, floor(2/3*3)=2, frontier=2 failed
  assert.deepEqual(states, ["done", "done", "failed"]);
});

test("diffPlan reports added/removed and ignores order-only when set-equal", () => {
  const d = diffPlan(["a", "b"], ["b", "a"]);
  assert.equal(d.changed, true, "reorder still counts as changed text");
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);

  const d2 = diffPlan(["a"], ["a", "c"]);
  assert.equal(d2.changed, true);
  assert.deepEqual(d2.added, ["c"]);
  assert.deepEqual(d2.removed, []);
});
