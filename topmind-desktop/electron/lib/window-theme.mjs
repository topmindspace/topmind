/**
 * Native window chrome theming.
 *
 * 1. `nativeTheme.themeSource` — OS title bar / scrollbars / native dialogs follow
 *    the app theme (otherwise dark UI under a light OS title bar).
 * 2. Windows `titleBarOverlay` caption strip — colors come from the same stops as
 *    the header row (see TONE_STOPS ↔ tokens.css). Keep the table in lockstep.
 *
 * Caption width is measured in `src/lib/window-controls.ts` (asserted in
 * `tests/window-shell.test.mjs`) — never hardcode a guessed reservation.
 */
import { createRequire } from "node:module";
import { usesCaptionOverlay } from "./window-shell.mjs";

const require = createRequire(import.meta.url);
const { nativeTheme } = require("electron");

/**
 * Chrome stops per surface tone × mode. Must match tokens.css:
 *   app-chrome · text-primary · background
 * warm is the DS default ladder.
 */
const TONE_STOPS = {
  warm: {
    light: { chrome: "#f1efe8", symbol: "#242220", background: "#f3f1eb" },
    dark: { chrome: "#171614", symbol: "#e8e4de", background: "#1c1a17" },
  },
  cool: {
    light: { chrome: "#eef1f5", symbol: "#1c2430", background: "#f2f5f8" },
    dark: { chrome: "#151a21", symbol: "#e6ebf2", background: "#1a2028" },
  },
  neutral: {
    light: { chrome: "#f0f0f0", symbol: "#1f1f1f", background: "#f4f4f4" },
    dark: { chrome: "#161616", symbol: "#e8e8e8", background: "#1a1a1a" },
  },
  slate: {
    light: { chrome: "#e4e9ef", symbol: "#15202b", background: "#eaeef3" },
    dark: { chrome: "#12171e", symbol: "#e4eaf2", background: "#161c24" },
  },
};

/** Normalize an arbitrary tone id to a known pack (fallback: warm). */
function normalizeTone(tone) {
  return tone && Object.hasOwn(TONE_STOPS, tone) ? tone : "warm";
}

/**
 * @param {string|undefined} themeSetting - 'light' | 'dark' | 'auto' | undefined
 * @returns {boolean}
 */
export function wantsDark(themeSetting) {
  return (
    themeSetting === "dark" ||
    (themeSetting !== "light" && nativeTheme.shouldUseDarkColors)
  );
}

/**
 * Resolve the stop table for the current theme + tone.
 * @param {string|undefined} themeSetting
 * @param {string|undefined} tone
 * @returns {{ chrome: string, symbol: string, background: string }}
 */
function resolveStops(themeSetting, tone) {
  const pack = TONE_STOPS[normalizeTone(tone)];
  return wantsDark(themeSetting) ? pack.dark : pack.light;
}

/**
 * Resolve Electron BrowserWindow backgroundColor from theme setting.
 * Avoids light flash on dark-mode users before renderer CSS loads.
 * @param {string|undefined} themeSetting - 'light' | 'dark' | 'auto' | undefined
 * @param {string|undefined} [tone] - surface tone pack ('warm' | 'cool' | 'neutral')
 * @returns {string} hex color matching Desktop --color-background token
 */
export function resolveWindowBackgroundColor(themeSetting, tone) {
  return resolveStops(themeSetting, tone).background;
}

/**
 * Resolve the header-row surface color the caption buttons sit on.
 * @param {string|undefined} themeSetting
 * @param {string|undefined} [tone]
 * @returns {string} hex color matching Desktop --color-app-chrome token
 */
export function resolveChromeSurfaceColor(themeSetting, tone) {
  return resolveStops(themeSetting, tone).chrome;
}

/**
 * Resolve the caption glyph color for that surface.
 * @param {string|undefined} themeSetting
 * @param {string|undefined} [tone]
 * @returns {string} hex color matching Desktop --color-text-primary token
 */
export function resolveChromeSymbolColor(themeSetting, tone) {
  return resolveStops(themeSetting, tone).symbol;
}

/**
 * Map the app theme preference onto Electron's `nativeTheme.themeSource`.
 * @param {string|undefined} themeSetting
 * @returns {'system'|'light'|'dark'}
 */
export function resolveNativeThemeSource(themeSetting) {
  if (themeSetting === "dark") return "dark";
  if (themeSetting === "light") return "light";
  return "system";
}

/**
 * Repaint the OS caption buttons for the current app theme + tone.
 *
 * Only meaningful where the overlay policy applies (Windows main window); every
 * other shape returns false without touching the window, so callers can stay
 * platform-agnostic.
 * @param {import('electron').BrowserWindow | null | undefined} win
 * @param {string|undefined} themeSetting
 * @param {string|undefined} [tone]
 * @returns {boolean} true when the overlay was updated
 */
export function applyTitleBarOverlayTheme(win, themeSetting, tone) {
  if (!win || win.isDestroyed?.()) return false;
  if (!usesCaptionOverlay({ platform: process.platform })) return false;
  if (typeof win.setTitleBarOverlay !== "function") return false;
  try {
    win.setTitleBarOverlay({
      color: resolveChromeSurfaceColor(themeSetting, tone),
      symbolColor: resolveChromeSymbolColor(themeSetting, tone),
    });
    return true;
  } catch {
    // A window created without titleBarOverlay — cosmetic only, never fatal.
    return false;
  }
}

/**
 * Align OS-drawn chrome with the app theme + surface tone.
 *
 * Also the single source for `prefers-color-scheme` in the renderer, so the
 * window background color and the `auto` CSS theme can never disagree.
 * @param {string|undefined} themeSetting
 * @param {import('electron').BrowserWindow | null} [win] - needed to repaint the caption overlay
 * @param {string|undefined} [tone] - surface tone pack
 * @returns {boolean} true when the theme source actually changed
 */
export function applyNativeWindowTheme(themeSetting, win = null, tone) {
  applyTitleBarOverlayTheme(win, themeSetting, tone);

  const next = resolveNativeThemeSource(themeSetting);
  if (nativeTheme.themeSource === next) return false;
  try {
    nativeTheme.themeSource = next;
    return true;
  } catch {
    // Never let chrome theming take the app down — a mismatched title bar is
    // cosmetic, a thrown main-process exception is not.
    return false;
  }
}

/** Exposed for tests / tone-aware callers. */
export const THEME_TONE_STOPS = TONE_STOPS;
