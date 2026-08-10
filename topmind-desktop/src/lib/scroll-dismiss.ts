/**
 * Shared scroll-to-dismiss policy for portaled menus / popovers.
 *
 * Capture-phase window scroll listeners must NOT close the panel when the user
 * scrolls **inside** the panel (long lists, todo body, select options).
 * Matches DropdownMenu's "scroll inside panel → skip" rule.
 */

function hasClosest(node: unknown): node is { closest: (sel: string) => Element | null } {
  return Boolean(
    node &&
      typeof node === "object" &&
      typeof (node as { closest?: unknown }).closest === "function",
  );
}

/**
 * @param e - scroll event (usually window capture listener)
 * @param panel - open panel element (or null if unmounted)
 * @returns true when the panel should close
 */
export function shouldCloseOnScroll(
  e: Event,
  panel: Element | null | undefined,
): boolean {
  const target = e.target as Node | null;
  // Scrolling the panel itself (overflow:auto body)
  if (target && panel?.contains(target)) return false;
  // Nested menu / select surfaces (submenus, portal children marked data-menu-surface)
  if (hasClosest(target) && target.closest("[data-menu-surface]")) {
    return false;
  }
  // Panel content marked as scroll host
  if (hasClosest(target) && target.closest("[data-scroll-stable-panel]")) {
    return false;
  }
  return true;
}

/**
 * Factory for capture-phase scroll listeners.
 * @param getPanel - live panel element getter
 * @param onClose - close callback
 * @param enabled - when false, never closes (e.g. pinned todo)
 */
export function createScrollDismissHandler(
  getPanel: () => Element | null | undefined,
  onClose: () => void,
  enabled: () => boolean = () => true,
): (e: Event) => void {
  return (e: Event) => {
    if (!enabled()) return;
    if (!shouldCloseOnScroll(e, getPanel())) return;
    onClose();
  };
}
