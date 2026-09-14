/**
 * CountBadge — the single numeric count indicator (tab corners, chip corners).
 *
 * Why a component instead of inline classes: the AI workspace tab and the chat
 * skills chip had drifted into three disagreements (radius, offset, fill) and
 * the tab one pointed at a `bg-skill-loop` token that no longer existed, so it
 * rendered white-on-transparent and was invisible in both themes. One component
 * makes that class of bug unrepeatable.
 *
 * Contract:
 * - Fill comes from the `--color-badge*` axis in tokens.css, never from
 *   `--color-accent-color`: the badge is a count signal, and accent flips hue in
 *   inbox mode while sky-600 only reaches 4.1:1 against white. The badge axis is
 *   contrast-verified in both modes.
 * - Positioning is the caller's job. Pass `absolute` offsets via `className`
 *   (e.g. `-right-0.5 -top-0.5` on a tab, `-right-1 -top-1` on a round chip) —
 *   two conflicting Tailwind offsets in one class string resolve by CSS order,
 *   not by class-string order, so the component must not ship a default.
 * - The badge is `aria-hidden`. Surface the count to assistive tech on the
 *   owning control via `aria-label`.
 */
import { cn } from "../../lib/cn";

/** Values above this collapse to `{max}+` — keeps the badge from widening. */
const DEFAULT_MAX = 9;

export interface CountBadgeProps {
  count: number;
  /** Saturates at `max` and renders `{max}+`. */
  max?: number;
  /**
   * `alert` is for counts that carry a high-priority item (mirrors the
   * StatusBar suggest chip, which tints warning when a high-priority item lands).
   */
  tone?: "default" | "alert";
  /** Positioning + one-off layout. The component ships no default offset. */
  className?: string;
}

export function CountBadge({ count, max = DEFAULT_MAX, tone = "default", className }: CountBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      aria-hidden
      data-count-badge={tone}
      className={cn(
        "pointer-events-none flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-4xs font-bold leading-none tabular-nums",
        tone === "alert"
          ? "bg-badge-alert text-badge-alert-foreground"
          : "bg-badge text-badge-foreground",
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
