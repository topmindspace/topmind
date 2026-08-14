// ── Two-source AI model catalog (Obsidian) ────────────────────────────────
//
// official list-models  >  models.dev community  >  curated defaults
//
// HTTP stays here (Obsidian `requestUrl` bypasses CSP). Parse / merge /
// cache-honesty live in lib/model-catalog.mjs — the same unit Desktop uses.

import { requestUrl } from "obsidian";
import { AI_PROVIDER_PRESETS } from "../constants";
import type { AiManualKeys } from "../types";
import { getProviderKey } from "../types";
import {
  parseModelsDevCatalog,
  parseOfficialList,
  resolveProviderModels,
  shouldServeCache,
  shouldPersistCatalog,
  resolveOfficialRequest,
  curatedModelsFor,
  nextSelectOptions,
  planCatalogRefresh,
  MODELS_DEV_URL,
  DEFAULT_COMMUNITY_TTL_MS,
  DEFAULT_OFFICIAL_TTL_MS,
  SOURCE_OFFICIAL,
  SOURCE_COMMUNITY,
  SOURCE_CURATED,
} from "../../../lib/model-catalog.mjs";

export { nextSelectOptions, planCatalogRefresh, SOURCE_OFFICIAL, SOURCE_COMMUNITY, SOURCE_CURATED };

const COMMUNITY_TTL_MS = DEFAULT_COMMUNITY_TTL_MS;
const OFFICIAL_TTL_MS = DEFAULT_OFFICIAL_TTL_MS;
const COMMUNITY_TIMEOUT_MS = 15_000;
const OFFICIAL_TIMEOUT_MS = 10_000;

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
  source?: string;
  error?: string;
}

export interface ResolveOpts {
  force?: boolean;
  key?: string;
  baseUrl?: string;
}

export interface ResolveResult {
  models: ModelEntry[];
  source: string;
  live: boolean;
  error?: string;
  fromCache?: boolean;
  keptPrior?: boolean;
}

let communityCache: { catalog: ProviderCatalogEntry[]; fetchedAt: number } | null = null;
const officialCache = new Map<string, { models: ModelEntry[]; fetchedAt: number }>();
let communityInflight: Promise<{ ok: boolean; catalog: ProviderCatalogEntry[]; error?: string }> | null = null;

export function clearModelsDevCache(): void {
  communityCache = null;
  officialCache.clear();
}

export function getProviderBaseUrl(providerId: string, manual: AiManualKeys): string {
  if (providerId === "custom") return manual.customBaseUrl || "";
  if (providerId === "ollama") {
    return manual.ollamaBaseUrl || AI_PROVIDER_PRESETS.ollama?.baseUrl || "http://127.0.0.1:11434/v1";
  }
  return AI_PROVIDER_PRESETS[providerId]?.baseUrl || "";
}

export function credentialsForProvider(providerId: string, manual: AiManualKeys): { key: string; baseUrl: string } {
  return {
    key: getProviderKey(providerId, manual) || "",
    baseUrl: getProviderBaseUrl(providerId, manual),
  };
}

async function httpGetJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  const requestPromise = requestUrl({
    url,
    method: "GET",
    headers: { Accept: "application/json", ...headers },
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("fetch timeout")), timeoutMs);
  });
  const res = await Promise.race([requestPromise, timeoutPromise]);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.json;
}

async function fetchCommunityCatalog(force: boolean): Promise<{ ok: boolean; catalog: ProviderCatalogEntry[]; error?: string }> {
  const now = Date.now();
  if (
    shouldServeCache({
      cache: communityCache?.catalog,
      fetchedAt: communityCache?.fetchedAt,
      now,
      ttlMs: COMMUNITY_TTL_MS,
      force,
    })
  ) {
    return { ok: true, catalog: communityCache!.catalog };
  }
  if (communityInflight && !force) return communityInflight;

  const work = (async () => {
    try {
      const data = await httpGetJson(MODELS_DEV_URL, {}, COMMUNITY_TIMEOUT_MS);
      const parsed = parseModelsDevCatalog(data);
      if (!parsed.ok || !shouldPersistCatalog(parsed.catalog, { fetchSucceeded: true, live: false })) {
        return {
          ok: false,
          catalog: communityCache?.catalog || [],
          error: parsed.error || "empty community catalog",
        };
      }
      communityCache = { catalog: parsed.catalog, fetchedAt: Date.now() };
      return { ok: true, catalog: parsed.catalog };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[topmind] models.dev fetch failed:", message);
      return { ok: false, catalog: communityCache?.catalog || [], error: message };
    } finally {
      communityInflight = null;
    }
  })();

  communityInflight = work;
  return work;
}

async function fetchOfficialForProvider(
  providerId: string,
  creds: { key?: string; baseUrl?: string },
): Promise<{ ok: boolean; models: ModelEntry[]; error?: string }> {
  const req = resolveOfficialRequest(providerId, creds);
  if (!req) return { ok: false, models: [], error: "no official list" };
  try {
    const json = await httpGetJson(req.url, req.headers, OFFICIAL_TIMEOUT_MS);
    const parsed = parseOfficialList(req.kind, json);
    if (!parsed.ok) return { ok: false, models: [], error: parsed.error || "invalid official list" };
    return { ok: true, models: parsed.models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve chat models for one provider.
 * Curated defaults are always available immediately via curatedModelsFor;
 * this function may hit official list-models and/or models.dev.
 */
export async function resolveProviderCatalog(
  providerId: string,
  opts: ResolveOpts = {},
): Promise<ResolveResult> {
  const force = opts.force === true;
  const now = Date.now();
  const curated = curatedModelsFor(providerId);
  const creds = { key: opts.key || "", baseUrl: opts.baseUrl || "" };
  const plan = planCatalogRefresh({
    providerId,
    force,
    hasKey: Boolean(creds.key),
    hasEndpoint: Boolean(creds.baseUrl),
    officialCacheFresh: shouldServeCache({
      cache: officialCache.get(providerId)?.models,
      fetchedAt: officialCache.get(providerId)?.fetchedAt,
      now,
      ttlMs: OFFICIAL_TTL_MS,
      force,
    }),
    communityCacheFresh: shouldServeCache({
      cache: communityCache?.catalog,
      fetchedAt: communityCache?.fetchedAt,
      now,
      ttlMs: COMMUNITY_TTL_MS,
      force,
    }),
  });

  const officialAttempt = plan.fetchOfficial
    ? await fetchOfficialForProvider(providerId, creds)
    : null;

  const communityFetch = plan.fetchCommunity
    ? await fetchCommunityCatalog(force)
    : { ok: true, catalog: communityCache?.catalog || [] };

  const communityModels =
    (communityFetch.catalog || []).find((c) => c.id === providerId)?.models || [];

  const decision = resolveProviderModels({
    providerId,
    force,
    now,
    officialTtlMs: OFFICIAL_TTL_MS,
    communityTtlMs: COMMUNITY_TTL_MS,
    officialCache: officialCache.get(providerId) || null,
    communityCache: communityModels.length
      ? { models: communityModels, fetchedAt: communityCache?.fetchedAt }
      : null,
    officialAttempt,
    communityAttempt: plan.fetchCommunity
      ? { ok: communityFetch.ok && communityModels.length > 0, models: communityModels, error: communityFetch.error }
      : null,
    curated,
    canOfficial: plan.canOfficial,
  });

  if (decision.persistOfficial && officialAttempt?.ok && officialAttempt.models.length > 0) {
    officialCache.set(providerId, { models: officialAttempt.models, fetchedAt: Date.now() });
  }
  return {
    models: decision.models,
    source: decision.source,
    live: decision.live,
    error: decision.error,
    fromCache: decision.fromCache,
    keptPrior: decision.keptPrior,
  };
}

/**
 * Community-only fetch (browse). Does not hit official endpoints.
 * Failed fetches are not stored as live.
 */
export async function fetchModelsDevCatalog(forceLive = false): Promise<ProviderCatalogEntry[]> {
  const result = await fetchCommunityCatalog(forceLive);
  return result.catalog;
}

export async function getModelsForProvider(
  providerId: string,
  forceOrOpts: boolean | ResolveOpts = false,
): Promise<ModelEntry[]> {
  const opts = typeof forceOrOpts === "boolean" ? { force: forceOrOpts } : forceOrOpts;
  const resolved = await resolveProviderCatalog(providerId, opts);
  return resolved.models;
}

/** Apply resolved models onto an Obsidian <select>, keeping a custom id. */
export function applyModelOptions(
  selectEl: HTMLSelectElement,
  models: ModelEntry[],
  opts: { currentValue: string; presetModel?: string | null; defaultLabel: string },
): void {
  const planned = nextSelectOptions({
    models,
    currentValue: opts.currentValue,
    presetId: opts.presetModel || "",
    defaultLabel: opts.defaultLabel,
  });
  const existing = new Map<string, HTMLOptionElement>();
  for (const opt of Array.from(selectEl.options)) existing.set(opt.value, opt);
  selectEl.empty();
  for (const row of planned) {
    const prev = existing.get(row.id);
    const el = selectEl.createEl("option", { value: row.id, text: prev?.text || row.label || row.id });
    if (row.id && prev?.text && prev.text !== row.id && !models.some((m) => m.id === row.id)) {
      el.text = prev.text;
    }
  }
  selectEl.value = opts.currentValue || "";
}
