/**
 * ContextMenu — right-click menu (portal, fixed at cursor).
 * Single-shot position (no ResizeObserver chase) → avoids flash/jump.
 * Viewport clamp + flip; keyboard ↑↓ Home/End Enter Esc Tab; type-ahead;
 * nested `ContextMenuSubmenu` (hover / → opens, ← closes).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/kit";
import { placeContextMenu } from "../../lib/dropdown-position";
import { acquireMenuLayer } from "../../lib/menu-layer";
import { onOverlayLayerChange } from "../../lib/overlay-layer";
import { shouldCloseOnScroll } from "../../lib/scroll-dismiss";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
  minWidth?: number;
  /** Screen-reader name for the menu surface. */
  ariaLabel?: string;
}

export function ContextMenu({ open, x, y, onClose, children, minWidth = 200, ariaLabel }: ContextMenuProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef(-1);
  const typeBufRef = useRef({ buf: "", t: 0 });
  /** ready=false first paint at cursor (invisible) → measure → ready=true (no mid-flight jump) */
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean; placement: "top" | "bottom" }>({
    left: x,
    top: y,
    ready: false,
    placement: "bottom",
  });

  const getMenuItems = () => {
    const all = contentRef.current?.querySelectorAll('[role="menuitem"]') ?? [];
    return Array.from(all).filter((el) => !el.hasAttribute("data-disabled")) as HTMLElement[];
  };

  const openSubmenuAtActive = useCallback(() => {
    const items = getMenuItems();
    const active = items[focusIndexRef.current] || (document.activeElement as HTMLElement | null);
    if (!active || !contentRef.current?.contains(active)) return false;
    const trigger = active.closest("[data-submenu-root]") as HTMLElement | null;
    if (!trigger) return false;
    const btn = trigger.querySelector<HTMLButtonElement>("[data-submenu-trigger]");
    btn?.click();
    btn?.focus();
    return true;
  }, []);

  // Place once: provisional at cursor (hidden) → measure → ready (visible enter)
  useLayoutEffect(() => {
    if (!open) {
      setPos({ left: x, top: y, ready: false, placement: "bottom" });
      return;
    }
    // Single provisional state (avoid double setPos which forced a paint jump)
    const el = contentRef.current;
    const w = el?.offsetWidth || minWidth;
    const h = el?.offsetHeight || 160;
    const next = placeContextMenu({ x, y, panel: { width: w, height: h }, minWidth });
    setPos({ ...next, ready: false });
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el2 = contentRef.current;
        const w2 = el2?.offsetWidth || w;
        const h2 = el2?.offsetHeight || h;
        const final = placeContextMenu({ x, y, panel: { width: w2, height: h2 }, minWidth });
        setPos({ ...final, ready: true });
        focusIndexRef.current = -1;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, x, y, minWidth]);

  useEffect(() => {
    if (!open) return;
    const release = acquireMenuLayer();
    const onDoc = (e: MouseEvent) => {
      if (contentRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      // Keep open when scrolling inside the menu (long lists / nested panels)
      if (!shouldCloseOnScroll(e, contentRef.current)) return;
      onClose();
    };
    const onResize = () => onClose();
    const unsubOverlay = onOverlayLayerChange((overlayActive) => {
      if (overlayActive) onClose();
    });
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      release();
      unsubOverlay();
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = getMenuItems();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndexRef.current =
        focusIndexRef.current < 0 ? 0 : Math.min(focusIndexRef.current + 1, items.length - 1);
      items[focusIndexRef.current]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndexRef.current =
        focusIndexRef.current <= 0 ? items.length - 1 : focusIndexRef.current - 1;
      items[focusIndexRef.current]?.focus();
    } else if (e.key === "Tab") {
      // Tab walks the same list (native menus do); never leave the surface.
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      const cur = focusIndexRef.current;
      focusIndexRef.current =
        cur < 0
          ? (dir > 0 ? 0 : items.length - 1)
          : (cur + dir + items.length) % items.length;
      items[focusIndexRef.current]?.focus();
    } else if (e.key === "ArrowRight") {
      if (openSubmenuAtActive()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      focusIndexRef.current = 0;
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      focusIndexRef.current = items.length - 1;
      items[focusIndexRef.current]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const focused = items[focusIndexRef.current >= 0 ? focusIndexRef.current : 0];
      focused?.click();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const now = Date.now();
      if (now - typeBufRef.current.t > 700) typeBufRef.current.buf = "";
      typeBufRef.current.t = now;
      typeBufRef.current.buf += e.key.toLowerCase();
      const prefix = typeBufRef.current.buf;
      const idx = items.findIndex((el) =>
        (el.textContent || "").trim().toLowerCase().startsWith(prefix),
      );
      if (idx >= 0) {
        focusIndexRef.current = idx;
        items[idx]?.focus();
      }
    }
  };

  useEffect(() => {
    if (!open || !pos.ready) return;
    requestAnimationFrame(() => {
      const items = getMenuItems();
      if (items[0]) {
        focusIndexRef.current = 0;
        items[0].focus({ preventScroll: true });
      } else {
        contentRef.current?.focus({ preventScroll: true });
      }
    });
  }, [open, pos.ready]);

  if (!open) return null;

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "v4-menu-surface fixed z-menu outline-none",
        "min-w-[200px] overflow-hidden p-1",
        // Only animate after final place — avoids "slide then jump"
        pos.ready ? "v4-menu-enter opacity-100" : "opacity-0 pointer-events-none",
      )}
      data-menu-surface=""
      data-placement={pos.placement}
      style={{ left: pos.left, top: pos.top, minWidth }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  children,
  onClick,
  destructive,
  disabled,
  icon,
  shortcut,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      data-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "v4-menu-item flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-[7px] text-left text-3xs font-medium outline-none select-none",
        destructive
          ? "text-error hover:bg-status-error-bg focus:bg-status-error-bg focus-visible:bg-status-error-bg"
          : "text-text-primary",
        disabled && "pointer-events-none opacity-45",
      )}
      data-soft-disabled={disabled ? "true" : undefined}
    >
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary opacity-90">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <kbd className="v4-kbd shrink-0 text-text-quaternary">{shortcut}</kbd> : null}
    </button>
  );
}

/**
 * Nested menu — opens a portal panel to the right of the parent item.
 * Hover / focus / → / click opens; ← / Esc / outside click closes the child
 * without dismissing the parent menu.
 */
export function ContextMenuSubmenu({
  label,
  icon,
  children,
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean } | null>(null);

  const place = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const w = panelRef.current?.offsetWidth || 180;
    const h = panelRef.current?.offsetHeight || 120;
    // Prefer opening to the right; flip left near the viewport edge.
    const pad = 8;
    let left = r.right + 4;
    let top = r.top;
    if (left + w > window.innerWidth - pad) left = Math.max(pad, r.left - w - 4);
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
    setPos({ left: Math.round(left), top: Math.round(top), ready: false });
    requestAnimationFrame(() => {
      const w2 = panelRef.current?.offsetWidth || w;
      const h2 = panelRef.current?.offsetHeight || h;
      let left2 = r.right + 4;
      let top2 = r.top;
      if (left2 + w2 > window.innerWidth - pad) left2 = Math.max(pad, r.left - w2 - 4);
      if (top2 + h2 > window.innerHeight - pad) top2 = Math.max(pad, window.innerHeight - h2 - pad);
      setPos({ left: Math.round(left2), top: Math.round(top2), ready: true });
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, place]);

  // Auto-focus first item when the panel becomes ready
  useEffect(() => {
    if (!open || !pos?.ready) return;
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])');
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open, pos?.ready]);

  return (
    <div ref={rootRef} data-submenu-root="" className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        data-submenu-trigger=""
        data-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        className={cn(
          "v4-menu-item flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-[7px] text-left text-3xs font-medium outline-none select-none",
          "text-text-primary",
          disabled && "pointer-events-none opacity-45",
        )}
      >
        {icon ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary opacity-90">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="v4-kbd shrink-0 text-text-quaternary" aria-hidden>
          ›
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              data-menu-surface=""
              data-submenu-panel=""
              className={cn(
                "v4-menu-surface fixed z-menu min-w-[160px] overflow-hidden p-1 outline-none",
                pos.ready ? "v4-menu-enter opacity-100" : "pointer-events-none opacity-0",
              )}
              style={{ left: pos.left, top: pos.top }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function ContextMenuSeparator() {
  return <div className="v4-menu-sep my-1 h-px" role="separator" />;
}

export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 py-1 text-3xs font-semibold uppercase tracking-wide text-text-quaternary">
      {children}
    </div>
  );
}
