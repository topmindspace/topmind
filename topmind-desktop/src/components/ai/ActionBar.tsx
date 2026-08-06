/**
 * ActionBar — compact pointer in AI rail to the global 建议 confirm surface.
 *
 * Primary entry point is now the StatusBar suggestion count chip (always visible
 * when items exist). This rail strip is kept ONLY for focus mode (where the
 * status bar may be hidden) as a minimal indicator.
 */
import { useEffect } from "react";
import { Loader2, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { useActionStore } from "../../stores/action-store";
import { useViewStore } from "../../stores/view-store";
import { openSuggestSurface } from "../../lib/suggest-surface";

export function ActionBar() {
  const { t } = useTranslation("editor");
  const items = useActionStore((s) => s.items);
  const loading = useActionStore((s) => s.loading);
  const everLoaded = useActionStore((s) => s.everLoaded);
  const autoPrepare = useActionStore((s) => s.autoPrepare);
  const panelOpen = useActionStore((s) => s.panelOpen);
  const refresh = useActionStore((s) => s.refresh);
  const focusMode = useViewStore((s) => s.focusMode);

  // Keep store warm when AI rail mounts
  useEffect(() => {
    void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrepare]);

  // In non-focus mode, the StatusBar chip is the primary entry — hide this strip.
  // Only show in focus mode as a fallback indicator.
  if (!focusMode) return null;

  const preparing = loading && autoPrepare && items.length === 0;
  if (items.length === 0 && !preparing) return null;

  const hasHigh = items.some((i) => i.priority === "high");

  if (preparing) {
    return (
      <div
        className="flex shrink-0 items-center gap-1.5 border-t border-border-subtle-dim px-2.5 py-1"
        data-action-bar
        data-action-bar-loading
      >
        <Loader2 size={ICON.nano} className="animate-spin text-text-quaternary" />
        <span className="text-3xs text-text-quaternary">{t("ai.suggestLoading")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "flex w-full shrink-0 items-center gap-1.5 border-t border-border-subtle-dim px-2.5 py-1.5 text-left",
        "cursor-pointer transition-colors hover:bg-surface-muted/60",
        panelOpen && "bg-accent-bg-faint/40",
      )}
      onClick={() => openSuggestSurface()}
      data-action-bar
      data-action-bar-compact
      aria-label={t("ai.suggestTitle")}
    >
      <Lightbulb
        size={ICON.nano}
        className={hasHigh ? "text-warning" : "text-accent-color"}
      />
      <span
        className={cn(
          "min-w-0 flex-1 text-3xs font-medium",
          hasHigh ? "text-warning" : "text-text-secondary",
        )}
      >
        {t("ai.suggestTitle")} · {t("ai.actionBarCount", { count: items.length })}
      </span>
      {loading ? (
        <Loader2 size={ICON.nano} className="animate-spin text-text-quaternary" />
      ) : null}
    </button>
  );
}
