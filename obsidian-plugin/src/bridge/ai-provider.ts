// ── AI Provider: fetch-based adapter for Kernel AiProvider interface ────────
//
// Multi-provider support — aligned with Desktop's provider list:
//   OpenAI · Anthropic · Google Gemini · DeepSeek · Moonshot · Zhipu ·
//   MiniMax · xAI · Ollama · Custom
//
// API call strategies:
//   - OpenAI-compatible (OpenAI, DeepSeek, Moonshot, Zhipu, MiniMax, xAI, Ollama, Custom)
//     → POST {baseUrl}/chat/completions
//   - Anthropic native → POST {baseUrl}/messages
//   - Google Gemini → POST {baseUrl}/models/{model}:generateContent
//
// The Kernel's AiProvider interface is:
//   { generate(prompt: string, context?: object) => Promise<string> }
//
// Includes transient error retry (matches Kernel's AI provider resilience).

import type { TopmindSettings } from "../types";
import { AI_PROVIDER_PRESETS } from "../constants";
import { isTransientError } from "../utils";
import { getProviderKey, hasConfiguredProvider } from "../types";

// Re-export for callers that previously imported from this module
export { isTransientError };

export interface AiProvider {
  generate(prompt: string, context?: unknown): Promise<string>;
}

/** Max retry attempts for transient errors (5xx, 429, network). */
const MAX_RETRIES = 2;
/** Base retry delay in ms (exponential backoff: delay * 2^attempt). */
const RETRY_BASE_DELAY = 500;
/** Request timeout in ms (30s — generous for slow models). */
const REQUEST_TIMEOUT_MS = 30_000;

// ── Legacy compat: resolve from old single-provider settings ────────────────

/**
 * Resolve the effective base URL and model from settings + provider presets.
 * Uses the new multi-provider `ai.manual` if keys are configured there,
 * falling back to legacy `aiProvider`/`aiApiKey`/`aiBaseUrl`/`aiModel`.
 */
export function resolveAiEndpoint(settings: TopmindSettings): {
  baseUrl: string;
  model: string;
  apiKey: string;
  provider: string;
} {
  // Try new multi-provider model first
  const ai = settings.ai;
  if (ai && hasConfiguredProvider(ai)) {
    const pref = ai.sourcePreference || "";
    // If preference is set and has a key, use it
    if (pref && pref !== "none") {
      const meta = AI_PROVIDER_PRESETS[pref];
      const key = getProviderKey(pref, ai.manual);
      // For ollama, URL is sufficient; for others, need key
      const isReady = pref === "ollama"
        ? Boolean(ai.manual.ollamaBaseUrl)
        : Boolean(key);
      if (isReady) {
        const baseUrl = pref === "ollama"
          ? (ai.manual.ollamaBaseUrl || meta?.baseUrl || "")
          : pref === "custom"
            ? ai.manual.customBaseUrl
            : (meta?.baseUrl || "");
        const model = ai.defaultModel || meta?.model || "";
        return { baseUrl, model, apiKey: key || "", provider: pref };
      }
      // Preference set but key missing — fall through to auto-select
      // This handles the edge case where user set preference but then cleared the key
    }
    // Auto: pick first configured provider
    for (const [pid, meta] of Object.entries(AI_PROVIDER_PRESETS)) {
      if (pid === "custom" || pid === "ollama") continue;
      const key = getProviderKey(pid, ai.manual);
      if (key) {
        const model = ai.defaultModel || meta.model;
        return { baseUrl: meta.baseUrl, model, apiKey: key, provider: pid };
      }
    }
    // Check ollama
    if (ai.manual.ollamaBaseUrl) {
      const meta = AI_PROVIDER_PRESETS.ollama;
      return {
        baseUrl: ai.manual.ollamaBaseUrl,
        model: ai.defaultModel || meta.model,
        apiKey: "ollama",
        provider: "ollama",
      };
    }
    // Check custom
    if (ai.manual.customBaseUrl && ai.manual.customKey) {
      return {
        baseUrl: ai.manual.customBaseUrl,
        model: ai.defaultModel || "",
        apiKey: ai.manual.customKey,
        provider: "custom",
      };
    }
  }

  // Fallback: legacy single-provider fields
  const provider = settings.aiProvider || "none";
  const preset = AI_PROVIDER_PRESETS[provider] || AI_PROVIDER_PRESETS.custom;
  const baseUrl = settings.aiBaseUrl || preset.baseUrl;
  const model = settings.aiModel || preset.model;
  const apiKey = settings.aiApiKey || "";
  return { baseUrl, model, apiKey, provider };
}

/**
 * Create a Kernel-compatible AI Provider from plugin settings.
 * Returns null when AI is not configured (product works without AI).
 *
 * Uses the new multi-provider `ai.manual` if available, falling back to
 * legacy single-provider fields for backward compatibility.
 */
export function createAiProvider(settings: TopmindSettings): AiProvider | null {
  const { provider, baseUrl, model, apiKey } = resolveAiEndpoint(settings);

  if (provider === "none") return null;
  const isOllama = provider === "ollama";
  if (!isOllama && !apiKey) return null;
  if (!baseUrl || !model) return null;

  const meta = AI_PROVIDER_PRESETS[provider];
  const apiType = meta?.apiType || "openai-compat";

  return {
    async generate(prompt: string, context: unknown = {}): Promise<string> {
      const ctx = (context || {}) as Record<string, unknown>;
      const operation = (ctx.operation as string) || "generic";
      const explicitMaxTokens = typeof ctx.maxOutputTokens === "number" && ctx.maxOutputTokens > 0
        ? ctx.maxOutputTokens
        : undefined;
      const explicitTemperature = typeof ctx.temperature === "number"
        ? ctx.temperature
        : undefined;
      const systemPrompt = (ctx.systemPrompt as string) || resolveSystemPrompt(operation);
      const maxTokens = explicitMaxTokens ?? resolveMaxTokens(operation);
      const temperature = explicitTemperature ?? resolveTemperature(operation);

      const callOpts: CallOpts = { systemPrompt, maxTokens, temperature, operation };

      if (apiType === "anthropic") {
        return callAnthropic(baseUrl, model, apiKey, prompt, callOpts);
      }
      if (apiType === "google") {
        return callGoogleGemini(baseUrl, model, apiKey, prompt, callOpts);
      }
      return callOpenAICompatible(baseUrl, model, apiKey, prompt, callOpts);
    },
  };
}

// ── OpenAI-compatible API call (/chat/completions) ──────────────────────────

interface CallOpts {
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  operation: string;
}

async function callOpenAICompatible(
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  opts: CallOpts,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body = {
    model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  };

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const data = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, opts.operation);

  // OpenAI-compatible response: { choices: [{ message: { content: "..." } }] }
  const choices = (data?.choices as Array<{ message?: { content?: string } }> | undefined) || [];
  const text = choices[0]?.message?.content || "";
  if (!text) {
    console.warn(`[topmind] AI ${opts.operation}: empty response from ${model}`);
  }
  return text;
}

// ── Anthropic native API call (/v1/messages) ────────────────────────────────

async function callAnthropic(
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  opts: CallOpts,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: [{ role: "user", content: prompt }],
  };
  if (opts.systemPrompt) {
    body.system = opts.systemPrompt;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/messages`;
  const data = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, opts.operation);

  // Anthropic response: { content: [{ type: "text", text: "..." }] }
  const contentBlocks = (data?.content as Array<{ type?: string; text?: string }> | undefined) || [];
  const text = contentBlocks.find((b) => b.type === "text")?.text || contentBlocks[0]?.text || "";
  if (!text) {
    console.warn(`[topmind] AI ${opts.operation}: empty response from ${model}`);
  }
  return text;
}

// ── Google Gemini API call (/v1beta/models/{model}:generateContent) ─────────

async function callGoogleGemini(
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  opts: CallOpts,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models/${model}:generateContent?key=${apiKey}`;
  // Gemini uses system_instruction for system prompt (separate from contents)
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
    },
  };
  if (opts.systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: opts.systemPrompt }],
    };
  }

  const data = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, opts.operation);

  // Gemini response: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
  const candidates = (data?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined) || [];
  const parts = candidates[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("") || "";
  if (!text) {
    console.warn(`[topmind] AI ${opts.operation}: empty response from ${model}`);
  }
  return text;
}

// ── Fetch with transient error retry ────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  operation: string,
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use AbortController for timeout — prevents hanging on unresponsive endpoints
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        // Retry on 5xx (transient server errors) and 429 (rate limit)
        if ((res.status >= 500 || res.status === 429) && attempt < MAX_RETRIES) {
          // For 429, respect Retry-After header if present
          const retryAfter = res.headers.get("Retry-After");
          const delay = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000, 10_000)
            : RETRY_BASE_DELAY * Math.pow(2, attempt);
          lastError = new Error(`AI ${res.status}: ${errText}`);
          await sleep(delay);
          continue;
        }
        throw new Error(`AI request failed (${res.status}): ${errText}`);
      }

      // Success path: no console noise (Obsidian plugin guidelines).
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      // Retry on network errors
      if (attempt < MAX_RETRIES && isTransientError(err)) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt));
        continue;
      }
      // Real failures only — avoid success-path console spam
      console.error(`[topmind] AI ${operation} failed:`, err);
      throw err;
    }
  }

  throw lastError || new Error("AI request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve max_tokens based on operation type.
 * Aligned with Desktop's ai-provider-adapter.mjs OP_LIMITS.
 */
function resolveMaxTokens(operation: string): number {
  switch (operation) {
    case "topic_summary":
      return 16384;     // Multi-file summaries can be long
    case "period_analysis":
    case "period_digest":
      return 12288;     // Structured Markdown with sections
    case "inbox_organize":
    case "memory_organize":
    case "ai_summary":
    case "write_digest":
      return 6144;      // JSON with arrays / structured output
    case "topic_classify":
    case "todo_maintain":
      return 4096;      // Small JSON / todo lines
    case "todo_extract":
    case "memory_extract":
      return 2048;      // Short extraction
    default:
      return 2048;
  }
}

/**
 * Resolve temperature based on operation type.
 * Aligned with Desktop's ai-provider-adapter.mjs.
 */
function resolveTemperature(operation: string): number {
  switch (operation) {
    case "todo_maintain":
    case "todo_extract":
    case "memory_extract":
    case "topic_classify":
      return 0.3;       // Extraction/classification: deterministic
    case "period_analysis":
    case "period_digest":
    case "ai_summary":
    case "memory_organize":
    case "write_digest":
      return 0.5;       // Analysis: balanced
    case "chat":
      return 0.6;       // Chat: slightly creative
    default:
      return 0.4;       // Generic default
  }
}

/**
 * Default system prompt for structured output operations.
 * Mirrors Desktop's resolveSystemPrompt — ensures structured ops
 * get clean output without thinking tags or preamble.
 */
const STRUCTURED_OPS = new Set([
  "inbox_organize",
  "topic_classify",
  "memory_organize",
  "todo_extract",
  "todo_maintain",
]);

function resolveSystemPrompt(operation: string): string | undefined {
  if (STRUCTURED_OPS.has(operation)) {
    return "You are a precise content analysis assistant. Follow output format instructions exactly. Output only the requested format — no preamble, no thinking tags, no markdown code fences unless explicitly requested.";
  }
  return undefined;
}
