import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileInput, Loader2 } from "lucide-react";
import type { PluginContext, StatusBarSlot } from "../types";
import { onLocal } from "../host";
import { api } from "../../services/api";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../../components/ui/tooltip";

export function createIngestStatusBarSlot(ctx: PluginContext): StatusBarSlot {
  return {
    kind: "statusBar",
    id: "topmind-ingest.statusbar",
    order: 40,
    align: "left",
    render: () => <IngestStatusBar ctx={ctx} />,
  };
}

function IngestStatusBar({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation("ingest");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const refresh = () => {
      void api.ingest.list().then((r) => {
        setActive((r.jobs || []).filter((j) => j.status === "queued" || j.status === "running").length);
      }).catch(() => {});
    };
    refresh();
    const u1 = onLocal("ingest:queue-changed", refresh);
    const u2 = onLocal("ingest:job-updated", refresh);
    return () => {
      u1();
      u2();
    };
  }, []);

  if (active <= 0) return null;

  return (
    <Tooltip content={t("hub.settingsTooltip")}>
      <button
        type="button"
        className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-3xs text-text-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        onClick={() => ctx.navigate({ kind: "connector", id: "ingest" })}
        aria-label={t("hub.title") + ` · ${active}`}
      >
        <Loader2 size={ICON.micro} className="animate-spin text-accent-color" aria-hidden />
        <FileInput size={ICON.micro} aria-hidden />
        {t("convert")} {active}
      </button>
    </Tooltip>
  );
}
