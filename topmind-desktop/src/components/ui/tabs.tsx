/**
 * Tabs — Radix UI Tabs wrapper, Design System 2.0 tokens.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef } from "react";
import { cn } from "../../lib/kit";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center gap-0.5 rounded-[var(--radius-lg)] bg-surface-wash-30 p-0.5 text-text-tertiary",
      "border border-transparent",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium",
      "transition-[background-color,color,box-shadow] duration-[var(--duration-fast)]",
      "text-text-tertiary data-[state=active]:bg-surface-elevated data-[state=active]:text-text-primary data-[state=active]:shadow-xs",
      "hover:bg-state-hover hover:text-text-secondary",
      "v4-focus-ring",
      "disabled:pointer-events-none disabled:opacity-50",
      "cursor-pointer",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
