/**
 * Drive the shipped two-source model catalog (lib/model-catalog.mjs).
 * No network. No re-implementation of parse / merge / cache policy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseModelsDevCatalog,
  parseOpenAICompatList,
  parseGoogleModelsList,
  parseOfficialList,
  isNonChatModel,
  mergeCatalogs,
  mergeOfficialDiskCache,
  resolveProviderModels,
  shouldServeCache,
  shouldPersistCatalog,
  planCatalogRefresh,
  nextSelectOptions,
  curatedModelsFor,
  curatedCatalog,
  canFetchOfficialList,
  officialListKind,
  SOURCE_OFFICIAL,
  SOURCE_COMMUNITY,
  SOURCE_CURATED,
  MODELS_DEV_PROVIDER_MAP,
} from "../lib/model-catalog.mjs";

const modelsDevFixture = {
  openai: {
    models: {
      "gpt-4o": {
        name: "GPT-4o",
        description: "Flagship",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 128000 },
        cost: { input: 2.5, output: 10 },
      },
      "gpt-4o-mini": {
        name: "GPT-4o mini",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 128000 },
      },
      "text-embedding-3-large": {
        name: "Embedding 3 Large",
        tool_call: false,
        reasoning: false,
        modalities: { output: ["embedding"] },
        limit: { context: 8192 },
      },
      "dall-e-3": {
        name: "DALL·E 3",
        tool_call: false,
        reasoning: false,
        modalities: { output: ["image"] },
        limit: { context: 0 },
      },
    },
  },
  anthropic: {
    models: {
      "claude-sonnet-5": {
        name: "Claude Sonnet 5",
        tool_call: true,
        reasoning: true,
        modalities: { output: ["text"] },
        limit: { context: 200000 },
      },
    },
  },
  google: {
    models: {
      "gemini-2.5-flash": {
        name: "Gemini 2.5 Flash",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 1000000 },
      },
    },
  },
  deepseek: {
    models: {
      "deepseek-chat": {
        name: "DeepSeek Chat",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 64000 },
      },
    },
  },
  moonshotai: {
    models: {
      "kimi-k2.5": {
        name: "Kimi K2.5",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 128000 },
      },
    },
  },
  zhipuai: {
    models: {
      "glm-5": {
        name: "GLM-5",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 128000 },
      },
    },
  },
  minimax: {
    models: {
      "MiniMax-M2.5": {
        name: "MiniMax M2.5",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 128000 },
      },
    },
  },
  xai: {
    models: {
      "grok-4.5": {
        name: "Grok 4.5",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 256000 },
      },
    },
  },
  // Unmapped provider — must be ignored
  cohere: {
    models: {
      "command-r": {
        name: "Command R",
        tool_call: true,
        reasoning: false,
        modalities: { output: ["text"] },
        limit: { context: 128000 },
      },
    },
  },
};

test("parseModelsDevCatalog extracts mapped chat models and filters non-chat / unmapped", () => {
  const parsed = parseModelsDevCatalog(modelsDevFixture);
  assert.equal(parsed.ok, true);
  const ids = parsed.catalog.map((c) => c.id).sort();
  assert.deepEqual(ids, ["anthropic", "deepseek", "google", "minimax", "moonshot", "openai", "xai", "zhipu"]);
  assert.ok(!ids.includes("cohere"), "unmapped providers stay out");
  const openai = parsed.catalog.find((c) => c.id === "openai");
  const modelIds = openai.models.map((m) => m.id);
  assert.ok(modelIds.includes("gpt-4o"));
  assert.ok(modelIds.includes("gpt-4o-mini"));
  assert.ok(!modelIds.includes("text-embedding-3-large"));
  assert.ok(!modelIds.includes("dall-e-3"));
  assert.equal(openai.live, false);
  assert.equal(openai.source, SOURCE_COMMUNITY);
  const gpt4o = openai.models.find((m) => m.id === "gpt-4o");
  assert.equal(gpt4o.toolCall, true);
  assert.equal(gpt4o.contextLimit, 128000);
  assert.equal(MODELS_DEV_PROVIDER_MAP.moonshotai, "moonshot");
  assert.equal(MODELS_DEV_PROVIDER_MAP.zhipuai, "zhipu");
});

test("parseModelsDevCatalog rejects empty / invalid payloads", () => {
  assert.equal(parseModelsDevCatalog(null).ok, false);
  assert.equal(parseModelsDevCatalog({}).ok, false);
  assert.equal(parseModelsDevCatalog({ openai: { models: {} } }).ok, false);
});

test("parseOpenAICompatList extracts chat ids and drops embeddings", () => {
  const parsed = parseOpenAICompatList({
    data: [
      { id: "gpt-4o" },
      { id: "gpt-4o-mini" },
      { id: "text-embedding-3-small" },
      { id: "tts-1" },
      { id: "whisper-1" },
      { id: "dall-e-3" },
    ],
  });
  assert.equal(parsed.ok, true);
  const ids = parsed.models.map((m) => m.id);
  assert.deepEqual(ids.sort(), ["gpt-4o", "gpt-4o-mini"]);
});

test("parseOpenAICompatList empty data is ok but not live-worthy", () => {
  const parsed = parseOpenAICompatList({ data: [] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.models.length, 0);
  assert.equal(parseOpenAICompatList({}).ok, false);
  assert.equal(parseOpenAICompatList(null).ok, false);
});

test("parseGoogleModelsList keeps generateContent and drops embeddings", () => {
  const parsed = parseGoogleModelsList({
    models: [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", displayName: "Embeddings", supportedGenerationMethods: ["embedContent"] },
      { name: "models/imagen-3", displayName: "Imagen 3", supportedGenerationMethods: ["generateContent"] },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].id, "gemini-2.5-flash");
});

test("parseOfficialList routes openai-compat vs google", () => {
  const oai = parseOfficialList("openai-compat", { data: [{ id: "gpt-4o" }] });
  assert.equal(oai.ok, true);
  assert.equal(oai.models[0].id, "gpt-4o");
  const g = parseOfficialList("google", {
    models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"] }],
  });
  assert.equal(g.ok, true);
  assert.equal(g.models[0].id, "gemini-2.5-pro");
  assert.equal(parseOfficialList("none", { data: [] }).ok, false);
});

test("isNonChatModel covers embedding / tts / image / whisper", () => {
  assert.equal(isNonChatModel("text-embedding-3-large", "Embedding"), true);
  assert.equal(isNonChatModel("whisper-1", "Whisper"), true);
  assert.equal(isNonChatModel("gpt-4o", "GPT-4o"), false);
});

test("official list overlays community for the same provider; curated fills the rest", () => {
  const community = parseModelsDevCatalog(modelsDevFixture).catalog;
  const official = [
    { id: "openai", label: "OpenAI", live: true, models: [{ id: "gpt-4o", label: "GPT-4o" }, { id: "gpt-5-pro", label: "GPT-5 Pro" }] },
  ];
  const curated = [{ id: "ollama", label: "Ollama", models: curatedModelsFor("ollama"), live: false }];
  const merged = mergeCatalogs({ official, community, curated });
  const openai = merged.find((c) => c.id === "openai");
  assert.equal(openai.source, SOURCE_OFFICIAL);
  assert.equal(openai.live, true);
  const ids = openai.models.map((m) => m.id);
  assert.ok(ids.includes("gpt-5-pro"), "official-only id kept");
  assert.ok(ids.includes("gpt-4o"));
  assert.ok(!ids.includes("gpt-4o-mini"), "community-only id does not replace official list");
  assert.equal(openai.models.find((m) => m.id === "gpt-4o").toolCall, true, "community metadata enriches official");
  const anthropic = merged.find((c) => c.id === "anthropic");
  assert.equal(anthropic.source, SOURCE_COMMUNITY);
  assert.equal(anthropic.live, false);
  const ollama = merged.find((c) => c.id === "ollama");
  assert.equal(ollama.source, SOURCE_CURATED);
});

test("empty / error official keeps curated or prior good list", () => {
  const curated = curatedModelsFor("openai");
  const emptyOfficial = resolveProviderModels({
    providerId: "openai",
    officialAttempt: { ok: true, models: [] },
    curated,
  });
  assert.equal(emptyOfficial.source, SOURCE_CURATED);
  assert.equal(emptyOfficial.live, false);
  assert.equal(emptyOfficial.persistOfficial, false);
  assert.deepEqual(emptyOfficial.models.map((m) => m.id), curated.map((m) => m.id));

  const prior = [{ id: "gpt-4o", label: "GPT-4o" }];
  const failedKeepsPrior = resolveProviderModels({
    providerId: "openai",
    officialAttempt: { ok: false, models: [], error: "HTTP 401" },
    officialCache: { models: prior, fetchedAt: 1 },
    curated,
    force: true,
  });
  assert.equal(failedKeepsPrior.source, SOURCE_OFFICIAL);
  assert.equal(failedKeepsPrior.keptPrior, true);
  assert.equal(failedKeepsPrior.persistOfficial, false);
  assert.deepEqual(failedKeepsPrior.models.map((m) => m.id), ["gpt-4o"]);
});

test("Anthropic / no-key path uses community or curated — never official", () => {
  assert.equal(canFetchOfficialList("anthropic", { key: "sk-ant" }), false);
  assert.equal(officialListKind("anthropic"), "none");
  const community = parseModelsDevCatalog(modelsDevFixture).catalog.find((c) => c.id === "anthropic").models;
  const r = resolveProviderModels({
    providerId: "anthropic",
    communityAttempt: { ok: true, models: community },
    curated: curatedModelsFor("anthropic"),
  });
  assert.equal(r.source, SOURCE_COMMUNITY);
  assert.equal(r.live, false);
  assert.ok(r.models.some((m) => m.id === "claude-sonnet-5"));

  const noKey = resolveProviderModels({
    providerId: "openai",
    communityAttempt: { ok: false, models: [], error: "timeout" },
    curated: curatedModelsFor("openai"),
  });
  assert.equal(noKey.source, SOURCE_CURATED);
  assert.ok(noKey.models.length > 0);
});

test("force bypasses TTL; failed fetch is not persistable as live", () => {
  const now = 1_000_000;
  const fresh = shouldServeCache({
    cache: [{ id: "gpt-4o" }],
    fetchedAt: now - 1000,
    now,
    ttlMs: 60_000,
    force: false,
  });
  assert.equal(fresh, true);
  assert.equal(
    shouldServeCache({
      cache: [{ id: "gpt-4o" }],
      fetchedAt: now - 1000,
      now,
      ttlMs: 60_000,
      force: true,
    }),
    false,
    "force must not serve TTL-fresh cache",
  );
  assert.equal(shouldServeCache({ cache: [], fetchedAt: now, now, ttlMs: 60_000 }), false);
  assert.equal(
    shouldPersistCatalog([{ id: "openai", models: curatedModelsFor("openai"), live: false, source: SOURCE_CURATED }], {
      fetchSucceeded: false,
    }),
    false,
  );
  assert.equal(
    shouldPersistCatalog([{ id: "openai", models: [{ id: "gpt-4o" }], live: true, source: SOURCE_OFFICIAL }], {
      fetchSucceeded: true,
      live: true,
    }),
    true,
  );
});

test("second resolve after failure does not treat fallback as a fresh live cache", () => {
  const curated = curatedModelsFor("openai");
  const first = resolveProviderModels({
    providerId: "openai",
    officialAttempt: { ok: false, models: [], error: "timeout" },
    communityAttempt: { ok: false, models: [], error: "timeout" },
    curated,
  });
  assert.equal(first.source, SOURCE_CURATED);
  assert.equal(first.persistOfficial, false);
  assert.equal(first.persistCommunity, false);
  assert.equal(first.live, false);

  // Caller stored nothing. Second resolve with no cache must not claim cache-hit.
  const second = resolveProviderModels({
    providerId: "openai",
    officialCache: null,
    communityCache: null,
    curated,
    force: false,
  });
  assert.equal(second.fromCache, false);
  assert.equal(second.source, SOURCE_CURATED);
  assert.equal(second.live, false);

  const plan = planCatalogRefresh({
    providerId: "openai",
    force: false,
    hasKey: true,
    hasEndpoint: true,
    officialCacheFresh: false,
    communityCacheFresh: false,
  });
  assert.equal(plan.fetchOfficial, true, "failed first fetch must retry official");
});

test("refresh plan: TTL-fresh cache still re-resolves when force; keyed OpenAI/Google use official kind", () => {
  const soft = planCatalogRefresh({
    providerId: "openai",
    force: false,
    hasKey: true,
    hasEndpoint: true,
    officialCacheFresh: true,
    communityCacheFresh: true,
  });
  assert.equal(soft.fetchOfficial, false);
  const forced = planCatalogRefresh({
    providerId: "openai",
    force: true,
    hasKey: true,
    hasEndpoint: true,
    officialCacheFresh: true,
    communityCacheFresh: true,
  });
  assert.equal(forced.fetchOfficial, true);
  assert.equal(forced.officialKind, "openai-compat");
  const google = planCatalogRefresh({
    providerId: "google",
    force: true,
    hasKey: true,
    hasEndpoint: true,
    officialCacheFresh: true,
    communityCacheFresh: true,
  });
  assert.equal(google.fetchOfficial, true);
  assert.equal(google.officialKind, "google");
  assert.equal(parseOfficialList(google.officialKind, {
    models: [{ name: "models/gemini-2.5-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }],
  }).models[0].id, "gemini-2.5-flash");
});

test("mergeOfficialDiskCache keeps prior good official and never stores fallback-as-live", () => {
  const previous = {
    catalog: [{ id: "openai", live: true, models: [{ id: "gpt-4o", label: "GPT-4o" }] }],
    fetchedAt: "2026-01-01T00:00:00.000Z",
  };
  const failedIncoming = [
    { id: "openai", live: false, models: curatedModelsFor("openai"), error: "HTTP 500" },
  ];
  const kept = mergeOfficialDiskCache(previous, failedIncoming, { nowIso: "2026-08-14T00:00:00.000Z" });
  assert.equal(kept.catalog[0].live, true);
  assert.equal(kept.catalog[0].models[0].id, "gpt-4o");

  const empty = mergeOfficialDiskCache(null, [{ id: "openai", live: false, models: curatedModelsFor("openai") }]);
  assert.equal(empty, null);
});

test("first paint: curated catalog is non-empty without any network payload", () => {
  const catalog = curatedCatalog(["openai", "anthropic", "google"]);
  assert.ok(catalog.every((e) => e.models.length > 0));
  assert.ok(catalog.every((e) => e.source === SOURCE_CURATED && e.live === false));
  const noNet = mergeCatalogs({ official: [], community: [], curated: catalog });
  assert.ok(noNet.find((c) => c.id === "openai").models.length > 0);
});

test("nextSelectOptions keeps a custom id when the dynamic list arrives", () => {
  const opts = nextSelectOptions({
    models: [{ id: "gpt-4o", label: "GPT-4o" }],
    currentValue: "my-fine-tune",
    presetId: "gpt-4o-mini",
    defaultLabel: "Provider default",
  });
  const ids = opts.map((o) => o.id);
  assert.ok(ids.includes(""));
  assert.ok(ids.includes("my-fine-tune"));
  assert.ok(ids.includes("gpt-4o"));
  assert.ok(ids.includes("gpt-4o-mini"));
});
