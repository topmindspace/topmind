/**
 * ContextMenu — right-click menu (portal, fixed at cursor).
 * Single-shot position (no ResizeObserver chase) → avoids flash/jump.
 * Viewport clamp + flip; keyboard ↑↓ Home/End Enter Esc; type-ahead.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
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
}

function placeMenu(
  x: number,
  y: number,
  w: number,
  h: number,
): { left: number; top: number } {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y;
  if (left + w > vw - pad) left = Math.max(pad, x - w);
  if (top + h > vh - pad) top = Math.max(pad, y - h);
  left = Math.max(pad, Math.min(left, vw - w - pad));
  top = Math.max(pad, Math.min(top, vh - h - pad));
  return { left, top };
}

export function ContextMenu({ open, x, y, onClose, children, minWidth = 200 }: ContextMenuProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef(-1);
  const typeBufRef = useRef({ buf: "", t: 0 });
  /** ready=false first paint at cursor (invisible) → measure → ready=true (no mid-flight jump) */
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: x,
    top: y,
    ready: false,
  });

  const getMenuItems = () => {
    const all = contentRef.current?.querySelectorAll('[role="menuitem"]') ?? [];
    return Array.from(all).filter((el) => !el.hasAttribute("data-disabled")) as HTMLElement[];
  };

  // Place once: provisional at cursor (hidden) → measure → ready (visible enter)
  useLayoutEffect(() => {
    if (!open) {
      setPos({ left: x, top: y, ready: false });
      return;
    }
    // Single provisional state (avoid double setPos which forced a paint jump)
    const el = contentRef.current;
    const w = el?.offsetWidth || minWidth;
    const h = el?.offsetHeight || 160;
    const next = placeMenu(x, y, w, h);
    setPos({ ...next, ready: false });
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el2 = contentRef.current;
        const w2 = el2?.offsetWidth || w;
        const h2 = el2?.offsetHeight || h;
        const final = placeMenu(x, y, w2, h2);
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
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      data-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        "v4-menu-item flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-[7px] text-3xs font-medium outline-none select-none",
        destructive
          ? "text-error hover:bg-status-error-bg focus:bg-status-error-bg focus-visible:bg-status-error-bg"
          : "text-text-primary",
        disabled && "pointer-events-none opacity-45",
      )}
    >
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary opacity-90">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <kbd className="v4-kbd shrink-0 text-text-quaternary">{shortcut}</kbd> : null}
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
