import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isReasoningModel } from "../electron/ai-provider-adapter.mjs";

describe("ai-provider-adapter reasoning model detection and resilience", () => {
  it("accurately detects reasoning models across providers", () => {
    assert.equal(isReasoningModel("deepseek-reasoner"), true);
    assert.equal(isReasoningModel("deepseek-r1"), true);
    assert.equal(isReasoningModel("DeepSeek-R1-Distill-Qwen-32B"), true);
    assert.equal(isReasoningModel("o1"), true);
    assert.equal(isReasoningModel("o1-mini"), true);
    assert.equal(isReasoningModel("o1-preview"), true);
    assert.equal(isReasoningModel("o3-mini"), true);
    assert.equal(isReasoningModel("qwq-32b-preview"), true);
    assert.equal(isReasoningModel("claude-3-7-sonnet-thinking"), true);

    assert.equal(isReasoningModel("gpt-4o"), false);
    assert.equal(isReasoningModel("gpt-4o-mini"), false);
    assert.equal(isReasoningModel("claude-3-5-sonnet-20241022"), false);
    assert.equal(isReasoningModel("gemini-2.0-flash"), false);
    assert.equal(isReasoningModel("deepseek-chat"), false);
    assert.equal(isReasoningModel(null), false);
    assert.equal(isReasoningModel(""), false);
  });

  it("ai-provider-adapter source includes dual self-healing and healed state retention", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const adapterSrc = await fs.readFile(
      path.resolve("electron/ai-provider-adapter.mjs"),
      "utf8",
    );

    // Temperature self-heal
    assert.match(adapterSrc, /temperature unsupported by model/i);
    assert.match(adapterSrc, /temperature = undefined/);

    // System prompt self-heal (merging into user prompt)
    assert.match(adapterSrc, /system message unsupported by model/i);
    assert.match(adapterSrc, /promptText = `\$\{systemPrompt\}\\n\\n\$\{promptText\}`/);
    assert.match(adapterSrc, /systemPrompt = undefined/);
  });

  it("ai-service.mjs complete method implements self-healing for models without system role", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const serviceSrc = await fs.readFile(
      path.resolve("electron/ai-service.mjs"),
      "utf8",
    );

    assert.match(serviceSrc, /complete: system message unsupported by model, self-healing by merging into prompt/);
    assert.match(serviceSrc, /prompt:\s*`\$\{systemPrompt\}\\n\\n\$\{prompt\}`/);
  });
});
