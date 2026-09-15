/**
 * Renderer platform detection for chrome padding.
 *
 * Three shapes exist, and the renderer only has to know about two of them:
 *
 * - **macOS** — traffic lights are inset *inside* our own 44px title bar row, on
 *   the left (`.v4-mac-titlebar-pad`).
 * - **Windows** — the app owns that row and the OS paints minimize / maximize /
 *   close over its *right* end, so the rightmost column header reserves the width
 *   the OS reports (`src/lib/window-controls.ts` → `--wc-inset-right`).
 * - **Linux** — the desktop environment draws the decorations and the native menu
 *   bar, exactly as it always has, so nothing is reserved.
 *
 * The policy itself lives in `electron/lib/window-shell.mjs`; the flags here are
 * its renderer-side mirror and the two are asserted against each other in
 * `tests/window-shell.test.mjs`, so a platform cannot get one half of the
 * behaviour without the other.
 */

export type DesktopPlatform = "darwin" | "win32" | "linux";

function detectPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "linux";
  const raw = navigator.userAgent || "";
  if (/Mac/i.test(navigator.platform || "") || /Mac OS X/iu.test(raw)) return "darwin";
  if (/Win/i.test(navigator.platform || "") || /Windows/iu.test(raw)) return "win32";
  return "linux";
}

export const platform: DesktopPlatform = detectPlatform();

export const isMacOS = platform === "darwin";

/**
 * True when the OS overlays the caption buttons on our own title bar row — which
 * is also what makes the app draw the in-row menu strip there. Mirrors
 * `usesCaptionOverlay()` in `electron/lib/window-shell.mjs`.
 */
export const usesCaptionOverlay = platform === "win32";
