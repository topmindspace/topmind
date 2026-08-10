/**
 * Input — token-aligned text field with soft inset + elegant focus.
 */
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-[var(--control-h-md,34px)] w-full rounded-[var(--radius-md)] border border-border-subtle-dim bg-input",
        "px-3 py-1.5 text-sm leading-none text-text-primary placeholder:text-text-quaternary",
        "shadow-[var(--shadow-input-inset)]",
        "transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
        "hover:border-border-subtle",
        "focus-visible:border-accent-color focus-visible:bg-surface-elevated focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
