/**
 * Windows title-bar menu strip — the app-drawn half of the native menu.
 *
 * The strip only ever knows ids. Main reports the top-level entries in template
 * order with labels already localized (`system.menuTopLevel`) and pops the matching
 * submenu on request (`system.menuPopup` → `Menu.popup`), so the menu is still
 * defined exactly once, in `electron/lib/menu-spec.mjs`. Nothing here re-implements
 * an item, a label or a checkmark.
 *
 * State is a tiny module store rather than a zustand slice: it has one writer
 * (this file) and two readers (the strip's list and its open item), and it must be
 * readable before React mounts because main pushes the list on the ready sequence.
 */
import { api } from "../services/api";
import { subscribe } from "../services/rpc";

export interface MenuTopLevelItem {
  id: string;
  label: string;
}

let items: MenuTopLevelItem[] = [];
let openId: string | null = null;
const itemListeners = new Set<(next: MenuTopLevelItem[]) => void>();
const openListeners = new Set<(next: string | null) => void>();

export function getMenuTopLevelItems(): MenuTopLevelItem[] {
  return items;
}

export function subscribeMenuTopLevel(listener: (next: MenuTopLevelItem[]) => void): () => void {
  itemListeners.add(listener);
  listener(items);
  return () => {
    itemListeners.delete(listener);
  };
}

/** Id of the section whose native popup is on screen, or null. */
export function getOpenMenuId(): string | null {
  return openId;
}

export function subscribeOpenMenu(listener: (next: string | null) => void): () => void {
  openListeners.add(listener);
  listener(openId);
  return () => {
    openListeners.delete(listener);
  };
}

function setItems(next: MenuTopLevelItem[]): void {
  items = next;
  for (const listener of itemListeners) listener(items);
}

function setOpenId(next: string | null): void {
  if (openId === next) return;
  openId = next;
  for (const listener of openListeners) listener(openId);
}

/**
 * Pop the native submenu `id` anchored under the title bar row.
 *
 * Main owns the toggle rule (clicking the item whose menu is already open closes
 * it) because only main can tell a close from an open — the mousedown closes the
 * popup before the click lands. The optimistic `setOpenId` is just so the strip's
 * pressed state responds on the same frame; main's `menu:popup-state` corrects it.
 *
 * @param id Top-level menu id, as reported by `system.menuTopLevel`.
 * @param row The title bar row — the popup hangs from its bottom edge.
 */
export function popMenuSection(id: string, row: DOMRect | null): void {
  if (!row) return;
  setOpenId(id);
  void api.sys
    .menuPopup({ id, x: Math.round(row.left), y: Math.round(row.bottom) })
    .catch(() => setOpenId(null));
}

/**
 * Wire the strip to main: pushed top-level list, popup open/close state, and an
 * initial fetch for the case where the shell mounted after main's ready push.
 * Returns a teardown function.
 */
export function installMenuStrip(): () => void {
  const offItems = subscribe("menu:top-level", (payload) => {
    if (Array.isArray(payload)) setItems(payload as MenuTopLevelItem[]);
  });
  const offState = subscribe("menu:popup-state", (payload) => {
    const next =
      payload && typeof payload === "object" && "openId" in payload
        ? ((payload as { openId?: string | null }).openId ?? null)
        : null;
    setOpenId(next);
  });

  void api.sys
    .menuTopLevel()
    .then((res) => {
      if (Array.isArray(res?.items)) setItems(res.items);
    })
    .catch(() => {
      /* no menu yet (boot) — the pushed list will arrive */
    });

  return () => {
    offItems();
    offState();
  };
}
