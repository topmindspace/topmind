/**
 * AI provider registry + secret durability / channel isolation guards.
 * Ensures Desktop / Obsidian / model-catalog stay aligned as providers expand.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURATED_DEFAULT_MODELS,
  MODELS_DEV_PROVIDER_MAP,
  PROVIDER_API,
  PROVIDER_KEY_FIELDS,
  PROVIDER_LABELS,
  PROVIDER_REGIONS,
} from "../electron/lib/model-catalog.mjs";
import {
  AI_SOURCE_PREFERENCES,
  MANUAL_SECRET_KEYS,
  defaultManualSettings,
  isAcceptedSourcePreference,
} from "../electron/lib/settings-core.mjs";
import { resolveDesktopStateHome, resolveStateChannel } from "../electron/lib/workspace-home.mjs";
import { getRuntimeStatus, resolveModel } from "../electron/ai-model.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..", "..");

const EXPECTED_PROVIDERS = [
  "openai", "anthropic", "google", "xai", "groq", "mistral", "openrouter",
  "deepseek", "moonshot", "zhipu", "minimax", "qwen", "doubao", "siliconflow", "baidu", "hunyuan",
  "ollama", "custom",
];

test("model-catalog covers US + CN mainstream providers", () => {
  for (const id of EXPECTED_PROVIDERS) {
    assert.ok(PROVIDER_LABELS[id], `PROVIDER_LABELS missing ${id}`);
    assert.ok(PROVIDER_API[id], `PROVIDER_API missing ${id}`);
    assert.ok(CURATED_DEFAULT_MODELS[id]?.length > 0, `CURATED missing ${id}`);
    assert.ok(PROVIDER_REGIONS[id], `PROVIDER_REGIONS missing ${id}`);
    assert.ok(id in PROVIDER_KEY_FIELDS, `PROVIDER_KEY_FIELDS missing ${id}`);
    assert.ok(AI_SOURCE_PREFERENCES.has(id), `AI_SOURCE_PREFERENCES missing ${id}`);
  }
});

test("manual secret keys match provider key fields", () => {
  const fields = Object.values(PROVIDER_KEY_FIELDS).filter(Boolean).sort();
  const manual = [...MANUAL_SECRET_KEYS].sort();
  assert.deepEqual(manual, fields, "MANUAL_SECRET_KEYS must match PROVIDER_KEY_FIELDS");

  const defaults = defaultManualSettings();
  for (const key of MANUAL_SECRET_KEYS) {
    assert.equal(defaults[key], "", `${key} default must be empty string`);
  }
  // URL fields
  assert.ok("customBaseUrl" in defaults);
  assert.ok("ollamaBaseUrl" in defaults);
});

test("sourcePreference accepts known and future ids; rejects junk", () => {
  assert.ok(isAcceptedSourcePreference(""));
  assert.ok(isAcceptedSourcePreference("qwen"));
  assert.ok(isAcceptedSourcePreference("some-future-vendor"));
  assert.ok(!isAcceptedSourcePreference("DROP TABLE"));
  assert.ok(!isAcceptedSourcePreference("OpenAI"));
  assert.ok(!isAcceptedSourcePreference(123));
});

test("root and desktop model-catalog copies stay identical", () => {
  const a = readFileSync(path.join(repoRoot, "lib", "model-catalog.mjs"), "utf8");
  const b = readFileSync(path.join(root, "..", "electron", "lib", "model-catalog.mjs"), "utf8");
  assert.equal(a, b, "lib/model-catalog.mjs and topmind-desktop/electron/lib/model-catalog.mjs must match");
});

test("AiProviderPanel PROVIDERS stays aligned with catalog", () => {
  const src = readFileSync(
    path.join(root, "..", "src", "components", "settings", "AiProviderPanel.tsx"),
    "utf8",
  );
  for (const id of EXPECTED_PROVIDERS) {
    assert.ok(src.includes(`id: "${id}"`), `AiProviderPanel missing provider ${id}`);
  }
});

test("dev/test channels isolate state home from prod keys", () => {
  const homeDir = "/tmp/tm-home";
  const prod = resolveDesktopStateHome({ homeDir, isPackaged: true, env: {} });
  const dev = resolveDesktopStateHome({ homeDir, isPackaged: false, env: {} });
  const testHome = resolveDesktopStateHome({ homeDir, env: { TOPMIND_CHANNEL: "test" } });

  assert.equal(prod, path.join(homeDir, "topmind", "topmind-desktop"));
  assert.equal(dev, path.join(homeDir, "topmind", "topmind-desktop-dev"));
  assert.equal(testHome, path.join(homeDir, "topmind", "topmind-desktop-test"));
  assert.notEqual(dev, prod, "dev must not share prod state home");

  // Explicit override wins verbatim (advanced / intentional share).
  const override = resolveDesktopStateHome({
    homeDir,
    isPackaged: false,
    env: { topmind_DESKTOP_HOME: "/custom/state" },
  });
  assert.equal(override, path.resolve("/custom/state"));

  assert.equal(resolveStateChannel({ isPackaged: true, env: {} }), "prod");
  assert.equal(resolveStateChannel({ isPackaged: false, env: {} }), "dev");
  assert.equal(resolveStateChannel({ env: { TOPMIND_CHANNEL: "production" } }), "prod");
});

test("resolveModel routes new domestic + international providers", () => {
  const s = {
    ai: {
      sourcePreference: "qwen",
      defaultModel: "qwen-max",
      manual: {
        ...defaultManualSettings(),
        qwenKey: "sk-qwen",
        groqKey: "gsk_x",
        openrouterKey: "sk-or-x",
        siliconflowKey: "sk-sf",
        doubaoKey: "db",
        baiduKey: "bd",
        hunyuanKey: "hy",
        mistralKey: "ms",
      },
      modelCache: null,
    },
  };
  const r = resolveModel(s);
  assert.ok(r, "must resolve");
  assert.equal(r.provider, "qwen");
  assert.equal(r.modelId, "qwen-max");

  const g = resolveModel({ ...s, ai: { ...s.ai, sourcePreference: "groq", defaultModel: null } });
  assert.equal(g.provider, "groq");

  const status = getRuntimeStatus(s);
  const sources = status.providers.map((p) => p.source);
  for (const id of ["qwen", "groq", "openrouter", "siliconflow", "doubao", "baidu", "hunyuan", "mistral"]) {
    assert.ok(sources.includes(id), `runtime status missing ${id}`);
  }
});

test("models.dev map includes CN aggregator aliases", () => {
  assert.equal(MODELS_DEV_PROVIDER_MAP.alibaba, "qwen");
  assert.equal(MODELS_DEV_PROVIDER_MAP.moonshotai, "moonshot");
  assert.equal(MODELS_DEV_PROVIDER_MAP.volcengine, "doubao");
});

test("local-secret keeps .secret-key.bak and refuses silent rotate under orphanGuard", async () => {
  const { createLocalSecretAdapter } = await import("../electron/lib/local-secret.mjs");
  const { promises: fs } = await import("node:fs");
  const os = await import("node:os");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tm-secret-"));
  const settingsPath = path.join(dir, "app-settings.json");

  const a1 = await createLocalSecretAdapter(settingsPath);
  assert.ok(a1.available);
  const cipher = a1.encryptLocal("sk-test");
  assert.ok(cipher.startsWith("v1aes:"));
  assert.equal(a1.decryptLocal(cipher), "sk-test");

  const keyPath = path.join(dir, ".secret-key");
  const bakPath = path.join(dir, ".secret-key.bak");
  assert.ok((await fs.stat(keyPath)).size === 32);
  assert.ok((await fs.stat(bakPath)).size === 32);

  // Wipe primary — bak restores, ciphertext still readable.
  await fs.rm(keyPath);
  const a2 = await createLocalSecretAdapter(settingsPath);
  assert.ok(a2.available);
  assert.equal(a2.decryptLocal(cipher), "sk-test");

  // orphanGuard with both keys gone must NOT invent a key.
  await fs.rm(keyPath);
  await fs.rm(bakPath);
  const guarded = await createLocalSecretAdapter(settingsPath, { orphanGuard: true });
  assert.equal(guarded.available, false);
  assert.equal(guarded.encryptLocal, null);
});
