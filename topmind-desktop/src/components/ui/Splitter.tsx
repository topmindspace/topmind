/**
 * Splitter — draggable divider for resizing adjacent panels.
 * Pointer-capture based (mouse + touch/pen via pointer events, same as the
 * canvas split divider) and keyboard-operable (←/→ steps, Shift = coarse).
 */
import { useCallback, useState } from "react";
import { cn } from "../../lib/cn";

interface SplitterProps {
  side: "left" | "right";
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  onDragStateChange?: (dragging: boolean) => void;
}

export function Splitter({ side, value, onChange, min = 180, max = 600, onDragStateChange }: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      onDragStateChange?.(true);
    },
    [onDragStateChange],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const parentRect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      // Left panel: width = distance from parent's left edge to the pointer.
      // Right panel: width = distance from the pointer to the parent's right edge.
      const next =
        side === "left" ? e.clientX - parentRect.left : parentRect.right - e.clientX;
      onChange(clamp(next));
    },
    [dragging, side, onChange, clamp],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      setDragging(false);
      onDragStateChange?.(false);
    },
    [dragging, onDragStateChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 48 : 16;
      const dir = (e.key === "ArrowLeft" ? -1 : 1) * (side === "left" ? 1 : -1);
      onChange(clamp(value + dir * step));
    },
    [onChange, clamp, value, side],
  );

  const active = dragging || hovering;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label="Resize panel"
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
