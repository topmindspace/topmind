/**
 * Tooltip — Radix UI Tooltip, Design System 2.0 tokens.
 *
 * Rules:
 * - Never paint above open menus (z-toast < z-menu; html[data-menu-open] hides tips)
 * - Overlay-tree tips portal into OverlayHost; leftover body tips hide on
 *   html[data-overlay-open] so they cannot cover settings.
 * - Prefer aria-label on controls that open menus; long tips belong in Field description
 * - Use disabled={menuOpen} when wrapping MenuSelect / Dropdown triggers
 */
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/cn";
import { isMenuLayerActive } from "../../lib/menu-layer";
import { useOverlayPortalRoot } from "../../lib/overlay-layer";

export function TooltipProvider({
  children,
  delayDuration = 220,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={80}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Prefer keyboard-accessible labels; hide when empty or menu is open */
  disabled?: boolean;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "bottom",
  align = "center",
  sideOffset = 6,
  disabled,
  className,
}: TooltipProps) {
  const overlayRoot = useOverlayPortalRoot();
  if (disabled || content == null || content === "") return children;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={overlayRoot ?? undefined}>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          // Force closed while any menu layer is active (belt + CSS hide)
          onPointerDownOutside={(e) => {
            if (isMenuLayerActive()) e.preventDefault();
          }}
          data-slot="tooltip-content"
          className={cn(
            // Below z-menu (110) so listboxes always win if a tip still mounts
            "z-toast max-w-[280px] select-none whitespace-pre-line rounded-[var(--radius-md)] border border-border-subtle",
            "bg-popover/95 px-2.5 py-1.5 text-3xs font-medium leading-snug text-text-secondary",
            "shadow-[var(--shadow-float)]",
            "animate-fade-in",
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow
            className="fill-[var(--color-popover,var(--color-card))]"
            width={11}
            height={6}
          />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
