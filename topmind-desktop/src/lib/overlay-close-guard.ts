/**
 * Overlay close guard — lets the active overlay veto/defer closeOverlay.
 *
 * SettingsDialog registers an async guard so Esc, scrim click, and shortcut
 * navigations all wait for its debounced settings flush before unmount.
 * Without this, only the X button flushed; every other close path could
 * silently drop the last edit's side effects (plugin toggles, cache sync).
 */

type CloseGuard = () => Promise<void> | void;

let activeGuard: CloseGuard | null = null;

/** Register the guard for the currently-open overlay (mount); null clears (unmount). */
export function setOverlayCloseGuard(guard: CloseGuard | null): void {
  activeGuard = guard;
}

/** Await the registered guard (if any) before the caller closes the overlay. */
export async function runOverlayCloseGuard(): Promise<void> {
  const guard = activeGuard;
  activeGuard = null;
  if (guard) await guard();
}
