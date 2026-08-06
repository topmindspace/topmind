/**
 * AI operation engine — config-driven registration (agent.ai_ops in topmind.yaml).
 * Workspace can disable ops and set default options without code changes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  registerOperationType,
  listOperationTypes,
  resolveAiOpsConfig,
  runOperation,
} from "../lib/ai-operation-engine.mjs";

const TEST_OP_ID = "test_config_probe";

registerOperationType({
  id: TEST_OP_ID,
  label: "probe",
  domain: "workspace",
  description: "test probe",
  requiresConfirm: false,
  run: async (ctx) => ({
    ok: true,
    changes: [],
    summary: "ran",
    seenOptions: ctx.options,
  }),
});

const contractWith = (aiOps) => ({
  contract_version: 4,
  agent: { skills_entry: "topmind", confirm_by_default: false, ai_ops: aiOps },
});

test("resolveAiOpsConfig parses disabled + options, tolerates garbage", () => {
  const cfg = resolveAiOpsConfig(
    contractWith({ disabled: ["topic_classify"], options: { todo_maintain: { depth: 3 } } }),
  );
  assert.ok(cfg.disabled.has("topic_classify"));
  assert.equal(cfg.options.todo_maintain.depth, 3);

  const empty = resolveAiOpsConfig({});
  assert.equal(empty.disabled.size, 0);
  assert.deepEqual(empty.options, {});

  const junk = resolveAiOpsConfig(contractWith({ disabled: "nope", options: [1] }));
  assert.equal(junk.disabled.size, 0);
  assert.deepEqual(junk.options, {});
});

test("listOperationTypes hides contract-disabled ops", () => {
  const all = listOperationTypes();
  assert.ok(all.some((t) => t.id === "todo_maintain"));
  const filtered = listOperationTypes(contractWith({ disabled: ["todo_maintain"] }));
  assert.ok(!filtered.some((t) => t.id === "todo_maintain"));
  assert.ok(filtered.some((t) => t.id === TEST_OP_ID));
});

test("runOperation blocks contract-disabled op", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-aiops-"));
  try {
    const res = await runOperation({
      id: TEST_OP_ID,
      workspaceRoot: dir,
      contract: contractWith({ disabled: [TEST_OP_ID] }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "operation-disabled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runOperation merges contract default options; explicit call wins", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-aiops-"));
  try {
    const contract = contractWith({ options: { [TEST_OP_ID]: { depth: 3, tag: "ws" } } });
    const res = await runOperation({
      id: TEST_OP_ID,
      workspaceRoot: dir,
      contract,
      options: { depth: 9 },
    });
    assert.equal(res.ok, true);
    assert.equal(res.seenOptions.depth, 9, "explicit call option overrides contract default");
    assert.equal(res.seenOptions.tag, "ws", "contract default fills unspecified option");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
