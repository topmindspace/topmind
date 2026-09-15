/**
 * App-owned menu strip (Windows OS chrome row content).
 *
 * Windows draws the HMENU in a row of its own *below* the caption, and Electron
 * cannot merge the two into one native row. This strip is drawn in the dedicated
 * full-width OS chrome row (`OsChromeStrip`) — not inside any product column
 * header — so OS chrome stays out of product IA. Labels are app-drawn; menus stay
 * native (`popMenuSection` → `Menu.popup`); min/max/close paint on the right end
 * of the same OS row via `titleBarOverlay` / `--wc-inset-right`.
 *
 * The strip renders whatever main reports — it does not know or care that the
 * labels are 文件 / 编辑 / …, so a new top-level menu needs no change here.
 *
 * macOS has a system menu bar and Linux keeps the native menu bar from its desktop
 * environment, so this returns null on both (`usesCaptionOverlay`).
 */
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { APP_ICON, APP_NAME } from "../../lib/app-identity";
import { usesCaptionOverlay } from "../../lib/platform";
import {
  getMenuTopLevelItems,
  getOpenMenuId,
  popMenuSection,
  subscribeMenuTopLevel,
  subscribeOpenMenu,
  type MenuTopLevelItem,
} from "../../lib/menu-strip";

function useMenuTopLevelItems(): MenuTopLevelItem[] {
  const [items, setItems] = useState<MenuTopLevelItem[]>(getMenuTopLevelItems);
  useEffect(() => subscribeMenuTopLevel(setItems), []);
  return items;
}

function useOpenMenuId(): string | null {
  const [openId, setOpenId] = useState<string | null>(getOpenMenuId);
  useEffect(() => subscribeOpenMenu(setOpenId), []);
  return openId;
}

export function AppMenuBar() {
  const items = useMenuTopLevelItems();
  const openId = useOpenMenuId();

  if (!usesCaptionOverlay || items.length === 0) return null;

  /** The popup hangs from the bottom edge of the OS chrome row, not of the button. */
  const rowRect = (target: HTMLElement): DOMRect | null =>
    target.closest("[data-os-chrome]")?.getBoundingClientRect() ?? null;

  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-1.5"
      data-app-menu-strip
    >
      <img
        src={APP_ICON}
        alt=""
        aria-hidden
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 rounded-[3px]"
        data-app-mark
      />
      <span
        className="shrink-0 text-xs font-semibold tracking-tight text-text-tertiary"
        data-app-name
      >
        {APP_NAME}
      </span>
      <div role="menubar" aria-label={APP_NAME} className="v4-no-drag flex items-center gap-0">
        {items.map((item) => {
          const open = openId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              data-menu-section={item.id}
              data-open={open ? "true" : undefined}
              className={cn(
                "rounded-[var(--radius-sm)] px-2 py-1 text-xs leading-none text-text-secondary transition-colors",
                "hover:bg-surface-muted/60 hover:text-text-primary v4-focus-ring",
                open && "bg-surface-muted text-text-primary",
              )}
              onClick={(event) => popMenuSection(item.id, rowRect(event.currentTarget))}
              // Hover-to-switch is what makes this read as a menu bar rather than a
              // set of unrelated dropdowns: once a section is open, sliding across
              // the strip opens the neighbour (main closes the previous popup).
              onMouseEnter={(event) => {
                if (openId && openId !== item.id) popMenuSection(item.id, rowRect(event.currentTarget));
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
