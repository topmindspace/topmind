/**
 * TodoPopover — floating todo panel from TitleBar icon.
 *
 * Triggered by:
 * - TitleBar ListTodo icon click
 * - ⌘⇧T keyboard shortcut (via emitLocal "todo:toggle-popover")
 *
 * Two modes:
 * - **Unpinned** (default): dropdown-style — closes on outside click / scroll / Esc
 * - **Pinned**: stays open as a floating panel; user can drag to reposition
 *
 * Design: lightweight portal panel, not a Dialog/Overlay — no backdrop,
 * doesn't block editor interaction. Pinned mode = always-on-top mini window.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Loader2, ListTodo, RefreshCw, Pin, PinOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { shouldCloseOnScroll } from "../../lib/scroll-dismiss";
import { useTodoStore } from "../../stores/todo-store";
import { Tooltip } from "../ui/tooltip";
import { TodoListBody } from "./TodoListBody";

interface TodoPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 480;

export function TodoPopover({ open, onOpenChange, children }: TodoPopoverProps) {
  const { t } = useTranslation("shell");
  const refresh = useTodoStore((s) => s.refresh);
  const maintain = useTodoStore((s) => s.maintain);
  const maintaining = useTodoStore((s) => s.maintaining);
  const items = useTodoStore((s) => s.items);
  const initRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  // Load on first open
  useEffect(() => {
    if (open && !initRef.current) {
      initRef.current = true;
      void refresh();
    }
  }, [open, refresh]);

  // Init file watcher on mount
  useEffect(() => {
    const unsub = useTodoStore.getState()._initWatch();
    return () => { unsub?.(); };
  }, []);

  // Reset position when closed (so next open recomputes from trigger)
  useEffect(() => {
    if (!open) {
      setPos(null);
      setPinned(false);
    }
  }, [open]);

  // Compute initial position — right side of viewport, below title bar
  useEffect(() => {
    if (open && !pinned && !pos) {
      const x = window.innerWidth - PANEL_WIDTH - 16;
      const y = 52; // below title bar
      setPos({ x, y });
    }
  }, [open, pinned, pos]);

  // Recompute position on window resize (unpinned only — pinned stays where user dragged)
  useEffect(() => {
    if (!open || pinned) return;
    const handle = () => {
      setPos({ x: window.innerWidth - PANEL_WIDTH - 16, y: 52 });
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [open, pinned]);

  // Close on outside click (unpinned only)
  useEffect(() => {
    if (!open || pinned) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, pinned, onOpenChange]);

  // Close on outside scroll only (unpinned) — internal list scroll must stay open
  useEffect(() => {
    if (!open || pinned) return;
    const handle = (e: Event) => {
      if (!shouldCloseOnScroll(e, panelRef.current)) return;
      onOpenChange(false);
    };
    window.addEventListener("scroll", handle, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handle, { capture: true });
  }, [open, pinned, onOpenChange]);

  // Esc closes (pinned: just unpin, unpinned: close)
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pinned) { setPinned(false); }
        else { onOpenChange(false); }
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, pinned, onOpenChange]);

  // Drag handling (pinned mode only — drag from header)
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!pinned || !pos) return;
    e.preventDefault();
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  }, [pinned, pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      const nx = Math.max(4, Math.min(window.innerWidth - PANEL_WIDTH - 4, dragStart.current.px + dx));
      const ny = Math.max(4, Math.min(window.innerHeight - 100, dragStart.current.py + dy));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => { setDragging(false); dragStart.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const activeCount = items.filter((i) => !i.done).length;

  const panel = open && pos ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("todo.title")}
      data-scroll-stable-panel=""
      data-menu-surface=""
      className={cn(
        // overflow-hidden + flex-col maxHeight: body can scroll inside (not page)
        "fixed z-[var(--z-popover-overlay)] flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-subtle bg-surface-elevated/90 shadow-[var(--shadow-elevated-hairline)] backdrop-blur-[var(--blur-glass)] backdrop-saturate-150 v4-todo-popover-enter",
        pinned && "shadow-[var(--shadow-float)]",
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
      }}
    >
      {/* Header — drag handle when pinned; shrink-0 so body absorbs remaining height */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-b border-border-subtle-dim px-2 py-1.5",
          pinned ? "cursor-move" : "cursor-default",
        )}
        onMouseDown={onDragStart}
      >
        <ListTodo size={ICON.micro} className="shrink-0 text-text-quaternary" />
        <span className="flex-1 text-3xs font-medium text-text-secondary">
          {t("todo.title")}
        </span>
        {activeCount > 0 ? (
          <span className="rounded-full bg-surface-muted px-1.5 text-3xs tabular-nums text-text-quaternary">
            {activeCount}
          </span>
        ) : null}
        <Tooltip content={t("todo.maintainTip")}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Progressive force: first click respects skip hash; second click after
              // "already processed" re-scans (parity with body force-retry CTA).
              const st = useTodoStore.getState();
              const force = st.maintainReason === "all-periods-processed";
              void maintain(force ? { force: true } : undefined);
            }}
            disabled={maintaining === "maintaining"}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] disabled:opacity-40",
              maintaining === "maintaining"
                ? "v4-ai-chip-gradient"
                : "text-text-quaternary transition-colors hover:bg-surface-muted hover:text-accent-color",
            )}
            aria-label={t("todo.maintain")}
            data-todo-maintain
            data-todo-maintain-active={maintaining === "maintaining" || undefined}
          >
            {maintaining === "maintaining" ? (
              <Loader2 size={ICON.nano} className="animate-spin" />
            ) : (
              <Sparkles size={ICON.nano} />
            )}
          </button>
        </Tooltip>
        <Tooltip content={t("todo.refreshTip")}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void refresh(); }}
            className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary"
            aria-label={t("todo.refresh")}
          >
            <RefreshCw size={ICON.nano} />
          </button>
        </Tooltip>
        {/* Pin / Unpin toggle */}
        <Tooltip content={pinned ? t("todo.unpin") : t("todo.pin")}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPinned((v) => !v); }}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] transition-colors hover:bg-surface-muted",
              pinned ? "text-accent-color" : "text-text-quaternary hover:text-text-secondary",
            )}
            aria-label={pinned ? t("todo.unpin") : t("todo.pin")}
          >
            {pinned ? <PinOff size={ICON.nano} /> : <Pin size={ICON.nano} />}
          </button>
        </Tooltip>
        {/* Close (only when unpinned; pinned closes via unpin then close) */}
        {!pinned ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
            className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary"
            aria-label={t("todo.close")}
          >
            <X size={ICON.nano} />
          </button>
        ) : null}
      </div>

      {/*
        Body scroll host: min-h-0 flex-1 is required for flex children to shrink
        under maxHeight — without it the list grows past the panel and wheel
        scrolls the page (capture target outside) → panel dismisses.
        Parity with SuggestPopover / TaskPanel.
      */}
      <div
        className="v4-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1.5"
        data-scroll-stable-panel=""
        data-todo-scroll-body=""
      >
        <TodoListBody />
      </div>
    </div>
  ) : null;

  return (
    <>
      <div ref={triggerRef} className="contents">
        {children}
      </div>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
