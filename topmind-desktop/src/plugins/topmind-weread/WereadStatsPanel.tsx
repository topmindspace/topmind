import { useTranslation } from "react-i18next";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import type { WereadStatsCache } from "../../types";
import { Button } from "../../components/ui/Button";
import { EmptyState, MetaText, SectionHeader } from "../../components/ui/view";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { formatDuration, formatSyncTime } from "./weread-format";

export type StatsMode = "weekly" | "monthly" | "annually" | "overall";

export function WereadStatsPanel({
  ready,
  stats,
  statsMode,
  onStatsMode,
  onRefresh,
  onOpenSettings,
}: {
  ready: boolean;
  stats: (WereadStatsCache & { fromCache?: boolean }) | null;
  statsMode: StatsMode;
  onStatsMode: (m: StatsMode) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);

  const modeLabels: Record<StatsMode, string> = {
    weekly: t("settings:wereadStats.weekly"),
    monthly: t("settings:wereadStats.monthly"),
    annually: t("settings:wereadStats.annually"),
    overall: t("settings:wereadStats.overall"),
  };

  return (
    <section className="mb-6">
      <SectionHeader
        icon={<BarChart3 size={ICON.sm} />}
        label={t("settings:wereadStats.title")}
        actions={
          <div className="flex items-center gap-1.5">
            {(["weekly", "monthly", "annually", "overall"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onStatsMode(m)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-3xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                  statsMode === m
                    ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                    : "text-text-quaternary hover:bg-surface-muted hover:text-text-secondary",
                )}
              >
                {modeLabels[m]}
              </button>
            ))}
            <Tooltip content={t("settings:wereadStats.refreshTooltip")}>
              <button
                type="button"
                disabled={!ready}
                onClick={onRefresh}
                className="rounded-[var(--radius-sm)] p-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-40"
                aria-label={t("settings:wereadStats.refreshAria")}
              >
                <RefreshCw size={ICON.micro} aria-hidden />
              </button>
            </Tooltip>
          </div>
        }
      />
      {!ready ? (
        <EmptyState
          icon={<BarChart3 size={ICON.md} />}
          title={t("settings:wereadStats.configTooltip")}
          action={
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              {t("common:action.edit")}
            </Button>
          }
        />
      ) : stats ? (
        <div className="v4-dash-card space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label={t("settings:wereadStats.readTime")} value={formatDuration(stats.totalReadTime)} />
            <StatChip label={t("settings:wereadStats.readDays")} value={t("settings:wereadStats.daysCount", { days: stats.readDays })} />
            <StatChip label={t("settings:wereadStats.readDays")} value={formatDuration(stats.dayAverageReadTime)} />
            <StatChip
              label={t("settings:wereadStats.compare")}
              value={
                stats.compare != null
                  ? `${stats.compare > 0 ? "+" : ""}${Math.round(stats.compare * 100)}%`
                  : "—"
              }
            />
          </div>
          {stats.preferCategoryWord || stats.preferTimeWord ? (
            <p className="text-3xs text-text-tertiary">
              {[stats.preferCategoryWord, stats.preferTimeWord].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {stats.readStat?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {stats.readStat.map((s) => (
                <span
                  key={s.stat}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-3xs text-text-secondary"
                >
                  {s.stat} {s.counts}
                </span>
              ))}
            </div>
          ) : null}
          {stats.topBooks?.length ? (
            <div>
              <div className="mb-1 text-3xs font-medium text-text-quaternary">{t("settings:wereadStats.mostRead")}</div>
              <ul className="m-0 list-none space-y-1 p-0">
                {stats.topBooks.map((b, i) => (
                  <li key={`${b.title}-${i}`} className="flex items-center justify-between gap-2 text-3xs">
                    <span className="truncate text-text-secondary">{b.title}</span>
                    <MetaText>{formatDuration(b.readTime)}</MetaText>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-3xs text-text-quaternary">
            {t("settings:wereadStats.cacheStatus", {
              status: stats.fromCache ? t("settings:wereadStats.cache") : t("settings:wereadStats.realtime"),
              time: formatSyncTime(stats.fetchedAt),
            })}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-1 py-2 text-3xs text-text-quaternary" role="status">
          <Loader2 size={ICON.xs} className="animate-spin" aria-hidden /> {t("settings:wereadStats.loading")}
        </div>
      )}
    </section>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-surface-muted/60 p-2">
      <div className="text-3xs text-text-quaternary">{label}</div>
      <div className="mt-0.5 font-mono text-xs font-medium text-text-primary">{value}</div>
    </div>
  );
}


