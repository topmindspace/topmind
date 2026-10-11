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
 * Operation-type-based defaults live in OP_LIMITS (callers can set context.operation).
 *
 * @param {object} context - Caller-provided context metadata
 * @param {number} [promptLen] - Prompt length (for heuristic fallback)
 * @returns {number}
 */
export const OP_LIMITS = {
  topic_summary: 16384,     // Multi-file summaries can be long
  period_analysis: 12288,    // Structured Markdown with 4 sections
  period_digest: 12288,      // Structured Markdown with 3 sections
  inbox_organize: 12288,     // JSON array with multiple items
  memory_extract: 4096,      // 1-3 short lines
  memory_organize: 12288,    // JSON with profile array + periodic text
  todo_extract: 12288,       // Todo list items
  todo_maintain: 12288,      // Todo maintenance operations
  topic_classify: 4096,      // Small JSON array (max 3 items)
};

const DEFAULT_OUTPUT_TOKENS = OP_LIMITS.todo_maintain;

export function resolveMaxTokens(context, promptLen = 0) {
  // Explicit override — highest priority
  if (typeof context.maxOutputTokens === "number" && context.maxOutputTokens > 0) {
    return context.maxOutputTokens;
  }

  if (context.operation && OP_LIMITS[context.operation]) {
    return OP_LIMITS[context.operation];
  }

  // Heuristic: infer from context shape (backward compat for callers without `operation`)
  if (context.topicPath) return OP_LIMITS.topic_summary;
  if (context.periodFile) return OP_LIMITS.period_digest;
  if (context.period || context.sourcePath === "activity-window") return OP_LIMITS.period_analysis;

  // Prompt-length heuristic: long prompts likely need more output space
  if (promptLen > 6000) return DEFAULT_OUTPUT_TOKENS;

  return DEFAULT_OUTPUT_TOKENS;
}

/**
 * Detect if a model ID is a reasoning / thinking model that prohibits custom temperature.
 * Examples: deepseek-reasoner, deepseek-r1, o1, o1-mini, o3-mini, qwq-32b, etc.
 * @param {string} [modelId]
 * @returns {boolean}
 */
export function isReasoningModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const lower = modelId.toLowerCase();
  // Tight patterns — avoid matching o10-*, o30-*, or generic "thinking" ids
  // that accept temperature (many Gemini/OpenRouter models).
  return (
    lower.includes("reasoner") ||
    lower.includes("deepseek-r1") ||
    /^o[134](-mini|-preview)?(?:[-/]|$)/.test(lower) ||
    lower.includes("qwq") ||
    /(^|[-/])thinking([-/]|$)/.test(lower)
  );
}

/**
 * Provider-specific thinking / reasoning-effort knobs for agent mode.
 * Agent work (multi-step tools + edits) should reason at least "high" when
 * the provider supports an effort/budget control. Unknown models get {}.
 *
 * @param {string} [modelId]
 * @param {"agent"|"inline"} [mode="agent"]
 * @returns {object} AI SDK v7 providerOptions
 */
export function reasoningProviderOptions(modelId, mode = "agent") {
  const id = String(modelId || "").toLowerCase();
  const agent = mode !== "inline";
  // OpenAI o-series / GPT-5 reasoning — reasoning_effort
  if (/^o[134](-|$)/.test(id) || /gpt-5/.test(id) || /o4-mini/.test(id)) {
    return { openai: { reasoningEffort: agent ? "high" : "medium" } };
  }
  // Anthropic extended thinking (Claude 3.7+ / 4 / 5)
  if (/claude/.test(id) && /(3-7|sonnet|opus|haiku|4|5)/.test(id)) {
    const budget = agent ? 8192 : 2048;
    return { anthropic: { thinking: { type: "enabled", budgetTokens: budget } } };
  }
  // Gemini 2.5+ / 3.x thinking budget
  if (/gemini/.test(id) && /(2\.5|3\.)/.test(id)) {
    return { google: { thinkingConfig: { thinkingBudget: agent ? 4096 : 1024 } } };
  }
  // DeepSeek Reasoner / QwQ always think — no extra provider option.
  return {};
}

/**
 * Resolve temperature based on operation context and target model capabilities.
 *
 * Extraction/classification tasks benefit from low temperature (deterministic).
 * Creative/analysis tasks benefit from moderate temperature (variety).
 * Reasoning models (DeepSeek-R1, o1, o3) reject non-default temperature → return undefined.
 *
 * @param {object} context
 * @param {string} [modelId]
 * @returns {number|undefined}
 */
function resolveTemperature(context, modelId) {
  if (isReasoningModel(modelId)) return undefined;
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
 * Map provider failures to actionable copy before they reach suggestions /
 * todo extract / other kernel lanes (those surfaces show err.message raw).
 * Mirrors the chat-path mapping in ai-service.mjs.
 * @param {unknown} err
 * @param {string} locale
 * @returns {Error}
 */
function mapProviderError(err, locale) {
  const raw = String(err?.message || err || "");
  const zh = locale !== "en-US" && locale !== "en";
  let friendly = raw;
  const low = raw.toLowerCase();
  if (/401|unauthorized|invalid.?api.?key|authentication/i.test(low)) {
    friendly = zh
      ? "API Key 无效或未配置。请到「设置 → AI」检查密钥。"
      : "Invalid or missing API key. Check Settings → AI.";
  } else if (/429|rate.?limit|too many requests|quota/i.test(low)) {
    friendly = zh
      ? "触发限流/配额。稍后重试，或换一个模型/供应商。"
      : "Rate limited or quota exceeded. Retry later or switch model/provider.";
  } else if (/timeout|etimedout|econnreset|network|fetch failed/i.test(low)) {
    friendly = zh
      ? "网络超时或连接失败。检查网络后重试。"
      : "Network timeout or connection failed. Check connectivity and retry.";
  } else if (/header or cookie too large|request header|413|431/i.test(low)) {
    friendly = zh
      ? "请求头过大，通常因 API Key 异常超长或已损坏。请到「设置 → AI」删除当前 Key 后重新粘贴官方纯英文密钥。"
      : "Request headers too large — the API key is likely corrupt or oversized. Re-paste a plain-ASCII key in Settings → AI.";
  } else if (/bytestring|character at index/i.test(low)) {
    friendly = zh
      ? "API Key 含非英文字符（HTTP 头只能是 ASCII）。请到「设置 → AI」重新粘贴纯英文密钥。"
      : "API key contains non-ASCII characters (HTTP headers must be ASCII). Re-paste a plain-ASCII key in Settings → AI.";
  } else if (/400 bad request|bad request/i.test(low)) {
    friendly = zh
      ? "模型服务拒绝了请求（400）。请检查 API Key 是否正确、模型名是否有效。"
      : "Provider rejected the request (400). Check the API key and model id.";
  }
  const mapped = new Error(friendly);
  mapped.cause = err;
  return mapped;
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
      let temperature = resolveTemperature(context, res.modelId);
      let systemPrompt = resolveSystemPrompt(context);
      let promptText = prompt;
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
            promptLen: promptText.length,
            maxOutputTokens: maxTokens,
            temperature: temperature ?? "default",
            systemPrompt: systemPrompt ? "present" : "none",
            operation: context.operation || "generic",
            context: context.period || context.topicPath || "generic",
          });
          const genOpts = {
            model: res.model,
            prompt: promptText,
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
          const errMsg = (err?.message || String(err)).toLowerCase();

          // Self-heal 1: temperature unsupported by model → drop temperature and retry
          if (temperature !== undefined && /temperature.*(?:not supported|unsupported|invalid|does not support)/i.test(errMsg)) {
            logInfo("ai", "temperature unsupported by model, self-healing without temperature", { model: res.modelId });
            temperature = undefined;
            try {
              const retryGenOpts = {
                model: res.model,
                prompt: promptText,
                maxOutputTokens: maxTokens,
              };
              if (systemPrompt) retryGenOpts.system = systemPrompt;
              const out = await generateText(retryGenOpts);
              return out.text || "";
            } catch (retryErr) {
              lastError = retryErr;
            }
          }

          // Self-heal 2: system message unsupported by model (e.g. o1/o1-mini/deepseek-reasoner) → merge into prompt
          if (systemPrompt && /(?:system|developer).*(?:not supported|unsupported|invalid|role|message)/i.test(errMsg)) {
            logInfo("ai", "system message unsupported by model, self-healing by merging into prompt", { model: res.modelId });
            promptText = `${systemPrompt}\n\n${promptText}`;
            systemPrompt = undefined;
            try {
              const retryGenOpts = {
                model: res.model,
                prompt: promptText,
                maxOutputTokens: maxTokens,
              };
              if (temperature !== undefined) retryGenOpts.temperature = temperature;
              const out = await generateText(retryGenOpts);
              return out.text || "";
            } catch (retryErr) {
              lastError = retryErr;
            }
          }

          // Don't retry on abort/cancel or non-transient errors
          if (!isTransientError(lastError) || attempt >= maxRetries) {
            logError("ai", "kernel-ai-provider failed", {
              model: res.modelId,
              maxOutputTokens: maxTokens,
              error: lastError?.message || String(lastError),
              durationMs: Date.now() - startTime,
              retried: attempt > 0,
            });
            throw mapProviderError(lastError, settings?.ui?.locale);
          }
          // Transient error — will retry with preserved healed state
        }
      }
      // Unreachable (loop either returns or throws), but TypeScript-safe fallback
      throw mapProviderError(lastError || new Error("kernel-ai-provider: unreachable"), settings?.ui?.locale);
    },
  };
}
