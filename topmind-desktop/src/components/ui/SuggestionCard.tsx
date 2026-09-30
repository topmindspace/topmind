import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/kit";

/**
 * SuggestionCard — Muse「点子」register: line icon + title + two-line description.
 *
 * Used on proactive surfaces (今日建议 / 点子 / 空态推荐). One primary action max.
 * Icons are Remix line glyphs (`ICON.sm`) — never emoji. Not for tool lists or
 * tree rows — those stay line-icon + dense.
 *
 * Dismiss contract (misoperation guard): the ignore control is an **always-visible
 * text button** in the action row — never a hover-only X. Callers decide the
 * semantics: proactive strips pass session soft-hide; the confirm pane passes
 * durable reject. `pending_write` cards must route through the confirm pane.
 */
export function SuggestionCard({
  icon,
  title,
  description,
  action,
  onDismiss,
  dismissLabel,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Session soft-hide (strip) or durable "no" (confirm pane). Suggestions only. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation("common");
  return (
    <article
      className={cn(
        "group/sugg flex items-start gap-3 rounded-[var(--radius-card)]",
        "bg-surface px-3.5 py-3",
        "shadow-[var(--shadow-card)]",
        className,
      )}
      data-suggestion-card
    >
      {icon ? (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-wash-30 text-text-tertiary"
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-medium tracking-tight text-text-primary">{title}</h4>
        {description ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-tertiary">
            {description}
          </p>
        ) : null}
        {(action || onDismiss) ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {action}
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className={cn(
                  "inline-flex h-7 items-center rounded-[var(--radius-sm)] px-2 text-xs text-text-tertiary",
                  "transition-colors hover:bg-state-hover hover:text-text-secondary",
                  "v4-focus-ring",
                )}
                data-suggestion-dismiss
              >
                {dismissLabel ?? t("action.dismiss", { defaultValue: "忽略" })}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
