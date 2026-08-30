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
  // Desktop tokens: light --color-background #f7f7f7 · dark --color-background #171717
  return isDark ? "#171717" : "#f7f7f7";
}

export function resolveWindowsTitleBarOverlay(themeSetting, height = 40) {
  const isDark =
    themeSetting === "dark" ||
    (themeSetting !== "light" && nativeTheme.shouldUseDarkColors);
  return {
    // Neutral palette — matches Desktop --color-app-chrome / --color-text-primary
    color: isDark ? "#161616" : "#f0f0f0",
    symbolColor: isDark ? "#e5e5e5" : "#262626",
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
