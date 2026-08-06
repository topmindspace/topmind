/**
 * Shell panel toggle — Lucide only (no custom paths).
 *
 * Open  → LayoutPanelLeft with left rail filled (half-solid, VS Code/Obsidian feel)
 * Closed → PanelLeftInactive / PanelRightInactive (dashed rail)
 *
 * Right side reuses LayoutPanelLeft mirrored via scale-x so we stay on official glyphs.
 */
import {
  LayoutPanelLeft,
  PanelLeftInactive,
  PanelRightInactive,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { ICON, ICON_STROKE } from "../../lib/icons";

export function PanelToggleIcon({
  side,
  open,
  size = ICON.sm,
  className,
}: {
  side: "left" | "right";
  open: boolean;
  size?: number;
  className?: string;
}) {
  if (!open) {
    const Dashed = side === "left" ? PanelLeftInactive : PanelRightInactive;
    return (
      <Dashed
        size={size}
        strokeWidth={ICON_STROKE.chrome}
        className={className}
        aria-hidden
      />
    );
  }

  // Official Lucide layout-panel-left: first <rect> is the side rail.
  // Fill only that child → half-solid active state (not a hand-drawn SVG).
  return (
    <LayoutPanelLeft
      size={size}
      strokeWidth={ICON_STROKE.chrome}
      aria-hidden
      className={cn(
        "[&>rect:first-child]:fill-current",
        side === "right" && "-scale-x-100",
        className,
      )}
    />
  );
}
