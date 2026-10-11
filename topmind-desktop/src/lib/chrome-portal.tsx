/**
 * Portal children into a named chrome slot (TitleBar actions, sidebar tree tools).
 * Slot hosts stay mounted in Shell / Sidebar; views register on mount and leave
 * on unmount by simply not rendering this.
 *
 * The live element is re-resolved when the host remounts (focus-mode TitleBar
 * used to drop `data-titlebar-actions-slot`, leaving portals on a detached node).
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const slotListeners = new Set<() => void>();

/** Live query — never returns a detached node. */
export function queryChromeSlot(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(selector);
  return el && el.isConnected ? el : null;
}

/** Slot hosts call this from a callback ref so portals re-bind on attach/detach. */
export function notifyChromeSlots(): void {
  for (const fn of slotListeners) fn();
}

/**
 * Subscribe to the current connected node for `selector`.
 * Re-fires when notifyChromeSlots() runs or the tree mutates.
 */
export function watchChromeSlot(
  selector: string,
  onChange: (el: HTMLElement | null) => void,
): () => void {
  let current: HTMLElement | null = queryChromeSlot(selector);
  onChange(current);
  const sync = () => {
    const next = queryChromeSlot(selector);
    if (next === current) return;
    current = next;
    onChange(current);
  };
  slotListeners.add(sync);
  let mo: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    mo = new MutationObserver(sync);
    const root = document.documentElement || document.body;
    if (root) mo.observe(root, { childList: true, subtree: true });
  }
  return () => {
    slotListeners.delete(sync);
    mo?.disconnect();
  };
}

export function ChromePortal({
  selector,
  children,
}: {
  selector: string;
  children: ReactNode;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => watchChromeSlot(selector, setEl), [selector]);
  if (!el || !el.isConnected || children == null) return null;
  return createPortal(children, el);
}

export function TitleBarActions({ children }: { children: ReactNode }) {
  return <ChromePortal selector="[data-titlebar-actions-slot]">{children}</ChromePortal>;
}
