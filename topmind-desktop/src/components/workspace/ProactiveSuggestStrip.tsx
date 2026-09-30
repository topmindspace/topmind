import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiBookOpenLine,
  RiFileTextLine,
  RiInboxUnarchiveLine,
  RiLightbulbLine,
  RiSparklingLine,
} from "@remixicon/react";
import { useActionStore } from "../../stores/action-store";
import { SuggestionCard } from "../ui/SuggestionCard";
import { Button } from "../ui/Button";
import { ICON } from "../../lib/icons";

/**
 * ProactiveSuggestStrip — Muse「点子」register on content surfaces.
 *
 * Surfaces the top pending suggestions inline so users see proactive value
 * without opening the confirm panel. Full list still lives in the suggest pane.
 *
 * Card-local hide contract (2026-09-29): 「查看」and「忽略」only hide **this
 * strip card** for the current mount. They must NOT mutate ActionStore, write
 * suggest-dismissed, or remove the real suggestion from the confirm pane —
 * accept / durable-ignore stay pane actions with full context.
 * `pending_write` cards never get a light dismiss — they must open the confirm
 * pane (same path as SuggestPopover 拒绝).
 */
export function ProactiveSuggestStrip({
  onOpenAll,
  max = 2,
  className,
}: {
  onOpenAll: () => void;
  max?: number;
  className?: string;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  const items = useActionStore((s) => s.items);
  /** Strip-local only — the real suggestion stays in ActionStore / pane. */
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const hideCard = (id: string) =>
    setHiddenIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const top = items.filter((i) => !hiddenIds.has(i.id)).slice(0, max);
  if (top.length === 0) return null;

  const iconFor = (kind?: string) => {
    switch (kind) {
      case "inbox_organize":
      case "inbox_review":
        return <RiInboxUnarchiveLine size={ICON.sm} className="text-accent-color" />;
      case "stream_digest":
      case "ai_summary":
        return <RiBookOpenLine size={ICON.sm} className="text-accent-color" />;
      case "promote_memory":
        return <RiLightbulbLine size={ICON.sm} className="text-warning" />;
      case "create_topic":
      case "open_profile":
        return <RiFileTextLine size={ICON.sm} className="text-accent-color" />;
      default:
        return <RiSparklingLine size={ICON.sm} className="text-accent-color" />;
    }
  };

  return (
    <section
      className={
        className ??
        "mb-[var(--density-content-gap)] flex flex-col gap-[var(--density-content-gap)]"
      }
      data-proactive-suggest
    >
      {top.map((item) => {
        const isPendingWrite = item.source === "pending_write";
        return (
          <SuggestionCard
            key={item.id}
            icon={iconFor(item.suggestionKind)}
            title={item.title}
            description={item.summary}
            // Suggestions: strip-local hide only — durable "no" is a pane action.
            // Pending writes: no one-click reject here — only open the confirm pane.
            onDismiss={isPendingWrite ? undefined : () => hideCard(item.id)}
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  hideCard(item.id);
                  onOpenAll();
                }}
              >
                {isPendingWrite
                  ? t("common:action.view", { defaultValue: "查看" })
                  : t("workspace:streamDetail.reviewSuggestions", {
                      defaultValue: t("common:action.view", { defaultValue: "查看" }),
                    })}
              </Button>
            }
          />
        );
      })}
    </section>
  );
}
