/**
 * v4 SystemService — settings, paths, native operations, workspace management.
 * Settings routed through settings.mjs (safeStorage-encrypted + workspace history).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { shell, dialog, app } = require("electron");
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { logInfo, logError } from "./lib/writeback.mjs";
import { loadAppSettings, updateAppSettings, saveAppSettings, createDefaultAppSettings } from "./settings.mjs";
import { normalizeStoredWorkspaceHistory } from "./workspace-history.mjs";
import { getRuntimeStatus } from "./ai-model.mjs";
import { ensureWorkspaceStructure, autoRepairWorkspace, loadWorkspaceConfig, getEngineRoot } from "./lib/workspace-home.mjs";
import { listTemplateDescriptors } from "./lib/template-api.mjs";
import { defaultEngineCandidate } from "./lib/engine-root.mjs";
import { platformTag } from "./lib/platform.mjs";
import {
  generateClipToken,
  getClipBridgeLive,
  CLIP_BRIDGE_DEFAULT_PORT,
} from "./lib/clip-bridge.mjs";
import {
  checkAllSurfaces,
  readRunningAppVersion,
} from "./lib/update-check.mjs";
import {
  listExternalPlugins,
  ensurePluginsDir,
  openPluginsDir,
  getPluginsRoot,
} from "./lib/external-plugins.mjs";
import {
  installPluginFromFolder,
  installPluginFromZip,
  uninstallPlugin,
  scaffoldExamplePlugin,
  previewPluginFromFolder,
  previewPluginFromZip,
} from "./lib/plugin-install.mjs";
import {
  ensureSkillsExtraRoot,
  getSkillsExtraRoot,
  installSkillsPackLocal,
  isSkillsPackRoot,
  resolveSkillsPackRoot,
  readSkillsExtraReceipt,
  summarizeSkillsPack,
} from "./lib/skills-extra.mjs";

function secretAdapterFromCtx(ctx) {
  return ctx.secretAdapter || null;
}

// ── models.dev integration ──────────────────────────────────────────────
// Community-maintained AI model catalog (https://models.dev)
// Used as a rich fallback/supplement to live provider API fetches.

/** models.dev provider ID → topmind internal provider ID.
 * Maps the community catalog providers to our internal source IDs.
 * Only providers we can actually route to (have SDK support) are mapped. */
const MODELS_DEV_PROVIDER_MAP = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  moonshotai: "moonshot",
  zhipuai: "zhipu",
  minimax: "minimax",
  xai: "xai",
};

/** In-memory cache TTL for models.dev catalog (24 hours) */
const MODELS_DEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Cached models.dev catalog (ProviderInfo[] format) */
let modelsDevCache = null;
let modelsDevCacheFetchedAt = 0;

export const SystemService = {
  async getSettings(_p, ctx) {
    const fp = ctx.workspaceStatePaths.settingsFilePath;
    // loadAppSettings already merges defaults + normalizes nested objects + hydrates secrets
    const loaded = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    const merged = { ...loaded };
    // launchDefaults are ephemeral (not disk truth): overlay only top-level flags like launchStatus
    if (ctx.launchDefaults && typeof ctx.launchDefaults === "object") {
      Object.assign(merged, ctx.launchDefaults);
    }
    return merged;
  },

  async updateSettings({ patch }, ctx) {
    const fp = ctx.workspaceStatePaths.settingsFilePath;
    const current = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    let next = await updateAppSettings(fp, current, patch, {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    // Auto-mint token when enabling clip bridge without one
    if (patch?.clipBridge?.enabled && !next.clipBridge?.token) {
      next = await updateAppSettings(
        fp,
        next,
        { clipBridge: { ...next.clipBridge, token: generateClipToken() } },
        { secretAdapter: secretAdapterFromCtx(ctx) },
      );
    }
    // CRITICAL: sync the in-memory appSettings so the window-bounds persist
    // function doesn't overwrite freshly-saved keys with stale values.
    if (typeof ctx.updateAppSettingsInMemory === "function") {
      ctx.updateAppSettingsInMemory(next);
    }
    // Keep skills catalog in sync with extra roots
    if (patch?.ai?.extraSkillsRoots !== undefined || next?.ai?.extraSkillsRoots) {
      try {
        const rt = await import("./lib/skills-runtime.mjs");
        rt.setConfiguredExtraSkillsRoots(next?.ai?.extraSkillsRoots || []);
      } catch {
        /* ignore */
      }
    }
    // Restart / stop loopback bridge when settings change
    if (typeof ctx.syncClipBridge === "function") {
      try {
        await ctx.syncClipBridge(next);
      } catch (e) {
        logError("system", "clip bridge sync failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return next;
  },

  async clipBridgeStatus(_p, ctx) {
    const live = getClipBridgeLive();
    const settings = await SystemService.getSettings({}, ctx);
    return {
      ...live,
      enabled: Boolean(settings.clipBridge?.enabled),
      configuredPort: settings.clipBridge?.port || CLIP_BRIDGE_DEFAULT_PORT,
      hasToken: Boolean(settings.clipBridge?.token),
      endpoint: live.running
        ? `http://127.0.0.1:${live.port}/v1/clip`
        : null,
    };
  },

  async clipBridgeRotateToken(_p, ctx) {
    const token = generateClipToken();
    const next = await SystemService.updateSettings(
      { patch: { clipBridge: { token, enabled: true } } },
      ctx,
    );
    return {
      ok: true,
      token,
      settings: next,
      live: getClipBridgeLive(),
    };
  },

  async openPath({ targetPath }, _ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    // shell.openPath resolves with an error *string* on failure (not a throw).
    // Surface it so Linux (xdg-open missing) / Windows (assoc missing) fail clearly.
    const err = await shell.openPath(targetPath);
    if (err) throw new Error(`无法打开路径: ${err}`);
    return { ok: true };
  },

  async revealPath({ targetPath }, _ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    shell.showItemInFolder(targetPath);
    return { ok: true };
  },

  async openExternal({ url }, _ctx) {
    if (!url) throw new Error("url required.");
    // Reject non-http(s) / mailto schemes that could shell-out unexpectedly.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`无效 URL: ${url}`);
    }
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      throw new Error(`不允许的协议: ${parsed.protocol}`);
    }
    await shell.openExternal(url);
    return { ok: true };
  },

  /**
   * Open capture surface (float sticky note or main overlay).
   * @param {{ mode?: 'float'|'overlay' }} p
   */
  async openCaptureSurface(p, ctx) {
    if (typeof ctx.openCaptureSurface === "function") {
      return ctx.openCaptureSurface(p || {});
    }
    throw new Error("openCaptureSurface not available");
  },

  /** Focus main shell → Knowledge Ingest hub (queue). Used by float capture. */
  async openIngestHub(_p, ctx) {
    if (typeof ctx.openIngestHub === "function") {
      return ctx.openIngestHub();
    }
    return { ok: false };
  },

  async closeQuickCapture(_p, ctx) {
    if (typeof ctx.closeQuickCaptureWindow === "function") {
      return ctx.closeQuickCaptureWindow();
    }
    return { ok: true };
  },

  /** App version + platform (About / update UI). */
  async getAppInfo(_p, _ctx) {
    return {
      name: app.getName?.() || "topmind",
      version: readRunningAppVersion(),
      platform: platformTag(),
      packaged: Boolean(app.isPackaged),
      electron: process.versions?.electron || null,
      chrome: process.versions?.chrome || null,
      node: process.versions?.node || null,
    };
  },

  /**
   * Multi-surface update check (Desktop + Skills pack + Clip Extension).
   * Desktop version is derived from installer asset names (topmind-X.Y.Z-*),
   * never from product tags like v1.0.0 (those are monorepo ship events).
   */
  async checkForUpdates(_p, ctx) {
    try {
      const engineRoot = ctx?.engineRoot || getEngineRoot() || null;
      const result = await checkAllSurfaces({
        currentVersion: readRunningAppVersion(),
        engineRoot,
      });
      logInfo("system", "update check", {
        desktop: {
          current: result.desktop?.currentVersion,
          latest: result.desktop?.latestVersion,
          reason: result.desktop?.reason,
          updateAvailable: result.desktop?.updateAvailable,
        },
        skills: {
          current: result.skills?.currentVersion,
          latest: result.skills?.latestVersion,
          reason: result.skills?.reason,
        },
        extension: {
          current: result.extension?.currentVersion,
          latest: result.extension?.latestVersion,
          reason: result.extension?.reason,
        },
      });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const code = e && typeof e === "object" && "code" in e ? String(e.code) : "error";
      logError("system", "update check failed", { error: message, code });
      const current = readRunningAppVersion();
      const repo = process.env.topmind_UPDATE_REPO || "topmindspace/topmind";
      const releasesUrl = `https://github.com/${repo}/releases`;
      const emptySurface = (surface) => ({
        ok: false,
        surface,
        updateAvailable: false,
        currentVersion: surface === "desktop" ? current : null,
        latestVersion: null,
        tagName: null,
        releaseUrl: releasesUrl,
        notes: null,
        publishedAt: null,
        assets: [],
        reason: "error",
        error: message,
      });
      return {
        ok: false,
        updateAvailable: false,
        currentVersion: current,
        latestVersion: null,
        tagName: null,
        releaseUrl: releasesUrl,
        releasesUrl,
        notes: null,
        publishedAt: null,
        assets: [],
        error: message,
        errorCode: code,
        checkedAt: new Date().toISOString(),
        reason: "error",
        desktop: emptySurface("desktop"),
        skills: emptySurface("skills"),
        extension: emptySurface("extension"),
        model: {
          desktopBundlesSkills: true,
          desktopBundlesUtr: true,
          extensionIsBrowser: true,
        },
      };
    }
  },

  /** Open the release page or a specific installer / pack download in the system browser. */
  async openUpdateDownload({ url, surface } = {}, ctx) {
    let target = typeof url === "string" ? url.trim() : "";
    if (!target) {
      const check = await SystemService.checkForUpdates({}, ctx);
      const s =
        surface === "skills"
          ? check.skills
          : surface === "extension"
            ? check.extension
            : check.desktop || check;
      target = s?.assets?.[0]?.url || s?.releaseUrl || check.releasesUrl || "";
    }
    if (!target) throw new Error("没有可打开的更新链接（尚未检查到可用版本）");
    return SystemService.openExternal({ url: target }, ctx);
  },

  /** Discover third-party plugins under Desktop home plugins/. */
  async listExternalPlugins(_p, _ctx) {
    return {
      ok: true,
      root: getPluginsRoot(),
      plugins: await listExternalPlugins(),
    };
  },

  async openPluginsDir(_p, _ctx) {
    await ensurePluginsDir();
    return openPluginsDir();
  },

  /** Native picker for a plugin folder (must contain topmind-plugin.json). */
  async pickPluginFolder(_p, _ctx) {
    const result = await dialog.showOpenDialog({
      title: "选择插件文件夹（含 topmind-plugin.json）",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { path: null };
    return { path: result.filePaths[0] };
  },

  /** Native picker for a plugin zip archive. */
  async pickPluginZip(_p, _ctx) {
    const result = await dialog.showOpenDialog({
      title: "选择插件 zip",
      properties: ["openFile"],
      filters: [{ name: "Plugin archive", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { path: null };
    return { path: result.filePaths[0] };
  },

  async installExternalPluginFromFolder({ sourcePath, force }, _ctx) {
    if (!sourcePath) throw new Error("sourcePath required");
    // Default force=false (safe); UI passes true only after preview confirm.
    const result = await installPluginFromFolder(sourcePath, { force: force === true });
    if (!result.ok) throw new Error(result.error || "install failed");
    logInfo("system", "external plugin installed from folder", { id: result.id, dir: result.dir });
    return result;
  },

  async installExternalPluginFromZip({ zipPath, force }, _ctx) {
    if (!zipPath) throw new Error("zipPath required");
    const result = await installPluginFromZip(zipPath, { force: force === true });
    if (!result.ok) throw new Error(result.error || "install failed");
    logInfo("system", "external plugin installed from zip", { id: result.id, dir: result.dir });
    return result;
  },

  async uninstallExternalPlugin({ pluginId, hard }, _ctx) {
    if (!pluginId) throw new Error("pluginId required");
    const result = await uninstallPlugin(pluginId, { hard: hard === true });
    if (!result.ok) throw new Error(result.error || "uninstall failed");
    logInfo("system", "external plugin uninstalled", { id: result.id, trashPath: result.trashPath });
    return result;
  },

  async scaffoldExamplePlugin(_p, _ctx) {
    const result = await scaffoldExamplePlugin();
    logInfo("system", "example plugin scaffolded", { id: result.id, dir: result.dir });
    return result;
  },

  /** Preview plugin folder before install (manifest + risk, no write). */
  async previewExternalPluginFromFolder({ sourcePath }, _ctx) {
    if (!sourcePath) throw new Error("sourcePath required");
    const result = await previewPluginFromFolder(sourcePath);
    if (!result.ok) throw new Error(result.error || "preview failed");
    return result;
  },

  /** Preview plugin zip before install (extract + validate + cleanup). */
  async previewExternalPluginFromZip({ zipPath }, _ctx) {
    if (!zipPath) throw new Error("zipPath required");
    const result = await previewPluginFromZip(zipPath);
    if (!result.ok) throw new Error(result.error || "preview failed");
    return result;
  },

  async showNotification({ title, body }, _ctx) {
    if (!title) throw new Error("title required.");
    const { Notification } = await import("electron");
    if (Notification.isSupported()) new Notification({ title, body: body || "" }).show();
    return { shown: Notification.isSupported() };
  },

  async setDockBadge({ label }, _ctx) {
    const { app } = await import("electron");
    if (app.dock) app.dock.setBadge(label || "");
    return { ok: true };
  },

  /** Return the model catalog — a merge of models.dev community data and
   * any live-fetched models from configured providers.
   *
   * Strategy:
   * 1. Start with models.dev community catalog (ALL supported providers,
   *    not just configured — lets users browse models before adding keys)
   * 2. If a live cache exists, overlay it (live data takes priority for
   *    configured providers — more up-to-date than community data)
   * 3. For configured providers not in models.dev (e.g. ollama, custom),
   *    add curated defaults
   *
   * This ensures the model selector never reverts to stale curated defaults
   * after the user has clicked "刷新模型" — the live list persists across
   * settings saves and UI re-renders. */
  async discoverModels(_p, ctx) {
    const fp = ctx.workspaceStatePaths.settingsFilePath;
    const settings = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    const status = getRuntimeStatus(settings);
    const configuredSources = new Set((status.providers || []).map((p) => p.source));
    const cache = settings?.ai?.modelCache;

    // Step 1: Get models.dev catalog as the base (all supported providers)
    let baseCatalog = [];
    try {
      baseCatalog = await this.fetchModelsDevCatalog();
    } catch {
      // models.dev unavailable — will fall back to curated defaults below
    }

    // Step 2: If live cache exists, overlay it on top
    if (cache?.catalog?.length > 0) {
      const liveMap = new Map(cache.catalog.map((c) => [c.id, c]));
      // Replace base entries with live data where available
      const merged = baseCatalog.map((c) => liveMap.get(c.id) || c);
      // Add live entries not in models.dev (ollama, custom, etc.)
      const baseIds = new Set(baseCatalog.map((c) => c.id));
      for (const [id, entry] of liveMap) {
        if (!baseIds.has(id)) merged.push(entry);
      }
      // Add curated defaults for configured providers still missing
      const mergedIds = new Set(merged.map((c) => c.id));
      for (const p of (status.providers || [])) {
        if (!mergedIds.has(p.source)) {
          merged.push({ id: p.source, label: providerLabel(p.source), models: defaultModelsFor(p.source), live: false });
        }
      }
      return merged;
    }

    // Step 3: No live cache — return models.dev catalog + curated defaults for configured-but-missing
    if (baseCatalog.length > 0) {
      const baseIds = new Set(baseCatalog.map((c) => c.id));
      for (const p of (status.providers || [])) {
        if (!baseIds.has(p.source)) {
          baseCatalog.push({ id: p.source, label: providerLabel(p.source), models: defaultModelsFor(p.source), live: false });
        }
      }
      return baseCatalog;
    }

    // Final fallback: curated defaults for configured providers only
    const catalog = (status.providers || []).map((p) => ({
      id: p.source,
      label: providerLabel(p.source),
      models: defaultModelsFor(p.source),
      live: false,
    }));
    return catalog;
  },

  /** Fetch the community-maintained model catalog from models.dev.
   *
   * models.dev (https://github.com/anomalyco/models.dev) is an open-source
   * database of AI model specs, pricing, and capabilities. It provides
   * `https://models.dev/api.json` — a JSON object keyed by provider ID,
   * each with model metadata (name, tool_call, reasoning, context limits,
   * cost, etc.).
   *
   * We use this as:
   * 1. A rich fallback when no provider keys are configured yet (shows all
   *    available models so users can browse before configuring)
   * 2. A supplement for Anthropic (which has no public list-models endpoint)
   * 3. A source of model capabilities metadata (tool_call, reasoning, etc.)
   *
   * Cached in-memory with a 24h TTL; the UI refresh button forces a refetch.
   *
   * Provider ID mapping: models.dev → topmind internal:
   *   openai → openai, anthropic → anthropic, google → google,
   *   deepseek → deepseek, moonshotai → moonshot, zhipuai → zhipu,
   *   minimax → minimax, xai → xai
   */
   async fetchModelsDevCatalog(params, _ctx) {
    const forceLive = params?.forceLive === true;
    // In-memory cache — 24h TTL
    const now = Date.now();
    if (
      !forceLive &&
      modelsDevCache &&
      modelsDevCacheFetchedAt &&
      now - modelsDevCacheFetchedAt < MODELS_DEV_CACHE_TTL_MS
    ) {
      return modelsDevCache;
    }

    try {
      const res = await fetch("https://models.dev/api.json", {
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          "User-Agent": "topmind-desktop/1.4 (model catalog fetch)",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const catalog = [];
      for (const [mdId, tmId] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
        const provider = data[mdId];
        if (!provider || !provider.models) continue;

        // Filter to chat-capable models — exclude image-only, embedding, etc.
        const chatModels = [];
        for (const [modelId, model] of Object.entries(provider.models)) {
          // Skip non-text-output models (image generators, embeddings, etc.)
          const outputModalities = model?.modalities?.output || [];
          if (
            outputModalities.length > 0 &&
            !outputModalities.includes("text")
          ) {
            continue;
          }
          // Skip models with 0 context (image gen, TTS, etc.)
          const ctxLimit = model?.limit?.context || 0;
          if (ctxLimit === 0 && model?.tool_call === false && model?.reasoning === false) {
            continue;
          }

          // Build rich model entry with metadata from models.dev
          const entry = {
            id: modelId,
            label: model.name || modelId,
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
          if (typeof model.cost?.input === "number" && model.cost.input >= 0) {
            entry.costInput = model.cost.input;
          }
          if (typeof model.cost?.output === "number" && model.cost.output >= 0) {
            entry.costOutput = model.cost.output;
          }
          chatModels.push(entry);
        }

        if (chatModels.length > 0) {
          catalog.push({
            id: tmId,
            label: providerLabel(tmId),
            models: chatModels.sort((a, b) => a.label.localeCompare(b.label)),
            live: false, // models.dev is community-maintained, not live API
          });
        }
      }

      modelsDevCache = catalog;
      modelsDevCacheFetchedAt = now;
      return catalog;
    } catch (err) {
      logError("system", "fetchModelsDevCatalog failed", { error: err.message });
      // Return curated defaults on failure
      return Object.entries(MODELS_DEV_PROVIDER_MAP).map(([, tmId]) => ({
        id: tmId,
        label: providerLabel(tmId),
        models: defaultModelsFor(tmId),
        live: false,
      }));
    }
  },

  /** Fetch the real-time model list from each configured provider's API.
   * Falls back to curated defaults on any failure (bad key, network, etc.)
   * so the UI always shows *something* usable.
   *
   * The result is persisted to settings.ai.modelCache so that subsequent
   * `discoverModels()` calls return the live list instead of reverting
   * to curated defaults.
   *
   * OpenAI-compatible providers (OpenAI, DeepSeek, Custom) expose
   * `GET {baseURL}/models`; Google exposes `GET /v1beta/models`; Anthropic
   * has no public list endpoint so a curated list is always used. */
  async fetchLiveModels(_p, ctx) {
    const fp = ctx.workspaceStatePaths.settingsFilePath;
    const settings = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    const m = settings?.ai?.manual || {};
    const providers = [];

    // OpenAI-compatible providers — each returns { data: [{ id }] }
    const openaiCompat = [
      { source: "openai", key: m.openAiKey, baseURL: "https://api.openai.com/v1" },
      { source: "deepseek", key: m.deepseekKey, baseURL: "https://api.deepseek.com/v1" },
      { source: "moonshot", key: m.moonshotKey, baseURL: "https://api.moonshot.cn/v1" },
      { source: "zhipu", key: m.zhipuKey, baseURL: "https://open.bigmodel.cn/api/paas/v4" },
      { source: "minimax", key: m.minimaxKey, baseURL: "https://api.minimax.chat/v1" },
      { source: "xai", key: m.xaiKey, baseURL: "https://api.x.ai/v1" },
      { source: "custom", key: m.customKey, baseURL: m.customBaseUrl || "" },
    ];
    for (const p of openaiCompat) {
      if (!p.key || (p.source === "custom" && !p.baseURL)) continue;
      try {
        const models = await fetchOpenAICompatModels(p.baseURL, p.key);
        providers.push({ id: p.source, label: providerLabel(p.source), models, live: true });
      } catch (err) {
        logError("system", "fetchLiveModels failed", { provider: p.source, error: err.message });
        providers.push({ id: p.source, label: providerLabel(p.source), models: defaultModelsFor(p.source), live: false, error: err.message });
      }
    }

    // Google — returns { models: [{ name, displayName, supportedGenerationMethods }] }
    if (m.googleKey) {
      try {
        const models = await fetchGoogleModels(m.googleKey);
        providers.push({ id: "google", label: "Google", models, live: true });
      } catch (err) {
        logError("system", "fetchLiveModels failed", { provider: "google", error: err.message });
        providers.push({ id: "google", label: "Google", models: defaultModelsFor("google"), live: false, error: err.message });
      }
    }

    // Anthropic — no public list endpoint; always use curated list
    if (m.anthropicKey) {
      providers.push({ id: "anthropic", label: "Anthropic", models: defaultModelsFor("anthropic"), live: false });
    }

    // Ollama — local OpenAI-compatible endpoint (no key required)
    const ollamaUrl = m.ollamaBaseUrl || "http://127.0.0.1:11434/v1";
    try {
      const ollamaModels = await fetchOpenAICompatModels(ollamaUrl, "ollama");
      providers.push({ id: "ollama", label: "Ollama", models: ollamaModels, live: true });
    } catch (err) {
      // Ollama not running — silently skip (don't error the whole fetch)
      logError("system", "fetchLiveModels ollama skipped", { error: err.message });
    }

    // Persist the live catalog to settings so discoverModels() returns it
    // instead of curated defaults on subsequent calls.
    try {
      const cachePayload = { catalog: providers, fetchedAt: new Date().toISOString() };
      await updateAppSettings(fp, settings, { ai: { modelCache: cachePayload } }, {
        secretAdapter: secretAdapterFromCtx(ctx),
      });
      if (typeof ctx.updateAppSettingsInMemory === "function") {
        const updated = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
          secretAdapter: secretAdapterFromCtx(ctx),
        });
        ctx.updateAppSettingsInMemory(updated);
      }
    } catch (err) {
      logError("system", "modelCache persist failed", { error: err.message });
    }

    return providers;
  },

  async getEngineHealth(_p, ctx) {
    return {
      ok: !!ctx.workspaceRoot,
      engineRoot: ctx.engineRoot || null,
      workspaceRoot: ctx.workspaceRoot?.userWorkspaceRoot || null,
    };
  },

  /**
   * Open a native folder picker and return the selected path.
   * Used by onboarding / workspace switcher to choose a workspace dir.
   */
  async pickWorkspaceFolder(_p, ctx) {
    const result = await dialog.showOpenDialog({
      title: "选择 topmind 工作区",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: ctx.workspaceRoot?.userWorkspaceRoot || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  },

  /**
   * Initialize a new workspace at the given path: create the default
   * category directories using the specified or default template.
   */
  async createWorkspace({ targetPath, templateId }, _ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    const resolved = path.resolve(targetPath);
    await fs.mkdir(resolved, { recursive: true });
    await ensureWorkspaceStructure(resolved, templateId || "stream");
    logInfo("system", "workspace created", { path: resolved, template: templateId || "stream" });
    return { ok: true, path: resolved };
  },

  /**
   * Open a folder as workspace, initializing structure if empty.
   * Prefer this from Landing / 「选择文件夹」 after pickWorkspaceFolder.
   */
  async openOrCreateWorkspace({ targetPath, templateId }, ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    const resolved = path.resolve(targetPath);
    await fs.mkdir(resolved, { recursive: true });
    await ensureWorkspaceStructure(resolved, templateId || "stream");
    const result = await SystemService.switchWorkspace({ targetPath: resolved, createIfMissing: true }, ctx);
    // Soft-ensure core profile file under memory dir (non-fatal)
    try {
      const { ensureCoreProfile } = await import("./lib/workspace-model-api.mjs");
      await ensureCoreProfile(resolved);
    } catch {
      /* ignore */
    }
    return result;
  },

  /** List all available workspace templates for UI selection. */
  async listTemplates(_p, ctx) {
    const engineRoot = ctx.engineRoot || getEngineRoot() || defaultEngineCandidate();
    return listTemplateDescriptors(engineRoot);
  },

  /**
   * Runtime diagnostics for support / packaging smoke.
   * Safe: no API keys or file contents.
   */
  async getDiagnostics(_p, ctx) {
    const engineRoot = ctx.engineRoot || getEngineRoot() || defaultEngineCandidate();
    return {
      version: app.getVersion?.() || null,
      name: app.getName?.() || "topmind",
      packaged: Boolean(app.isPackaged),
      platform: platformTag(),
      electron: process.versions?.electron || null,
      chrome: process.versions?.chrome || null,
      node: process.versions?.node || null,
      engineRoot,
      workspaceRoot: ctx.workspaceRoot?.userWorkspaceRoot || null,
      resourcesPath: process.resourcesPath || null,
      execPath: process.execPath || null,
      desktopStateHome: ctx.workspaceStatePaths?.desktopStateHome || null,
      settingsFile: ctx.workspaceStatePaths?.settingsFilePath || null,
      safeStorage: Boolean(ctx.secretAdapter?.isEncryptionAvailable?.()),
    };
  },

  /**
   * Bundled topmind skills pack status + discovery catalog (for Settings / AI slash).
   */
  async getSkillsStatus(_p, ctx) {
    const rt = await import("./lib/skills-runtime.mjs");
    const { SKILL_PROMPTS } = await import("./ai-prompts.mjs");
    const engineRoot = ctx.workspaceRoot?.engineRoot || getEngineRoot();
    const settings = await loadAppSettings(
      ctx.workspaceStatePaths.settingsFilePath,
      ctx.workspaceRoot?.userWorkspaceRoot || "",
      { secretAdapter: secretAdapterFromCtx(ctx) },
    );
    const extraRoots = settings?.ai?.extraSkillsRoots || [];
    rt.setConfiguredExtraSkillsRoots(extraRoots);
    const status = rt.getSkillsStatus({ engineRoot, extraRoots });
    const enabledIds = settings?.ai?.enabledSkillIds || null;
    const catalog = rt.listSkillCatalog({ engineRoot, enabledIds, extraRoots });
    const slash = Object.entries(rt.SLASH_TO_SKILL).map(([cmd, skillId]) => {
      const key = skillId === "topmind" ? "topmind" : skillId.replace(/^topmind-/, "");
      return {
        command: cmd,
        skillId,
        prompt: SKILL_PROMPTS[key] || `请按 ${skillId} skill 执行（先 load_skill）。`,
      };
    });
    const managedExtraRoot = getSkillsExtraRoot();
    const extraReceipt = await readSkillsExtraReceipt(managedExtraRoot);
    /** @type {Array<object>} */
    const extraSummaries = [];
    for (const root of status.extraRoots || extraRoots || []) {
      try {
        const sum = await summarizeSkillsPack(root);
        if (sum.ok) extraSummaries.push(sum);
      } catch {
        /* skip */
      }
    }
    return {
      ...status,
      skillsEnabled: settings?.ai?.skillsEnabled !== false,
      enabledSkillIds: enabledIds,
      enabledCatalog: catalog,
      slash,
      extraSkillsRoots: extraRoots,
      managedExtraRoot,
      extraReceipt,
      extraSummaries,
    };
  },

  async getSkillBody({ skillId }, ctx) {
    if (!skillId) throw new Error("skillId required");
    const rt = await import("./lib/skills-runtime.mjs");
    const engineRoot = ctx.workspaceRoot?.engineRoot || getEngineRoot();
    const settings = await loadAppSettings(
      ctx.workspaceStatePaths.settingsFilePath,
      ctx.workspaceRoot?.userWorkspaceRoot || "",
      { secretAdapter: secretAdapterFromCtx(ctx) },
    );
    rt.setConfiguredExtraSkillsRoots(settings?.ai?.extraSkillsRoots || []);
    return rt.loadSkillBody(skillId, { engineRoot, maxChars: 20000 });
  },

  /** Pick a folder to use as an extra skills root (or local pack to install). */
  async pickSkillsFolder(_p, _ctx) {
    const result = await dialog.showOpenDialog({
      title: "选择 Skills 目录（含 SKILL.md 或 topmind-pack.json）",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { path: null };
    return { path: result.filePaths[0] };
  },

  /**
   * Install a local skills pack into managed skills-extra and return dest path.
   * Caller should add dest to ai.extraSkillsRoots if not already present.
   */
  async installSkillsPackLocal({ sourcePath, dest }, _ctx) {
    if (!sourcePath) throw new Error("sourcePath required");
    const result = await installSkillsPackLocal(sourcePath, {
      dest: dest || undefined,
    });
    if (!result.ok) throw new Error(result.error || "skills install failed");
    logInfo("system", "skills pack installed to extra root", {
      dest: result.dest,
      count: result.installed?.length,
    });
    return result;
  },

  async ensureSkillsExtraDir(_p, _ctx) {
    const root = await ensureSkillsExtraRoot();
    return { ok: true, path: root };
  },

  async openSkillsExtraDir(_p, _ctx) {
    const root = await ensureSkillsExtraRoot();
    await shell.openPath(root);
    return { ok: true, path: root };
  },

  async probeSkillsPack({ sourcePath }, _ctx) {
    if (!sourcePath) throw new Error("sourcePath required");
    const packRoot = await resolveSkillsPackRoot(sourcePath);
    const ok = await isSkillsPackRoot(packRoot);
    if (!ok) return { ok: false, path: packRoot };
    const summary = await summarizeSkillsPack(packRoot);
    return { ok: true, path: packRoot, summary: summary.ok ? summary : null };
  },

  async getWorkspaceConfig(_p, ctx) {
    const defaultConfig = {
      contract_version: 4,
      categorySeparator: "-",
      template: "stream",
      stream: { packing: "weekly", appendHeading: "day" },
      memory: { dir: null, profileFile: "profile.md" },
      writebackMode: "auto",
      views: { default: "stream", enabled: ["stream", "category", "timeline", "tags", "kanban"] },
      connectorDefaults: { weread: { syncCategory: "auto" }, x: { syncCategory: "auto" } },
      categories: [],
      categoryExtensions: {},
      categoryOverrides: {},
    };
    if (!ctx.workspaceRoot?.userWorkspaceRoot) return defaultConfig;
    const resolvedRoot = ctx.workspaceRoot.userWorkspaceRoot;
    const config = await loadWorkspaceConfig(resolvedRoot);
    let categories = [];
    let stream = defaultConfig.stream;
    let memory = defaultConfig.memory;
    try {
      const { resolveWorkspaceModel } = await import("./lib/workspace-model-api.mjs");
      const model = await resolveWorkspaceModel(resolvedRoot);
      categories = model.categories;
      if (model.stream) stream = model.stream;
      if (model.memory) memory = model.memory;
    } catch {
      categories = [];
    }
    return {
      contract_version: config.contract_version || 4,
      categorySeparator: config.categorySeparator || config.workspace?.category_separator || defaultConfig.categorySeparator,
      template: config.template || config.workspace?.template || defaultConfig.template,
      stream: config.stream || stream,
      memory: {
        dir: (config.memory || memory)?.dir ?? null,
        profileFile: (config.memory || memory)?.profileFile || "profile.md",
        files: (config.memory || memory)?.files || [],
      },
      writebackMode: config.writebackMode || config.writeback?.mode || defaultConfig.writebackMode,
      views: config.views || config.presentation?.views || defaultConfig.views,
      connectorDefaults: config.connectorDefaults || config.ingest?.connectors || defaultConfig.connectorDefaults,
      categoryExtensions: config.categoryExtensions || config.categories?.extensions || {},
      categoryOverrides: config.categoryOverrides || config.categories?.overrides || {},
      categories,
    };
  },

  async updateWorkspaceConfig({ categorySeparator, template, views, connectorDefaults, stream, memory, writebackMode }, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    const resolvedRoot = ctx.workspaceRoot.userWorkspaceRoot;

    const config = await loadWorkspaceConfig(resolvedRoot);

    // Ensure v4 nested structures exist
    if (!config.workspace) config.workspace = {};
    if (!config.writeback) config.writeback = {};
    if (!config.presentation) config.presentation = {};
    if (!config.ingest) config.ingest = {};
    if (!config.categories) config.categories = {};
    if (!config.memory) config.memory = {};
    if (!config.stream) config.stream = {};

    if (categorySeparator !== undefined) {
      if (categorySeparator !== "-" && categorySeparator !== " ") {
        throw new Error("Invalid separator. Only '-' or ' ' are allowed.");
      }
      config.workspace.category_separator = categorySeparator;
    }
    if (template !== undefined) {
      config.workspace.template = template;
    }
    if (views !== undefined) {
      config.presentation.views = views;
    }
    if (connectorDefaults !== undefined) {
      config.ingest.connectors = connectorDefaults;
    }
    if (stream !== undefined && stream && typeof stream === "object") {
      const packing = ["atom", "daily", "weekly", "monthly"].includes(stream.packing)
        ? stream.packing
        : config.stream?.packing || "weekly";
      const appendHeading =
        stream.appendHeading === "none" || stream.appendHeading === "day"
          ? stream.appendHeading
          : config.stream?.appendHeading || "day";
      config.stream = { packing, appendHeading };
    }
    if (memory !== undefined && memory && typeof memory === "object") {
      const files = Array.isArray(memory.files)
        ? memory.files
            .filter((f) => typeof f === "string" && f.trim())
            .map((f) => String(f).trim().replace(/^\/+/u, ""))
            .filter((f) => f.endsWith(".md") && !f.includes("/") && !f.includes(".."))
        : config.memory?.files || [];
      config.memory = {
        dir: memory.dir === null || memory.dir === ""
          ? null
          : typeof memory.dir === "string"
            ? memory.dir
            : config.memory?.dir ?? null,
        profileFile:
          typeof memory.profileFile === "string" && memory.profileFile.trim()
            ? memory.profileFile.trim()
            : config.memory?.profileFile || "profile.md",
        files,
      };
    }
    if (writebackMode !== undefined) {
      if (!["auto", "confirm"].includes(writebackMode)) {
        throw new Error("Invalid writebackMode. Only 'auto' or 'confirm' are allowed.");
      }
      config.writeback.mode = writebackMode;
    }
    // Ensure categories nested structure
    if (!config.categories.extensions) config.categories.extensions = {};
    if (!config.categories.overrides) config.categories.overrides = {};
    config.contract_version = 4;

    // Clean up v3 flat fields (migrated to v4 nested above)
    delete config.categorySeparator;
    delete config.template;
    delete config.writebackMode;
    delete config.views;
    delete config.connectorDefaults;
    delete config.categoryExtensions;
    delete config.categoryOverrides;
    delete config.schemaVersion;

    // Write to topmind.yaml (v4 single source of truth)
    const yamlPath = path.join(resolvedRoot, "topmind.yaml");
    await fs.writeFile(yamlPath, yaml.dump(config, { lineWidth: -1, noRefs: true }), "utf8");
    await autoRepairWorkspace(resolvedRoot);
    return { ok: true };
  },

  /**
   * Add a first-level category (mkdir + categories.extensions in topmind.yaml).
   * @param {{ slot?: string, name: string, role?: string, specialBehavior?: string }} p
   */
  async createCategory({ slot, name, role, specialBehavior, catchAll, referenceOnly }, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    const root = ctx.workspaceRoot.userWorkspaceRoot;
    const { addCategory, suggestNextSlot } = await import("./lib/workspace-model-api.mjs");
    let resolvedSlot = slot;
    if (!resolvedSlot) {
      resolvedSlot = await suggestNextSlot(root);
    }
    const result = await addCategory(root, {
      slot: resolvedSlot,
      name,
      role: role || "deep-work",
      specialBehavior,
      catchAll,
      referenceOnly,
    });
    return { ok: true, directory: result.directory, category: result.category };
  },

  /**
   * Update role / behavior for a category slot (config extensions or overrides).
   * @param {{ slot: string, role?: string, specialBehavior?: string|null, hidden?: boolean, catchAll?: boolean, referenceOnly?: boolean }} p
   */
  async updateCategory({ slot, role, specialBehavior, hidden, catchAll, referenceOnly }, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    if (!slot) throw new Error("slot required.");
    const root = ctx.workspaceRoot.userWorkspaceRoot;
    const { updateCategoryAttributes } = await import("./lib/workspace-model-api.mjs");
    const result = await updateCategoryAttributes(root, slot, {
      role,
      specialBehavior,
      hidden,
      catchAll,
      referenceOnly,
    });
    return { ok: true, category: result.category };
  },

  /**
   * Rename category display name (physical dir + frontmatter category field under tree).
   * @param {{ slot: string, newName: string, updateFrontmatter?: boolean }} p
   */
  async renameCategory({ slot, newName, updateFrontmatter }, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    if (!slot) throw new Error("slot required.");
    if (!newName) throw new Error("newName required.");
    const root = ctx.workspaceRoot.userWorkspaceRoot;
    const { renameCategory } = await import("./lib/workspace-model-api.mjs");
    const result = await renameCategory(root, {
      slot,
      newName,
      updateFrontmatter: updateFrontmatter !== false,
    });
    return {
      ok: true,
      from: result.from,
      to: result.to,
      frontmatterUpdated: result.frontmatterUpdated,
      category: result.category,
    };
  },

  /** Rebuild derived `.topmind/workspace-map.json` (not content truth). */
  async rebuildWorkspaceMap(_p, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    const { writeWorkspaceMap } = await import("./lib/workspace-model-api.mjs");
    const result = await writeWorkspaceMap(ctx.workspaceRoot.userWorkspaceRoot);
    return { ok: true, path: path.relative(ctx.workspaceRoot.userWorkspaceRoot, result.path).replace(/\\/gu, "/") };
  },

  async suggestCategorySlot(_p, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    const { suggestNextSlot } = await import("./lib/workspace-model-api.mjs");
    const slot = await suggestNextSlot(ctx.workspaceRoot.userWorkspaceRoot);
    return { slot };
  },

  /**
   * Switch the active workspace.
   * @param {{ targetPath: string, createIfMissing?: boolean }} p
   *   createIfMissing — true when user picked/created a folder (may be empty).
   *   false (default) for opening a recent — missing path fails and is pruned.
   */
  async switchWorkspace({ targetPath, createIfMissing }, ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    if (typeof ctx.activateWorkspace !== "function") {
      throw new Error("activateWorkspace not available.");
    }
    const resolved = path.resolve(targetPath);
    const allowCreate = createIfMissing === true;

    try {
      const { context, settings } = await ctx.activateWorkspace(resolved, {
        createIfMissing: allowCreate,
      });
      logInfo("system", "workspace switched", { to: context.userWorkspaceRoot });
      return { ok: true, workspaceRoot: context.userWorkspaceRoot, settings };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e && typeof e === "object" && "code" in e ? e.code : "";
      // Missing/broken/forbidden path → drop from recents so landing stays clean
      if (
        code === "missing"
        || code === "not-directory"
        || code === "forbidden"
        || /不存在|不是文件夹|无法访问|运行目录|runtime/u.test(msg)
      ) {
        if (typeof ctx.removeRecentWorkspace === "function") {
          const pruned = await ctx.removeRecentWorkspace(resolved);
          logInfo("system", "removed dead recent workspace", { path: resolved, code });
          const err = new Error(msg);
          err.code = code || "missing";
          err.settings = pruned.settings;
          throw err;
        }
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  },

  /**
   * Classify a path for onboarding / switcher (healthy · empty · missing · forbidden).
   * Does not create directories or open the workspace.
   */
  async classifyWorkspace({ targetPath }, ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    const { classifyWorkspaceRoot } = await import("./workspace-history.mjs");
    const engineRoot = ctx.workspaceRoot?.engineRoot || getEngineRoot();
    return classifyWorkspaceRoot(path.resolve(targetPath), { engineRoot });
  },

  /**
   * Re-normalize recents (dedupe + prune missing/forbidden) and return settings.
   */
  async refreshWorkspaceHistory(_p, ctx) {
    const fp = ctx.workspaceStatePaths?.settingsFilePath;
    if (!fp) throw new Error("settings path unavailable");
    const current = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    const engineRoot = ctx.workspaceRoot?.engineRoot || getEngineRoot();
    const { settings: next, changed, removed } = await normalizeStoredWorkspaceHistory(
      current,
      engineRoot,
      { pruneMissing: true },
    );
    if (changed) {
      await saveAppSettings(fp, next, { secretAdapter: secretAdapterFromCtx(ctx) });
      if (typeof ctx.updateAppSettingsInMemory === "function") {
        ctx.updateAppSettingsInMemory(next);
      }
    }
    return {
      ok: true,
      changed,
      removed: removed || [],
      settings: next,
      recent: next.workspaces?.recent || [],
    };
  },

  /**
   * Close the active workspace and return to the landing screen.
   * Does not delete data; recents remain for re-open.
   */
  async closeWorkspace(_p, ctx) {
    if (typeof ctx.closeWorkspace !== "function") {
      throw new Error("closeWorkspace not available in this runtime.");
    }
    const result = await ctx.closeWorkspace();
    logInfo("system", "workspace closed");
    return result;
  },

  /** Manually remove a path from the recent list (and clear active if matched). */
  async removeRecentWorkspace({ targetPath }, ctx) {
    if (!targetPath) throw new Error("targetPath required.");
    if (typeof ctx.removeRecentWorkspace !== "function") {
      throw new Error("removeRecentWorkspace not available.");
    }
    const result = await ctx.removeRecentWorkspace(path.resolve(targetPath));
    logInfo("system", "recent workspace removed", { path: targetPath });
    return result;
  },

  async clearCache(_p, _ctx) {
    logInfo("system", "cache cleared");
    return { ok: true };
  },
};

function providerLabel(source) {
  return source === "openai" ? "OpenAI"
    : source === "anthropic" ? "Anthropic"
    : source === "google" ? "Google"
    : source === "deepseek" ? "DeepSeek"
    : source === "moonshot" ? "Moonshot/Kimi"
    : source === "zhipu" ? "Zhipu/GLM"
    : source === "minimax" ? "MiniMax"
    : source === "xai" ? "xAI/Grok"
    : source === "ollama" ? "Ollama"
    : source === "custom" ? "Custom (OpenAI-compatible)"
    : source;
}

/** Curated fallback model lists — used when live fetch fails or for Anthropic
 * (which has no public list-models endpoint). Updated 2026-07.
 *
 * These are intentionally curated (not exhaustive) — the live fetch from each
 * provider's /models endpoint provides the full list. This is the safety net
 * when the API is unreachable or the provider has no list endpoint. */
function defaultModelsFor(source) {
  switch (source) {
    case "openai":
      return [
        { id: "gpt-4o-mini", label: "GPT-4o mini" },
        { id: "gpt-4o", label: "GPT-4o" },
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
        { id: "o3", label: "o3" },
        { id: "o4-mini", label: "o4-mini" },
      ];
    case "anthropic":
      return [
        { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
        { id: "claude-opus-5", label: "Claude Opus 5" },
        { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
      ];
    case "google":
      return [
        { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
        { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
        { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      ];
    case "deepseek":
      return [
        { id: "deepseek-chat", label: "DeepSeek Chat (V4)" },
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      ];
    case "moonshot":
      return [
        { id: "kimi-k2.5", label: "Kimi K2.5" },
        { id: "kimi-k3", label: "Kimi K3 (1M)" },
        { id: "kimi-k2.6", label: "Kimi K2.6" },
        { id: "moonshot-v1-128k", label: "Moonshot V1 128K" },
      ];
    case "zhipu":
      return [
        { id: "glm-4.7-flash", label: "GLM-4.7 Flash" },
        { id: "glm-5.2", label: "GLM-5.2 (1M)" },
        { id: "glm-5", label: "GLM-5" },
        { id: "glm-4.5-flash", label: "GLM-4.5 Flash" },
      ];
    case "minimax":
      return [
        { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
        { id: "MiniMax-M3", label: "MiniMax M3 (1M)" },
        { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
        { id: "MiniMax-Text-01", label: "MiniMax Text 01" },
      ];
    case "xai":
      return [
        { id: "grok-3-mini", label: "Grok 3 Mini" },
        { id: "grok-4.5", label: "Grok 4.5" },
        { id: "grok-4.3", label: "Grok 4.3 (1M)" },
        { id: "grok-3", label: "Grok 3" },
      ];
    case "ollama":
      return [
        { id: "qwen2.5:7b", label: "Qwen2.5 7B" },
        { id: "qwen2.5:14b", label: "Qwen2.5 14B" },
        { id: "llama3.2:8b", label: "Llama 3.2 8B" },
        { id: "deepseek-r1:8b", label: "DeepSeek R1 8B" },
      ];
    case "custom":
      return [{ id: "default", label: "Default model" }];
    default:
      return [];
  }
}

/** Fetch models from an OpenAI-compatible `/models` endpoint.
 * Filters out embedding/tts/whisper models, keeps chat-capable ones. */
async function fetchOpenAICompatModels(baseURL, apiKey) {
  const url = baseURL.replace(/\/+$/u, "") + "/models";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  // Filter to chat-capable models — exclude embedding/tts/whisper/dall-e
  const chatModels = data
    .filter((m) => {
      const id = String(m?.id || "");
      if (/^(text-embedding|tts|whisper|dall-e|davinci|babbage|curie|ada)/iu.test(id)) return false;
      return true;
    })
    .map((m) => {
      const id = String(m.id);
      // Human-friendly label: strip date suffixes, capitalize
      const label = id
        .replace(/-(\d{4})(\d{2})(\d{2})$/u, "")
        .replace(/[-_]/gu, " ")
        .replace(/\b\w/gu, (c) => c.toUpperCase());
      return { id, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return chatModels.length > 0 ? chatModels : defaultModelsFor("openai");
}

/** Fetch models from Google's Generative Language API.
 * Returns chat-capable models (supports generateContent). */
async function fetchGoogleModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const models = Array.isArray(json?.models) ? json.models : [];
  const chatModels = models
    .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => {
      // name is "models/gemini-2.0-flash" → id is "gemini-2.0-flash"
      const id = String(m.name || "").replace(/^models\//u, "");
      const label = String(m.displayName || id).replace(/[-_]/gu, " ").replace(/\b\w/gu, (c) => c.toUpperCase());
      return { id, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return chatModels.length > 0 ? chatModels : defaultModelsFor("google");
}
