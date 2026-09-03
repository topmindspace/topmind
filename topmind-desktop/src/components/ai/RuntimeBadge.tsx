import { RiCheckboxBlankCircleLine, RiToolsLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "../../stores/ai-store";
import { useViewStore } from "../../stores/view-store";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";

export function RuntimeBadge() {
  const { t } = useTranslation("editor");
  const status = useAiStore((s) => s.runtimeStatus);
  const agentEnabled = useAiStore((s) => s.agentEnabled);
  const streaming = useAiStore((s) => s.streaming);
  const openOverlay = useViewStore((s) => s.openOverlay);

  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 text-3xs text-text-quaternary" role="status" aria-live="polite">
        <RiCheckboxBlankCircleLine size={ICON.nano} className="opacity-40" aria-hidden /> …
      </span>
    );
  }
  if (!status.ready) {
    return (
      <Tooltip content={t("ai.runtimeOfflineTooltip")}>
        <button
          type="button"
          className="v4-chip text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary"
          onClick={() => openOverlay("settings", { topicId: "ai" })}
          aria-label={t("ai.runtimeOfflineAria")}
        >
          <RiCheckboxBlankCircleLine size={ICON.nano} className="fill-current opacity-40" aria-hidden /> {t("ai.runtimeOfflineLabel")}
        </button>
      </Tooltip>
    );
  }
  const n = status.providers?.length ?? 0;
  const names = (status.providers || []).map((p) => p.label || p.id).filter(Boolean);
  return (
    <Tooltip
      content={
        agentEnabled
          ? t("ai.runtimeReadyWithAgent", { names: names.join(" / ") || t("ai.runtimeReadyCount", { count: n }) })
          : t("ai.runtimeReadyWithoutAgent", { names: names.join(" / ") || t("ai.runtimeReadyCount", { count: n }) })
      }
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs text-success/90",
          streaming && "bg-success/8",
        )}
      >
        <RiCheckboxBlankCircleLine
          size={ICON.nano}
          className={cn("fill-current", streaming && "animate-pulse-soft")}
        />
        <span className="tabular-nums">{n}</span>
        {agentEnabled ? <RiToolsLine size={ICON.micro} className="text-accent-color/80" /> : null}
      </span>
    </Tooltip>
  );
}
