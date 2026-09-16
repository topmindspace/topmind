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
import { APP_NAME } from "../../lib/app-identity";
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

/**
 * Inline brand mark — same nested-D plate as `public/favicon.svg`.
 *
 * Shipped as `<img src="/favicon.svg">` it 404s under `loadFile` (file://
 * resolves root-absolute against the filesystem). Inline SVG cannot miss.
 */
function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="shrink-0 rounded-[3px]"
      role="img"
      aria-label="topmind"
      data-app-mark
    >
      <defs>
        <linearGradient id="brand-mark-g" x1="12" y1="52" x2="52" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#075985" />
          <stop offset="0.45" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#2fa89a" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" ry="14" fill="#ffffff" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" ry="13.5" fill="none" stroke="#e8eaef" strokeWidth="1" />
      <path
        fill="none"
        stroke="url(#brand-mark-g)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 18h10c9 0 15 6 15 14s-6 14-15 14H20z"
      />
      <path
        fill="none"
        stroke="url(#brand-mark-g)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M26 25h6c4.8 0 8 3 8 7s-3.2 7-8 7h-6z"
      />
    </svg>
  );
}

/**
 * Popup anchor: left edge of the *clicked* label, bottom edge of the OS chrome
 * row. Using the strip's left for every section made all submenus stack at the
 * window's left edge regardless of which menu was opened.
 */
function popupAnchor(button: HTMLElement): DOMRect | null {
  const btn = button.getBoundingClientRect();
  const strip = button.closest("[data-os-chrome]")?.getBoundingClientRect();
  if (!strip) return null;
  return {
    left: btn.left,
    right: btn.right,
    top: strip.top,
    bottom: strip.bottom,
    width: btn.width,
    height: strip.height,
    x: btn.left,
    y: strip.top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

export function AppMenuBar() {
  const items = useMenuTopLevelItems();
  const openId = useOpenMenuId();

  if (!usesCaptionOverlay) return null;

  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2"
      data-app-menu-strip
    >
      <BrandMark size={16} />
      <span
        className="shrink-0 text-xs font-semibold tracking-tight text-text-tertiary"
        data-app-name
      >
        {APP_NAME}
      </span>
      {items.length > 0 ? (
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
                onClick={(event) => popMenuSection(item.id, popupAnchor(event.currentTarget))}
                // Hover-to-switch is what makes this read as a menu bar rather than a
                // set of unrelated dropdowns: once a section is open, sliding across
                // the strip opens the neighbour (main closes the previous popup).
                onMouseEnter={(event) => {
                  if (openId && openId !== item.id) {
                    popMenuSection(item.id, popupAnchor(event.currentTarget));
                  }
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
