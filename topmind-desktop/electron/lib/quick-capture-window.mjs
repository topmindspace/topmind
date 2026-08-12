/**
 * Floating Quick Capture window — OneNote / Quick Note style.
 * Must load the renderer reliably (dev URL + packaged loadFile) and stay opaque
 * so content is never "blank" due to transparent chrome.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { markUtilityBrowserWindow } from "./utility-windows.mjs";
import { logInfo, logWarn, logError } from "./writeback.mjs";
import { t } from "./electron-i18n.mjs";
import { loadAppIconImage, applyWindowIcon } from "./app-icon.mjs";
import { resolveWindowsTitleBarOverlay, resolveWindowBackgroundColor } from "./window-theme.mjs";

const require = createRequire(import.meta.url);
const { BrowserWindow } = require("electron");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('electron').BrowserWindow | null} */
let captureWin = null;

/**
 * Resolve index.html for packaged / local builds.
 * @param {string} appRoot
 */
function resolveIndexHtml(appRoot) {
  const candidates = [
    path.join(appRoot, "dist", "index.html"),
    path.join(appRoot, "index.html"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

/**
 * Load capture surface into win. Prefer loadFile+query (reliable on all OS).
 * @param {import('electron').BrowserWindow} win
 * @param {{ getLoadUrl?: () => string, appRoot: string }} opts
 */
async function loadCaptureSurface(win, opts) {
  const devUrl = process.env.topmind_DESKTOP_DEV_SERVER_URL;
  if (devUrl) {
    // Vite: query on root works; also set hash as belt-and-suspenders for client detect
    const base = String(devUrl).replace(/\/?$/u, "/");
    const url = `${base}?surface=capture#surface=capture`;
    logInfo("capture-float", "load dev", { url });
    await win.loadURL(url);
    return;
  }

  const indexHtml = resolveIndexHtml(opts.appRoot);
  if (!existsSync(indexHtml)) {
    throw new Error(`renderer not found: ${indexHtml}`);
  }
  logInfo("capture-float", "load file", { indexHtml });
  // Electron loadFile query is the portable way for file:// + search params
  await win.loadFile(indexHtml, {
    query: { surface: "capture" },
    hash: "surface=capture",
  });
}

/**
 * @param {{
 *   appRoot: string,
 *   packaged?: boolean,
 *   alwaysOnTop?: boolean,
 *   getLoadUrl?: () => string,
 * }} opts
 */
export function openQuickCaptureWindow(opts) {
  const alwaysOnTop = opts.alwaysOnTop !== false;

  if (captureWin && !captureWin.isDestroyed()) {
    if (captureWin.isMinimized()) captureWin.restore();
    if (!captureWin.isVisible()) captureWin.show();
    captureWin.setAlwaysOnTop(alwaysOnTop);
    captureWin.focus();
    try {
      captureWin.webContents.send("capture:focus", { surface: "float" });
    } catch {
      /* ignore */
    }
    return captureWin;
  }

  const loadedIcon = loadAppIconImage({ packaged: opts.packaged });
  const windowIcon = loadedIcon?.img || null;
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  // Avoid double chrome on Windows: one custom drag bar + native overlay buttons.
  const titleBarStyle = isMac ? "hiddenInset" : isWin ? "hidden" : "default";

  // Opaque surface — transparent + vibrancy previously caused "blank" windows
  // when CSS tokens lagged or content was translucent.
  const win = new BrowserWindow({
    width: 480,
    height: 560,
    minWidth: 360,
    minHeight: 400,
    maxWidth: 800,
    maxHeight: 960,
    show: false,
    alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    fullscreenable: false,
    title: t("capture.title"),
    backgroundColor: resolveWindowBackgroundColor(opts?.theme),
    titleBarStyle,
    trafficLightPosition: isMac ? { x: 12, y: 10 } : undefined,
    autoHideMenuBar: true,
    ...(isWin
      ? {
          titleBarOverlay: resolveWindowsTitleBarOverlay(opts?.theme, 36),
        }
      : {}),
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  markUtilityBrowserWindow(win);
  applyWindowIcon(win, windowIcon, { packaged: opts.packaged });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logError("capture-float", "did-fail-load", { code, desc, url });
    if (!win.isDestroyed()) {
      const msg = t("capture.loadFail", { code, desc });
      const errBg = resolveWindowBackgroundColor(opts?.theme);
      const isDark = errBg === "#201e19";
      const errFg = isDark ? "#f0ede4" : "#2b2822";
      const errMuted = isDark ? "#a49c8c" : "#7c766b";
      void win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          `<!doctype html><html><body style="font:14px system-ui;padding:24px;background:${errBg};color:${errFg}">
            <h1 style="font-size:16px">${t("capture.errorTitle")}</h1>
            <p>${msg}</p>
            <p style="color:${errMuted};font-size:12px">${t("capture.errorHint")}</p>
            <p style="font-size:11px;word-break:break-all">${url || ""}</p>
          </body></html>`,
        )}`,
      );
      win.show();
    }
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    logError("capture-float", "render-process-gone", details);
  });

  void loadCaptureSurface(win, opts)
    .then(() => {
      if (win.isDestroyed()) return;
      // Show even if ready-to-show already fired
      if (!win.isVisible()) {
        win.show();
        win.focus();
      }
    })
    .catch((e) => {
      logError("capture-float", "load failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      if (!win.isDestroyed()) {
        win.show();
      }
    });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  win.on("closed", () => {
    if (captureWin === win) captureWin = null;
  });

  captureWin = win;
  logInfo("capture-float", "opened", {
    alwaysOnTop,
    appRoot: opts.appRoot,
    indexHint: resolveIndexHtml(opts.appRoot),
  });
  return win;
}

export function closeQuickCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) {
    captureWin.close();
  }
  captureWin = null;
}

/** Hide float without destroying (sticky note stays warm). */
export function hideQuickCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) {
    captureWin.hide();
    return true;
  }
  return false;
}

export function focusQuickCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) {
    captureWin.show();
    captureWin.focus();
    return true;
  }
  return false;
}

export function getQuickCaptureWindow() {
  return captureWin && !captureWin.isDestroyed() ? captureWin : null;
}

/** Test-only: resolve index HTML path candidates (capture surface boot). */
export function __debugResolveIndexHtml(appRoot) {
  return resolveIndexHtml(appRoot);
}

/** Test-only: file URL form of resolveIndexHtml. */
export function __debugPathToFileUrl(appRoot) {
  return pathToFileURL(resolveIndexHtml(appRoot)).href;
}
