import { test } from "node:test";
import assert from "node:assert/strict";
import { isReasoningModel } from "../electron/ai-provider-adapter.mjs";

test("isReasoningModel accurately detects reasoning models", () => {
  // Reasoning models that reject non-default temperature
  assert.equal(isReasoningModel("deepseek-reasoner"), true);
  assert.equal(isReasoningModel("deepseek/deepseek-r1"), true);
  assert.equal(isReasoningModel("o1"), true);
  assert.equal(isReasoningModel("o1-mini"), true);
  assert.equal(isReasoningModel("o1-preview"), true);
  assert.equal(isReasoningModel("o3-mini"), true);
  assert.equal(isReasoningModel("qwq-32b-preview"), true);
  assert.equal(isReasoningModel("model-thinking-v1"), true);

  // Standard LLMs that accept custom temperature
  assert.equal(isReasoningModel("deepseek-chat"), false);
  assert.equal(isReasoningModel("gpt-4o"), false);
  assert.equal(isReasoningModel("gpt-4o-mini"), false);
  assert.equal(isReasoningModel("claude-3-5-sonnet"), false);
  assert.equal(isReasoningModel("claude-3-7-sonnet"), false);
  assert.equal(isReasoningModel("gemini-2.5-flash"), false);
  assert.equal(isReasoningModel("gemini-2.5-pro"), false);
  assert.equal(isReasoningModel(null), false);
  assert.equal(isReasoningModel(undefined), false);
  assert.equal(isReasoningModel(""), false);
});
