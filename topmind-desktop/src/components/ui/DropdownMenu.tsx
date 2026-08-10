/**
 * Portal dropdown / listbox — fixed to viewport, never clipped by overflow.
 *
 * Placement (no flash / jump):
 * 1. On open: measure trigger → provisional coords, render panel **invisible**
 * 2. One layout measure of panel → final coords + `ready`
 * 3. Only then show enter animation
 * Scroll → close (never chase trigger with setState — that causes lag/drift).
 *
 * Stacking: z-menu (110) > tooltip (100) > overlay (70)
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import {
  computeDropdownPosition,
  resolveTriggerRect,
  type DropdownPosition,
} from "../../lib/dropdown-position";
import { acquireMenuLayer } from "../../lib/menu-layer";
import { shouldCloseOnScroll } from "../../lib/scroll-dismiss";

export interface DropdownMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Default true — panel width tracks trigger (settings). False for wide menus. */
  matchTriggerWidth?: boolean;
  /**
   * Close when any scroll container moves (default true).
   * Native menus dismiss on scroll — chasing fixed coords causes laggy drift.
   */
  closeOnScroll?: boolean;
  className?: string;
  panelClassName?: string;
  autoFocus?: boolean;
}

type Placed = DropdownPosition & { ready: boolean };

export function DropdownMenu({
  open,
  onOpenChange,
  trigger,
  children,
  align = "start",
  minWidth = 0,
  maxWidth = 480,
  maxHeight = 320,
  matchTriggerWidth = true,
  closeOnScroll = true,
  className,
  panelClassName,
  autoFocus = true,
}: DropdownMenuProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Placed | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const labelId = useId();

  const compute = useCallback(
    (measurePanel: boolean): Placed | null => {
      const triggerRect = resolveTriggerRect(triggerRef.current);
      if (!triggerRect) return null;

      let panelSize: { width: number; height: number } | null = null;
      if (measurePanel && panelRef.current) {
        const el = panelRef.current;
        // Use offset size (layout box) — more stable than scrollWidth during enter
        panelSize = {
          width: Math.ceil(el.offsetWidth || el.scrollWidth),
          height: Math.ceil(Math.min(el.offsetHeight || el.scrollHeight, maxHeight)),
        };
      }

      const next = computeDropdownPosition({
        trigger: triggerRect,
        panel: panelSize,
        align,
        minWidth,
        maxWidth,
        maxHeight,
        matchTriggerWidth,
        gap: 4,
        pad: 8,
      });
      return { ...next, ready: measurePanel };
    },
    [align, matchTriggerWidth, maxHeight, maxWidth, minWidth],
  );

  // Open: place without paint → measure once → ready (single visible jump-free paint)
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    // Provisional (panel not measured yet — still hidden)
    const provisional = compute(false);
    if (provisional) setPos({ ...provisional, ready: false });

    // Double-rAF: first ensures panel is in DOM with provisional styles; second reads layout
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const final = compute(true);
        if (final) setPos({ ...final, ready: true });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, compute]);

  useEffect(() => {
    if (!open) return;
    return acquireMenuLayer();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (!closeOnScroll) return;
      // Shared policy: inside panel / nested menu-surface scroll stays open
      if (!shouldCloseOnScroll(e, panelRef.current)) return;
      onOpenChangeRef.current(false);
    };
    const onResize = () => {
      const final = compute(true);
      if (final) setPos({ ...final, ready: true });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, closeOnScroll, compute]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onOpenChangeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;

      const items = Array.from(
        panel.querySelectorAll('[role="option"]:not([disabled])'),
      ) as HTMLElement[];
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      let idx = items.indexOf(active as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = idx < 0 ? 0 : Math.min(idx + 1, items.length - 1);
        items[idx]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = idx <= 0 ? items.length - 1 : idx - 1;
        items[idx]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === "Enter" && active && items.includes(active as HTMLElement)) {
        e.preventDefault();
        (active as HTMLElement).click();
      }
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !autoFocus || !pos?.ready) return;
    const id = requestAnimationFrame(() => {
      const active = panelRef.current?.querySelector(
        '[role="option"][aria-selected="true"]',
      ) as HTMLElement | null;
      const first = panelRef.current?.querySelector(
        '[role="option"]:not([disabled])',
      ) as HTMLElement | null;
      (active || first)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open, autoFocus, pos?.ready]);

  return (
    <div ref={triggerRef} className={cn("relative inline-flex min-w-0", className)}>
      {trigger}
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              id={labelId}
              role="listbox"
              data-placement={pos.placement}
              data-menu-surface=""
              data-ready={pos.ready ? "true" : "false"}
              className={cn(
                "v4-menu-surface fixed z-menu overflow-auto p-1",
                // Hide until measured — prevents visible jump from provisional → final
                pos.ready ? "v4-menu-enter opacity-100" : "pointer-events-none opacity-0",
                panelClassName,
              )}
              style={{
                top: pos.top,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function DropdownSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 py-1.5 text-3xs font-semibold uppercase tracking-wide text-text-quaternary">
      {children}
    </div>
  );
}

export function DropdownItem({
  children,
  onSelect,
  disabled,
  destructive,
  active,
  className,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active || undefined}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
      className={cn(
        "v4-menu-item flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-[7px] text-left text-3xs font-medium outline-none",
        "disabled:opacity-40",
        destructive
          ? "text-error hover:bg-status-error-bg focus-visible:bg-status-error-bg focus:bg-status-error-bg"
          : active
            ? "bg-accent-bg-subtle text-accent-color"
            : "text-text-secondary hover:text-text-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}
