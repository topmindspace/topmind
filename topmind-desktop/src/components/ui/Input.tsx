/**
 * Input — quiet filled field (no outline box).
 * Soft wash fill · hairline only on hover/focus · accent ring when active.
 * Form fields must not read as heavy gray rectangles next to content cards.
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
        "flex h-9 w-full rounded-[var(--radius-md)] bg-surface-wash-15 px-3 text-sm",
        "py-1.5 leading-none text-text-primary placeholder:text-text-quaternary",
        "border-none outline-none v4-quiet-field",
        "transition-[box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
        "hover:bg-surface-wash-30",
        "focus-visible:bg-surface-elevated",
        "aria-[invalid=true]:border-status-error aria-[invalid=true]:bg-status-error-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
