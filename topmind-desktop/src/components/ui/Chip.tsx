/**
 * Chip — the single compact label/filter primitive (DS 4.0.5).
 *
 * Replaces the ad-hoc `inline-flex h-5 rounded-[var(--radius-sm)]` clusters that
 * grew across the AI surface (suggest chips, goal chips, filter chips, tool chips
 * each had their own height/radius/focus). One geometry, tonal containers.
 *
 * Geometry: height 22px (`--control-h-chip`), radius-xs (2px) — quiet rect,
 * not a capsule (matches CountBadge / v4-chip count-adjacent language).
 *
 * Tones map onto MD3 containers: neutral = surface-muted, accent = accent-container,
 * warn/error/success = their `*-container` / `status-*-bg` washes at full strength.
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/kit";

/** Shared state-layer overlay (::after) — same language as Button (DS 4.0.5).
    Never recolor the base fill on hover; that is a different object. */
const STATE_LAYER = [
  "relative isolate",
  "after:absolute after:inset-0 after:rounded-[inherit] after:pointer-events-none",
  "after:bg-transparent after:transition-colors after:duration-[var(--duration-fast)]",
  "hover:after:bg-state-hover active:after:bg-state-pressed",
].join(" ");

const chipVariants = cva(
  [
    "inline-flex items-center gap-1 whitespace-nowrap select-none",
    "rounded-[var(--radius-xs)] font-medium leading-none",
    "transition-colors duration-[var(--duration-fast)]",
    "disabled:pointer-events-none disabled:opacity-45",
    "data-[soft-disabled=true]:cursor-default data-[soft-disabled=true]:opacity-50 data-[soft-disabled=true]:pointer-events-auto",
  ].join(" "),
  {
    variants: {
      tone: {
        neutral: "bg-surface-wash-30 text-text-secondary",
        accent: "bg-accent-bg-subtle text-accent-color",
        warn: "bg-status-warning-bg text-warning",
        error: "bg-status-error-bg text-error",
        success: "bg-status-success-bg text-success",
        outline: "border border-border-subtle-dim bg-transparent text-text-secondary",
      },
      size: {
        /* sm = pure status/label (12px floor for badges). md carries words
           (paths, plan toggles) so it sits on the 13px content floor. */
        sm: "h-5 px-1.5 text-4xs",
        md: "h-[var(--control-h-chip,22px)] px-2 text-xs",
      },
      active: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        active: true,
        tone: "neutral",
        className: "bg-accent-bg-subtle text-accent-color",
      },
      {
        active: true,
        tone: "outline",
        className: "border-accent-border-subtle bg-accent-bg-subtle text-accent-color",
      },
    ],
    defaultVariants: { tone: "neutral", size: "md", active: false },
  },
);

export interface ChipProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {
  /** Leading icon (already sized). */
  icon?: ReactNode;
  /** Soft-disabled: looks off but stays keyboard-focusable. */
  softDisabled?: boolean;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  (
    {
      className,
      tone,
      size,
      active,
      icon,
      softDisabled,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled && !softDisabled}
      data-soft-disabled={softDisabled ? "true" : undefined}
      data-active={active ? "true" : undefined}
      aria-pressed={active === true ? true : undefined}
      className={cn(chipVariants({ tone, size, active }), STATE_LAYER, "v4-focus-ring cursor-pointer", className)}
      {...props}
    >
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  ),
);
Chip.displayName = "Chip";

/** Non-interactive label variant (tag, receipt, status pill). */
export function ChipLabel({
  className,
  tone,
  size,
  icon,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chipVariants> & {
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(chipVariants({ tone, size }), "cursor-default", className)}
      {...props}
    >
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
