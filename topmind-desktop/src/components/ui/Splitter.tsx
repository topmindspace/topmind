/**
 * Splitter — draggable divider for resizing adjacent panels.
 *
 * Pointer-capture based (mouse + touch/pen) and keyboard-operable
 * (←/→ steps, Shift = coarse). Drag state lives in a ref so a missed
 * pointerup cannot leave the divider "sticky" — width kept changing
 * after the button was released (classic setPointerCapture race).
 * Window-level pointerup / lostpointercapture are hard stoppers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/kit";

interface SplitterProps {
  side: "left" | "right";
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  onDragStateChange?: (dragging: boolean) => void;
}

export function Splitter({ side, value, onChange, min = 180, max = 600, onDragStateChange }: SplitterProps) {
  const { t } = useTranslation("shell");
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;

  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    // Pointer may have left the hit area mid-drag — drop hover too so the
    // divider does not stay lit after a capture-lost release.
    setHovering(false);
    onDragStateChangeRef.current?.(false);
    try {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    } catch {
      /* ignore */
    }
  }, []);

  // Safety net: any pointerup outside the element (lost capture, overlay steal)
  // must end the drag. Element-level pointerup alone is not enough.
  // Cleanup also restores body styles — unmount mid-drag (⌘B, focus mode,
  // workspace switch) must not leave user-select/cursor locked.
  useEffect(() => {
    if (!dragging) return;
    const stop = () => endDrag();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      endDrag();
    };
  }, [dragging, endDrag]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button starts a resize — right/middle click stays inert.
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture optional — window listeners still stop the drag */
      }
      draggingRef.current = true;
      setDragging(true);
      onDragStateChangeRef.current?.(true);
      try {
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const parentRect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      // Left panel: width = distance from parent's left edge to the pointer.
      // Right panel: width = distance from the pointer to the parent's right edge.
      const next =
        side === "left" ? e.clientX - parentRect.left : parentRect.right - e.clientX;
      onChangeRef.current(clamp(next));
    },
    [side, clamp],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      endDrag();
    },
    [endDrag],
  );

  const onLostPointerCapture = useCallback(() => {
    endDrag();
  }, [endDrag]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 48 : 16;
      const dir = (e.key === "ArrowLeft" ? -1 : 1) * (side === "left" ? 1 : -1);
      onChangeRef.current(clamp(value + dir * step));
    },
    [clamp, value, side],
  );

  const active = dragging || hovering;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        // Hover only paints idle highlight — never drives width.
        if (!draggingRef.current) setHovering(false);
      }}
      onPointerLeave={() => {
        if (!draggingRef.current) setHovering(false);
      }}
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={t("splitter.resizePanel")}
      data-splitter={side}
      data-dragging={dragging || undefined}
      className={cn(
        "group relative z-local flex w-px cursor-col-resize touch-none items-center justify-center outline-none",
        "transition-[background-color,box-shadow] duration-[var(--duration-fast)] v4-focus-ring",
        active
          ? "bg-accent-color shadow-[0_0_0_1px_var(--color-accent-color)]"
          : "bg-border-subtle-dim hover:bg-border-subtle",
      )}
    >
      {/* Wider hit area for easier grabbing */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-local" />
      {/* Grip pill — appears on hover/drag/focus */}
      <div
        className={cn(
          "absolute top-1/2 flex h-8 w-1 -translate-y-1/2 items-center justify-center rounded-full",
          "transition-[opacity,background-color,transform] duration-[var(--duration-fast)]",
          active
            ? "scale-100 bg-accent-color opacity-100"
            : "scale-90 bg-border-subtle opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60",
        )}
      />
    </div>
  );
}
