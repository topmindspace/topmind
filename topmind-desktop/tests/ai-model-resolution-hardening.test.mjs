import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModel, getRuntimeStatus } from "../electron/ai-model.mjs";

test("resolveModel: unconfigured settings return null and do not falsely activate unconfigured ollama", () => {
  const emptySettings = {
    ai: {
      manual: {},
      sourcePreference: "",
    },
  };
  const res = resolveModel(emptySettings);
  assert.equal(res, null);

  const status = getRuntimeStatus(emptySettings);
  assert.equal(status.ready, false);
  assert.equal(status.providers.length, 0);
});

test("resolveModel: ollama only active when ollamaBaseUrl is configured or pref is ollama", () => {
  const ollamaSettings = {
    ai: {
      manual: {
        ollamaBaseUrl: "http://127.0.0.1:11434/v1",
      },
      sourcePreference: "ollama",
    },
  };
  const res = resolveModel(ollamaSettings);
  assert.ok(res);
  assert.equal(res.modelId, "qwen2.5:7b");

  const status = getRuntimeStatus(ollamaSettings);
  assert.equal(status.ready, true);
  assert.equal(status.providers.some((p) => p.source === "ollama"), true);
});

test("resolveModel: cross-provider fallback does not pass alien modelId to fallback provider", () => {
  const settings = {
    ai: {
      manual: {
        openAiKey: "sk-test-key-mock",
      },
      sourcePreference: "openai",
    },
  };

  const res = resolveModel(settings, "anthropic/claude-sonnet-5");
  assert.ok(res);
  assert.equal(res.modelId, "gpt-4o-mini");
});

test("resolveModel: same-provider explicit modelId is honored", () => {
  const settings = {
    ai: {
      manual: {
        openAiKey: "sk-test-key-mock",
      },
      sourcePreference: "openai",
    },
  };

  const res = resolveModel(settings, "openai/gpt-4o");
  assert.ok(res);
  assert.equal(res.modelId, "gpt-4o");
});
