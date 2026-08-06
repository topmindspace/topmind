/**
 * AI Provider Adapter — bridges Desktop's AI SDK (Vercel AI SDK v7) to the
 * Kernel's AiProvider interface ({ generate(prompt, context) => Promise<string> }).
 *
 * Used by (per-call injection, no global singleton):
 * - suggest-engine.mjs (AI-powered suggestions, real period digests)
 * - ai-operation-engine.mjs (todo_maintain / memory_organize / topic_classify)
 * - derived-builder.mjs (topic summaries, period digests) via per-call provider
 *
 * When AI is not configured (no API keys), returns null — callers fall back
 * to deterministic/rule-based behavior. This is intentional: the product
 * works without AI; AI enhances it when available.
 */
import { generateText } from "ai";
import { resolveModel } from "./ai-model.mjs";
import { logInfo, logError } from "./lib/writeback.mjs";

/**
 * Create a Kernel-compatible AiProvider from Desktop settings.
 *
 * @param {object} settings - Full app settings (with decrypted secrets)
 * @param {string} [modelOverride] - Optional model id override
 * @returns {{ generate: (prompt: string, context?: object) => Promise<string> } | null}
 *   Returns null when no AI provider is configured.
 */
export function createKernelAiProvider(settings, modelOverride) {
  const res = resolveModel(settings, modelOverride);
  if (!res) return null;

  return {
    /**
     * Generate text via the configured AI provider.
     * @param {string} prompt - Full prompt text
     * @param {object} [context] - Optional context metadata for logging
     * @returns {Promise<string>} generated text
     */
    async generate(prompt, context = {}) {
      const startTime = Date.now();
      try {
        logInfo("ai", "kernel-ai-provider generate", {
          model: res.modelId,
          promptLen: prompt.length,
          context: context.period || context.topicPath || "generic",
        });
        const out = await generateText({
          model: res.model,
          prompt,
          maxOutputTokens: 2048,
        });
        const text = out.text || "";
        logInfo("ai", "kernel-ai-provider done", {
          model: res.modelId,
          outputLen: text.length,
          durationMs: Date.now() - startTime,
        });
        return text;
      } catch (err) {
        logError("ai", "kernel-ai-provider failed", {
          model: res.modelId,
          error: err?.message || String(err),
          durationMs: Date.now() - startTime,
        });
        throw err;
      }
    },
  };
}
