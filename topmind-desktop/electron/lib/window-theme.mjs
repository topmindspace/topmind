/**
 * Native window chrome theming.
 *
 * History worth keeping: Windows used to run `titleBarStyle: 'hidden'` +
 * `titleBarOverlay`, drawing native caption buttons on top of our own 44px
 * column chrome. That cost ~146px at the top-right — and because the class
 * reserving it (`.v4-win-titlebar-pad`) was declared *before*
 * `.v4-column-chrome { padding: 0 8px }` in the same stylesheet, the shorthand
 * won and the reservation silently did nothing. The AI workspace's 4th tab and
 * the AI panel toggle were painted under the window buttons.
 *
 * 2026-09-14: overlay removed everywhere (see `window-shell.mjs`). Windows and
 * Linux now use a real native frame + native menu bar, so no native control is
 * ever painted over app content and nothing needs reserving. What remains is a
 * single theming job: keep the OS-drawn title bar / scrollbars in step with the
 * in-app theme preference.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { nativeTheme } = require("electron");

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
 * Align OS-drawn chrome (title bar, scrollbars, native dialogs) with the app
 * theme. Without this, picking "dark" inside the app on a light-mode OS leaves
 * a bright native title bar pinned above a dark window — most visible on
 * Windows/Linux, where the title bar is drawn by the desktop environment.
 *
 * Also the single source for `prefers-color-scheme` in the renderer, so the
 * window background color and the `auto` CSS theme can never disagree.
 * @param {string|undefined} themeSetting
 * @returns {boolean} true when the source actually changed
 */
export function applyNativeWindowTheme(themeSetting) {
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
