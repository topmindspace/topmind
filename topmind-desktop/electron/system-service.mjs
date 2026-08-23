/**
 * v4 SystemService — settings, paths, native operations, workspace management.
 * Settings routed through settings.mjs (safeStorage-encrypted + workspace history).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { shell, dialog, app } = require("electron");
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
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
  compareSemver,
  readBundledSkillsVersion,
  readBundledExtensionVersion,
  readBundledObsidianVersion,
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
import {
  getCompanionStatus,
  installSkillsToHost,
  uninstallSkillsFromHost,
  upgradeSkillsOnHost,
  prepareClipExtensionInstall,
  getClipExtensionManagedDir,
  uninstallClipExtension,
  installObsidianPlugin,
  uninstallObsidianPlugin,
  resolveEngineSkillsRoot,
} from "./lib/companion-lifecycle.mjs";
import {
  downloadCompanionAsset,
  cleanupDownloadTemp,
} from "./lib/companion-download.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import {
  parseModelsDevCatalog,
  parseOpenAICompatList,
  parseGoogleModelsList,
  mergeCatalogs,
  mergeOfficialDiskCache,
  shouldServeCache,
  shouldPersistCatalog,
  curatedModelsFor,
  providerLabel as catalogProviderLabel,
  MODELS_DEV_URL,
} from "./lib/model-catalog.mjs";

function secretAdapterFromCtx(ctx) {
  return ctx.secretAdapter || null;
}

// ── Two-source model catalog ────────────────────────────────────────────
// official list-models > models.dev community > curated defaults.
// Parse / merge / cache-honesty live in electron/lib/model-catalog.mjs
// (identical to engine lib/model-catalog.mjs — pack-safe, no ../../lib).

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
    // writebackMode is workspace behavior truth (topmind.yaml), not app-settings alone.
    // Mirror UI preference into Kernel contract when an active workspace exists.
    if (
      patch?.writebackMode !== undefined &&
      (patch.writebackMode === "auto" || patch.writebackMode === "confirm") &&
      ctx.workspaceRoot?.userWorkspaceRoot
    ) {
      try {
        await SystemService.updateWorkspaceConfig(
          { writebackMode: patch.writebackMode },
          ctx,
        );
      } catch (e) {
        logError("system", "mirror writebackMode to workspace contract failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
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
   * Multi-surface update check (Desktop + Skills pack + Clip Extension + Obsidian).
   *
   * Each surface is checked independently against remote GitHub releases.
   * The installed version (from companion lifecycle) is compared against
   * the latest remote version — not the bundled version — so inline-upgraded
   * companions correctly show "up to date".
   *
   * Desktop version is derived from installer asset names (topmind-X.Y.Z-*),
   * never from product tags like v1.0.0 (those are monorepo ship events).
   */
  async checkForUpdates(_p, ctx) {
    try {
      const engineRoot = ctx?.engineRoot || getEngineRoot() || null;
      const workspaceRoot = ctx?.workspaceRoot?.userWorkspaceRoot || null;
      const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || null;

      // Get installed companion versions (what's actually deployed on disk)
      // These take priority over bundled versions for update comparison.
      let skillsInstalled = null;
      let extensionInstalled = null;
      let obsidianInstalled = null;
      try {
        const companionStatus = await getCompanionStatus({
          workspaceRoot,
          engineRoot,
          desktopStateHome: desktopStateHome || undefined,
        });
        // Skills: pick the highest installed version across all agent hosts
        const agentHosts = companionStatus?.agents || [];
        const installedVersions = agentHosts
          .filter((a) => a.installed && a.installedVersion)
          .map((a) => String(a.installedVersion).replace(/^v/i, ""))
          .sort((a, b) => {
            // descending — highest first
            const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
            const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
            if (bMajor !== aMajor) return bMajor - aMajor;
            if (bMinor !== aMinor) return bMinor - aMinor;
            return bPatch - aPatch;
          });
        skillsInstalled = installedVersions[0] || null;
        // Clip extension (managed dir)
        extensionInstalled = companionStatus?.clip?.version || null;
        // Obsidian plugin (vault)
        obsidianInstalled = companionStatus?.obsidian?.pluginVersion || null;
      } catch {
        // Companion detection failure is non-fatal — fall back to bundled versions
      }

      const result = await checkAllSurfaces({
        currentVersion: readRunningAppVersion(),
        engineRoot,
        // Pass installed versions — checkAllSurfaces falls back to bundled
        // when these are null/undefined (e.g. companion not installed)
        skillsVersion: skillsInstalled || undefined,
        extensionVersion: extensionInstalled || undefined,
        obsidianVersion: obsidianInstalled || undefined,
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
        obsidian: {
          current: result.obsidian?.currentVersion,
          latest: result.obsidian?.latestVersion,
          reason: result.obsidian?.reason,
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
        obsidian: emptySurface("obsidian"),
        model: {
          desktopBundlesSkills: true,
          desktopBundlesUtr: true,
          extensionIsBrowser: true,
          obsidianIsVaultPlugin: true,
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
            : surface === "obsidian"
              ? check.obsidian
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
      title: ei18n("dialog.selectPluginFolder"),
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { path: null };
    return { path: result.filePaths[0] };
  },

  /** Native picker for a plugin zip archive. */
  async pickPluginZip(_p, _ctx) {
    const result = await dialog.showOpenDialog({
      title: ei18n("dialog.selectPluginZip"),
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
  async discoverModels(params, ctx) {
    const fp = ctx.workspaceStatePaths.settingsFilePath;
    const settings = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
      secretAdapter: secretAdapterFromCtx(ctx),
    });
    const status = getRuntimeStatus(settings);
    const cache = settings?.ai?.modelCache;
    const forceCommunity = params?.forceCommunity === true || params?.forceLive === true;
    // First paint: official disk + curated only — do not wait on models.dev.
    const skipCommunity = params?.skipCommunity === true && !forceCommunity;

    let community = [];
    if (skipCommunity) {
      community = modelsDevCache || [];
    } else {
      try {
        community = await this.fetchModelsDevCatalog({ forceLive: forceCommunity });
      } catch {
        community = [];
      }
    }

    const official = Array.isArray(cache?.catalog)
      ? cache.catalog.filter((c) => c && c.live === true && Array.isArray(c.models) && c.models.length > 0)
      : [];
    const curated = (status.providers || []).map((p) => ({
      id: p.source,
      label: providerLabel(p.source),
      models: defaultModelsFor(p.source),
      live: false,
      source: "curated",
    }));
    return mergeCatalogs({ official, community, curated });
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
    const now = Date.now();
    if (
      shouldServeCache({
        cache: modelsDevCache,
        fetchedAt: modelsDevCacheFetchedAt,
        now,
        ttlMs: MODELS_DEV_CACHE_TTL_MS,
        force: forceLive,
      })
    ) {
      return modelsDevCache;
    }

    try {
      const res = await fetch(MODELS_DEV_URL, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          "User-Agent": "topmind-desktop/1.4 (model catalog fetch)",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parsed = parseModelsDevCatalog(data);
      if (!parsed.ok || !shouldPersistCatalog(parsed.catalog, { fetchSucceeded: true, live: false })) {
        throw new Error(parsed.error || "empty community catalog");
      }
      modelsDevCache = parsed.catalog;
      modelsDevCacheFetchedAt = now;
      return parsed.catalog;
    } catch (err) {
      logError("system", "fetchModelsDevCatalog failed", { error: err.message });
      // Do not stamp fallback as a live cache. Retry next resolve / force refresh.
      return modelsDevCache || [];
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
        if (models.length > 0) {
          providers.push({ id: p.source, label: providerLabel(p.source), models, live: true, source: "official" });
        } else {
          providers.push({ id: p.source, label: providerLabel(p.source), models: [], live: false, error: "empty official list" });
        }
      } catch (err) {
        logError("system", "fetchLiveModels failed", { provider: p.source, error: err.message });
        providers.push({ id: p.source, label: providerLabel(p.source), models: [], live: false, error: err.message });
      }
    }

    // Google — returns { models: [{ name, displayName, supportedGenerationMethods }] }
    if (m.googleKey) {
      try {
        const models = await fetchGoogleModels(m.googleKey);
        if (models.length > 0) {
          providers.push({ id: "google", label: "Google", models, live: true, source: "official" });
        } else {
          providers.push({ id: "google", label: "Google", models: [], live: false, error: "empty official list" });
        }
      } catch (err) {
        logError("system", "fetchLiveModels failed", { provider: "google", error: err.message });
        providers.push({ id: "google", label: "Google", models: [], live: false, error: err.message });
      }
    }

    // Anthropic has no public list-models API — community/curated overlay happens in discoverModels.

    // Ollama — local OpenAI-compatible endpoint (no key required)
    const ollamaUrl = m.ollamaBaseUrl || "http://127.0.0.1:11434/v1";
    try {
      const ollamaModels = await fetchOpenAICompatModels(ollamaUrl, "ollama");
      if (ollamaModels.length > 0) {
        providers.push({ id: "ollama", label: "Ollama", models: ollamaModels, live: true, source: "official" });
      }
    } catch (err) {
      logError("system", "fetchLiveModels ollama skipped", { error: err.message });
    }

    // Persist only successful official entries. Keep prior good official on failure.
    try {
      const nextCache = mergeOfficialDiskCache(settings?.ai?.modelCache, providers);
      if (nextCache && shouldPersistCatalog(nextCache.catalog, { fetchSucceeded: true, live: true })) {
        await updateAppSettings(fp, settings, { ai: { modelCache: nextCache } }, {
          secretAdapter: secretAdapterFromCtx(ctx),
        });
        if (typeof ctx.updateAppSettingsInMemory === "function") {
          const updated = await loadAppSettings(fp, ctx.workspaceRoot?.userWorkspaceRoot || "", {
            secretAdapter: secretAdapterFromCtx(ctx),
          });
          ctx.updateAppSettingsInMemory(updated);
        }
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
      title: ei18n("dialog.selectWorkspace"),
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
    const { getSkillPrompts, resolvePromptLocale } = await import("./ai-prompts.mjs");
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
    // UI locale when set; otherwise zh default (slash seeds are short prompt seeds)
    const uiLoc = settings?.ui?.locale;
    const skillLocale = uiLoc && uiLoc !== "auto" ? resolvePromptLocale(uiLoc) : "zh";
    const skillPrompts = getSkillPrompts(skillLocale);
    const slashFallback = skillLocale === "en"
      ? (skillId) => `Follow skill ${skillId} (load_skill first).`
      : (skillId) => `请按 ${skillId} skill 执行（先 load_skill）。`;
    const slash = Object.entries(rt.SLASH_TO_SKILL).map(([cmd, skillId]) => {
      const key = skillId === "topmind" ? "topmind" : skillId.replace(/^topmind-/, "");
      return {
        command: cmd,
        skillId,
        prompt: skillPrompts[key] || slashFallback(skillId),
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
      title: ei18n("dialog.selectSkillsDir"),
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

  // ── Companion lifecycle (agent hosts · clip · obsidian) ─────────────────

  /**
   * Check if a companion surface has a newer version on GitHub than bundled.
   * Returns { latestVersion, tag, bundledVersion, needsDownload } when a newer
   * version is available; returns { needsDownload: false } when bundled is
   * current or the check fails (non-blocking — install proceeds from bundled).
   *
   * @private
   * @param {"skills"|"obsidian"|"extension"} surface
   * @param {string|null} engineRoot
   * @returns {Promise<{ needsDownload: boolean, latestVersion?: string, tag?: string, bundledVersion?: string|null }>}
   */
  async _checkLatestCompanion(surface, engineRoot) {
    const engineRootResolved = engineRoot || getEngineRoot() || null;
    let bundledVersion = null;
    if (surface === "skills") {
      bundledVersion = readBundledSkillsVersion({ engineRoot: engineRootResolved });
    } else if (surface === "obsidian") {
      bundledVersion = readBundledObsidianVersion({ engineRoot: engineRootResolved });
    } else if (surface === "extension") {
      bundledVersion = readBundledExtensionVersion({ engineRoot: engineRootResolved });
    }
    try {
      const updateResult = await checkAllSurfaces({
        currentVersion: readRunningAppVersion(),
        engineRoot: engineRootResolved,
      });
      const surfaceInfo = updateResult?.[surface];
      if (surfaceInfo?.updateAvailable && surfaceInfo?.latestVersion && surfaceInfo?.tagName) {
        const cmp = compareSemver(surfaceInfo.latestVersion, bundledVersion || "0.0.0");
        if (cmp > 0) {
          return {
            needsDownload: true,
            latestVersion: surfaceInfo.latestVersion,
            tag: surfaceInfo.tagName,
            bundledVersion,
          };
        }
      }
      return { needsDownload: false, bundledVersion };
    } catch {
      // Network/API failure is non-blocking — install from bundled
      logInfo("system", "companion latest check failed (non-blocking)", { surface });
      return { needsDownload: false, bundledVersion };
    }
  },

  /** System info: platform, arch, homebrew, node version for install guidance. */
  async getSystemInfo(_p, _ctx) {
    const platform = process.platform;
    const arch = process.arch;
    const home = os.homedir();
    let brewAvailable = false;
    if (platform === "darwin") {
      try {
        const { spawnSync } = require("node:child_process");
        const r = spawnSync("which", ["brew"], { encoding: "utf8", timeout: 3000 });
        brewAvailable = r.status === 0 && Boolean(r.stdout?.trim());
      } catch {
        /* not available */
      }
    }
    return {
      platform,
      arch,
      home,
      brewAvailable,
      nodeVersion: process.versions?.node || null,
      electronVersion: process.versions?.electron || null,
      platformLabel:
        platform === "darwin" ? "macOS"
        : platform === "win32" ? "Windows"
        : platform === "linux" ? "Linux"
        : platform,
      archLabel:
        arch === "arm64" ? "ARM64"
        : arch === "x64" ? "x64"
        : arch,
    };
  },

  /** Detect agent hosts, browsers, Obsidian + managed companion status. */
  async detectCompanions(_p, ctx) {
    return SystemService.getCompanionStatus(_p, ctx);
  },

  async getCompanionStatus(_p, ctx) {
    const engineRoot = ctx?.workspaceRoot?.engineRoot || getEngineRoot() || null;
    const workspaceRoot = ctx?.workspaceRoot?.userWorkspaceRoot || null;
    const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || null;
    const status = await getCompanionStatus({
      workspaceRoot,
      engineRoot,
      desktopStateHome: desktopStateHome || undefined,
    });
    return { ok: true, ...status };
  },

  /**
   * Install bundled skills pack into an agent host (claude-code, codex, …).
   * Pre-checks GitHub for a newer version; if available, downloads and installs
   * the latest instead of the stale bundled version.
   * @param {{ hostId: string, mode?: 'copy'|'symlink', dest?: string }} p
   */
  async installCompanionSkills({ hostId, mode, dest } = {}, ctx) {
    if (!hostId) throw new Error("hostId required");
    const engineRoot = ctx?.workspaceRoot?.engineRoot || getEngineRoot() || null;

    // Pre-check: is a newer skills version available on GitHub?
    const latest = await this._checkLatestCompanion("skills", engineRoot);
    if (latest.needsDownload) {
      logInfo("system", "skills: downloading latest (bundled is stale)", {
        bundled: latest.bundledVersion, latest: latest.latestVersion,
      });
      try {
        const dlResult = await downloadCompanionAsset({
          surface: "skills",
          version: latest.latestVersion,
          tag: latest.tag,
        });
        if (dlResult.ok) {
          try {
            const { installSkillsPackLocal } = await import("./lib/skills-extra.mjs");
            const localResult = await installSkillsPackLocal(dlResult.zipPath);
            // Also install to the agent host from the downloaded pack
            const hostResult = await installSkillsToHost({
              hostId,
              mode: mode === "symlink" ? "symlink" : "copy",
              dest: dest || undefined,
              sourceRoot: localResult.dest || dlResult.zipPath,
              engineRoot,
            });
            if (!hostResult.ok) throw new Error(hostResult.error || "skills install failed");
            logInfo("system", "companion skills installed (from latest download)", {
              hostId, dest: hostResult.dest, version: latest.latestVersion,
              source: "downloaded",
            });
            return { ...hostResult, source: "downloaded", downloadedVersion: latest.latestVersion };
          } finally {
            await cleanupDownloadTemp(dlResult.tempDir);
          }
        }
      } catch (err) {
        logError("system", "skills download+install failed, falling back to bundled", { error: err.message });
      }
    }

    // Fallback: install from bundled source
    const sourceRoot = resolveEngineSkillsRoot({ engineRoot });
    const result = await installSkillsToHost({
      hostId,
      mode: mode === "symlink" ? "symlink" : "copy",
      dest: dest || undefined,
      sourceRoot,
      engineRoot,
    });
    if (!result.ok) throw new Error(result.error || "skills install failed");
    logInfo("system", "companion skills installed", {
      hostId,
      dest: result.dest,
      version: result.version,
      source: latest.needsDownload ? "bundled-fallback" : "bundled",
    });
    return { ...result, source: "bundled" };
  },

  async uninstallCompanionSkills({ hostId, dest } = {}, _ctx) {
    if (!hostId) throw new Error("hostId required");
    const result = await uninstallSkillsFromHost({ hostId, dest: dest || undefined });
    if (!result.ok) throw new Error(result.error || "skills uninstall failed");
    logInfo("system", "companion skills uninstalled", { hostId, dest: result.dest });
    return result;
  },

  async upgradeCompanionSkills({ hostId, mode, dest } = {}, ctx) {
    if (!hostId) throw new Error("hostId required");
    const engineRoot = ctx?.workspaceRoot?.engineRoot || getEngineRoot() || null;

    // Pre-check: is a newer skills version available on GitHub?
    const latest = await this._checkLatestCompanion("skills", engineRoot);
    if (latest.needsDownload) {
      logInfo("system", "skills upgrade: downloading latest (bundled is stale)", {
        bundled: latest.bundledVersion, latest: latest.latestVersion,
      });
      try {
        const dlResult = await downloadCompanionAsset({
          surface: "skills",
          version: latest.latestVersion,
          tag: latest.tag,
        });
        if (dlResult.ok) {
          try {
            const { installSkillsPackLocal } = await import("./lib/skills-extra.mjs");
            const localResult = await installSkillsPackLocal(dlResult.zipPath);
            const hostResult = await upgradeSkillsOnHost({
              hostId,
              mode,
              dest: dest || undefined,
              sourceRoot: localResult.dest || dlResult.zipPath,
              engineRoot,
            });
            if (!hostResult.ok) throw new Error(hostResult.error || "skills upgrade failed");
            logInfo("system", "companion skills upgraded (from latest download)", {
              hostId, dest: hostResult.dest, version: latest.latestVersion,
              source: "downloaded",
            });
            return { ...hostResult, source: "downloaded", downloadedVersion: latest.latestVersion };
          } finally {
            await cleanupDownloadTemp(dlResult.tempDir);
          }
        }
      } catch (err) {
        logError("system", "skills download+upgrade failed, falling back to bundled", { error: err.message });
      }
    }

    // Fallback: upgrade from bundled source
    const sourceRoot = resolveEngineSkillsRoot({ engineRoot });
    const result = await upgradeSkillsOnHost({
      hostId,
      mode,
      dest: dest || undefined,
      sourceRoot,
      engineRoot,
    });
    if (!result.ok) throw new Error(result.error || "skills upgrade failed");
    logInfo("system", "companion skills upgraded", {
      hostId,
      dest: result.dest,
      version: result.version,
      source: "bundled",
    });
    return { ...result, source: "bundled" };
  },

  /**
   * Prepare Clip extension for guided load-unpacked (never silent Chrome install).
   * Pre-checks GitHub for a newer version; if available, downloads and installs
   * the latest instead of the stale bundled version.
   */
  async prepareClipExtension(_p, ctx) {
    const engineRoot = ctx?.workspaceRoot?.engineRoot || getEngineRoot() || null;
    const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || null;

    // Pre-check: is a newer extension version available on GitHub?
    const latest = await this._checkLatestCompanion("extension", engineRoot);
    if (latest.needsDownload) {
      logInfo("system", "extension: downloading latest (bundled is stale)", {
        bundled: latest.bundledVersion, latest: latest.latestVersion,
      });
      try {
        const dlResult = await downloadCompanionAsset({
          surface: "extension",
          version: latest.latestVersion,
          tag: latest.tag,
        });
        if (dlResult.ok) {
          try {
            const result = await prepareClipExtensionInstall({
              engineRoot,
              desktopStateHome: desktopStateHome || undefined,
              bundledZipPath: dlResult.zipPath,
            });
            if (!result.ok) throw new Error(result.error || "prepare clip extension failed");
            logInfo("system", "clip extension prepared (from latest download)", {
              path: result.path, version: result.version, source: "downloaded",
            });
            return { ...result, source: "downloaded", downloadedVersion: latest.latestVersion };
          } finally {
            await cleanupDownloadTemp(dlResult.tempDir);
          }
        }
      } catch (err) {
        logError("system", "extension download+prepare failed, falling back to bundled", { error: err.message });
      }
    }

    // Fallback: prepare from bundled source
    const result = await prepareClipExtensionInstall({
      engineRoot,
      desktopStateHome: desktopStateHome || undefined,
    });
    if (!result.ok) throw new Error(result.error || "prepare clip extension failed");
    logInfo("system", "clip extension prepared", {
      path: result.path, version: result.version, source: "bundled",
    });
    return { ...result, source: "bundled" };
  },

  /**
   * Uninstall (clean) the managed Clip extension directory.
   * Removes all contents but keeps the directory for re-prepare.
   */
  async uninstallClipExtension(_p, ctx) {
    const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || null;
    const result = await uninstallClipExtension({
      desktopStateHome: desktopStateHome || undefined,
    });
    logInfo("system", "clip extension uninstalled", { removed: result.removed.length });
    return result;
  },

  async openClipExtensionFolder(_p, ctx) {
    const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || null;
    const dir = getClipExtensionManagedDir({
      desktopStateHome: desktopStateHome || undefined,
    });
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true, path: dir };
  },

  /**
   * Install Obsidian plugin into vault (default: current workspace if .obsidian present).
   * Pre-checks GitHub for a newer version; if available, downloads and installs
   * the latest instead of the stale bundled version.
   *
   * Error handling: if download fails (network, verification, etc.), falls back
   * to bundled with a warning log. The returned `source` field indicates whether
   * the install came from "downloaded" or "bundled" so the UI can inform users.
   *
   * @param {{ vaultPath?: string }} [p]
   */
  async installObsidianPlugin({ vaultPath } = {}, ctx) {
    const engineRoot = ctx?.workspaceRoot?.engineRoot || getEngineRoot() || null;
    const vaultRoot =
      (vaultPath && String(vaultPath).trim()) ||
      ctx?.workspaceRoot?.userWorkspaceRoot ||
      null;

    // Pre-check: is a newer Obsidian plugin version available on GitHub?
    const latest = await this._checkLatestCompanion("obsidian", engineRoot);
    if (latest.needsDownload) {
      logInfo("system", "obsidian: downloading latest (bundled is stale)", {
        bundled: latest.bundledVersion, latest: latest.latestVersion,
      });
      try {
        const dlResult = await downloadCompanionAsset({
          surface: "obsidian",
          version: latest.latestVersion,
          tag: latest.tag,
        });
        if (!dlResult.ok) {
          logError("system", "obsidian download failed, falling back to bundled", {
            error: dlResult.error,
            bundled: latest.bundledVersion,
          });
        } else {
          try {
            const result = await installObsidianPlugin({
              vaultRoot,
              zipPath: dlResult.zipPath,
              engineRoot,
            });
            if (!result.ok) {
              logError("system", "obsidian install from download failed, falling back to bundled", {
                error: result.error,
              });
            } else {
              logInfo("system", "obsidian plugin installed (from latest download)", {
                version: result.version, pluginId: result.pluginId, path: result.path,
                source: "downloaded",
              });
              return { ...result, source: "downloaded", downloadedVersion: latest.latestVersion };
            }
          } finally {
            await cleanupDownloadTemp(dlResult.tempDir);
          }
        }
      } catch (err) {
        logError("system", "obsidian download+install failed, falling back to bundled", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logInfo("system", "obsidian: using bundled version (no newer release found)", {
        bundled: latest.bundledVersion,
      });
    }

    // Fallback: install from bundled source
    const result = await installObsidianPlugin({
      vaultRoot,
      engineRoot,
    });
    if (!result.ok) {
      if (result.guided) {
        return result;
      }
      throw new Error(result.error || "obsidian plugin install failed");
    }
    logInfo("system", "obsidian plugin installed", {
      path: result.path,
      version: result.version,
      source: "bundled",
    });
    return { ...result, source: "bundled" };
  },

  async uninstallObsidianPlugin({ vaultPath } = {}, ctx) {
    const vaultRoot =
      (vaultPath && String(vaultPath).trim()) ||
      ctx?.workspaceRoot?.userWorkspaceRoot ||
      null;
    const result = await uninstallObsidianPlugin({ vaultRoot });
    if (!result.ok) throw new Error(result.error || "obsidian plugin uninstall failed");
    logInfo("system", "obsidian plugin uninstalled", { removed: result.removed });
    return result;
  },

  /**
   * Export decrypted AI provider keys for the Obsidian plugin to import.
   *
   * Desktop stores keys encrypted via safeStorage; the Obsidian plugin cannot
   * decrypt them. This method writes a temporary plaintext JSON file that the
   * Obsidian plugin's "Import from Desktop" feature can read.
   *
   * The export file is:
   * - Written to desktopStateHome/obsidian-key-export.json
   * - Contains only AI provider keys + preference + model
   * - Overwritten on each call (no accumulation)
   * - User must explicitly trigger this from Settings → AI → Export
   *
   * @returns {{ ok: true, path: string, keyCount: number }}
   */
  async exportKeysForObsidian(_p, ctx) {
    const fp = ctx.workspaceStatePaths.settingsFilePath;
    const settings = await loadAppSettings(
      fp,
      ctx.workspaceRoot?.userWorkspaceRoot || "",
      { secretAdapter: secretAdapterFromCtx(ctx) },
    );
    const m = settings?.ai?.manual || {};
    const exportData = {
      source: "topmind-desktop",
      version: readRunningAppVersion(),
      exportedAt: new Date().toISOString(),
      ai: {
        sourcePreference: settings?.ai?.sourcePreference || "",
        defaultModel: settings?.ai?.defaultModel || null,
        manual: {
          openAiKey: m.openAiKey || "",
          anthropicKey: m.anthropicKey || "",
          googleKey: m.googleKey || "",
          deepseekKey: m.deepseekKey || "",
          moonshotKey: m.moonshotKey || "",
          zhipuKey: m.zhipuKey || "",
          minimaxKey: m.minimaxKey || "",
          xaiKey: m.xaiKey || "",
          customBaseUrl: m.customBaseUrl || "",
          customKey: m.customKey || "",
          ollamaBaseUrl: m.ollamaBaseUrl || "",
        },
      },
    };

    // Count non-empty keys
    const keyCount = Object.values(exportData.ai.manual).filter(
      (v) => typeof v === "string" && v.trim() !== "",
    ).length;

    if (keyCount === 0) {
      throw new Error("No AI provider keys configured in Desktop");
    }

    // Write to desktopStateHome/obsidian-key-export.json
    const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || path.join(os.homedir(), "topmind", "topmind-desktop", "state");
    const exportPath = path.join(desktopStateHome, "obsidian-key-export.json");
    await fs.mkdir(desktopStateHome, { recursive: true });
    await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), "utf8");

    logInfo("system", "keys exported for Obsidian", { path: exportPath, keyCount });
    return { ok: true, path: exportPath, keyCount };
  },

  // ── Inline companion download + install ──────────────────────────────
  // Download a newer companion package from GitHub Releases and install it
  // locally, replacing the bundled version. This enables upgrading Skills,
  // Obsidian plugin, or Clip extension without a full Desktop update.

  /**
   * Download a companion package from GitHub Releases.
   * @param {{ surface: 'skills'|'obsidian'|'extension', version: string, tag: string }} p
   */
  async downloadCompanion({ surface, version, tag } = {}, _ctx) {
    if (!surface || !version || !tag) {
      throw new Error("surface, version, and tag are required");
    }
    logInfo("system", "downloading companion", { surface, version, tag });
    const result = await downloadCompanionAsset({ surface, version, tag });
    if (!result.ok) {
      throw new Error(result.error || `download failed for ${surface}`);
    }
    logInfo("system", "companion downloaded", { surface, zipPath: result.zipPath });
    return {
      ok: true,
      surface,
      version,
      zipPath: result.zipPath,
      tempDir: result.tempDir,
    };
  },

  /**
   * Download and install a companion package in one step.
   * After install, the temp download is cleaned up.
   *
   * @param {{ surface: 'skills'|'obsidian'|'extension', version: string, tag: string, hostId?: string, vaultPath?: string }} p
   */
  async downloadAndInstallCompanion({ surface, version, tag, hostId, vaultPath } = {}, ctx) {
    if (!surface || !version || !tag) {
      throw new Error("surface, version, and tag are required");
    }

    logInfo("system", "download+install companion", { surface, version, tag, hostId, vaultPath });

    // Step 1: Download
    const dlResult = await downloadCompanionAsset({ surface, version, tag });
    if (!dlResult.ok) {
      throw new Error(dlResult.error || `download failed for ${surface}`);
    }

    try {
      // Step 2: Install based on surface type
      const zipPath = dlResult.zipPath;

      if (surface === "skills") {
        // Install skills pack from downloaded zip
        const { installSkillsPackLocal } = await import("./lib/skills-extra.mjs");
        const result = await installSkillsPackLocal(zipPath);
        if (!result.ok) {
          throw new Error(result.error || "skills install from zip failed");
        }

        // Also install to agent host if hostId specified
        if (hostId) {
          try {
            await installSkillsToHost({
              hostId,
              mode: "copy",
              sourceRoot: result.dest,
              engineRoot: ctx?.workspaceRoot?.engineRoot || getEngineRoot(),
            });
          } catch (err) {
            logError("system", "skills host install after download", { hostId, error: err.message });
          }
        }

        return {
          ok: true,
          surface: "skills",
          version,
          dest: result.dest,
          installed: result.installed,
        };
      }

      if (surface === "obsidian") {
        // Install Obsidian plugin from downloaded zip
        // CRITICAL: pass zipPath (not sourcePath) — installObsidianPlugin
        // resolves the source via resolveObsidianPluginSource which checks
        // opts.zipPath. A wrong property name silently falls back to the
        // bundled/monorepo version, defeating the inline upgrade.
        const vaultRoot =
          (vaultPath && String(vaultPath).trim()) ||
          ctx?.workspaceRoot?.userWorkspaceRoot ||
          null;
        const result = await installObsidianPlugin({
          vaultRoot,
          zipPath,
        });
        if (!result.ok) {
          throw new Error(result.error || "obsidian plugin install from zip failed");
        }
        logInfo("system", "obsidian plugin installed from download", {
          version, pluginId: result.pluginId, path: result.path,
        });
        return {
          ok: true,
          surface: "obsidian",
          version,
          path: result.path,
          pluginId: result.pluginId,
        };
      }

      if (surface === "extension") {
        // Clip extension: extract to managed dir
        // CRITICAL: pass bundledZipPath (not sourcePath) — prepareClipExtensionInstall
        // checks opts.bundledZipPath for the zip source. A wrong property name
        // silently falls back to the bundled/monorepo version.
        const desktopStateHome = ctx?.workspaceStatePaths?.desktopStateHome || null;
        const result = await prepareClipExtensionInstall({
          engineRoot: ctx?.workspaceRoot?.engineRoot || getEngineRoot(),
          desktopStateHome: desktopStateHome || undefined,
          bundledZipPath: zipPath,
        });
        if (!result.ok) {
          throw new Error(result.error || "clip extension install from zip failed");
        }
        logInfo("system", "clip extension installed from download", {
          version, path: result.path,
        });
        return {
          ok: true,
          surface: "extension",
          version,
          path: result.path,
        };
      }

      throw new Error(`unknown surface: ${surface}`);
    } finally {
      // Always clean up temp files
      if (dlResult.tempDir) {
        await cleanupDownloadTemp(dlResult.tempDir);
      }
    }
  },

  async getWorkspaceConfig(_p, ctx) {
    const defaultConfig = {
      contract_version: 4,
      categorySeparator: "-",
      template: "stream",
      stream: { packing: "weekly", appendHeading: "day", yearDir: true },
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
    } catch {
      categories = [];
    }
    // Project v4 nested memory (layers.global.file) to the UI's flat profileFile.
    // Reading config.memory.profileFile directly always missed custom names.
    try {
      const { loadKernelApi } = await import("./lib/kernel-api.mjs");
      const kernel = await loadKernelApi();
      if (typeof kernel.normalizeMemoryConfig === "function") {
        memory = kernel.normalizeMemoryConfig(config.memory || {});
      }
    } catch {
      const raw = config.memory || {};
      memory = {
        dir: typeof raw.dir === "string" ? raw.dir : null,
        profileFile: raw.layers?.global?.file || raw.profileFile || "profile.md",
        files: Array.isArray(raw.files) ? raw.files : [],
      };
    }
    return {
      contract_version: config.contract_version || 4,
      categorySeparator: config.workspace?.category_separator || defaultConfig.categorySeparator,
      template: config.workspace?.template || defaultConfig.template,
      stream: config.stream || stream,
      memory: {
        dir: memory.dir ?? null,
        profileFile: memory.profileFile || "profile.md",
        files: memory.files || [],
      },
      writebackMode: config.writeback?.mode || defaultConfig.writebackMode,
      views: config.presentation?.views || defaultConfig.views,
      connectorDefaults: config.ingest?.connectors || defaultConfig.connectorDefaults,
      categoryExtensions: config.categories?.extensions || {},
      categoryOverrides: config.categories?.overrides || {},
      categories,
    };
  },

  /**
   * Patch workspace behavior contract and write via Kernel only
   * (`writeContract` + `sanitizeContract`). Never surface-private yaml.dump —
   * that left flat aliases / camelCase keys and made on-disk repairable.
   */
  async updateWorkspaceConfig({ categorySeparator, template, views, connectorDefaults, stream, memory, writebackMode }, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    const resolvedRoot = ctx.workspaceRoot.userWorkspaceRoot;

    const { loadKernelApi } = await import("./lib/kernel-api.mjs");
    const kernel = await loadKernelApi();

    // Start from clean Kernel contract (v4 nested keys only)
    const base = kernel.loadContract(resolvedRoot) || kernel.buildDefaultContract();
    const next = {
      ...base,
      workspace: { ...(base.workspace || {}) },
      writeback: { ...(base.writeback || {}) },
      presentation: { ...(base.presentation || {}) },
      ingest: { ...(base.ingest || {}) },
      categories: {
        extensions: { ...(base.categories?.extensions || {}) },
        overrides: { ...(base.categories?.overrides || {}) },
      },
      stream: { ...(base.stream || {}) },
      memory: { ...(base.memory || {}) },
    };

    if (categorySeparator !== undefined) {
      if (categorySeparator !== "-" && categorySeparator !== " ") {
        throw new Error("Invalid separator. Only '-' or ' ' are allowed.");
      }
      next.workspace.category_separator = categorySeparator;
    }
    if (template !== undefined) {
      next.workspace.template = template;
    }
    if (views !== undefined) {
      next.presentation.views = views;
    }
    if (connectorDefaults !== undefined) {
      next.ingest.connectors = connectorDefaults;
    }
    if (stream !== undefined && stream && typeof stream === "object") {
      const prevPacking = next.stream?.packing || "weekly";
      const prevAppend =
        next.stream?.append_heading === "none" || next.stream?.append_heading === "day"
          ? next.stream.append_heading
          : next.stream?.appendHeading === "none" || next.stream?.appendHeading === "day"
            ? next.stream.appendHeading
            : "day";
      const packing = ["atom", "daily", "weekly", "monthly"].includes(stream.packing)
        ? stream.packing
        : prevPacking;
      // Accept camelCase from UI; persist snake_case for v4 YAML
      const appendRaw =
        stream.append_heading ?? stream.appendHeading ?? prevAppend;
      const appendHeading =
        appendRaw === "none" || appendRaw === "day" ? appendRaw : "day";
      // year_dir: explicit boolean wins; absent keeps the on-disk value (spread)
      const rawYearDir = stream.yearDir ?? stream.year_dir;
      // Spread the loaded stream section so unmanaged keys (year_dir,
      // default_view …) survive — replacing it wholesale used to silently
      // reset user preferences to contract defaults.
      next.stream = {
        ...next.stream,
        packing,
        append_heading: appendHeading,
        ...(typeof rawYearDir === "boolean" ? { year_dir: rawYearDir } : {}),
      };
    }
    if (memory !== undefined && memory && typeof memory === "object") {
      const prevLayers = next.memory?.layers || {};
      const files = Array.isArray(memory.files)
        ? memory.files
            .filter((f) => typeof f === "string" && f.trim())
            .map((f) => String(f).trim().replace(/^\/+/u, ""))
            .filter((f) => f.endsWith(".md") && !f.includes("/") && !f.includes(".."))
        : next.memory?.files || [];
      const profileFile =
        typeof memory.profileFile === "string" && memory.profileFile.trim()
          ? memory.profileFile.trim()
          : prevLayers.global?.file || "profile.md";
      const dir =
        memory.dir === null || memory.dir === ""
          ? "memory"
          : typeof memory.dir === "string"
            ? memory.dir
            : next.memory?.dir || "memory";
      next.memory = {
        // Spread loaded memory so unmanaged keys (files, future keys …) survive
        ...next.memory,
        dir,
        layers: {
          ...prevLayers,
          global: {
            ...(prevLayers.global || {}),
            file: profileFile,
            update: prevLayers.global?.update || "on-suggest",
          },
        },
        promotion: next.memory?.promotion,
        // files is Desktop UI convenience (nested under memory): an explicit
        // array (even empty) sets it; absent keeps the on-disk value via spread.
        ...(Array.isArray(memory.files) ? { files } : {}),
      };
    }
    if (writebackMode !== undefined) {
      if (!["auto", "confirm"].includes(writebackMode)) {
        throw new Error("Invalid writebackMode. Only 'auto' or 'confirm' are allowed.");
      }
      next.writeback.mode = writebackMode;
    }

    // Kernel sanitize strips unknown tops + fills defaults; writeContract is only write path
    const clean = kernel.sanitizeContract
      ? kernel.sanitizeContract(next)
      : next;
    kernel.writeContract(resolvedRoot, clean);
    await autoRepairWorkspace(resolvedRoot).catch(() => {});

    // Verify on-disk health (no silent lie)
    const inspection = kernel.inspectContract
      ? kernel.inspectContract(resolvedRoot)
      : { onDiskValid: true, state: "ok" };
    return {
      ok: inspection.onDiskValid !== false,
      onDiskValid: inspection.onDiskValid !== false,
      state: inspection.state || "ok",
      writebackMode: clean.writeback?.mode || next.writeback?.mode,
    };
  },

  /**
   * User recovery: backup corrupt topmind.yaml + reseed valid v4. Content dirs kept.
   */
  async reseedWorkspaceContract({ templateId, locale } = {}, ctx) {
    if (!ctx.workspaceRoot?.userWorkspaceRoot) throw new Error("No active workspace.");
    const root = ctx.workspaceRoot.userWorkspaceRoot;
    const { kernelReseedContract } = await import("./lib/kernel-api.mjs");
    const result = await kernelReseedContract(root, {
      templateId,
      locale,
    });
    // Clear unrepairable launch status when reseed succeeds so next boot is healthy
    if (result.onDiskValid === true && typeof ctx.clearContractLaunchFailure === "function") {
      ctx.clearContractLaunchFailure(root);
    } else if (result.onDiskValid === true && typeof ctx.activateWorkspace === "function") {
      // Re-activate to refresh launchStatus after successful reseed
      try {
        await ctx.activateWorkspace(root, { createIfMissing: false });
      } catch {
        /* non-fatal */
      }
    }
    return {
      ok: result.onDiskValid === true,
      status: result.status,
      backupPath: result.backupPath || null,
      onDiskValid: result.onDiskValid === true,
      errors: result.errors || [],
    };
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
      const { context, settings, launchStatus } = await ctx.activateWorkspace(resolved, {
        createIfMissing: allowCreate,
      });
      logInfo("system", "workspace switched", { to: context.userWorkspaceRoot });
      // Pass through contract health — do not invent ok when unrepairable
      const contractOk = launchStatus?.contractOnDiskValid !== false && launchStatus?.ok !== false;
      return {
        ok: contractOk,
        workspaceRoot: context.userWorkspaceRoot,
        settings: { ...settings, launchStatus: launchStatus || settings?.launchStatus },
        launchStatus: launchStatus || null,
        contractOnDiskValid: launchStatus?.contractOnDiskValid !== false,
        recovery: launchStatus?.recovery || null,
      };
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
  return catalogProviderLabel(source);
}

function defaultModelsFor(source) {
  return curatedModelsFor(source);
}

/** Fetch models from an OpenAI-compatible `/models` endpoint. */
async function fetchOpenAICompatModels(baseURL, apiKey) {
  const url = baseURL.replace(/\/+$/u, "") + "/models";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const parsed = parseOpenAICompatList(json);
  if (!parsed.ok) throw new Error(parsed.error || "invalid official list");
  return parsed.models;
}

/** Fetch models from Google's Generative Language API. */
async function fetchGoogleModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const parsed = parseGoogleModelsList(json);
  if (!parsed.ok) throw new Error(parsed.error || "invalid official list");
  return parsed.models;
}
