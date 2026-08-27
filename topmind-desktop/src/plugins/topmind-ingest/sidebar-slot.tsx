import { FileInput, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginContext, SidebarSlot } from "../types";
import { onLocal } from "../host";
import { api } from "../../services/api";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";

export function createIngestSidebarSlot(ctx: PluginContext): SidebarSlot {
  return {
    kind: "sidebar",
    id: "topmind-ingest.sidebar",
    label: "Knowledge Ingest",
    labelKey: "ingest:title",
    icon: "file-input",
    order: 150,
    render: () => <IngestSidebarEntry ctx={ctx} />,
  };
}

function IngestSidebarEntry({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation("ingest");
  const [active, setActive] = useState(0);
  const [enabled, setEnabled] = useState(true);

  const refresh = () => {
    void api.ingest.list().then((r) => {
      const n = (r.jobs || []).filter((j) => j.status === "queued" || j.status === "running").length;
      setActive(n);
    }).catch(() => {});
  };

  useEffect(() => {
    void api.sys.settings().then((s) => {
      setEnabled((s as { ingest?: { enabled?: boolean } }).ingest?.enabled !== false);
    }).catch(() => {});
    refresh();
    const u1 = onLocal("ingest:queue-changed", () => refresh());
    const u2 = onLocal("ingest:job-updated", () => refresh());
    return () => {
      u1();
      u2();
    };
  }, []);

  if (!enabled) return null;

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-[var(--radius-md)] p-2 text-left",
        "text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary",
        "v4-focus-ring",
      )}
      onClick={() => ctx.navigate({ kind: "connector", id: "ingest" })}
      aria-label={active > 0 ? `${t("title")} · ${active}` : t("title")}
    >
      {active > 0 ? (
        <Loader2 size={ICON.xs} className="shrink-0 animate-spin text-accent-color" aria-hidden />
      ) : (
        <FileInput size={ICON.xs} className="shrink-0 text-text-tertiary" aria-hidden />
      )}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-3xs font-medium text-text-primary">{t("title")}</span>
        <span className="truncate text-3xs text-text-quaternary">
          {active > 0 ? t("hub.subtitleActive", { count: active }) : t("desc")}
        </span>
      </div>
      {active > 0 ? (
        <span className="rounded-full bg-accent-bg-subtle px-1.5 py-0.5 text-3xs font-semibold tabular-nums text-accent-color">
          {active}
        </span>
      ) : null}
    </button>
  );
}
