/**
 * SuggestEntryStrip — quiet global entry when there are suggestions or prepare is running.
 *
 * Auto-hides when count=0 and not loading. Header Lightbulb always available.
 * Click opens SuggestPopover (openSuggestSurface).
 * Not a second full list; not Stream-body-only.
 */
import { ChevronRight, Lightbulb, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { useActionStore } from "../../stores/action-store";
import { openSuggestSurface } from "../../lib/suggest-surface";

export type SuggestEntryStripProps = {
  className?: string;
  variant?: "canvas" | "compact";
};

export function SuggestEntryStrip({ className, variant = "canvas" }: SuggestEntryStripProps) {
  const { t } = useTranslation(["workspace", "editor"]);
  const items = useActionStore((s) => s.items);
  const loading = useActionStore((s) => s.loading);
  const autoPrepare = useActionStore((s) => s.autoPrepare);
  const count = items.length;
  const hasHigh = items.some((i) => i.priority === "high");
  const preparing = loading && autoPrepare && count === 0;

  // Auto-hide when empty and not preparing — no permanent spacer
  if (count === 0 && !preparing) {
    return null;
  }

  return (
    <div
      className={cn(
        "shrink-0",
        variant === "canvas" ? "px-3 pt-1.5 pb-0.5" : null,
        className,
      )}
      data-suggest-entry-strip
      data-suggest-entry-state={preparing ? "preparing" : "active"}
    >
      <button
        type="button"
        onClick={() => openSuggestSurface({ refresh: preparing || count === 0 })}
        className={cn(
          "flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-3 py-1.5 text-left transition-colors",
          preparing
            ? "border-border-subtle-dim bg-surface-muted/40"
            : "border-accent-border-subtle/60 bg-accent-bg-faint/50 hover:bg-accent-bg-subtle/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          hasHigh && !preparing && "border-warning/30 bg-warning/5",
        )}
        title={
          preparing
            ? t("workspace:streamDetail.suggestionsPreparingTip")
            : t("workspace:streamDetail.suggestionsQuietTip")
        }
        data-stream-suggestions-quiet
        data-suggest-entry-open
      >
        {preparing ? (
          <Loader2 size={ICON.xs} className="shrink-0 animate-spin text-text-tertiary" aria-hidden />
        ) : (
          <Lightbulb
            size={ICON.xs}
            className={cn("shrink-0", hasHigh ? "text-warning" : "text-accent-color")}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 text-3xs text-text-secondary">
          {preparing
            ? t("workspace:streamDetail.suggestionsPreparing")
            : t("workspace:streamDetail.suggestionsQuiet", { count })}
        </span>
        {!preparing ? (
          <>
            <span
              className={cn(
                "shrink-0 text-3xs font-medium",
                hasHigh ? "text-warning" : "text-accent-color",
              )}
            >
              {t("workspace:streamDetail.suggestionsOpen")}
            </span>
            <ChevronRight
              size={ICON.nano}
              className={cn("shrink-0", hasHigh ? "text-warning/70" : "text-accent-color/70")}
              aria-hidden
            />
          </>
        ) : null}
      </button>
    </div>
  );
}
