/**
 * Textarea — quiet filled multi-line field (same language as Input).
 */
import { forwardRef } from "react";
import { cn } from "../../lib/kit";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-20 w-full resize-y rounded-[var(--radius-md)] border-none outline-none v4-quiet-field",
        "bg-surface-wash-15 px-3 py-2 text-sm leading-relaxed text-text-primary placeholder:text-text-quaternary",
        "transition-[box-shadow,background-color] duration-[var(--duration-fast)]",
        "hover:bg-surface-wash-30",
        "focus-visible:bg-surface-elevated",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
