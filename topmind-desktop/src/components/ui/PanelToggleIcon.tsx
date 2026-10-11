/**
 * Shell panel toggle — RemixIcon line glyphs only.
 * Open uses accent color on the same outline; it does not swap in a Fill icon.
 */
import { RiLayoutLeftLine, RiLayoutRightLine } from "@remixicon/react";
import { cn } from "../../lib/kit";
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
  const Icon = side === "left" ? RiLayoutLeftLine : RiLayoutRightLine;
  return (
    <Icon
      size={size}
      aria-hidden
      className={cn("shrink-0", open && "text-accent-color", className)}
    />
  );
}
