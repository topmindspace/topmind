/**
 * Overlay close guard — lets the active overlay flush or veto closeOverlay.
 *
 * SettingsDialog registers an async flush guard so Esc, scrim click, and
 * shortcut navigations all wait for its debounced settings flush before unmount.
 * Capture registers a dirty-guard that returns false so a half-written draft
 * is not discarded by Esc / Cancel without confirmation.
 */

/** Return `false` to veto the close (after any async flush work). */
type CloseGuard = () => Promise<boolean | void> | boolean | void;

let activeGuard: CloseGuard | null = null;

/** Register the guard for the currently-open overlay (mount); null clears (unmount). */
export function setOverlayCloseGuard(guard: CloseGuard | null): void {
  activeGuard = guard;
}

/**
 * Await the registered guard (if any). Returns false when the guard vetoes
 * the close; true/undefined means the caller may close.
 *
 * The guard stays armed when it vetoes — a dirty Capture that opens a
 * ConfirmDialog must still veto the next Esc after the dialog is cancelled.
 * It is only cleared once a close is actually allowed (or unmount clears it).
 */
export async function runOverlayCloseGuard(): Promise<boolean> {
  if (!activeGuard) return true;
  const result = await activeGuard();
  if (result === false) return false;
  activeGuard = null;
  return true;
}
