/**
 * App branding icon resolution — Dock (mac), taskbar/window (win/linux).
 *
 * Packaged layout (electron-builder asar):
 *   electron/assets/icon.png · icon-mac.png · icon.ico
 * Dev layout:
 *   build/icon-mac.png · build/icon.icns · build/icon.* · electron/assets/*
 *
 * macOS Dock rules (critical):
 *   1. Bundled .app uses build/icon.icns (electron-builder / patch-electron-icon).
 *   2. Runtime app.dock.setIcon MUST use a PNG plate (icon-mac.png), never .icns.
 *      createFromPath / setIcon with .icns is unreliable and can fall back to the
 *      stock Electron atom icon.
 *   3. icon-mac.png MUST match peer Dock geometry (measured VS Code/Claude/Messages):
 *      ~10% transparent canvas margin + rounded white plate (~80.5% of canvas).
 *      setIcon paints pixels as-is (no system squircle). Full-canvas plate looks
 *      oversized; full-bleed opaque square looks like a hard rectangle.
 *
 * Windows notes:
 *   - Running window: BrowserWindow `icon` (NativeImage / path).
 *   - Pinned Start Menu / Explorer: embedded .exe icon (patch-win-exe-icon.mjs).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** electron/ */
const ELECTRON_DIR = path.resolve(__dirname, "..");
/** topmind-desktop/ (dev) or app.asar root (packaged) */
const APP_ROOT = path.resolve(ELECTRON_DIR, "..");

/**
 * Ordered icon candidates. `forDock` skips .icns (Dock setIcon PNG-only).
 * @param {{ packaged?: boolean, platform?: NodeJS.Platform, forDock?: boolean }} [opts]
 * @returns {string[]}
 */
export function resolveAppIconCandidates(opts = {}) {
  const platform = opts.platform || process.platform;
  const packaged = Boolean(opts.packaged);
  const forDock = Boolean(opts.forDock);

  const assetsPng = path.join(ELECTRON_DIR, "assets", "icon.png");
  const assetsIco = path.join(ELECTRON_DIR, "assets", "icon.ico");
  const assetsMacPng = path.join(ELECTRON_DIR, "assets", "icon-mac.png");
  const buildPng = path.join(APP_ROOT, "build", "icon.png");
  const buildMacPng = path.join(APP_ROOT, "build", "icon-mac.png");
  const buildIco = path.join(APP_ROOT, "build", "icon.ico");
  const build512 = path.join(APP_ROOT, "build", "icons", "512x512.png");
  const build256 = path.join(APP_ROOT, "build", "icons", "256x256.png");
  const buildIcns = path.join(APP_ROOT, "build", "icon.icns");

  /** @type {string[]} */
  let candidates;
  if (platform === "win32") {
    candidates = packaged
      ? [assetsIco, assetsPng, buildIco, buildPng, build256]
      : [buildIco, assetsIco, buildPng, build256, assetsPng];
  } else if (platform === "darwin") {
    // PNG white plate first. Never list .icns when forDock — setIcon(icns) breaks branding.
    if (forDock) {
      candidates = packaged
        ? [assetsMacPng, buildMacPng, assetsPng]
        : [buildMacPng, assetsMacPng, assetsPng, buildPng];
    } else {
      // Window / generic: still prefer plate PNG; icns only as last-resort file existence
      candidates = packaged
        ? [assetsMacPng, assetsPng, buildMacPng, buildIcns]
        : [buildMacPng, assetsMacPng, assetsPng, buildPng, buildIcns];
    }
  } else {
    candidates = packaged
      ? [assetsPng, build256, buildPng]
      : [buildPng, build256, build512, assetsPng];
  }

  return candidates.filter((p) => p && existsSync(p));
}

/**
 * @param {{ packaged?: boolean, platform?: NodeJS.Platform, forDock?: boolean }} [opts]
 * @returns {string | null}
 */
export function resolveAppIconPath(opts = {}) {
  const list = resolveAppIconCandidates(opts);
  return list[0] || null;
}

/**
 * Load first non-empty NativeImage from candidates.
 * @param {{ packaged?: boolean, platform?: NodeJS.Platform, forDock?: boolean }} [opts]
 * @returns {{ img: Electron.NativeImage, path: string } | null}
 */
export function loadAppIconImage(opts = {}) {
  const { nativeImage } = require("electron");
  const candidates = resolveAppIconCandidates(opts);
  for (const iconPath of candidates) {
    // Runtime Dock must never load .icns (unreliable → Electron atom)
    if (opts.forDock && /\.icns$/iu.test(iconPath)) continue;
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (img && !img.isEmpty()) {
        return { img, path: iconPath };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Apply platform branding after app ready.
 * @param {typeof import('electron').app} app
 * @param {{ packaged?: boolean }} [opts]
 * @returns {import('electron').NativeImage | null}
 */
export function applyAppIcon(app, opts = {}) {
  const packaged = opts.packaged ?? Boolean(app.isPackaged);

  if (process.platform === "darwin" && app.dock) {
    // Pre-masked plate PNG for Dock — never .icns (setIcon(icns) → Electron atom)
    const loaded = loadAppIconImage({ packaged, forDock: true, platform: "darwin" });
    if (!loaded) return null;
    try {
      // Pre-masked PNG; resize to 256 so Dock scaling is crisp (avoid 1024 raw buffer)
      let img = loaded.img;
      const size = img.getSize?.() || {};
      if (typeof img.resize === "function" && (size.width > 256 || size.height > 256)) {
        try {
          img = img.resize({ width: 256, height: 256, quality: "best" });
        } catch {
          img = loaded.img;
        }
      }
      app.dock.setIcon(img);
      return img;
    } catch {
      try {
        app.dock.setIcon(loaded.path);
        return loaded.img;
      } catch {
        return null;
      }
    }
  }

  const loaded = loadAppIconImage({ packaged });
  return loaded?.img || null;
}

/**
 * Set BrowserWindow icon (Win/Linux taskbar). Safe no-op if missing.
 * @param {import('electron').BrowserWindow} win
 * @param {import('electron').NativeImage | null} iconImage
 * @param {{ packaged?: boolean }} [opts]
 */
export function applyWindowIcon(win, iconImage, opts = {}) {
  if (!win || win.isDestroyed()) return;
  try {
    if (iconImage && !iconImage.isEmpty()) {
      win.setIcon(iconImage);
      return;
    }
    const loaded = loadAppIconImage({
      packaged: opts.packaged,
      platform: process.platform,
      forDock: false,
    });
    if (loaded) win.setIcon(loaded.img);
  } catch {
    /* ignore — some platforms reject setIcon */
  }
}

export function appIconDebugInfo(opts = {}) {
  return {
    resolved: resolveAppIconPath(opts),
    dockResolved: resolveAppIconPath({ ...opts, forDock: true, platform: "darwin" }),
    candidates: resolveAppIconCandidates(opts),
    dockCandidates: resolveAppIconCandidates({ ...opts, forDock: true, platform: "darwin" }),
    electronDir: ELECTRON_DIR,
    appRoot: APP_ROOT,
    platform: process.platform,
  };
}
