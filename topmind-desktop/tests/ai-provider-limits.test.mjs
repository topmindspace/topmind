/**
 * Adapter output-token limits and ARCHITECTURE copy must match shipped OP_LIMITS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OP_LIMITS, resolveMaxTokens } from "../electron/ai-provider-adapter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("OP_LIMITS is the adapter source of truth", () => {
  assert.ok(OP_LIMITS.topic_summary > OP_LIMITS.period_digest);
  assert.equal(OP_LIMITS.period_digest, OP_LIMITS.todo_maintain);
  assert.equal(OP_LIMITS.period_digest, OP_LIMITS.memory_organize);
  assert.equal(OP_LIMITS.memory_extract, OP_LIMITS.topic_classify);
  for (const n of Object.values(OP_LIMITS)) {
    assert.equal(n % 1024, 0, "limits are whole-K tokens");
  }
});

test("resolveMaxTokens returns OP_LIMITS for shipped operations", () => {
  assert.equal(resolveMaxTokens({ operation: "topic_summary" }), OP_LIMITS.topic_summary);
  assert.equal(resolveMaxTokens({ operation: "todo_extract" }), OP_LIMITS.todo_extract);
  assert.equal(resolveMaxTokens({ operation: "memory_extract" }), OP_LIMITS.memory_extract);
  assert.equal(resolveMaxTokens({ maxOutputTokens: 99, operation: "topic_summary" }), 99);
  assert.equal(resolveMaxTokens({ topicPath: "/x" }), OP_LIMITS.topic_summary);
  assert.equal(resolveMaxTokens({ periodFile: "/p" }), OP_LIMITS.period_digest);
});

test("ARCHITECTURE documents shipped OP_LIMITS, not retired 8K/4K/2K", () => {
  const arch = readFileSync(path.join(root, "ARCHITECTURE.md"), "utf8");
  const topicK = OP_LIMITS.topic_summary / 1024;
  const periodK = OP_LIMITS.period_digest / 1024;
  const smallK = OP_LIMITS.memory_extract / 1024;
  assert.match(arch, new RegExp(`topic_summary → ${topicK}K`));
  assert.match(arch, new RegExp(`period/digest/todo/memory_organize → ${periodK}K`));
  assert.match(arch, new RegExp(`memory_extract/topic_classify → ${smallK}K`));
  assert.doesNotMatch(arch, /topic_summary → 8K、period\/digest\/todo → 4K/);
});
