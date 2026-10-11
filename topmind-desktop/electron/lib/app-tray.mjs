/**
 * System tray — required for hide-to-tray on Windows/Linux and optional on macOS.
 * Ensures the app remains reachable when the main window is hidden.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { logInfo, logWarn } from "./writeback.mjs";
import { t } from "./electron-i18n.mjs";

const require = createRequire(import.meta.url);
const { Tray, Menu, nativeImage, app } = require("electron");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('electron').Tray | null} */
let tray = null;

/**
 * Resolve a small tray icon (platform-appropriate).
 * @param {{ packaged?: boolean, appRoot?: string }} opts
 */
function resolveTrayImage(opts = {}) {
  const candidates = [];
  if (opts.appRoot) {
    candidates.push(
      path.join(opts.appRoot, "electron/assets/icon.png"),
      path.join(opts.appRoot, "build/icon.png"),
      path.join(opts.appRoot, "dist/icon-256.png"),
    );
  }
  // Relative to this module: electron/lib → electron/assets
  candidates.push(
    path.join(__dirname, "../assets/icon.png"),
    path.join(__dirname, "../assets/icon-mac.png"),
  );
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        let img = nativeImage.createFromPath(p);
        if (img.isEmpty()) continue;
        // Tray icons should be small; resize for crisp menu bar / notification area
        const size = process.platform === "darwin" ? 18 : 16;
        img = img.resize({ width: size, height: size, quality: "best" });
        if (process.platform === "darwin") {
          img.setTemplateImage(true);
        }
        return img;
      } catch {
        /* try next */
      }
    }
  }
  // 1×1 fallback so Tray still constructs (visible as blank is better than crash)
  return nativeImage.createEmpty();
}

/**
 * @param {{
 *   appRoot: string,
 *   packaged?: boolean,
 *   onShow: () => void,
 *   onCapture: () => void,
 *   onIngest?: () => void,
 *   onQuit: () => void,
 * }} handlers
 */
export function ensureAppTray(handlers) {
  if (tray && !tray.isDestroyed?.()) {
    rebuildTrayMenu(handlers);
    return tray;
  }

  const img = resolveTrayImage({ appRoot: handlers.appRoot, packaged: handlers.packaged });
  try {
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  } catch (e) {
    logWarn("tray", "create failed", { error: e instanceof Error ? e.message : String(e) });
    tray = null;
    return null;
  }

  tray.setToolTip("topmind");
  rebuildTrayMenu(handlers);

  // Windows/Linux: click often toggles visibility
  tray.on("click", () => {
    handlers.onShow?.();
  });
  tray.on("double-click", () => {
    handlers.onShow?.();
  });

  logInfo("tray", "ready", { platform: process.platform });
  return tray;
}

/**
 * @param {Parameters<typeof ensureAppTray>[0]} handlers
 */
export function rebuildTrayMenu(handlers) {
  if (!tray) return;
  const isMac = process.platform === "darwin";
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: t("tray.show"),
      click: () => handlers.onShow?.(),
    },
    {
      label: t("tray.capture"),
      accelerator: "CommandOrControl+Shift+N",
      click: () => handlers.onCapture?.(),
    },
  ];
  if (typeof handlers.onIngest === "function") {
    template.push({
      label: t("tray.ingest"),
      click: () => handlers.onIngest?.(),
    });
  }
  template.push(
    { type: "separator" },
    {
      label: isMac ? t("tray.quitMac") : t("tray.quit"),
      click: () => handlers.onQuit?.(),
    },
  );
  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
}

export function destroyAppTray() {
  try {
    if (tray) {
      tray.destroy();
    }
  } catch {
    /* ignore */
  }
  tray = null;
}

export function hasAppTray() {
  return Boolean(tray);
}

/** Balloon / notification on Windows when hiding to tray (first time). */
export function notifyTrayHidden(message) {
  if (!tray) return;
  try {
    if (process.platform === "win32" && typeof tray.displayBalloon === "function") {
      tray.displayBalloon({
        title: "topmind",
        content: message || t("tray.hiddenMessage"),
      });
    }
  } catch {
    /* ignore */
  }
}
