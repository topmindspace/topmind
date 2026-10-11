/**
 * Allowlisted long-lived utility BrowserWindows (e.g. floating Quick Capture).
 * Distinct from ephemeral render helpers — these are intentional UI, skipTaskbar,
 * and must not be auto-destroyed by the dual-dock guard in main.mjs.
 */
const utility = new WeakSet();

/** @param {import('electron').BrowserWindow | null | undefined} win */
export function markUtilityBrowserWindow(win) {
  if (win) utility.add(win);
}

/** @param {import('electron').BrowserWindow | null | undefined} win */
export function isUtilityBrowserWindow(win) {
  return Boolean(win && utility.has(win));
}
