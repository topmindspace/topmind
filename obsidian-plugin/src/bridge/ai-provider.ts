// ── AI Provider: fetch-based adapter for Kernel AiProvider interface ────────
//
// Unlike Desktop (which uses Vercel AI SDK v7), the Obsidian plugin uses
// the native fetch API to call OpenAI-compatible endpoints directly.
// This keeps the plugin lightweight (no heavy SDK dependencies).
//
// The Kernel's AiProvider interface is:
//   { generate(prompt: string, context?: object) => Promise<string> }
//
// Supported providers:
// - OpenAI / DeepSeek / Ollama / Custom → OpenAI-compatible /chat/completions
// - Anthropic → native /v1/messages API (different format)
//
// Includes transient error retry (matches Kernel's AI provider resilience).

import type { TopmindSettings } from "../types";
import { AI_PROVIDER_PRESETS } from "../constants";

export interface AiProvider {
  generate(prompt: string, context?: unknown): Promise<string>;
}

/** Max retry attempts for transient errors (5xx, 429, network). */
const MAX_RETRIES = 2;
/** Base retry delay in ms (exponential backoff: delay * 2^attempt). */
const RETRY_BASE_DELAY = 500;
/** Request timeout in ms (30s — generous for slow models). */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Resolve the effective base URL and model from settings + provider presets.
 */
export function resolveAiEndpoint(settings: TopmindSettings): {
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  const preset = AI_PROVIDER_PRESETS[settings.aiProvider] || AI_PROVIDER_PRESETS.custom;
  const baseUrl = settings.aiBaseUrl || preset.baseUrl;
  const model = settings.aiModel || preset.model;
  const apiKey = settings.aiApiKey || "";
  return { baseUrl, model, apiKey };
}

/**
 * Create a Kernel-compatible AI Provider from plugin settings.
 * Returns null when AI is not configured (product works without AI).
 *
 * Provider-specific key requirements:
 * - Ollama: no API key required (local server)
 * - All others: API key required
 *
 * Uses fetch() to call provider-specific API endpoints.
 */
export function createAiProvider(settings: TopmindSettings): AiProvider | null {
  const isOllama = settings.aiProvider === "ollama";
  const needsKey = !isOllama;

  if (settings.aiProvider === "none") return null;
  if (needsKey && !settings.aiApiKey) return null;

  const { baseUrl, model, apiKey } = resolveAiEndpoint(settings);
  if (!baseUrl || !model) return null;

  const isAnthropic = settings.aiProvider === "anthropic";

  return {
    async generate(prompt: string, context: unknown = {}): Promise<string> {
      const ctx = (context || {}) as Record<string, unknown>;
      const operation = (ctx.operation as string) || "generic";
      const systemPrompt = (ctx.systemPrompt as string) || undefined;
      const maxTokens = resolveMaxTokens(operation);
      const temperature = resolveTemperature(operation);

      if (isAnthropic) {
        return callAnthropic(baseUrl, model, apiKey, prompt, {
          systemPrompt, maxTokens, temperature, operation,
        });
      }
      return callOpenAICompatible(baseUrl, model, apiKey, prompt, {
        systemPrompt, maxTokens, temperature, operation,
      });
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

// ── Fetch with transient error retry ────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  operation: string,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();
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

      const data = await res.json();
      console.debug(
        `[topmind] AI ${operation} done: attempt=${attempt + 1} ${Date.now() - startTime}ms`,
      );
      return data as Record<string, unknown>;
    } catch (err) {
      // Retry on network errors
      if (attempt < MAX_RETRIES && isTransientError(err)) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt));
        continue;
      }
      console.error(`[topmind] AI ${operation} failed:`, err);
      throw err;
    }
  }

  throw lastError || new Error("AI request failed after retries");
}

function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network error
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Check for transient error indicators including abort/timeout
    return msg.includes("fetch") || msg.includes("network") || msg.includes("timeout") || msg.includes("abort");
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve max_tokens based on operation type (mirrors Desktop's adapter).
 */
function resolveMaxTokens(operation: string): number {
  switch (operation) {
    case "topic_summary":
    case "topic_classify":
      return 4096;
    case "memory_organize":
    case "ai_summary":
    case "write_digest":
      return 4096;
    case "todo_maintain":
    case "memory_extract":
      return 2048;
    default:
      return 2048;
  }
}

/**
 * Resolve temperature based on operation type (mirrors Desktop's adapter).
 */
function resolveTemperature(operation: string): number {
  switch (operation) {
    case "todo_maintain":
    case "memory_extract":
    case "topic_classify":
      return 0.3;
    case "ai_summary":
    case "memory_organize":
    case "write_digest":
      return 0.5;
    default:
      return 0.4;
  }
}
