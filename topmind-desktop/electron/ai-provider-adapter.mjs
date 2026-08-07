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
 * Resolve maxOutputTokens based on operation context.
 *
 * Modern models (GPT-4.1, Claude 4, Gemini 2.5) support 16K+ output tokens.
 * Defaults are tuned for structured output reliability without over-spending.
 *
 * Operation-type-based defaults (callers can set context.operation):
 * - Topic summaries (multi-file): up to 8K tokens
 * - Period analysis/digest (structured Markdown): ~4K tokens
 * - Inbox organize (JSON array): ~4K tokens
 * - Memory organize (JSON with arrays): ~4K tokens
 * - Todo extraction (short lines): ~2K tokens
 * - Topic classify (small JSON array): ~2K tokens
 *
 * @param {object} context - Caller-provided context metadata
 * @param {number} [promptLen] - Prompt length (for heuristic fallback)
 * @returns {number}
 */
function resolveMaxTokens(context, promptLen = 0) {
  // Explicit override — highest priority
  if (typeof context.maxOutputTokens === "number" && context.maxOutputTokens > 0) {
    return context.maxOutputTokens;
  }

  // Operation-type-based defaults
  const OP_LIMITS = {
    topic_summary: 8192,      // Multi-file summaries can be long
    period_analysis: 4096,    // Structured Markdown with 4 sections
    period_digest: 4096,      // Structured Markdown with 3 sections
    inbox_organize: 4096,     // JSON array with multiple items
    memory_extract: 2048,     // 1-3 short lines
    memory_organize: 4096,    // JSON with profile array + periodic text
    todo_extract: 4096,       // Todo list items
    todo_maintain: 4096,      // Todo maintenance operations
    topic_classify: 2048,     // Small JSON array (max 3 items)
  };
  if (context.operation && OP_LIMITS[context.operation]) {
    return OP_LIMITS[context.operation];
  }

  // Heuristic: infer from context shape (backward compat for callers without `operation`)
  if (context.topicPath) return 8192;   // Topic summary path
  if (context.periodFile) return 4096;  // Period digest path
  if (context.period || context.sourcePath === "activity-window") return 4096;

  // Prompt-length heuristic: long prompts likely need more output space
  if (promptLen > 6000) return 4096;

  // Default: 4096 (up from original 2048 — prevents truncation of structured output)
  return 4096;
}

/**
 * Resolve temperature based on operation context.
 *
 * Extraction/classification tasks benefit from low temperature (deterministic).
 * Creative/analysis tasks benefit from moderate temperature (variety).
 *
 * @param {object} context
 * @returns {number|undefined}
 */
function resolveTemperature(context) {
  if (typeof context.temperature === "number") return context.temperature;

  const LOW_TEMP_OPS = new Set([
    "inbox_organize",
    "topic_classify",
    "memory_extract",
    "memory_organize",
    "todo_extract",
    "todo_maintain",
  ]);
  if (context.operation && LOW_TEMP_OPS.has(context.operation)) {
    return 0.3; // Low temperature for extraction/classification (deterministic)
  }

  // Analysis/summary tasks: moderate temperature for natural prose
  if (context.operation === "period_analysis" || context.operation === "period_digest" || context.operation === "topic_summary") {
    return 0.5;
  }

  // Default: undefined (let provider decide — typically 0.7-1.0)
  return undefined;
}

/**
 * Brief system prompt for Kernel AI operations.
 * Improves output quality by setting role expectations without consuming
 * excessive context tokens.
 * @param {object} context
 * @returns {string|undefined}
 */
function resolveSystemPrompt(context) {
  if (typeof context.systemPrompt === "string" && context.systemPrompt) {
    return context.systemPrompt;
  }
  // Brief, operation-aware system prompt for structured output tasks
  const STRUCTURED_OPS = new Set([
    "inbox_organize",
    "topic_classify",
    "memory_organize",
    "todo_extract",
    "todo_maintain",
  ]);
  if (context.operation && STRUCTURED_OPS.has(context.operation)) {
    return "You are a precise content analysis assistant. Follow output format instructions exactly. Output only the requested format — no preamble, no thinking tags, no markdown code fences unless explicitly requested.";
  }
  return undefined;
}

/**
 * Check if an error is likely transient (worth retrying).
 * @param {Error} err
 * @returns {boolean}
 */
function isTransientError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  // Network/timeout/rate-limit errors are transient
  if (/timeout|econnreset|enotfound|socket hang up|rate.?limit|429|503|502|500/.test(msg)) {
    return true;
  }
  // Abort/cancel errors are NOT transient
  if (/abort|cancel/.test(msg)) {
    return false;
  }
  return false;
}

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
     * @param {object} [context] - Optional context metadata for logging + token sizing.
     *   Supports `context.operation` (e.g., "topic_summary") and
     *   `context.maxOutputTokens` (explicit override).
     * @returns {Promise<string>} generated text
     */
    async generate(prompt, context = {}) {
      const startTime = Date.now();
      const maxTokens = resolveMaxTokens(context, prompt.length);
      const temperature = resolveTemperature(context);
      const systemPrompt = resolveSystemPrompt(context);
      const maxRetries = 1; // Allow 1 retry for transient errors (network, rate-limit)

      let lastError = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            // Brief backoff before retry (800ms — avoids hammering rate-limited APIs)
            await new Promise((r) => setTimeout(r, 800));
            logInfo("ai", "kernel-ai-provider retry", {
              model: res.modelId,
              attempt,
              maxOutputTokens: maxTokens,
              operation: context.operation || "generic",
            });
          }
          logInfo("ai", "kernel-ai-provider generate", {
            model: res.modelId,
            promptLen: prompt.length,
            maxOutputTokens: maxTokens,
            temperature: temperature ?? "default",
            operation: context.operation || "generic",
            context: context.period || context.topicPath || "generic",
          });
          const genOpts = {
            model: res.model,
            prompt,
            maxOutputTokens: maxTokens,
          };
          if (temperature !== undefined) genOpts.temperature = temperature;
          if (systemPrompt) genOpts.system = systemPrompt;
          const out = await generateText(genOpts);
          const text = out.text || "";
          logInfo("ai", "kernel-ai-provider done", {
            model: res.modelId,
            outputLen: text.length,
            maxOutputTokens: maxTokens,
            durationMs: Date.now() - startTime,
          });
          return text;
        } catch (err) {
          lastError = err;
          // Don't retry on abort/cancel or non-transient errors
          if (!isTransientError(err) || attempt >= maxRetries) {
            logError("ai", "kernel-ai-provider failed", {
              model: res.modelId,
              maxOutputTokens: maxTokens,
              error: err?.message || String(err),
              durationMs: Date.now() - startTime,
              retried: attempt > 0,
            });
            throw err;
          }
          // Transient error — will retry
        }
      }
      // Unreachable (loop either returns or throws), but TypeScript-safe fallback
      throw lastError || new Error("kernel-ai-provider: unreachable");
    },
  };
}
