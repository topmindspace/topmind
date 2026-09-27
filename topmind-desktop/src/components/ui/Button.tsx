/**
 * Button — cva variants + control-height tokens.
 * DS 4.0.5 (MD3 state layers): base fill + translucent state overlay.
 *
 * MD3 mapping (desktop-adapted, not Material clone):
 * - default  ≈ filled (monochrome ink primary — product lock)
 * - tonal    ≈ filled tonal (secondary-container)
 * - outline  ≈ outlined
 * - ghost    ≈ text
 * - destructive ≈ error-container tonal
 * - softDisabled ≈ MD3 soft-disabled (visible + focusable when "off" but discoverable)
 *
 * State layers (MD3): hover 8% · press 10% · focus 10%. Solid CTA uses
 * `--color-state-on-primary-*` (light overlay on ink); the rest use
 * `--color-state-*` (ink overlay). Never swap the base fill on hover — that
 * is "a different color", not "the same object under a finger".
 */
import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/kit";

/** Shared state-layer overlay (::after) — applied to every variant. */
const STATE_LAYER = [
  "relative isolate",
  "after:absolute after:inset-0 after:rounded-[inherit] after:pointer-events-none",
  "after:bg-transparent after:transition-colors after:duration-[var(--duration-fast)]",
  "hover:after:bg-state-hover active:after:bg-state-pressed",
].join(" ");

const ON_PRIMARY_LAYER =
  "hover:after:bg-state-on-primary-hover active:after:bg-state-on-primary-pressed";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-xs font-medium select-none",
    "transition-[color,border-color,box-shadow,opacity] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
    STATE_LAYER,
    "v4-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
    "disabled:after:hidden",
    "data-[soft-disabled=true]:cursor-default data-[soft-disabled=true]:opacity-50 data-[soft-disabled=true]:shadow-none",
    "data-[soft-disabled=true]:pointer-events-auto data-[soft-disabled=true]:after:hidden",
    "cursor-pointer",
  ].join(" "),
  {
    variants: {
      variant: {
        /* Flat solid CTA — monochrome ink, one per region (ZCode primary).
           State layer is light-on-ink (on-primary). */
        default: cn(
          "bg-primary text-primary-foreground font-semibold",
          ON_PRIMARY_LAYER,
        ),
        secondary:
          "border border-border-subtle-dim bg-secondary text-secondary-foreground hover:border-border-subtle",
        /* MD3 tonal — secondary emphasis without a second solid CTA */
        tonal: cn(
          "border border-transparent bg-accent-container text-on-accent-container font-medium",
          "hover:after:bg-state-dragged active:after:bg-state-pressed",
        ),
        outline:
          "border border-border-subtle bg-transparent text-text-primary hover:border-border-subtle",
        ghost: "text-text-secondary hover:text-text-primary",
        /* MD3 error-container tonal — destructive without neon fill */
        destructive: cn(
          "border border-transparent bg-error-container text-on-error-container font-semibold",
        ),
        link: "text-accent-color underline-offset-2 hover:underline shadow-none after:hidden",
        /** Quiet AI capability — accent tint, not a second solid CTA */
        ai: cn(
          "border border-accent-border-subtle bg-accent-bg-subtle text-accent-color",
        ),
      },
      size: {
        sm: "h-[var(--control-h-sm,30px)] min-w-[var(--control-h-sm,30px)] px-2.5 text-3xs gap-1",
        default: "h-[var(--control-h-md,34px)] px-3.5",
        lg: "h-[var(--control-h-lg,40px)] px-4 text-sm",
        icon: "h-[var(--control-h-sm,30px)] w-[var(--control-h-sm,30px)] shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * MD3 soft-disabled: looks off but stays keyboard-focusable so toolbar
   * actions remain discoverable. Does not fire click when set.
   */
  softDisabled?: boolean;
  /** Optional override for CSS/telemetry targeting; defaults to cva variant. */
  "data-variant"?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      type = "button",
      softDisabled,
      disabled,
      onClick,
      "data-variant": dataVariant,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled && !softDisabled}
      data-soft-disabled={softDisabled ? "true" : undefined}
      data-variant={dataVariant ?? variant ?? "default"}
      aria-disabled={softDisabled || disabled || undefined}
      onClick={softDisabled ? undefined : onClick}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
