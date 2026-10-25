/**
 * Accessible Radix Tabs with standard controls or through-column chrome.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef } from "react";
import { cn } from "../../lib/kit";

export const Tabs = TabsPrimitive.Root;
type Variant = { variant?: "default" | "chrome" };

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & Variant
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      variant === "chrome" ? "v4-column-chrome v4-drag gap-0.5" : "inline-flex h-9 items-center justify-center gap-0.5 rounded-[var(--radius-lg)] border border-transparent bg-surface-wash-30 p-0.5 text-text-tertiary",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & Variant
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      variant === "chrome"
        ? "v4-no-drag relative flex h-(--density-chrome-control,32px) min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium data-[state=active]:bg-accent-bg-faint data-[state=active]:text-text-primary"
        : "inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium data-[state=active]:bg-surface-elevated data-[state=active]:text-text-primary data-[state=active]:shadow-xs",
      "transition-[background-color,color,box-shadow] duration-[var(--duration-fast)]",
      "text-text-tertiary",
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
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & Variant
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(variant === "chrome" ? "min-h-0 flex-1 v4-focus-ring" : "mt-2 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
