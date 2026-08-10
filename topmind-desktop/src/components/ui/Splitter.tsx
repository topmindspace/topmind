/**
 * Splitter — draggable divider for resizing adjacent panels.
 * Supports horizontal (left/right) drag. Updates a zustand store value.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
  const startXRef = useRef(0);
  const startValueRef = useRef(value);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startValueRef.current = value;
      setDragging(true);
      onDragStateChange?.(true);
    },
    [value, onDragStateChange],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      // Left panel: drag right = wider. Right panel: drag left = wider (delta negative).
      const next = side === "left" ? startValueRef.current + delta : startValueRef.current - delta;
      onChange(Math.max(min, Math.min(max, next)));
    };

    const handleMouseUp = () => {
      setDragging(false);
      onDragStateChange?.(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, side, onChange, min, max, onDragStateChange]);

  const active = dragging || hovering;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      className={cn(
        "group relative z-local flex w-px cursor-col-resize items-center justify-center",
        "transition-[background-color,box-shadow] duration-[var(--duration-fast)]",
        active
          ? "bg-accent-color shadow-[0_0_0_1px_var(--color-accent-color)]"
          : "bg-border-subtle-dim hover:bg-border-subtle",
      )}
    >
      {/* Wider hit area for easier grabbing */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-local" />
      {/* Grip pill — appears on hover/drag */}
      <div
        className={cn(
          "absolute top-1/2 flex h-8 w-1 -translate-y-1/2 items-center justify-center rounded-full",
          "transition-[opacity,background-color,transform] duration-[var(--duration-fast)]",
          active
            ? "scale-100 bg-accent-color opacity-100"
            : "scale-90 bg-border-subtle opacity-0 group-hover:opacity-60",
        )}
      />
    </div>
  );
}
