/** Types for lib/model-catalog.mjs (two-source AI model catalog). */

export const MODELS_DEV_PROVIDER_MAP: Readonly<Record<string, string>>;
export const SOURCE_OFFICIAL: "official";
export const SOURCE_COMMUNITY: "community";
export const SOURCE_CURATED: "curated";
export const DEFAULT_COMMUNITY_TTL_MS: number;
export const DEFAULT_OFFICIAL_TTL_MS: number;
export const MODELS_DEV_URL: string;
export const PROVIDER_LABELS: Readonly<Record<string, string>>;
export const PROVIDER_API: Readonly<Record<string, { kind: string; defaultBaseUrl: string }>>;
export const CURATED_DEFAULT_MODELS: Readonly<Record<string, ReadonlyArray<{ id: string; label: string }>>>;

export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
  toolCall?: boolean;
  reasoning?: boolean;
  contextLimit?: number;
  costInput?: number;
  costOutput?: number;
}

export interface CatalogEntry {
  id: string;
  label: string;
  models: CatalogModel[];
  live: boolean;
  source?: string;
  error?: string;
}

export function isNonChatModel(modelId: string, modelName?: string): boolean;
export function curatedModelsFor(source: string): { id: string; label: string }[];
export function providerLabel(source: string): string;
export function officialListKind(providerId: string): string;
export function canFetchOfficialList(providerId: string, creds?: { key?: string; baseUrl?: string }): boolean;
export function officialListUrl(providerId: string, opts?: { baseUrl?: string; apiKey?: string }): string | null;
export function officialListHeaders(providerId: string, apiKey?: string): Record<string, string>;
export function resolveOfficialRequest(
  providerId: string,
  creds?: { key?: string; baseUrl?: string },
): { url: string; headers: Record<string, string>; kind: string } | null;
export function parseModelsDevCatalog(data: unknown): { ok: boolean; catalog: CatalogEntry[]; error?: string };
export function parseOpenAICompatList(json: unknown): { ok: boolean; models: CatalogModel[]; error?: string };
export function parseGoogleModelsList(json: unknown): { ok: boolean; models: CatalogModel[]; error?: string };
export function parseOfficialList(kind: string, json: unknown): { ok: boolean; models: CatalogModel[]; error?: string };
export function shouldServeCache(p?: {
  cache?: unknown;
  fetchedAt?: number;
  now?: number;
  ttlMs?: number;
  force?: boolean;
}): boolean;
export function shouldPersistCatalog(
  catalog: CatalogEntry[] | null | undefined,
  meta?: { fetchSucceeded?: boolean; live?: boolean },
): boolean;
export function enrichModels(officialModels: CatalogModel[], communityModels?: CatalogModel[]): CatalogModel[];
export function mergeCatalogs(parts?: {
  official?: CatalogEntry[];
  community?: CatalogEntry[];
  curated?: CatalogEntry[];
}): CatalogEntry[];
export function mergeOfficialDiskCache(
  previous: { catalog?: CatalogEntry[]; fetchedAt?: string } | null,
  incoming: CatalogEntry[],
  opts?: { nowIso?: string },
): { catalog: CatalogEntry[]; fetchedAt: string } | null;
export function resolveProviderModels(p?: Record<string, unknown>): {
  models: CatalogModel[];
  source: string;
  live: boolean;
  persistOfficial: boolean;
  persistCommunity: boolean;
  fromCache: boolean;
  keptPrior: boolean;
  error?: string;
};
export function planCatalogRefresh(p?: {
  providerId: string;
  force?: boolean;
  hasKey?: boolean;
  hasEndpoint?: boolean;
  officialCacheFresh?: boolean;
  communityCacheFresh?: boolean;
  baseUrl?: string;
}): {
  fetchOfficial: boolean;
  fetchCommunity: boolean;
  officialKind: string | null;
  canOfficial: boolean;
};
export function nextSelectOptions(p?: {
  models?: CatalogModel[];
  currentValue?: string;
  presetId?: string;
  defaultLabel?: string;
}): { id: string; label: string }[];
export function curatedCatalog(providerIds?: string[]): CatalogEntry[];
