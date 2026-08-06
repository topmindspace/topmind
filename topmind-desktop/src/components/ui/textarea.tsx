/**
 * Textarea — token-aligned multi-line field.
 */
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-20 w-full resize-y rounded-[var(--radius-md)] border border-border-subtle-dim bg-input",
        "px-3 py-2 text-sm leading-relaxed text-text-primary placeholder:text-text-quaternary",
        "shadow-[var(--shadow-input-inset)]",
        "transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)]",
        "hover:border-border-subtle",
        "focus-visible:border-accent-color focus-visible:bg-surface focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
