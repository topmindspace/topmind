/**
 * Button — cva variants + control-height tokens.
 * DS 4.0.2 (MD3-informed): tonal / error-container, state layers, soft-disabled.
 *
 * MD3 mapping (desktop-adapted, not Material clone):
 * - default  ≈ filled (monochrome ink primary — product lock)
 * - tonal    ≈ filled tonal (secondary-container)
 * - outline  ≈ outlined
 * - ghost    ≈ text
 * - destructive ≈ error-container tonal
 * - softDisabled ≈ MD3 soft-disabled (visible + focusable when "off" but discoverable)
 */
import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/kit";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-xs font-medium select-none",
    "transition-[background-color,color,border-color,box-shadow,opacity] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
    "v4-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
    "data-[soft-disabled=true]:cursor-default data-[soft-disabled=true]:opacity-50 data-[soft-disabled=true]:shadow-none",
    "data-[soft-disabled=true]:pointer-events-auto",
    "cursor-pointer",
  ].join(" "),
  {
    variants: {
      variant: {
        /* Flat solid CTA — monochrome ink, one per region (ZCode primary) */
        default:
          "bg-primary text-primary-foreground font-semibold hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-border-subtle-dim bg-secondary text-secondary-foreground hover:bg-surface-muted hover:border-border-subtle active:bg-surface-inset",
        /* MD3 tonal — secondary emphasis without a second solid CTA */
        tonal:
          "border border-transparent bg-accent-container text-on-accent-container font-medium hover:bg-accent-bg-subtle active:bg-accent-bg-faint",
        outline:
          "border border-border-subtle bg-transparent text-text-primary hover:bg-surface-muted hover:border-border-subtle active:bg-surface-inset",
        ghost:
          "text-text-secondary hover:bg-state-hover hover:text-text-primary active:bg-state-pressed",
        /* MD3 error-container tonal — destructive without neon fill */
        destructive:
          "border border-transparent bg-error-container text-on-error-container font-semibold hover:bg-status-error-bg active:opacity-90",
        link:
          "text-accent-color underline-offset-2 hover:underline shadow-none",
        /** Quiet AI capability — accent tint, not a second solid CTA */
        ai:
          "border border-accent-border-subtle bg-accent-bg-subtle text-accent-color hover:bg-accent-bg-faint active:bg-accent-bg-subtle",
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
