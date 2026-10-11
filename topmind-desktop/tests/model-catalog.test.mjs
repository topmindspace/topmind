/**
 * Desktop catalog path — import the same module system-service ships
 * (`electron/lib/model-catalog.mjs`) and assert it stays the engine copy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseModelsDevCatalog,
  parseOpenAICompatList,
  parseGoogleModelsList,
  parseOfficialList,
  mergeCatalogs,
  mergeOfficialDiskCache,
  shouldServeCache,
  planCatalogRefresh,
  SOURCE_OFFICIAL,
  SOURCE_COMMUNITY,
} from "../electron/lib/model-catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

test("Desktop electron catalog module is the shipped engine copy", () => {
  const engine = readFileSync(path.join(repoRoot, "lib", "model-catalog.mjs"), "utf8");
  const desktop = readFileSync(path.join(here, "../electron/lib/model-catalog.mjs"), "utf8");
  assert.equal(desktop, engine, "electron/lib/model-catalog.mjs must stay identical to lib/model-catalog.mjs");
});

test("system-service wires official parse / merge / cache-honesty from the shipped catalog module", () => {
  const src = readFileSync(path.join(here, "../electron/system-service.mjs"), "utf8");
  assert.match(src, /from\s+["']\.\/lib\/model-catalog\.mjs["']/u);
  for (const name of [
    "parseModelsDevCatalog",
    "parseOpenAICompatList",
    "parseGoogleModelsList",
    "mergeCatalogs",
    "mergeOfficialDiskCache",
    "shouldServeCache",
    "shouldPersistCatalog",
    "curatedModelsFor",
    "skipCommunity",
  ]) {
    assert.match(src, new RegExp(name, "u"), `system-service must use ${name}`);
  }
  const store = readFileSync(path.join(here, "../src/stores/ai-store.ts"), "utf8");
  const skipAt = store.indexOf("skipCommunity: true");
  const communityAt = store.indexOf("fetchModelsDevCatalog");
  assert.ok(skipAt >= 0, "loadModelCatalog must hydrate skipCommunity first paint");
  assert.ok(communityAt > skipAt, "first paint must not wait on models.dev");
  assert.doesNotMatch(
    src,
    /return chatModels\.length > 0 \? chatModels : defaultModelsFor\("openai"\)/u,
    "empty official list must not be replaced with curated-as-live",
  );
});

test("Desktop parse + merge + force-refresh plan (official overlay)", () => {
  const community = parseModelsDevCatalog({
    openai: {
      models: {
        "gpt-4o": {
          name: "GPT-4o",
          tool_call: true,
          reasoning: false,
          modalities: { output: ["text"] },
          limit: { context: 128000 },
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
  });
  assert.equal(community.ok, true);
  const officialJson = parseOpenAICompatList({ data: [{ id: "gpt-4o" }, { id: "gpt-5-pro" }, { id: "text-embedding-3-large" }] });
  const googleJson = parseGoogleModelsList({
    models: [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
    ],
  });
  const merged = mergeCatalogs({
    official: [
      { id: "openai", live: true, models: officialJson.models },
      { id: "google", live: true, models: googleJson.models },
    ],
    community: community.catalog,
  });
  const openai = merged.find((c) => c.id === "openai");
  assert.equal(openai.source, SOURCE_OFFICIAL);
  assert.deepEqual(openai.models.map((m) => m.id).sort(), ["gpt-4o", "gpt-5-pro"]);
  const anthropic = merged.find((c) => c.id === "anthropic");
  assert.equal(anthropic.source, SOURCE_COMMUNITY);

  const plan = planCatalogRefresh({
    providerId: "openai",
    force: true,
    hasKey: true,
    hasEndpoint: true,
    officialCacheFresh: true,
    communityCacheFresh: true,
  });
  assert.equal(plan.fetchOfficial, true);
  assert.equal(plan.officialKind, "openai-compat");
  assert.equal(parseOfficialList(plan.officialKind, { data: [{ id: "gpt-4o" }] }).models[0].id, "gpt-4o");

  assert.equal(
    shouldServeCache({ cache: community.catalog, fetchedAt: Date.now(), now: Date.now(), ttlMs: 60_000, force: true }),
    false,
  );

  const kept = mergeOfficialDiskCache(
    { catalog: [{ id: "openai", live: true, models: [{ id: "gpt-4o", label: "GPT-4o" }] }], fetchedAt: "t0" },
    [{ id: "openai", live: false, models: [{ id: "gpt-4o-mini" }], error: "HTTP 500" }],
  );
  assert.equal(kept.catalog[0].models[0].id, "gpt-4o");
});
