/**
 * Live TitleBar identity overlay — period name, collection stats.
 * Views register on mount and clear on unmount. TitleBar reads via
 * useSyncExternalStore so the slot is never a dead empty div for copy.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import type { TitleBarLive } from "./titlebar-identity";

type TitleBarChromeState = TitleBarLive & { owner: string | null };

const EMPTY: TitleBarChromeState = { owner: null, title: "", stats: "" };

let state: TitleBarChromeState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribeTitleBarChrome(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTitleBarChrome(): TitleBarChromeState {
  return state;
}

export function useTitleBarChromeLive(): TitleBarChromeState {
  return useSyncExternalStore(subscribeTitleBarChrome, getTitleBarChrome, getTitleBarChrome);
}

/** Register live title/stats for the active canvas. Clears on unmount. */
export function useTitleBarChrome(owner: string, live: TitleBarLive): void {
  const title = live.title ?? "";
  const stats = live.stats ?? "";
  useLayoutEffect(() => {
    state = { owner, title, stats };
    emit();
    return () => {
      if (state.owner === owner) {
        state = EMPTY;
        emit();
      }
    };
  }, [owner, title, stats]);
}
