/**
 * OS fullscreen state — renderer half.
 *
 * Main owns the truth (`enter-full-screen` / `leave-full-screen` on the window)
 * and pushes `window:fullscreen`; the initial `system.windowState` fetch covers
 * the boot race where the push landed before the shell mounted (same answer the
 * menu strip uses for `menu:top-level`).
 *
 * The state exists to drive CSS, not React: `document.documentElement`'s
 * `data-fullscreen` collapses the chrome reserves that exist only to dodge OS
 * buttons (macOS traffic-light pad, Windows caption-button insets) — see
 * `html[data-fullscreen]` in v4.css. A module store keeps that attribute
 * correct even before/without any component subscribing.
 */
import { api } from "../services/api";
import { subscribe } from "../services/rpc";

let fullscreen = false;
const listeners = new Set<(next: boolean) => void>();

export function isWindowFullscreen(): boolean {
  return fullscreen;
}

export function subscribeWindowFullscreen(listener: (next: boolean) => void): () => void {
  listeners.add(listener);
  listener(fullscreen);
  return () => {
    listeners.delete(listener);
  };
}

function setFullscreen(next: boolean): void {
  if (fullscreen === next) return;
  fullscreen = next;
  document.documentElement.dataset.fullscreen = String(next);
  for (const listener of listeners) listener(next);
}

/** Wire the store to main. Returns a teardown function. */
export function installFullscreenChrome(): () => void {
  const off = subscribe("window:fullscreen", (payload) => {
    setFullscreen(
      Boolean(payload && typeof payload === "object" && (payload as { fullscreen?: boolean }).fullscreen),
    );
  });
  void api.sys
    .windowState()
    .then((res) => {
      setFullscreen(Boolean(res?.fullscreen));
    })
    .catch(() => {
      /* no window yet (boot) — the first transition will arrive */
    });
  // Keep the attribute in sync even before the first event.
  document.documentElement.dataset.fullscreen = String(fullscreen);
  return off;
}
