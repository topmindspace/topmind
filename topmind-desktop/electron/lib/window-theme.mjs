/**
 * Native window chrome theming.
 *
 * Two jobs, both about OS-drawn surfaces matching the *in-app* theme preference:
 *
 * 1. `nativeTheme.themeSource` — the OS title bar, scrollbars and native dialogs
 *    on every platform. Without it, picking "dark" inside the app on a light-mode
 *    OS leaves a bright native title bar above a dark window.
 * 2. The Windows `titleBarOverlay` strip — the caption buttons the OS paints over
 *    our own header row. It needs an explicit background + glyph color, and a
 *    light strip over a dark header is a visible seam, so it follows the app theme
 *    rather than the OS one. Both colors are read from the same tokens the header
 *    row uses (`--color-app-chrome` / `--color-text-primary`); a drift here would
 *    show up as a lighter rectangle in the top-right corner.
 *
 * History worth keeping: the first overlay attempt reserved a *guessed* 138px and
 * lost the reservation to a `padding` shorthand later in the stylesheet, so the
 * AI workspace's 4th tab and the AI panel toggle were painted under the caption
 * buttons. The reservation is now measured (see `src/lib/window-controls.ts`) and
 * asserted in `tests/window-shell.test.mjs`; the overlay itself is deliberate
 * again — see the platform table in `window-shell.mjs`.
 */
import { createRequire } from "node:module";
import { usesCaptionOverlay } from "./window-shell.mjs";

const require = createRequire(import.meta.url);
const { nativeTheme } = require("electron");

/** Desktop tokens: light --color-app-chrome #f0f0f0 · dark #161616. */
const CHROME_SURFACE = { light: "#f0f0f0", dark: "#161616" };
/** Desktop tokens: light --color-text-primary #262626 · dark #e5e5e5. */
const CHROME_SYMBOL = { light: "#262626", dark: "#e5e5e5" };

/**
 * @param {string|undefined} themeSetting - 'light' | 'dark' | 'auto' | undefined
 * @returns {boolean}
 */
function wantsDark(themeSetting) {
  return (
    themeSetting === "dark" ||
    (themeSetting !== "light" && nativeTheme.shouldUseDarkColors)
  );
}

/**
 * Resolve Electron BrowserWindow backgroundColor from theme setting.
 * Avoids light flash on dark-mode users before renderer CSS loads.
 * @param {string|undefined} themeSetting - 'light' | 'dark' | 'auto' | undefined
 * @returns {string} hex color matching Desktop --color-background token
 */
export function resolveWindowBackgroundColor(themeSetting) {
  const isDark = wantsDark(themeSetting);
  // Desktop tokens: light --color-background #f7f7f7 · dark --color-background #171717
  return isDark ? "#171717" : "#f7f7f7";
}

/**
 * Resolve the header-row surface color the caption buttons sit on.
 * @param {string|undefined} themeSetting
 * @returns {string} hex color matching Desktop --color-app-chrome token
 */
export function resolveChromeSurfaceColor(themeSetting) {
  return wantsDark(themeSetting) ? CHROME_SURFACE.dark : CHROME_SURFACE.light;
}

/**
 * Resolve the caption glyph color for that surface.
 * @param {string|undefined} themeSetting
 * @returns {string} hex color matching Desktop --color-text-primary token
 */
export function resolveChromeSymbolColor(themeSetting) {
  return wantsDark(themeSetting) ? CHROME_SYMBOL.dark : CHROME_SYMBOL.light;
}

/**
 * Map the app theme preference onto Electron's `nativeTheme.themeSource`.
 * @param {string|undefined} themeSetting - 'light' | 'dark' | 'auto' | undefined
 * @returns {'system'|'light'|'dark'}
 */
export function resolveNativeThemeSource(themeSetting) {
  if (themeSetting === "dark") return "dark";
  if (themeSetting === "light") return "light";
  return "system";
}

/**
 * Repaint the OS caption buttons for the current app theme.
 *
 * Only meaningful where the overlay policy applies (Windows main window); every
 * other shape returns false without touching the window, so callers can stay
 * platform-agnostic.
 * @param {import('electron').BrowserWindow | null | undefined} win
 * @param {string|undefined} themeSetting
 * @returns {boolean} true when the overlay was updated
 */
export function applyTitleBarOverlayTheme(win, themeSetting) {
  if (!win || win.isDestroyed?.()) return false;
  if (!usesCaptionOverlay({ platform: process.platform })) return false;
  if (typeof win.setTitleBarOverlay !== "function") return false;
  try {
    win.setTitleBarOverlay({
      color: resolveChromeSurfaceColor(themeSetting),
      symbolColor: resolveChromeSymbolColor(themeSetting),
    });
    return true;
  } catch {
    // A window created without titleBarOverlay — cosmetic only, never fatal.
    return false;
  }
}

/**
 * Align OS-drawn chrome with the app theme.
 *
 * Also the single source for `prefers-color-scheme` in the renderer, so the
 * window background color and the `auto` CSS theme can never disagree.
 * @param {string|undefined} themeSetting
 * @param {import('electron').BrowserWindow | null} [win] - needed to repaint the caption overlay
 * @returns {boolean} true when the theme source actually changed
 */
export function applyNativeWindowTheme(themeSetting, win = null) {
  applyTitleBarOverlayTheme(win, themeSetting);

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
