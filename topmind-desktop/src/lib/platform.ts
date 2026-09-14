/**
 * Renderer platform detection for chrome padding.
 *
 * Only macOS needs a branch now: its traffic lights are inset *inside* our own
 * 44px column chrome (`.v4-mac-titlebar-pad`). Windows and Linux draw their own
 * title bar and menu bar, so no app content ever sits under a native control and
 * nothing has to be reserved — see `electron/lib/window-shell.mjs`.
 */
export const isMacOS =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
