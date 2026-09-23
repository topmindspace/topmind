/**
 * Input — token-aligned text field (MD3-informed filled outline).
 * Soft inset idle · elevated + accent ring on focus · error container when invalid.
 */
import { forwardRef } from "react";
import { cn } from "../../lib/kit";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", "aria-invalid": ariaInvalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={ariaInvalid}
      className={cn(
        "flex h-[var(--control-h-md,34px)] w-full rounded-[var(--radius-md)] border border-border-subtle-dim bg-input",
        "px-3 py-1.5 text-sm leading-none text-text-primary placeholder:text-text-quaternary",
        "shadow-[var(--shadow-input-inset)]",
        "transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
        "hover:border-border-subtle hover:bg-surface-muted/40",
        "focus-visible:border-accent-color focus-visible:bg-surface-elevated focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0",
        "aria-[invalid=true]:border-status-error aria-[invalid=true]:bg-status-error-bg/40",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
