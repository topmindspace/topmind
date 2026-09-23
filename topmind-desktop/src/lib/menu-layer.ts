/**
 * Global open-menu layer — tooltips must yield while any portaled menu is open.
 * Uses a refcount so nested/overlapping menus stay stable.
 */

const ATTR = "data-menu-open";

let openCount = 0;

export function acquireMenuLayer(): () => void {
  openCount += 1;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute(ATTR, String(openCount));
  }
  return () => {
    openCount = Math.max(0, openCount - 1);
    if (typeof document === "undefined") return;
    if (openCount === 0) document.documentElement.removeAttribute(ATTR);
    else document.documentElement.setAttribute(ATTR, String(openCount));
  };
}

export function isMenuLayerActive(): boolean {
  return openCount > 0;
}

export const MENU_OPEN_ATTR = ATTR;
