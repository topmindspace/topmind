// ── models.dev integration for Obsidian plugin ─────────────────────────────
//
// Community-maintained AI model catalog (https://models.dev)
// Provides dynamic model lists instead of static curated defaults.
//
// Strategy:
// 1. Fetch https://models.dev/api.json (cached 24h in plugin data)
// 2. Map models.dev provider IDs to our internal provider IDs
// 3. Filter to chat-capable text-output models
// 4. Fall back to PROVIDER_DEFAULT_MODELS on any failure
//
// Used by settings-tab.ts model dropdown — gives users up-to-date model
// lists without manual updates to constants.ts.

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

/** Cache TTL: 24 hours */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Fetch the models.dev community catalog and map it to our provider structure.
 * Returns cached data if fresh (within TTL).
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
    const res = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        "User-Agent": "topmind-obsidian-plugin/2.10.0 (model catalog fetch)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const catalog: ProviderCatalogEntry[] = [];
    for (const [mdId, tmId] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
      const provider = data[mdId];
      if (!provider || !provider.models) continue;

      const chatModels: ModelEntry[] = [];
      for (const [modelId, modelRaw] of Object.entries(provider.models) as [string, Record<string, unknown>][]) {
        const model = modelRaw as Record<string, unknown>;
        const modalities = (model.modalities || {}) as Record<string, unknown>;
        const outputModalities = (modalities.output || []) as string[];
        // Skip non-text-output models
        if (outputModalities.length > 0 && !outputModalities.includes("text")) continue;

        const limit = (model.limit || {}) as Record<string, unknown>;
        const ctxLimit = (limit.context || 0) as number;
        // Skip models with 0 context (image gen, TTS, etc.)
        if (ctxLimit === 0 && model.tool_call === false && model.reasoning === false) continue;

        const entry: ModelEntry = {
          id: modelId,
          label: (model.name || modelId) as string,
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
          live: false,
        });
      }
    }

    cache = catalog;
    cacheFetchedAt = now;
    return catalog;
  } catch {
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
