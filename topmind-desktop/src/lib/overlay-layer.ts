/**
 * Workbench modal layer — OverlayHost, Confirm/Prompt/Error dialogs, ingest gate.
 *
 * Refcounted: nested confirms inside settings do not drop html[data-overlay-open]
 * (that attr flattens list-mode stream sticky day headers so Electron cannot
 * composite them above body-portaled scrims).
 */
import { createContext, useContext } from "react";

export const OVERLAY_OPEN_ATTR = "data-overlay-open";

let holds = 0;
let active = false;
let portalRoot: HTMLElement | null = null;
let hostRelease: (() => void) | null = null;
const listeners = new Set<(next: boolean) => void>();

function stampAttr(): void {
  if (typeof document === "undefined") return;
  if (active) document.documentElement.setAttribute(OVERLAY_OPEN_ATTR, "");
  else document.documentElement.removeAttribute(OVERLAY_OPEN_ATTR);
}

function setWorkbenchInert(on: boolean): void {
  if (typeof document === "undefined") return;
  const bench = document.getElementById("workbench-root");
  if (!(bench instanceof HTMLElement)) return;
  bench.inert = on;
  if (on) bench.setAttribute("aria-hidden", "true");
  else bench.removeAttribute("aria-hidden");
}

function setActive(next: boolean): void {
  if (active === next) return;
  active = next;
  stampAttr();
  setWorkbenchInert(next);
  listeners.forEach((fn) => fn(active));
}

/** Hold the modal layer. First acquire stamps the attr + inerts the canvas. */
export function acquireOverlayLayer(root?: HTMLElement | null): () => void {
  holds += 1;
  if (root) portalRoot = root;
  setActive(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) {
      portalRoot = null;
      setActive(false);
    }
  };
}

/**
 * OverlayHost hold: true acquires once, repeated true only updates the tooltip
 * portal root (must not re-notify — that would close settings-owned dropdowns).
 */
export function setOverlayLayer(next: boolean, root: HTMLElement | null): void {
  if (next) {
    if (root) portalRoot = root;
    if (!hostRelease) hostRelease = acquireOverlayLayer(root ?? undefined);
  } else if (hostRelease) {
    hostRelease();
    hostRelease = null;
  }
}

export function setOverlayPortalRoot(root: HTMLElement | null): void {
  portalRoot = root;
}

export function isOverlayLayerActive(): boolean {
  return active;
}

export function getOverlayPortalRoot(): HTMLElement | null {
  return portalRoot;
}

export function onOverlayLayerChange(fn: (next: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tooltip / HelpTip inside OverlayHost consume this to portal into the sheet. */
export const OverlayPortalContext = createContext<HTMLElement | null>(null);

export function useOverlayPortalRoot(): HTMLElement | null {
  return useContext(OverlayPortalContext);
}
