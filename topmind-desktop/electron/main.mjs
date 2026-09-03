/** v4 main.mjs — minimal Electron entry. RPC bridge + lifecycle. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { app, BrowserWindow, safeStorage, globalShortcut, dialog, protocol, net, nativeTheme } = require("electron");
import { resolveWindowsTitleBarOverlay, updateWindowsTitleBarOverlay, resolveWindowBackgroundColor } from "./lib/window-theme.mjs";
import {
  registerMediaSchemePrivileged,
  registerMediaProtocolHandler,
} from "./lib/media-protocol.mjs";

// Custom scheme for workspace images in the editor (must precede app.ready).
registerMediaSchemePrivileged({ protocol });
import { installApplicationMenu } from "./lib/app-menu.mjs";
import { setLocale as setElectronLocale, t as ei18n } from "./lib/electron-i18n.mjs";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveDesktopStateHome, resolveUserWorkspaceRoot, resolveWorkspaceStatePaths, ensureWorkspaceStructure, autoRepairWorkspace, setEngineRoot } from "./lib/workspace-home.mjs";
import { resolvetopmindRoot, detectUserWorkspaceRoot, resolveWorkspaceContext } from "./lib/path-model.mjs";
import { defaultEngineCandidate } from "./lib/engine-root.mjs";
import { registerRpcBridge, emitToRenderer } from "./rpc-bridge.mjs";
import { WorkspaceService } from "./workspace-service.mjs";
import { SystemService } from "./system-service.mjs";
import { AiService } from "./ai-service.mjs";
import { ToolService } from "./tool-service.mjs";
import { WereadService } from "./weread-service.mjs";
import { XService } from "./x-service.mjs";
import { IngestService } from "./ingest-service.mjs";
import { logInfo, logWarn, logError, attachFileLogger, getLogFilePath } from "./lib/writeback.mjs";
import { loadAppSettings, saveAppSettings, updateAppSettings } from "./settings.mjs";
import { closeWorkspaceWatcher, startWorkspaceWatcher, markIgnoredFileChanges } from "./watchers.mjs";
import { invalidateNotesIndex } from "./lib/notes-index.mjs";
import {
  normalizeStoredWorkspaceHistory,
  listLaunchCandidates,
  removeRecentWorkspace,
  touchRecentWorkspace,
  probeWorkspacePath,
  classifyWorkspaceRoot,
  resolveDefaultUserWorkspaceRootForSettings,
} from "./workspace-history.mjs";
import { isEphemeralBrowserWindow } from "./lib/ephemeral-windows.mjs";
import { isUtilityBrowserWindow } from "./lib/utility-windows.mjs";
import {
  openQuickCaptureWindow,
  closeQuickCaptureWindow,
  getQuickCaptureWindow,
} from "./lib/quick-capture-window.mjs";
import {
  ensureAppTray,
  destroyAppTray,
  notifyTrayHidden,
} from "./lib/app-tray.mjs";
import {
  syncClipBridgeFromSettings,
  stopClipBridge,
  generateClipToken,
} from "./lib/clip-bridge.mjs";
import {
  applyChromiumCompatibilityFlags,
  isLinux,
  isWin32,
  platformTag,
} from "./lib/platform.mjs";
import {
  applyAppIcon,
  applyWindowIcon,
  loadAppIconImage,
  appIconDebugInfo,
} from "./lib/app-icon.mjs";

// MUST run before app ready — Chromium flags are ignored after that.
// Covers Linux/ARM GPU, sandbox (AppImage / userns), and Wayland ozone.
const chromiumFlags = applyChromiumCompatibilityFlags(app);
if (!chromiumFlags.sandbox || !chromiumFlags.gpu) {
  // Use console before logging subsystem is fully wired; still useful in terminals / journal.
  console.warn(
    `[topmind] chromium flags platform=${platformTag()} sandbox=${chromiumFlags.sandbox} gpu=${chromiumFlags.gpu} ozone=${chromiumFlags.ozoneHint ?? "n/a"}`,
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Packaged: files live under app.asar; __dirname is …/app.asar/electron.
// Prefer app.getAppPath() after ready when available (same root as package.json main).
const appRoot = path.resolve(__dirname, "..");
const desktopStateHome = resolveDesktopStateHome();
// File log early — Windows GUI installers have no console; this is the support surface.
const mainLogPath = path.join(desktopStateHome, "logs", "main.log");
attachFileLogger(mainLogPath);
const defaultWsRoot = resolveUserWorkspaceRoot();
let defaultEngine = null, currentCtx = null, mainWindow = null, appSettings = null, launchStatus = null;
let windowCreating = false; // Guard against concurrent createWindow calls (activate + whenReady race)
/** True when app is intentionally quitting (menu Quit / before-quit). */
let isQuitting = false;
let aiStreamingActive = false; // Track AI streaming state for dock badge management
let bootErrorShown = false;

function showBootError(title, detail) {
  const message = String(detail || "Unknown error");
  logError("main", title, { error: message, logFile: getLogFilePath() });
  // dialog needs app ready on some platforms; swallow if too early.
  try {
    if (app.isReady()) {
      dialog.showErrorBox(
        title,
        `${message}\n\nLog: ${getLogFilePath() || "(no log file)"}\nPlatform: ${platformTag()}\nPackaged: ${app.isPackaged}`,
      );
    } else {
      app.whenReady().then(() => {
        if (bootErrorShown) return;
        bootErrorShown = true;
        dialog.showErrorBox(
          title,
          `${message}\n\nLog: ${getLogFilePath() || "(no log file)"}\nPlatform: ${platformTag()}`,
        );
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

// Surface crashes that would otherwise be silent on Windows GUI builds.
process.on("uncaughtException", (err) => {
  showBootError(
    "topmind crashed (uncaughtException)",
    err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err),
  );
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack || ""}` : String(reason);
  showBootError("topmind crashed (unhandledRejection)", msg);
});

const settingsAdapter = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (v) => safeStorage.encryptString(v).toString("base64"),
  decryptString: (v) => safeStorage.decryptString(Buffer.from(v, "base64")),
};

function statePaths(wsRoot) { return resolveWorkspaceStatePaths(desktopStateHome, wsRoot || defaultWsRoot); }
function settingsFile() { return statePaths().settingsFilePath; }

const services = {
  workspace: WorkspaceService,
  system: SystemService,
  ai: AiService,
  tool: ToolService,
  weread: WereadService,
  x: XService,
  ingest: IngestService,
};

// Shared context for all RPC handlers. `emit` is bound to the main window so
// AiService.invoke (and any future streaming endpoint) can push events to the
// renderer through the unified event bus without special-casing in rpc-bridge.
// `secretAdapter` lets SystemService read/write encrypted settings.
function getContext() {
  return {
    workspaceRoot: currentCtx,
    engineRoot: currentCtx?.engineRoot ?? defaultEngine,
    workspaceStatePaths: statePaths(currentCtx?.userWorkspaceRoot),
    appSettings,
    secretAdapter: settingsAdapter,
    /** Soft-suppress chokidar echo after intentional path writes */
    markIgnoredFileChanges,
    launchDefaults: launchStatus ? { launchStatus } : undefined,
    /** Open workspace (opts.createIfMissing for new/empty folders). */
    activateWorkspace: (candidate, opts) => activateWorkspace(candidate, opts),
    /** After successful reseed: mark launch healthy without full re-open. */
    clearContractLaunchFailure: (rootPath) => {
      launchStatus = {
        ok: true,
        reason: null,
        requestedPath: rootPath || currentCtx?.userWorkspaceRoot || null,
        errorMessage: null,
        contractOnDiskValid: true,
        contractStatus: "reseeded",
        contractErrors: [],
        recovery: null,
      };
      return launchStatus;
    },
    /** UI zoom step — apply to the main window and persist under window.uiZoom. */
    setUiZoom: async (mode) => {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      if (!win) return { ok: false, error: "no-window" };
      const current = win.webContents.getZoomFactor();
      let next;
      if (mode === "reset") next = 1;
      else if (mode === "in") next = Math.min(2, Math.round(current * 1.1 * 100) / 100);
      else if (mode === "out") next = Math.max(0.75, Math.round((current / 1.1) * 100) / 100);
      else return { ok: false, error: "invalid-mode" };
      win.webContents.setZoomFactor(next);
      const latest = await loadAppSettings(
        settingsFile(),
        appSettings?.workspaceRoot || defaultWsRoot,
        { secretAdapter: settingsAdapter },
      );
      appSettings = await updateAppSettings(
        settingsFile(), latest, { window: { uiZoom: next } }, { secretAdapter: settingsAdapter },
      );
      return { ok: true, factor: next };
    },
    /** Return to landing: stop watcher, clear live ctx, keep recents. */
    closeWorkspace: async () => {
      await closeWorkspaceWatcher();
      currentCtx = null;
      // Keep recents; clear active root so boot does not re-open automatically
      // as "persisted non-default" if user only wanted landing.
      if (appSettings) {
        appSettings = {
          ...appSettings,
          workspaceRoot: "",
        };
        await saveAppSettings(settingsFile(), appSettings, { secretAdapter: settingsAdapter }).catch(() => {});
      }
      launchStatus = {
        ok: false,
        reason: "closed",
        requestedPath: null,
        errorMessage: null,
      };
      logInfo("main", "workspace closed → landing");
      return { ok: true, settings: appSettings };
    },
    /** Drop a path from recents (missing / user dismiss). */
    removeRecentWorkspace: async (rootPath) => {
      const next = await dropRecentAndPersist(rootPath);
      return { ok: true, settings: next };
    },
    // CRITICAL: SystemService.updateSettings must call this to keep the
    // in-memory appSettings in sync. Without it, the window-bounds persist
    // function would save stale settings (with empty API keys) and
    // overwrite the user's freshly-saved keys on the next resize.
    updateAppSettingsInMemory: (next) => {
      appSettings = next;
      if (process.platform === "win32") {
        updateWindowsTitleBarOverlay(mainWindow, next?.theme, 40);
        const qWin = getQuickCaptureWindow();
        if (qWin && !qWin.isDestroyed()) {
          updateWindowsTitleBarOverlay(qWin, next?.theme, 36);
        }
      }
    },
    emit: (event, payload) => {
      emitToRenderer(mainWindow, event, payload);
      // macOS dock badge: show ● during AI streaming, clear on done.
      // The "done" status is always emitted (including error/abort paths)
      // because ai-stream.mjs emits it in its finally block.
      if (event === "ai:stream" && payload?.type === "status") {
        if (payload.status === "preparing" && !aiStreamingActive) {
          aiStreamingActive = true;
          if (app.dock) app.dock.setBadge("●");
        } else if (payload.status === "done" && aiStreamingActive) {
          aiStreamingActive = false;
          if (app.dock) app.dock.setBadge("");
        }
      }
    },
    /** Open floating / overlay capture (settings.capture.globalMode). */
    openCaptureSurface: (opts) => openCaptureSurface(opts || {}),
    /** Focus main window and open Knowledge Ingest hub (from float capture). */
    openIngestHub: () => {
      showMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        emitToRenderer(mainWindow, "navigate:select", {
          kind: "connector",
          id: "ingest",
        });
        emitToRenderer(mainWindow, "ingest:queue-changed", {});
      }
      return { ok: true };
    },
    closeQuickCaptureWindow: () => {
      closeQuickCaptureWindow();
      return { ok: true };
    },
    getQuickCaptureWindowId: () => {
      const w = getQuickCaptureWindow();
      return { id: w && !w.isDestroyed() ? w.id : null };
    },
    /** Start/stop browser Clip Bridge from settings. */
    syncClipBridge: async (settings) => {
      const s = settings || appSettings;
      if (!s) return;
      let next = s;
      if (next.clipBridge?.enabled && !next.clipBridge?.token) {
        next = {
          ...next,
          clipBridge: { ...next.clipBridge, token: generateClipToken() },
        };
        appSettings = next;
        await saveAppSettings(settingsFile(), next, { secretAdapter: settingsAdapter }).catch(() => {});
      }
      return syncClipBridgeFromSettings(next, {
        getContext: () => getContext(),
        ingest: (p, c) => WorkspaceService.ingestInbox(p, c),
        listDestinations: async (c) => {
          const { categories = [] } = await WorkspaceService.listCategories(
            { includeHidden: false },
            c,
          );
          const slimCats = (categories || [])
            .filter((cat) => cat.role !== "buffer" && cat.role !== "system" && cat.role !== "delivery")
            .map((cat) => ({
              id: cat.directory || cat.name,
              name: cat.directory || cat.name,
              role: cat.role || "deep-work",
            }));
          /** @type {{ id: string, name: string, category: string, mtime?: string }[]} */
          const topics = [];
          for (const cat of slimCats.slice(0, 24)) {
            try {
              const { topics: tlist = [] } = await WorkspaceService.listTopics(
                { category: cat.id },
                c,
              );
              for (const t of tlist) {
                topics.push({
                  id: t.id,
                  name: t.name,
                  category: cat.id,
                  mtime: t.mtime,
                });
              }
            } catch {
              /* skip cat */
            }
          }
          topics.sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));
          return {
            inbox: true,
            categories: slimCats,
            topics: topics.slice(0, 60),
          };
        },
        emit: (event, payload) => emitToRenderer(mainWindow, event, payload),
      });
    },
  };
}

// Resolve a workspace candidate, make it the live context, persist it to
// settings + recents, and (re)start the file watcher. Shared by first launch
// (initApp) and runtime switching (SystemService.switchWorkspace) so the main
// process context and the renderer never drift apart.
/**
 * Open a workspace root as the live context.
 * @param {string|object} candidate path string or context-like
 * @param {{ createIfMissing?: boolean }} [opts]
 *   createIfMissing — only for explicit "新建/选择空文件夹". Recents open with false.
 */
async function activateWorkspace(candidate, opts = {}) {
  const createIfMissing = opts.createIfMissing === true;
  const bootstrapRoot =
    typeof candidate === "string"
      ? candidate
      : candidate?.userWorkspaceRoot || candidate?.rootPath || null;
  if (!bootstrapRoot) {
    throw new Error(ei18n("workspace.missingPath"));
  }
  const resolved = path.resolve(bootstrapRoot);
  const classified = await classifyWorkspaceRoot(resolved, { engineRoot: defaultEngine });
  if (!classified.ok) {
    if (classified.status === "missing" && createIfMissing) {
      // fall through — ensureWorkspaceStructure will mkdir
    } else {
      const err = new Error(classified.message || ei18n("workspace.openFail", { resolved }));
      err.code = classified.status;
      err.path = classified.path || resolved;
      throw err;
    }
  }
  const openRoot = classified.path || resolved;

  // Structure + Kernel ensureContract (separator migration, required roles).
  // Must surface contract health — never claim launch healthy while on-disk YAML is corrupt.
  let ensureResult = {
    root: openRoot,
    contractOnDiskValid: true,
    contractStatus: "unknown",
    contractErrors: [],
    recovery: null,
  };
  try {
    ensureResult = await ensureWorkspaceStructure(openRoot);
  } catch (err) {
    logWarn("main", "ensureWorkspaceStructure on activate failed", {
      path: openRoot,
      error: err instanceof Error ? err.message : String(err),
    });
    ensureResult = {
      root: openRoot,
      contractOnDiskValid: false,
      contractStatus: "unknown",
      contractErrors: [err instanceof Error ? err.message : String(err)],
      recovery: "system.reseedWorkspaceContract",
    };
  }

  const context = await resolveWorkspaceContext(openRoot, { engineRoot: defaultEngine });
  if (context?.engineRoot) setEngineRoot(context.engineRoot);
  currentCtx = context;

  // Hydrate app-settings writebackMode FROM workspace contract (display cache only).
  // Kernel durable writes never prefer app-settings over topmind.yaml.
  let workspaceWritebackMode;
  try {
    const { loadKernelApi } = await import("./lib/kernel-api.mjs");
    const kernel = await loadKernelApi();
    const contract = kernel.loadContract(context.userWorkspaceRoot);
    const mode = contract?.writeback?.mode;
    if (mode === "auto" || mode === "confirm") workspaceWritebackMode = mode;
  } catch {
    /* ignore */
  }

  // Merge recents via touchRecentWorkspace semantics in settings merge
  const settingsPatch = {
    workspaceRoot: context.userWorkspaceRoot,
    workspaces: {
      recent: [{ rootPath: context.userWorkspaceRoot, lastOpenedAt: new Date().toISOString() }],
    },
  };
  if (workspaceWritebackMode) {
    settingsPatch.writebackMode = workspaceWritebackMode;
  }
  appSettings = await updateAppSettings(
    settingsFile(),
    appSettings,
    settingsPatch,
    { secretAdapter: settingsAdapter },
  );
  // Keep in-memory shape consistent even if disk merge reordered
  appSettings = touchRecentWorkspace(appSettings, context.userWorkspaceRoot);

  const contractOk = ensureResult?.contractOnDiskValid !== false;
  if (contractOk) {
    launchStatus = {
      ok: true,
      reason: null,
      requestedPath: context.userWorkspaceRoot,
      errorMessage: null,
      contractOnDiskValid: true,
      contractStatus: ensureResult?.contractStatus || "ok",
      contractErrors: [],
      recovery: null,
    };
  } else {
    // Unrepairable contract: do not claim healthy open. User must reseed (content kept).
    const errMsg =
      (Array.isArray(ensureResult?.contractErrors) && ensureResult.contractErrors[0]) ||
      "topmind.yaml is unrepairable — reseed workspace contract (backs up bad file; content dirs kept)";
    launchStatus = {
      ok: false,
      reason: "contract-unrepairable",
      requestedPath: context.userWorkspaceRoot,
      errorMessage: errMsg,
      contractOnDiskValid: false,
      contractStatus: ensureResult?.contractStatus || "unrepairable",
      contractErrors: ensureResult?.contractErrors || [],
      recovery: ensureResult?.recovery || "system.reseedWorkspaceContract",
    };
    logWarn("main", "workspace contract unrepairable on activate", {
      path: context.userWorkspaceRoot,
      status: launchStatus.contractStatus,
      errors: launchStatus.contractErrors,
    });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    await closeWorkspaceWatcher();
    await startWorkspaceWatcher(context, (p) => {
      try { invalidateNotesIndex(p?.relativePath); } catch { /* ignore */ }
      emitToRenderer(mainWindow, "workspace:file-changed", p);
    });
  }
  if (appSettings?.clipBridge?.enabled) {
    try {
      await getContext().syncClipBridge(appSettings);
    } catch (e) {
      logWarn("main", "clip bridge after workspace activate", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { context, settings: appSettings, launchStatus, ensureResult };
}

/** Persist pruned settings after removing a bad recent path. */
async function persistSettingsAfterHistoryChange(nextSettings) {
  appSettings = nextSettings;
  await saveAppSettings(settingsFile(), appSettings, { secretAdapter: settingsAdapter }).catch((err) => {
    logWarn("main", "persist settings after history change failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return appSettings;
}

async function dropRecentAndPersist(rootPath) {
  const next = removeRecentWorkspace(appSettings || {}, rootPath);
  return persistSettingsAfterHistoryChange(next);
}

// Single RPC channel — registerRpcBridge dispatches `service.method(params, ctx)`.
// AiService.invoke reads `ctx.emit` for streaming; no inline handler needed.
registerRpcBridge(services, getContext);

async function initApp() {
  const engineCandidate = defaultEngineCandidate();
  logInfo("main", "resolving engine", {
    candidate: engineCandidate,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath || null,
  });
  try {
    defaultEngine = await resolvetopmindRoot(engineCandidate);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("main", "engine root invalid", {
      candidate: engineCandidate,
      error: msg,
      hint: "Packaged builds need resources/topmind-engine (npm run pack:prepare).",
    });
    // Last resort: still set candidate so UI can show diagnostics; templates may fail.
    defaultEngine = engineCandidate;
    launchStatus = {
      ok: false,
      reason: "invalid-engine",
      requestedPath: engineCandidate,
      errorMessage: msg,
    };
  }
  setEngineRoot(defaultEngine);
  // Default *path hints* only (not auto-opened / not mkdir'd here):
  //   content: ~/topmind/topmind-workspace
  //   state:   ~/topmind/topmind-desktop
  const defRoot = await resolveDefaultUserWorkspaceRootForSettings(defaultWsRoot, defaultEngine);
  appSettings = await loadAppSettings(settingsFile(), defRoot, { secretAdapter: settingsAdapter });

  // Set Electron main-process locale from settings (for menus, tray, notifications)
  setElectronLocale(appSettings?.ui?.locale || "auto");

  // Prune missing / unreadable recents before picking a launch candidate
  const norm = await normalizeStoredWorkspaceHistory(appSettings, defaultEngine, { pruneMissing: true });
  appSettings = norm.settings;
  if (norm.changed || (norm.removed && norm.removed.length)) {
    await saveAppSettings(settingsFile(), appSettings, { secretAdapter: settingsAdapter });
    if (norm.removed?.length) {
      logInfo("main", "pruned unavailable workspaces from recents", {
        count: norm.removed.length,
        paths: norm.removed.map((r) => r.rootPath),
      });
    }
  }

  // Try candidates in order until one opens; drop failures from recents.
  // Never invent defRoot. No success → landing.
  const launchRoot = await resolveLaunchRoot(process.argv.slice(1));
  const candidates = listLaunchCandidates({
    launchWorkspaceRoot: launchRoot,
    settings: appSettings,
    defaultUserWorkspaceRoot: defRoot,
  });

  if (!candidates.length) {
    currentCtx = null;
    launchStatus = {
      ok: false,
      reason: "no-workspace",
      requestedPath: null,
      errorMessage: null,
    };
    logInfo("main", "no launch candidate → landing");
    return;
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      // Recents / restore: do not create missing folders
      await activateWorkspace(candidate, { createIfMissing: false });
      logInfo("main", "workspace activated", { path: candidate });
      return;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const code = e && typeof e === "object" && "code" in e ? e.code : "";
      logWarn("main", "workspace candidate failed — drop from recents if missing", {
        path: candidate,
        error: msg,
        code,
      });
      // Always remove from recents when open fails (missing or broken)
      await dropRecentAndPersist(candidate);
    }
  }

  currentCtx = null;
  launchStatus = {
    ok: false,
    reason: lastError ? "invalid-workspace" : "no-workspace",
    requestedPath: candidates[0] || null,
    errorMessage: lastError instanceof Error ? lastError.message : lastError ? String(lastError) : null,
  };
  logInfo("main", "all candidates failed → landing", {
    tried: candidates.length,
    error: launchStatus.errorMessage,
  });
}

async function resolveLaunchRoot(argv) {
  for (const a of argv) {
    const c = String(a || "").trim();
    if (!c || c.startsWith("-")) continue;
    const resolved = path.resolve(c);
    // Prefer the path itself when it already exists as a directory (user folder).
    // Only fall back to detectUserWorkspaceRoot for engine/monorepo discovery.
    try {
      const probe = await probeWorkspacePath(resolved);
      if (probe.ok) return probe.path;
    } catch {
      /* continue */
    }
    try {
      return await detectUserWorkspaceRoot(resolved, { engineRoot: defaultEngine });
    } catch {
      /* try next arg */
    }
  }
  return null;
}

/** @returns {import('electron').NativeImage | null} */
function applyBrandingIcon() {
  const packaged = app.isPackaged;
  const img = applyAppIcon(app, { packaged });
  if (!img) {
    logWarn("main", "app icon missing — Dock/taskbar may show Electron default", {
      packaged,
      ...appIconDebugInfo({ packaged, forDock: process.platform === "darwin" }),
    });
    return null;
  }
  // Log the Dock-safe path on mac (PNG plate), not a generic resolve that might list .icns
  const loaded = loadAppIconImage({
    packaged,
    forDock: process.platform === "darwin",
    platform: process.platform,
  });
  logInfo("main", "app icon applied", {
    path: loaded?.path,
    packaged,
    platform: process.platform,
    size: img.getSize?.() || null,
    empty: img.isEmpty?.() || false,
  });
  return img;
}

async function createWindow() {
  // Guard against concurrent calls — on macOS, `activate` can fire during
  // `whenReady` → `initApp()` before the first window is created, causing a
  // race that opens two windows. The flag ensures only one creation path wins.
  if (windowCreating || (mainWindow && !mainWindow.isDestroyed())) return mainWindow;
  windowCreating = true;
  try {
    const stored = appSettings?.window || {};
    // Single chrome layer:
    //   macOS  → hiddenInset (traffic lights in custom titlebar)
    //   Windows → hidden + titleBarOverlay (native caption buttons on our bar — no double header)
    //   Linux  → default frame (overlay support varies by DE)
    const isWin = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const titleBarStyle = isMac ? "hiddenInset" : isWin ? "hidden" : "default";
    // Window icon: Win/Linux taskbar of the running window; harmless on mac (Dock separate).
    // Packaged Windows also needs the .exe icon embedded (patch-win-exe-icon) for pins/Start Menu.
    const loadedIcon = loadAppIconImage({ packaged: app.isPackaged });
    const windowIcon = loadedIcon?.img || null;
    const win = new BrowserWindow({
      width: stored.bounds?.width ?? 1440, height: stored.bounds?.height ?? 980,
      minWidth: 1180, minHeight: 760, backgroundColor: resolveWindowBackgroundColor(stored.theme), title: "topmind",
      titleBarStyle,
      // Custom titlebar chrome: no File/Edit strip on Win/Linux (mac keeps minimal menu)
      autoHideMenuBar: process.platform !== "darwin",
      ...(isWin
        ? {
            titleBarOverlay: resolveWindowsTitleBarOverlay(stored.theme, 40),
          }
        : {}),
      ...(windowIcon ? { icon: windowIcon } : {}),
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
    });
    // Re-assert after construction (some Windows shells ignore ctor icon until setIcon).
    applyWindowIcon(win, windowIcon, { packaged: app.isPackaged });
    if (stored.isMaximized) win.maximize();
    // Persisted UI zoom (Ctrl +/-/0 on Win/Linux; the macOS menu owns its own zoom)
    if (typeof stored.uiZoom === "number" && stored.uiZoom !== 1) {
      win.webContents.setZoomFactor(stored.uiZoom);
    }

    if (isWin) {
      nativeTheme.on("updated", () => {
        if (win && !win.isDestroyed()) {
          updateWindowsTitleBarOverlay(win, appSettings?.theme, 40);
        }
        const qWin = getQuickCaptureWindow();
        if (qWin && !qWin.isDestroyed()) {
          updateWindowsTitleBarOverlay(qWin, appSettings?.theme, 36);
        }
      });
    }

    const devUrl = process.env.topmind_DESKTOP_DEV_SERVER_URL;

    // Prevent: deny all popups + navigations. Without setWindowOpenHandler,
    // any renderer side-effect that triggers a popup (HMR reload during AI
    // streaming, accidental window.open, link with target=_blank) would
    // create a new BrowserWindow. Combined with macOS 'activate' race on
    // renderer crash, this caused the "AI 对话触发多窗口" bug.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => {
      // Allow same-origin reloads (vite HMR, window.location.reload on
      // workspace switch); block everything else.
      const target = e.url;
      const isDevSelf = Boolean(devUrl) && target.startsWith(devUrl);
      const isFileSelf = target.startsWith("file://") && target.endsWith("/index.html");
      if (!isDevSelf && !isFileSelf) e.preventDefault();
    });

    // Monitor renderer process health — crashes during AI streaming
    // (OOM, uncaught exceptions, GPU hang) are logged with diagnostic
    // detail so the root cause can be correlated with window creation.
    win.webContents.on("render-process-gone", (_event, details) => {
      logError("main", "render-process-gone", {
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });

    let saveTimer;
    const persist = async () => {
      try {
        if (win.isDestroyed()) return;
        // Reload from disk to get the latest settings (including any AI keys
        // saved by SystemService.updateSettings since the last window-bounds
        // save). This prevents stale in-memory appSettings from overwriting
        // freshly-saved API keys.
        const latest = await loadAppSettings(settingsFile(), appSettings?.workspaceRoot || defaultWsRoot, { secretAdapter: settingsAdapter });
        // Re-check after async gap — window can be destroyed during the await.
        if (win.isDestroyed()) return;
        appSettings = await updateAppSettings(settingsFile(), latest, { window: { bounds: win.getNormalBounds(), isMaximized: win.isMaximized() } }, { secretAdapter: settingsAdapter });
      } catch (err) {
        // Defensive: persist failure during window destruction is harmless.
        if (!win.isDestroyed()) logWarn("main", "window bounds persist failed", { error: err.message });
      }
    };
    win.on("resize", () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); });
    win.on("move", () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); });
    win.on("close", (e) => {
      clearTimeout(saveTimer);
      void persist();
      // Quit path (menu Quit / app.quit) sets isQuitting — allow close.
      if (isQuitting) return;
      const behavior = appSettings?.ui?.closeBehavior || "ask";
      if (behavior === "quit") return;
      if (behavior === "hide") {
        e.preventDefault();
        hideMainWindowToTray();
        return;
      }
      // ask — prompt once; optional "remember"
      e.preventDefault();
      void (async () => {
        try {
          const hideLabel =
            process.platform === "darwin"
              ? ei18n("window.hideMac")
              : process.platform === "win32"
                ? ei18n("window.hideTray")
                : ei18n("window.hideOther");
          const detail =
            process.platform === "win32"
              ? ei18n("window.hideTrayHint")
              : process.platform === "darwin"
                ? ei18n("window.hideMacHint")
                : ei18n("window.hideOtherHint");
          const { response, checkboxChecked } = await dialog.showMessageBox(win, {
            type: "question",
            buttons: [hideLabel, ei18n("window.quit"), ei18n("window.cancel")],
            defaultId: 0,
            cancelId: 2,
            title: ei18n("window.closeTitle"),
            message: ei18n("window.closeMessage"),
            detail,
            checkboxLabel: ei18n("window.rememberChoice"),
            checkboxChecked: false,
          });
          if (response === 2) return;
          const choice = response === 1 ? "quit" : "hide";
          if (checkboxChecked) {
            try {
              const latest = await loadAppSettings(
                settingsFile(),
                appSettings?.workspaceRoot || defaultWsRoot,
                { secretAdapter: settingsAdapter },
              );
              appSettings = await updateAppSettings(
                settingsFile(),
                latest,
                { ui: { ...(latest.ui || {}), closeBehavior: choice } },
                { secretAdapter: settingsAdapter },
              );
            } catch (err) {
              logWarn("main", "persist closeBehavior failed", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          if (choice === "quit") {
            isQuitting = true;
            app.quit();
          } else if (!win.isDestroyed()) {
            hideMainWindowToTray();
          }
        } catch (err) {
          logWarn("main", "close prompt failed — quitting", {
            error: err instanceof Error ? err.message : String(err),
          });
          isQuitting = true;
          app.quit();
        }
      })();
    });

    if (devUrl) { await win.loadURL(devUrl); }
    else { await win.loadFile(path.join(appRoot, "dist", "index.html")); }
    mainWindow = win;
    // Re-assert branding after first paint (Dock on mac; taskbar icon on win/linux).
    applyBrandingIcon();
    applyWindowIcon(win, windowIcon, { packaged: app.isPackaged });
    if (currentCtx) {
      await startWorkspaceWatcher(currentCtx, (p) => {
        try { invalidateNotesIndex(p?.relativePath); } catch { /* ignore */ }
        emitToRenderer(win, "workspace:file-changed", p);
      });
    }
    return win;
  } finally {
    windowCreating = false;
  }
}

/**
 * Resolve renderer load URL for main / utility windows (dev server or file).
 */
function getRendererLoadUrl() {
  const devUrl = process.env.topmind_DESKTOP_DEV_SERVER_URL;
  if (devUrl) return devUrl.replace(/\/?$/u, "/");
  return `file://${path.join(appRoot, "dist", "index.html")}`;
}

/** Show / focus main window (from tray or second-instance). */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  ensureTray();
  mainWindow.hide();
  // Windows: balloon so user knows app is still running
  if (process.platform === "win32") {
    notifyTrayHidden(ei18n("window.trayHiddenMac"));
  }
}

function ensureTray(force = false) {
  const show =
    force ||
    appSettings?.capture?.showTray !== false ||
    process.platform === "win32" ||
    process.platform === "linux";
  // Windows/Linux: always keep tray when hide-to-tray may be used
  if (!show && process.platform === "darwin" && !force) {
    return null;
  }
  return ensureAppTray({
    appRoot,
    packaged: app.isPackaged,
    onShow: () => showMainWindow(),
    onCapture: () => {
      try {
        openCaptureSurface();
      } catch (e) {
        logWarn("tray", "capture failed", { error: e instanceof Error ? e.message : String(e) });
      }
    },
    onIngest: () => {
      showMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        emitToRenderer(mainWindow, "navigate:select", { kind: "connector", id: "ingest" });
      }
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
}

/**
 * Open capture UI from global shortcut / RPC.
 * - float (default): OneNote-style sticky utility window
 * - overlay: focus main shell + quick-capture overlay
 */
function openCaptureSurface(opts = {}) {
  const mode =
    opts.mode ||
    appSettings?.capture?.globalMode ||
    "float";
  const alwaysOnTop = appSettings?.capture?.floatAlwaysOnTop !== false;

  if (mode === "overlay") {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      emitToRenderer(mainWindow, "overlay:open", { kind: "quick-capture" });
    } else {
      openQuickCaptureWindow({
        appRoot,
        packaged: app.isPackaged,
        alwaysOnTop,
        getLoadUrl: getRendererLoadUrl,
      });
    }
    return { ok: true, mode: "overlay" };
  }

  openQuickCaptureWindow({
    appRoot,
    packaged: app.isPackaged,
    alwaysOnTop,
    getLoadUrl: getRendererLoadUrl,
  });
  return { ok: true, mode: "float" };
}

/** Register OS-level global shortcuts so topmind is usable even when not focused.
 *  ⌘⇧N → floating quick note (default) or main overlay — capture-first from anywhere. */
function registerGlobalShortcuts() {
  const accelerator = "CommandOrControl+Shift+N";
  const registered = globalShortcut.register(accelerator, () => {
    try {
      openCaptureSurface();
    } catch (e) {
      logWarn("main", "global capture failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
  if (!registered) {
    logWarn("main", "global shortcut registration failed", { accelerator });
  } else {
    logInfo("main", "global shortcut registered", { accelerator });
  }
}

// Identity: keep a single dock/taskbar entry named topmind (not generic "Electron").
// Helper processes (GPU/Renderer/Network) must not show as separate apps — Electron
// handles that when name/userModelId are set before ready.
// NOTE: setName alone does NOT change the Dock *image* in dev — that needs
// app.dock.setIcon() after whenReady (see applyAppIcon).
app.setName("topmind");
// Keep Electron userData under our state home (not a second copy in Application Support).
try {
  app.setPath("userData", desktopStateHome);
} catch {
  /* too late / unavailable — harmless */
}
if (process.platform === "win32") {
  // Must match electron-builder.yml appId so taskbar pins stay stable across upgrades.
  app.setAppUserModelId("com.topmindspace.topmind");
}
// Linux: align WM_CLASS with electron-builder executableName for taskbar grouping.
if (isLinux() && typeof app.setDesktopName === "function") {
  try {
    app.setDesktopName("topmind.desktop");
  } catch {
    /* Electron versions without setDesktopName — harmless */
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) { app.quit(); } else {
  app.on("second-instance", () => {
    showMainWindow();
  });
  app.whenReady().then(async () => {
    // Hide dock icon duplication on macOS when relaunching while already running
    // is prevented by single-instance lock; still prune stray windows from prior
    // crash recovery if Electron rehydrates them.
    logInfo("main", "boot", {
      platform: platformTag(),
      packaged: app.isPackaged,
      chromium: chromiumFlags,
      appPath: app.getAppPath?.() || appRoot,
      logFile: getLogFilePath(),
      win: isWin32(),
    });
    // Branding — MUST be after ready. macOS Dock + first-window taskbar on Win/Linux.
    applyBrandingIcon();
    // App menu: macOS minimal native Edit/App; Win/Linux no menubar (custom chrome).
    installApplicationMenu({ isDev: !app.isPackaged });
    // Linux: safeStorage needs libsecret / kwallet. Without it, API keys fall
    // back to plaintext in app-settings.json — warn once so users can install.
    if (isLinux() && !safeStorage.isEncryptionAvailable()) {
      logWarn(
        "main",
        "safeStorage unavailable — API keys stored without OS encryption. Install libsecret (e.g. libsecret-1-0 + gnome-keyring) for encrypted keys.",
      );
    }
    // Workspace media for editor relative images (topmind-asset://local/…)
    registerMediaProtocolHandler({ protocol, net }, () => currentCtx);
    try {
      await initApp();
    } catch (e) {
      showBootError(
        "topmind failed to initialize",
        e instanceof Error ? `${e.message}\n${e.stack || ""}` : String(e),
      );
    }
    try {
      await createWindow();
    } catch (e) {
      showBootError(
        "topmind failed to open window",
        e instanceof Error ? `${e.message}\n${e.stack || ""}` : String(e),
      );
      // Without a window the app looks "broken" — quit so the user can relaunch cleanly.
      app.quit();
      return;
    }
    registerGlobalShortcuts();
    // System tray: required for Windows/Linux hide-to-tray visibility; useful on all platforms.
    ensureTray();
    // Close any non-main windows that slipped in during boot.
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== mainWindow && !w.isDestroyed()) {
        logWarn("main", "closing stray window on ready", { id: w.id, title: w.getTitle() });
        w.destroy();
      }
    }
    // Background update check (30s delay, non-blocking, silent on failure).
    // Respects autoCheckUpdates setting (default true).
    // Checks ALL surfaces (Desktop / Skills / Clip / Obsidian) — any available
    // update triggers a status bar badge; clicking it opens settings → manage.
    const autoCheck = appSettings?.ui?.autoCheckUpdates !== false;
    if (autoCheck) {
      setTimeout(async () => {
        try {
          const { checkAllSurfaces, readRunningAppVersion } = await import("./lib/update-check.mjs");
          const result = await checkAllSurfaces({
            currentVersion: readRunningAppVersion(),
            retries: 1,
            timeoutMs: 10_000,
          });
          // Collect all surfaces with available updates
          const surfaces = [];
          if (result.desktop?.updateAvailable) surfaces.push("desktop");
          if (result.skills?.updateAvailable) surfaces.push("skills");
          if (result.extension?.updateAvailable) surfaces.push("extension");
          if (result.obsidian?.updateAvailable) surfaces.push("obsidian");
          if (surfaces.length > 0) {
            logInfo("main", "updates available", {
              surfaces,
              desktop: { current: result.desktop?.currentVersion, latest: result.desktop?.latestVersion },
              skills: { current: result.skills?.currentVersion, latest: result.skills?.latestVersion },
              extension: { current: result.extension?.currentVersion, latest: result.extension?.latestVersion },
              obsidian: { current: result.obsidian?.currentVersion, latest: result.obsidian?.latestVersion },
            });
            emitToRenderer(mainWindow, "update:available", {
              surfaces,
              desktop: result.desktop,
              skills: result.skills,
              extension: result.extension,
              obsidian: result.obsidian,
              // Legacy fields for backward compat (Desktop surface)
              currentVersion: result.desktop?.currentVersion,
              latestVersion: result.desktop?.latestVersion,
              releaseUrl: result.desktop?.releaseUrl,
              tagName: result.desktop?.tagName,
              notes: result.desktop?.notes,
              publishedAt: result.desktop?.publishedAt,
            });
          }
        } catch (e) {
          // Silent — never bother user on background check failure
          logInfo("main", "background update check skipped", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }, 30_000);
    }
  }).catch((e) => {
    showBootError(
      "topmind failed to start",
      e instanceof Error ? `${e.message}\n${e.stack || ""}` : String(e),
    );
    app.quit();
  });
  // macOS dock click / re-activate — never spawn a second main window while one exists.
  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }
    if (!windowCreating) void createWindow();
  });
  app.on("window-all-closed", () => {
    // Hide-to-tray: main window may be hidden (not closed) — keep process.
    // If user truly closed everything while quitting, exit.
    if (isQuitting) return;
    // With tray present we intentionally stay alive on Windows/Linux when hidden.
    // Only quit if no tray and not macOS (legacy).
    if (process.platform !== "darwin") {
      // Prefer staying alive when closeBehavior is hide (tray keeps process useful).
      const behavior = appSettings?.ui?.closeBehavior || "ask";
      if (behavior === "hide" || behavior === "ask") {
        ensureTray();
        return;
      }
      app.quit();
    }
  });
  app.on("before-quit", () => {
    isQuitting = true;
    closeQuickCaptureWindow();
    destroyAppTray();
    void closeWorkspaceWatcher();
    void stopClipBridge();
    globalShortcut.unregisterAll();
  });

  // Global BrowserWindow creation monitor — auto-destroy non-main windows.
  // Root cause of "AI 对话多出一个 Electron 图标": any second BrowserWindow
  // (popup, crash recovery, accidental open) shows as a second dock entry in
  // dev when the app is still branded as "Electron".
  // Exception: ephemeral fetch/render windows + utility float capture.
  app.on("browser-window-created", (_event, win) => {
    const title = win.getTitle();
    const url = win.webContents.getURL();
    const isMain = win === mainWindow;
    const ephemeral = isEphemeralBrowserWindow(win);
    const utility = isUtilityBrowserWindow(win);
    logWarn("main", "browser-window-created", {
      title,
      url,
      id: win.id,
      isMain,
      ephemeral,
      utility,
      stack: new Error("window-creation-trace").stack?.split("\n").slice(1, 6).join(" → "),
    });
    // Defer until mainWindow is assigned (first create). After that, any other
    // non-ephemeral/non-utility window is an orphan — destroy immediately so Dock
    // never gains a 2nd icon.
    if (mainWindow && !isMain && !ephemeral && !utility && !win.isDestroyed()) {
      queueMicrotask(() => {
        if (
          !win.isDestroyed() &&
          win !== mainWindow &&
          !isEphemeralBrowserWindow(win) &&
          !isUtilityBrowserWindow(win)
        ) {
          logWarn("main", "destroying non-main BrowserWindow", { id: win.id, title: win.getTitle() });
          win.destroy();
        }
      });
    }
  });
}
