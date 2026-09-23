/**
 * Allowlist for short-lived BrowserWindows (e.g. SPA URL render).
 * main.mjs destroys any non-main window unless registered here —
 * prevents dual dock icons while still enabling headless render.
 */
const ephemeral = new WeakSet();

/** Mark a BrowserWindow as ephemeral fetch/render helper (not main UI). */
export function markEphemeralBrowserWindow(win) {
  if (win) ephemeral.add(win);
}

/** @returns {boolean} */
export function isEphemeralBrowserWindow(win) {
  return Boolean(win && ephemeral.has(win));
}
