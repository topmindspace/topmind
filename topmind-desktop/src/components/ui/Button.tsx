/**
 * Button — cva variants + control-height tokens.
 * Soft radius, primary elevation, clear focus, no layout thrash.
 */
import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-xs font-medium select-none",
    "transition-[background-color,color,border-color,box-shadow,opacity] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
    "v4-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-42",
    "cursor-pointer",
  ].join(" "),
  {
    variants: {
      variant: {
        /* Flat solid CTA — monochrome ink, one per region (ZCode primary) */
        default:
          "bg-primary text-primary-foreground font-semibold hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-border-subtle-dim bg-secondary text-secondary-foreground hover:bg-surface-muted hover:border-border-subtle",
        outline:
          "border border-border-subtle bg-transparent text-text-primary hover:bg-surface-muted hover:border-border-subtle active:bg-surface-inset",
        ghost:
          "text-text-secondary hover:bg-surface-muted/90 hover:text-text-primary active:bg-surface-muted",
        destructive:
          "border border-transparent bg-status-error-bg text-status-error font-semibold hover:bg-status-error/12",
        link:
          "text-accent-color underline-offset-2 hover:underline shadow-none",
        /** Quiet AI capability — accent tint, not a second solid CTA */
        ai:
          "border border-accent-border-subtle bg-accent-bg-subtle text-accent-color hover:bg-accent-bg-faint",
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
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
