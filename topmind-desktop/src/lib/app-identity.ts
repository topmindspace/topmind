/**
 * Product identity for the app-owned title bar row (Windows).
 *
 * That row replaced the native title bar, so it carries what the native one used
 * to: the app mark and the app name. `APP_NAME` MUST match the literal main uses
 * for the OS window title in `electron/main.mjs` (`refreshWindowTitle`) — the
 * window title still feeds the taskbar, and the row must not disagree with it
 * about what the app is called. Asserted in `tests/window-shell.test.mjs`.
 */

/** Product name — same string main puts in the OS window title. */
export const APP_NAME = "topmind";

/** App mark. The favicon asset on purpose: row and taskbar can't diverge. */
export const APP_ICON = "/favicon.svg";
