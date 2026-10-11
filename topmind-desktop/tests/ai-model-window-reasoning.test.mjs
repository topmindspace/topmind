/**
 * Model contextWindow wiring + agent reasoning effort + local secret fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reasoningProviderOptions, isReasoningModel } from "../electron/ai-provider-adapter.mjs";
import { lookupContextLimit, resolveModel } from "../electron/ai-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("lookupContextLimit reads modelCache catalog", () => {
  const settings = {
    ai: {
      modelCache: {
        catalog: [
          {
            id: "openai",
            models: [{ id: "gpt-4o", contextLimit: 128000 }],
          },
        ],
      },
    },
  };
  assert.equal(lookupContextLimit(settings, "openai", "gpt-4o"), 128000);
  assert.equal(lookupContextLimit(settings, "openai", "missing"), 0);
  assert.equal(lookupContextLimit(null, "openai", "gpt-4o"), 0);
});

test("resolveModel attaches contextWindow when catalog knows the model", () => {
  const settings = {
    ai: {
      manual: { openAiKey: "sk-test" },
      defaultModel: "gpt-4o",
      sourcePreference: "openai",
      modelCache: {
        catalog: [
          { id: "openai", models: [{ id: "gpt-4o", contextLimit: 128000 }] },
        ],
      },
    },
  };
  const res = resolveModel(settings, "openai/gpt-4o");
  assert.ok(res);
  assert.equal(res.modelId, "gpt-4o");
  assert.equal(res.provider, "openai");
  assert.equal(res.contextWindow, 128000);
});

test("agent reasoning effort is high for known reasoning providers", () => {
  const o3 = reasoningProviderOptions("o3", "agent");
  assert.equal(o3.openai?.reasoningEffort, "high");
  const inline = reasoningProviderOptions("o3", "inline");
  assert.equal(inline.openai?.reasoningEffort, "medium");

  const claude = reasoningProviderOptions("claude-sonnet-5", "agent");
  assert.equal(claude.anthropic?.thinking?.type, "enabled");
  assert.ok(claude.anthropic.thinking.budgetTokens >= 4096);

  const gemini = reasoningProviderOptions("gemini-2.5-pro", "agent");
  assert.ok((gemini.google?.thinkingConfig?.thinkingBudget || 0) > 0);

  // Unknown model → empty object (no crash, no bogus params)
  assert.deepEqual(reasoningProviderOptions("some-local-llama", "agent"), {});
});

test("isReasoningModel covers o-series including o4", () => {
  assert.equal(isReasoningModel("o3"), true);
  assert.equal(isReasoningModel("o4-mini"), true);
  assert.equal(isReasoningModel("deepseek-reasoner"), true);
  assert.equal(isReasoningModel("gpt-4o"), false);
});

test("local-secret + dual-layer envelope are wired", () => {
  const local = readFileSync(path.join(root, "electron/lib/local-secret.mjs"), "utf8");
  assert.match(local, /aes-256-gcm/);
  assert.match(local, /\.secret-key/);
  const core = readFileSync(path.join(root, "electron/lib/settings-core.mjs"), "utf8");
  assert.match(core, /manualLocal/);
  assert.match(core, /integrationLocal/);
  const main = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
  assert.match(main, /attachLocalSecretFallback/);
  assert.match(main, /createLocalSecretAdapter/);
});

test("ai-service uses res.contextWindow and friendly errors", () => {
  const src = readFileSync(path.join(root, "electron/ai-service.mjs"), "utf8");
  assert.match(src, /res\.contextWindow/);
  assert.match(src, /friendlyError/);
  assert.match(src, /rate.?limit|限流/i);
  assert.match(src, /pi-agent-core threw, falling back to ai-sdk/);
});
