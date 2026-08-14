/**
 * Shared AI model catalog — parse / merge / cache policy.
 *
 * Two-source contract (Desktop + Obsidian):
 *   official list-models  >  models.dev community  >  curated defaults
 *
 * HTTP stays at the surface edge (Obsidian requestUrl vs Desktop fetch).
 * This module is pure: fixtures drive it without network.
 */

/** models.dev provider id → topmind internal provider id */
export const MODELS_DEV_PROVIDER_MAP = Object.freeze({
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  moonshotai: "moonshot",
  zhipuai: "zhipu",
  minimax: "minimax",
  xai: "xai",
});

export const SOURCE_OFFICIAL = "official";
export const SOURCE_COMMUNITY = "community";
export const SOURCE_CURATED = "curated";

export const DEFAULT_COMMUNITY_TTL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_OFFICIAL_TTL_MS = 5 * 60 * 1000;
export const MODELS_DEV_URL = "https://models.dev/api.json";

export const PROVIDER_LABELS = Object.freeze({
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  moonshot: "Moonshot / Kimi",
  zhipu: "Zhipu / GLM",
  minimax: "MiniMax",
  xai: "xAI / Grok",
  ollama: "Ollama",
  custom: "Custom (OpenAI-compatible)",
});

/**
 * Official list-models capability per provider.
 * Anthropic has no public list endpoint.
 */
export const PROVIDER_API = Object.freeze({
  openai: { kind: "openai-compat", defaultBaseUrl: "https://api.openai.com/v1" },
  anthropic: { kind: "none", defaultBaseUrl: "https://api.anthropic.com/v1" },
  google: { kind: "google", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  deepseek: { kind: "openai-compat", defaultBaseUrl: "https://api.deepseek.com/v1" },
  moonshot: { kind: "openai-compat", defaultBaseUrl: "https://api.moonshot.cn/v1" },
  zhipu: { kind: "openai-compat", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  minimax: { kind: "openai-compat", defaultBaseUrl: "https://api.minimax.chat/v1" },
  xai: { kind: "openai-compat", defaultBaseUrl: "https://api.x.ai/v1" },
  ollama: { kind: "openai-compat", defaultBaseUrl: "http://127.0.0.1:11434/v1" },
  custom: { kind: "openai-compat", defaultBaseUrl: "" },
});

/** Curated fallbacks — not the live source of truth. Updated 2026-08. */
export const CURATED_DEFAULT_MODELS = Object.freeze({
  openai: Object.freeze([
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
  ]),
  anthropic: Object.freeze([
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  ]),
  google: Object.freeze([
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ]),
  deepseek: Object.freeze([
    { id: "deepseek-chat", label: "DeepSeek Chat (V4)" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ]),
  moonshot: Object.freeze([
    { id: "kimi-k2.5", label: "Kimi K2.5" },
    { id: "kimi-k3", label: "Kimi K3 (1M)" },
    { id: "kimi-k2.6", label: "Kimi K2.6" },
    { id: "moonshot-v1-128k", label: "Moonshot V1 128K" },
  ]),
  zhipu: Object.freeze([
    { id: "glm-4.7-flash", label: "GLM-4.7 Flash" },
    { id: "glm-5.2", label: "GLM-5.2 (1M)" },
    { id: "glm-5", label: "GLM-5" },
    { id: "glm-4.5-flash", label: "GLM-4.5 Flash" },
  ]),
  minimax: Object.freeze([
    { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
    { id: "MiniMax-M3", label: "MiniMax M3 (1M)" },
    { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
    { id: "MiniMax-Text-01", label: "MiniMax Text 01" },
  ]),
  xai: Object.freeze([
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-4.5", label: "Grok 4.5" },
    { id: "grok-4.3", label: "Grok 4.3 (1M)" },
    { id: "grok-3", label: "Grok 3" },
  ]),
  ollama: Object.freeze([
    { id: "qwen2.5:7b", label: "Qwen2.5 7B" },
    { id: "qwen2.5:14b", label: "Qwen2.5 14B" },
    { id: "llama3.2", label: "Llama 3.2" },
    { id: "llama3.2:8b", label: "Llama 3.2 8B" },
    { id: "mistral", label: "Mistral" },
  ]),
  custom: Object.freeze([{ id: "default", label: "Default model" }]),
});

const NON_CHAT_RE =
  /embedding|whisper|tts|dall-e|imagen|moderation|realtime|transcribe|text-to-speech|speech-to-text/iu;
const LEGACY_COMPLETION_RE = /^(davinci|babbage|curie|ada)(-|$)/iu;
const OPENAI_NON_CHAT_PREFIX_RE = /^(text-embedding|tts|whisper|dall-e)/iu;

/**
 * True when an id/name looks like embedding / TTS / image / audio / non-text.
 * @param {string} modelId
 * @param {string} [modelName]
 */
export function isNonChatModel(modelId, modelName = "") {
  const id = String(modelId || "");
  const name = String(modelName || "");
  const lower = `${id} ${name}`.toLowerCase();
  if (NON_CHAT_RE.test(lower)) return true;
  if (OPENAI_NON_CHAT_PREFIX_RE.test(id)) return true;
  if (LEGACY_COMPLETION_RE.test(id)) return true;
  // "image" / "audio" as a token (avoid matching "imagen" twice; already covered)
  if (/(^|[^a-z])image([^a-z]|$)/iu.test(lower)) return true;
  if (/(^|[^a-z])audio([^a-z]|$)/iu.test(lower)) return true;
  return false;
}

/**
 * @param {string} source
 * @returns {{ id: string, label: string }[]}
 */
export function curatedModelsFor(source) {
  const list = CURATED_DEFAULT_MODELS[source];
  return Array.isArray(list) ? list.map((m) => ({ id: m.id, label: m.label })) : [];
}

/**
 * @param {string} source
 */
export function providerLabel(source) {
  return PROVIDER_LABELS[source] || source;
}

/**
 * @param {string} providerId
 */
export function officialListKind(providerId) {
  return PROVIDER_API[providerId]?.kind || "none";
}

/**
 * @param {string} providerId
 * @param {{ key?: string, baseUrl?: string }} creds
 */
export function canFetchOfficialList(providerId, creds = {}) {
  const spec = PROVIDER_API[providerId];
  if (!spec || spec.kind === "none") return false;
  const key = typeof creds.key === "string" ? creds.key.trim() : "";
  const baseUrl = typeof creds.baseUrl === "string" ? creds.baseUrl.trim() : "";
  if (providerId === "ollama") return true;
  if (providerId === "custom") return Boolean(baseUrl);
  return Boolean(key);
}

/**
 * @param {string} providerId
 * @param {{ baseUrl?: string, apiKey?: string }} opts
 * @returns {string | null}
 */
export function officialListUrl(providerId, opts = {}) {
  const spec = PROVIDER_API[providerId];
  if (!spec || spec.kind === "none") return null;
  const base = String(opts.baseUrl || spec.defaultBaseUrl || "").replace(/\/+$/u, "");
  if (!base) return null;
  if (spec.kind === "google") {
    const key = String(opts.apiKey || "");
    return `${base}/models${key ? `?key=${encodeURIComponent(key)}` : ""}`;
  }
  return `${base}/models`;
}

/**
 * @param {string} providerId
 * @param {string} [apiKey]
 */
export function officialListHeaders(providerId, apiKey = "") {
  if (officialListKind(providerId) === "google") return {};
  const key = apiKey || (providerId === "ollama" ? "ollama" : "");
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * @param {string} providerId
 * @param {{ key?: string, baseUrl?: string }} creds
 * @returns {{ url: string, headers: Record<string, string>, kind: string } | null}
 */
export function resolveOfficialRequest(providerId, creds = {}) {
  if (!canFetchOfficialList(providerId, creds)) return null;
  const url = officialListUrl(providerId, { baseUrl: creds.baseUrl, apiKey: creds.key });
  if (!url) return null;
  return {
    url,
    headers: officialListHeaders(providerId, creds.key),
    kind: officialListKind(providerId),
  };
}

function humanizeModelId(id) {
  return String(id)
    .replace(/-(\d{4})(\d{2})(\d{2})$/u, "")
    .replace(/[-_]/gu, " ")
    .replace(/\b\w/gu, (c) => c.toUpperCase());
}

function isChatModelsDevEntry(modelId, model) {
  const modalities = model?.modalities || {};
  const outputModalities = Array.isArray(modalities.output) ? modalities.output : [];
  if (outputModalities.length > 0 && !outputModalities.includes("text")) return false;
  const ctxLimit = Number(model?.limit?.context || 0);
  if (ctxLimit === 0 && model?.tool_call === false && model?.reasoning === false) return false;
  const modelName = String(model?.name || modelId);
  if (isNonChatModel(modelId, modelName)) return false;
  return true;
}

function toCommunityModelEntry(modelId, model) {
  const modelName = String(model?.name || modelId);
  const entry = { id: String(modelId), label: modelName };
  if (typeof model?.description === "string" && model.description) entry.description = model.description;
  if (typeof model?.tool_call === "boolean") entry.toolCall = model.tool_call;
  if (typeof model?.reasoning === "boolean") entry.reasoning = model.reasoning;
  const ctxLimit = Number(model?.limit?.context || 0);
  if (ctxLimit > 0) entry.contextLimit = ctxLimit;
  if (typeof model?.cost?.input === "number" && model.cost.input >= 0) entry.costInput = model.cost.input;
  if (typeof model?.cost?.output === "number" && model.cost.output >= 0) entry.costOutput = model.cost.output;
  return entry;
}

/**
 * Parse models.dev `api.json` into provider catalog entries.
 * Unmapped providers are ignored. Non-chat models are filtered out.
 *
 * @param {unknown} data
 * @returns {{ ok: boolean, catalog: object[], error?: string }}
 */
export function parseModelsDevCatalog(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, catalog: [], error: "invalid" };
  }
  const catalog = [];
  for (const [mdId, tmId] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
    const provider = data[mdId];
    if (!provider || typeof provider !== "object" || !provider.models) continue;
    const chatModels = [];
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!model || typeof model !== "object") continue;
      if (!isChatModelsDevEntry(modelId, model)) continue;
      chatModels.push(toCommunityModelEntry(modelId, model));
    }
    if (chatModels.length > 0) {
      catalog.push({
        id: tmId,
        label: providerLabel(tmId),
        models: chatModels.sort((a, b) => a.label.localeCompare(b.label)),
        live: false,
        source: SOURCE_COMMUNITY,
      });
    }
  }
  if (catalog.length === 0) return { ok: false, catalog: [], error: "empty" };
  return { ok: true, catalog };
}

/**
 * Parse OpenAI-compatible `{ data: [{ id }] }`.
 * Empty `data` is ok:true with models=[] (caller keeps curated, not live).
 *
 * @param {unknown} json
 * @returns {{ ok: boolean, models: { id: string, label: string }[], error?: string }}
 */
export function parseOpenAICompatList(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, models: [], error: "invalid" };
  }
  if (!Array.isArray(json.data)) return { ok: false, models: [], error: "invalid" };
  const models = [];
  for (const m of json.data) {
    const id = String(m?.id || "");
    if (!id) continue;
    if (isNonChatModel(id, m?.name || "")) continue;
    models.push({ id, label: humanizeModelId(id) });
  }
  models.sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, models };
}

/**
 * Parse Google `{ models: [{ name, displayName, supportedGenerationMethods }] }`.
 *
 * @param {unknown} json
 */
export function parseGoogleModelsList(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, models: [], error: "invalid" };
  }
  if (!Array.isArray(json.models)) return { ok: false, models: [], error: "invalid" };
  const models = [];
  for (const m of json.models) {
    const methods = m?.supportedGenerationMethods;
    if (!Array.isArray(methods) || !methods.includes("generateContent")) continue;
    const id = String(m?.name || "").replace(/^models\//u, "");
    if (!id) continue;
    const display = String(m?.displayName || id);
    if (isNonChatModel(id, display)) continue;
    models.push({ id, label: display });
  }
  models.sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, models };
}

/**
 * Route official list JSON to the matching parser.
 * @param {string} kind
 * @param {unknown} json
 */
export function parseOfficialList(kind, json) {
  if (kind === "google") return parseGoogleModelsList(json);
  if (kind === "openai-compat") return parseOpenAICompatList(json);
  return { ok: false, models: [], error: "no official list" };
}

/**
 * Serve in-memory / disk cache only when it is a real successful fetch.
 * `force` always bypasses TTL.
 *
 * @param {{ cache?: unknown, fetchedAt?: number, now?: number, ttlMs?: number, force?: boolean }} p
 */
export function shouldServeCache(p = {}) {
  if (p.force === true) return false;
  const cache = p.cache;
  if (!cache) return false;
  if (Array.isArray(cache) && cache.length === 0) return false;
  const fetchedAt = Number(p.fetchedAt || 0);
  if (!fetchedAt) return false;
  const now = Number(p.now || Date.now());
  const ttlMs = Number(p.ttlMs || DEFAULT_COMMUNITY_TTL_MS);
  return now - fetchedAt < ttlMs;
}

/**
 * Only persist a catalog that came from a successful live/community fetch
 * with at least one model. Never persist curated fallback as "live".
 *
 * @param {object[] | null | undefined} catalog
 * @param {{ fetchSucceeded?: boolean, live?: boolean }} [meta]
 */
export function shouldPersistCatalog(catalog, meta = {}) {
  if (meta.fetchSucceeded === false) return false;
  if (!Array.isArray(catalog) || catalog.length === 0) return false;
  if (meta.live === true) {
    return catalog.some((e) => e && e.live === true && Array.isArray(e.models) && e.models.length > 0);
  }
  return catalog.some((e) => e && Array.isArray(e.models) && e.models.length > 0 && e.source !== SOURCE_CURATED);
}

/**
 * Overlay official model ids with community capability metadata.
 * @param {object[]} officialModels
 * @param {object[]} [communityModels]
 */
export function enrichModels(officialModels, communityModels) {
  const list = Array.isArray(officialModels) ? officialModels : [];
  const comm = Array.isArray(communityModels) ? communityModels : [];
  if (comm.length === 0) return list.map((m) => ({ ...m }));
  const meta = new Map(comm.map((m) => [m.id, m]));
  return list.map((m) => {
    const c = meta.get(m.id);
    if (!c) return { ...m };
    return {
      ...m,
      label: m.label || c.label,
      description: m.description || c.description,
      toolCall: m.toolCall ?? c.toolCall,
      reasoning: m.reasoning ?? c.reasoning,
      contextLimit: m.contextLimit ?? c.contextLimit,
      costInput: m.costInput ?? c.costInput,
      costOutput: m.costOutput ?? c.costOutput,
    };
  });
}

/**
 * Merge provider catalogs: official (live) > community > curated.
 *
 * @param {{ official?: object[], community?: object[], curated?: object[] }} parts
 */
export function mergeCatalogs(parts = {}) {
  const byId = new Map();
  const take = (list, source, live) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (!e || typeof e.id !== "string" || !e.id) continue;
      const models = Array.isArray(e.models) ? e.models.filter((m) => m && typeof m.id === "string") : [];
      byId.set(e.id, {
        id: e.id,
        label: e.label || providerLabel(e.id),
        models,
        live: live === true,
        source,
        error: typeof e.error === "string" ? e.error : undefined,
      });
    }
  };
  take(parts.curated, SOURCE_CURATED, false);
  take(parts.community, SOURCE_COMMUNITY, false);
  if (Array.isArray(parts.official)) {
    for (const e of parts.official) {
      if (!e || typeof e.id !== "string") continue;
      const models = Array.isArray(e.models) ? e.models.filter((m) => m && typeof m.id === "string") : [];
      if (e.live === true && models.length > 0) {
        const prev = byId.get(e.id);
        byId.set(e.id, {
          id: e.id,
          label: e.label || providerLabel(e.id),
          models: enrichModels(models, prev?.models),
          live: true,
          source: SOURCE_OFFICIAL,
        });
      } else if (!byId.has(e.id) && models.length > 0) {
        byId.set(e.id, {
          id: e.id,
          label: e.label || providerLabel(e.id),
          models,
          live: false,
          source: e.source || SOURCE_CURATED,
          error: typeof e.error === "string" ? e.error : undefined,
        });
      }
    }
  }
  return [...byId.values()];
}

/**
 * Persist only successful official entries. Keep prior good official on failure.
 * Never replace a prior good catalog with empty or fallback-as-live.
 *
 * @param {{ catalog?: object[], fetchedAt?: string } | null} previous
 * @param {object[]} incoming
 * @param {{ nowIso?: string }} [opts]
 */
export function mergeOfficialDiskCache(previous, incoming, opts = {}) {
  const prevList = Array.isArray(previous?.catalog) ? previous.catalog : [];
  const prevMap = new Map(prevList.map((e) => [e.id, e]));
  const next = [];
  const seen = new Set();
  for (const e of Array.isArray(incoming) ? incoming : []) {
    if (!e || typeof e.id !== "string") continue;
    seen.add(e.id);
    if (e.live === true && Array.isArray(e.models) && e.models.length > 0) {
      next.push({
        id: e.id,
        label: e.label || providerLabel(e.id),
        models: e.models,
        live: true,
        source: SOURCE_OFFICIAL,
      });
    } else {
      const prior = prevMap.get(e.id);
      if (prior?.live === true && Array.isArray(prior.models) && prior.models.length > 0) {
        next.push(prior);
      }
    }
  }
  for (const [id, e] of prevMap) {
    if (seen.has(id)) continue;
    if (e.live === true && Array.isArray(e.models) && e.models.length > 0) next.push(e);
  }
  if (next.length === 0) return previous || null;
  return {
    catalog: next,
    fetchedAt: typeof opts.nowIso === "string" && opts.nowIso ? opts.nowIso : new Date().toISOString(),
  };
}

/**
 * Per-provider resolve: official attempt + community attempt + curated + cache policy.
 *
 * @param {object} p
 * @returns {{
 *   models: object[],
 *   source: string,
 *   live: boolean,
 *   persistOfficial: boolean,
 *   persistCommunity: boolean,
 *   fromCache: boolean,
 *   keptPrior: boolean,
 *   error?: string,
 * }}
 */
export function resolveProviderModels(p = {}) {
  const curated = Array.isArray(p.curated) ? p.curated : curatedModelsFor(p.providerId);
  const force = p.force === true;
  const now = Number(p.now || Date.now());
  const officialTtl = Number(p.officialTtlMs || DEFAULT_OFFICIAL_TTL_MS);
  const communityTtl = Number(p.communityTtlMs || DEFAULT_COMMUNITY_TTL_MS);

  const officialCacheModels = p.officialCache?.models;
  const communityCacheModels = p.communityCache?.models;
  const officialFresh = shouldServeCache({
    cache: officialCacheModels,
    fetchedAt: p.officialCache?.fetchedAt,
    now,
    ttlMs: officialTtl,
    force,
  });
  const communityFresh = shouldServeCache({
    cache: communityCacheModels,
    fetchedAt: p.communityCache?.fetchedAt,
    now,
    ttlMs: communityTtl,
    force,
  });

  let official = officialFresh ? officialCacheModels : null;
  let community = communityFresh ? communityCacheModels : null;
  let persistOfficial = false;
  let persistCommunity = false;
  let fromCache = Boolean((officialFresh && official?.length) || (communityFresh && community?.length));
  let keptPrior = false;
  let error;

  const officialAttempt = p.officialAttempt;
  if (officialAttempt) {
    fromCache = false;
    if (officialAttempt.ok && Array.isArray(officialAttempt.models) && officialAttempt.models.length > 0) {
      official = officialAttempt.models;
      persistOfficial = true;
    } else {
      error = officialAttempt.error || "official fetch failed";
      if (!official && Array.isArray(p.officialCache?.models) && p.officialCache.models.length > 0) {
        official = p.officialCache.models;
        keptPrior = true;
      }
    }
  }

  const communityAttempt = p.communityAttempt;
  if (communityAttempt) {
    if (communityAttempt.ok && Array.isArray(communityAttempt.models) && communityAttempt.models.length > 0) {
      community = communityAttempt.models;
      persistCommunity = true;
    } else {
      error = error || communityAttempt.error || "community fetch failed";
      if (!community && Array.isArray(p.communityCache?.models) && p.communityCache.models.length > 0) {
        community = p.communityCache.models;
        keptPrior = true;
      }
    }
  }

  if (Array.isArray(official) && official.length > 0) {
    return {
      models: enrichModels(official, community),
      source: SOURCE_OFFICIAL,
      live: true,
      persistOfficial,
      persistCommunity,
      fromCache: fromCache && !persistOfficial,
      keptPrior,
      error,
    };
  }
  if (Array.isArray(community) && community.length > 0) {
    return {
      models: community.map((m) => ({ ...m })),
      source: SOURCE_COMMUNITY,
      live: false,
      persistOfficial: false,
      persistCommunity,
      fromCache: fromCache && !persistCommunity,
      keptPrior,
      error,
    };
  }
  return {
    models: curated.map((m) => ({ ...m })),
    source: SOURCE_CURATED,
    live: false,
    persistOfficial: false,
    persistCommunity: false,
    fromCache: false,
    keptPrior: false,
    error,
  };
}

/**
 * What a refresh / resolve should hit. `force` always re-resolves.
 *
 * @param {{
 *   providerId: string,
 *   force?: boolean,
 *   hasKey?: boolean,
 *   hasEndpoint?: boolean,
 *   officialCacheFresh?: boolean,
 *   communityCacheFresh?: boolean,
 * }} p
 */
export function planCatalogRefresh(p = {}) {
  const key = p.hasKey ? "x" : "";
  const baseUrl = p.hasEndpoint ? (p.baseUrl || "http://127.0.0.1/v1") : "";
  const canOfficial = canFetchOfficialList(p.providerId, { key, baseUrl });
  const kind = officialListKind(p.providerId);
  const force = p.force === true;
  return {
    fetchOfficial: canOfficial && (force || p.officialCacheFresh !== true),
    fetchCommunity: force || p.communityCacheFresh !== true || !canOfficial || kind === "none",
    officialKind: canOfficial ? kind : null,
    canOfficial,
  };
}

/**
 * Keep a custom / current id visible when a dynamic list arrives.
 *
 * @param {{ models?: object[], currentValue?: string, presetId?: string, defaultLabel?: string }} p
 */
export function nextSelectOptions(p = {}) {
  const options = [];
  const seen = new Set();
  const add = (id, label) => {
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ id: key, label: label || key });
  };
  add("", p.defaultLabel || "");
  if (p.presetId) add(p.presetId, p.presetId);
  if (p.currentValue) add(p.currentValue, p.currentValue);
  for (const m of Array.isArray(p.models) ? p.models : []) {
    if (m && m.id) add(m.id, m.label || m.id);
  }
  return options;
}

/**
 * Build a curated catalog for the given provider ids (or all known).
 * @param {string[]} [providerIds]
 */
export function curatedCatalog(providerIds) {
  const ids = Array.isArray(providerIds) && providerIds.length > 0
    ? providerIds
    : Object.keys(CURATED_DEFAULT_MODELS);
  return ids.map((id) => ({
    id,
    label: providerLabel(id),
    models: curatedModelsFor(id),
    live: false,
    source: SOURCE_CURATED,
  }));
}
