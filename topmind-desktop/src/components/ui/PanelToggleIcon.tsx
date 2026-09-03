/**
 * Shell panel toggle — RemixIcon only (no custom paths).
 *
 * Open   → RiLayoutLeft/RightFill (filled side rail = active, VS Code/Obsidian feel)
 * Closed → RiLayoutLeft/RightLine (outline)
 */
import {
  RiLayoutLeftFill,
  RiLayoutLeftLine,
  RiLayoutRightFill,
  RiLayoutRightLine,
} from "@remixicon/react";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";

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
  const Icon =
    side === "left"
      ? open
        ? RiLayoutLeftFill
        : RiLayoutLeftLine
      : open
        ? RiLayoutRightFill
        : RiLayoutRightLine;
  return <Icon size={size} aria-hidden className={cn("shrink-0", className)} />;
}
