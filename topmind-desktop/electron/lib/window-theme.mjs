/**
 * Utility functions for syncing Electron titleBarOverlay with application/system themes.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { nativeTheme } = require("electron");
import { logWarn } from "./writeback.mjs";

/**
 * Resolve Electron BrowserWindow backgroundColor from theme setting.
 * Avoids light flash on dark-mode users before renderer CSS loads.
 * @param {string|undefined} themeSetting - 'light' | 'dark' | 'auto' | undefined
 * @returns {string} hex color matching Desktop --color-background token
 */
export function resolveWindowBackgroundColor(themeSetting) {
  const isDark =
    themeSetting === "dark" ||
    (themeSetting !== "light" && nativeTheme.shouldUseDarkColors);
  // Desktop tokens: light --color-background #f6f4ef · dark --color-background #201e19
  return isDark ? "#201e19" : "#f6f4ef";
}

export function resolveWindowsTitleBarOverlay(themeSetting, height = 40) {
  const isDark =
    themeSetting === "dark" ||
    (themeSetting !== "light" && nativeTheme.shouldUseDarkColors);
  return {
    // Warm paper palette — matches Desktop --color-app-chrome / --color-text-primary
    color: isDark ? "#181613" : "#edeae2",
    symbolColor: isDark ? "#f0ede4" : "#2b2822",
    height,
  };
}

export function updateWindowsTitleBarOverlay(win, themeSetting, height = 40) {
  if (!win || win.isDestroyed() || process.platform !== "win32") return;
  try {
    const overlay = resolveWindowsTitleBarOverlay(themeSetting, height);
    win.setTitleBarOverlay(overlay);
  } catch (err) {
    logWarn("window-theme", "failed to update titleBarOverlay", { error: String(err) });
  }
}
