// ── models.dev integration for Obsidian plugin ─────────────────────────────
//
// Community-maintained AI model catalog (https://models.dev)
// Provides dynamic model lists instead of static curated defaults.
//
// Strategy:
// 1. Fetch https://models.dev/api.json (cached 24h in memory)
// 2. Map models.dev provider IDs to our internal provider IDs
// 3. Filter to chat-capable text-output models (exclude embedding/image/tts)
// 4. Fall back to PROVIDER_DEFAULT_MODELS on any failure
//
// CRITICAL: Uses Obsidian's `requestUrl` instead of raw `fetch`.
// Obsidian's CSP blocks `fetch` to external URLs on some platforms
// (especially Windows), causing silent failures that always fall back
// to hardcoded static model lists. `requestUrl` bypasses CSP and is
// the recommended HTTP API for Obsidian plugins.
//
// NOTE: The models.dev API response is ~3.6 MB (hundreds of providers).
// We only extract the 8 providers we care about, but the full response
// must be downloaded and parsed. A 15-second timeout prevents hangs on
// slow connections.

import { requestUrl } from "obsidian";
import { AI_PROVIDER_PRESETS, PROVIDER_DEFAULT_MODELS } from "../constants";

/** models.dev provider ID → topmind internal provider ID */
const MODELS_DEV_PROVIDER_MAP: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  moonshotai: "moonshot",
  zhipuai: "zhipu",
  minimax: "minimax",
  xai: "xai",
};

/** Cache TTL: 6 hours (reduced from 24h for fresher model lists) */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Fetch timeout: 15 seconds (the API response is ~3.6 MB) */
const FETCH_TIMEOUT_MS = 15_000;

export interface ModelEntry {
  id: string;
  label: string;
  description?: string;
  toolCall?: boolean;
  reasoning?: boolean;
  contextLimit?: number;
  costInput?: number;
  costOutput?: number;
}

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  models: ModelEntry[];
  live: boolean;
}

/** In-memory cache */
let cache: ProviderCatalogEntry[] | null = null;
let cacheFetchedAt = 0;

/** Check if a model ID/name indicates a non-chat model (embedding, image, TTS, etc.) */
function isNonChatModel(modelId: string, modelName: string): boolean {
  const lower = `${modelId} ${modelName}`.toLowerCase();
  return (
    lower.includes("embedding") ||
    lower.includes("whisper") ||
    lower.includes("tts") ||
    lower.includes("dall-e") ||
    lower.includes("image") ||
    lower.includes("moderation") ||
    lower.includes("realtime") ||
    lower.includes("audio") ||
    lower.includes("transcribe")
  );
}

/**
 * Fetch the models.dev community catalog and map it to our provider structure.
 * Returns cached data if fresh (within TTL).
 *
 * Uses Obsidian's `requestUrl` to bypass CSP restrictions that block `fetch`
 * on Windows and some other platforms.
 *
 * @param forceLive - bypass cache and fetch fresh
 * @returns provider catalog entries (one per mapped provider)
 */
export async function fetchModelsDevCatalog(forceLive = false): Promise<ProviderCatalogEntry[]> {
  const now = Date.now();
  if (!forceLive && cache && cacheFetchedAt && now - cacheFetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  try {
    // Use Obsidian's requestUrl — bypasses CSP, works on all platforms
    // (Windows, macOS, Linux). Raw `fetch` is blocked by Obsidian's CSP on
    // some platforms, causing silent fallback to static defaults.
    //
    // The API response is ~3.6 MB, so we use a timeout to prevent hangs.
    const requestPromise = requestUrl({
      url: "https://models.dev/api.json",
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("models.dev fetch timeout")), FETCH_TIMEOUT_MS);
    });

    const res = await Promise.race([requestPromise, timeoutPromise]);

    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = res.json;

    const catalog: ProviderCatalogEntry[] = [];
    for (const [mdId, tmId] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
      const provider = data[mdId];
      if (!provider || !provider.models) continue;

      const chatModels: ModelEntry[] = [];
      for (const [modelId, modelRaw] of Object.entries(provider.models) as [string, Record<string, unknown>][]) {
        const model = modelRaw as Record<string, unknown>;
        const modalities = (model.modalities || {}) as Record<string, unknown>;
        const outputModalities = (modalities.output || []) as string[];
        // Skip non-text-output models (image gen, TTS, etc.)
        if (outputModalities.length > 0 && !outputModalities.includes("text")) continue;

        const limit = (model.limit || {}) as Record<string, unknown>;
        const ctxLimit = (limit.context || 0) as number;
        // Skip models with 0 context (image gen, TTS, etc.)
        if (ctxLimit === 0 && model.tool_call === false && model.reasoning === false) continue;

        // Skip embedding / audio / non-chat models
        const modelName = (model.name || modelId) as string;
        if (isNonChatModel(modelId, modelName)) continue;

        const entry: ModelEntry = {
          id: modelId,
          label: modelName,
        };
        if (typeof model.description === "string" && model.description) {
          entry.description = model.description;
        }
        if (typeof model.tool_call === "boolean") {
          entry.toolCall = model.tool_call;
        }
        if (typeof model.reasoning === "boolean") {
          entry.reasoning = model.reasoning;
        }
        if (typeof ctxLimit === "number" && ctxLimit > 0) {
          entry.contextLimit = ctxLimit;
        }
        const cost = (model.cost || {}) as Record<string, unknown>;
        if (typeof cost.input === "number" && cost.input >= 0) {
          entry.costInput = cost.input;
        }
        if (typeof cost.output === "number" && cost.output >= 0) {
          entry.costOutput = cost.output;
        }
        chatModels.push(entry);
      }

      if (chatModels.length > 0) {
        const preset = AI_PROVIDER_PRESETS[tmId];
        catalog.push({
          id: tmId,
          label: preset?.label || tmId,
          models: chatModels.sort((a, b) => a.label.localeCompare(b.label)),
          live: true,
        });
      }
    }

    if (catalog.length === 0) {
      throw new Error("No providers found in models.dev response");
    }

    cache = catalog;
    cacheFetchedAt = now;
    console.log(`[topmind] models.dev: fetched ${catalog.reduce((sum, c) => sum + c.models.length, 0)} models across ${catalog.length} providers`);
    return catalog;
  } catch (err) {
    // Log the error so users can diagnose connectivity issues
    console.warn("[topmind] models.dev fetch failed, using static fallbacks:", err);
    // Fallback: curated defaults from constants
    return Object.entries(MODELS_DEV_PROVIDER_MAP).map(([, tmId]) => ({
      id: tmId,
      label: AI_PROVIDER_PRESETS[tmId]?.label || tmId,
      models: (PROVIDER_DEFAULT_MODELS[tmId] || []).map((m) => ({
        id: m.id,
        label: m.label,
      })),
      live: false,
    }));
  }
}

/**
 * Get model list for a specific provider.
 * Uses models.dev catalog when available, falls back to curated defaults.
 *
 * @param providerId - internal provider ID (e.g. "openai", "anthropic")
 * @param forceLive - bypass cache
 * @returns model entries for the provider
 */
export async function getModelsForProvider(
  providerId: string,
  forceLive = false,
): Promise<ModelEntry[]> {
  const catalog = await fetchModelsDevCatalog(forceLive);
  const entry = catalog.find((c) => c.id === providerId);
  if (entry && entry.models.length > 0) return entry.models;

  // Fallback to curated defaults
  const curated = PROVIDER_DEFAULT_MODELS[providerId] || [];
  return curated.map((m) => ({ id: m.id, label: m.label }));
}

/** Clear the in-memory cache (forces next call to fetch fresh). */
export function clearModelsDevCache(): void {
  cache = null;
  cacheFetchedAt = 0;
}
