import { RiCloseLine, RiFileTextLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "../../stores/ai-store";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";

export function ContextPills() {
  const { t } = useTranslation("editor");
  const mountedFiles = useAiStore((s) => s.mountedFiles);
  const unmountFile = useAiStore((s) => s.unmountFile);
  if (mountedFiles.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-2.5 pb-1 pt-1">
      {mountedFiles.map((f) => (
        <span
          key={f.path}
          className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-full)] border border-border-subtle/80 bg-surface px-1.5 py-px text-3xs text-text-secondary"
        >
          <RiFileTextLine size={ICON.micro} className="shrink-0 text-accent-color/70" />
          <Tooltip content={f.path}>
            <span className="max-w-[120px] truncate">{f.name}</span>
          </Tooltip>
          <Tooltip content={t("ai.removeContextTooltip")}>
            <button
              type="button"
              onClick={() => unmountFile(f.path)}
              aria-label={t("ai.removeContextTooltip")}
              className="rounded-full p-0.5 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-primary"
            >
              <RiCloseLine size={ICON.micro} />
            </button>
          </Tooltip>
        </span>
      ))}
    </div>
  );
}
