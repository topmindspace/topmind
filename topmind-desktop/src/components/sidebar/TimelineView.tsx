// ── TimelineView — packing-aware time groups (day / week / month) ─────────
import { useState, useEffect, useCallback, useMemo } from "react";
import { FileText, AlertCircle, RefreshCw, Calendar, Zap, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "../../lib/cn";
import { onLocal } from "../../plugins/host";
import type { NoteMeta } from "../../types";
import { ICON } from "../../lib/icons";
import { getCachedAllNotes } from "../../lib/workspace-data-cache";
import { EmptyState } from "../ui/view";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../ui/workspace-file-menu";
import { useViewStore } from "../../stores/view-store";
import { api } from "../../services/api";

interface TimelineViewProps {
  onNavigate: (selection: { kind: string; path: string }) => void;
}

interface TimeGroup {
  key: string;
  label: string;
  entries: NoteMeta[];
}

/** ISO week key YYYY-Www from local date */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function groupByPacking(entries: NoteMeta[], packing: string, t: TFunction): TimeGroup[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = isoWeekKey(today);
  const thisMonth = monthKey(today);

  const groups: Map<string, { label: string; entries: NoteMeta[] }> = new Map();

  for (const entry of entries) {
    const ts = Date.parse(entry.mtime);
    if (!Number.isFinite(ts)) continue;
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);

    let key: string;
    let label: string;

    // Period notes named 2026-W30.md / 2026-07-22.md — group by filename first
    const base = entry.name.replace(/\.md$/iu, "");
    if (/^\d{4}-W\d{2}$/u.test(base) && packing !== "daily") {
      key = `week:${base}`;
      label = base === thisWeek ? t("sidebar.timeline.weekThis", { key: base }) : base;
    } else if (/^\d{4}-\d{2}-\d{2}$/u.test(base)) {
      key = `day:${base}`;
      if (base === dayKey(today)) label = t("sidebar.timeline.today");
      else if (base === dayKey(yesterday)) label = t("sidebar.timeline.yesterday");
      else label = base;
    } else if (/^\d{4}-\d{2}$/u.test(base) && packing === "monthly") {
      key = `month:${base}`;
      label = base === thisMonth ? t("sidebar.timeline.monthThis", { key: base }) : base;
    } else if (packing === "weekly") {
      const wk = isoWeekKey(d);
      key = `week:${wk}`;
      label = wk === thisWeek ? t("sidebar.timeline.weekThis", { key: wk }) : wk;
    } else if (packing === "monthly") {
      const mk = monthKey(d);
      key = `month:${mk}`;
      label = mk === thisMonth ? t("sidebar.timeline.monthThis", { key: mk }) : mk;
    } else {
      // daily / atom → by day
      const dk = dayKey(d);
      key = `day:${dk}`;
      if (d.getTime() === today.getTime()) label = t("sidebar.timeline.today");
      else if (d.getTime() === yesterday.getTime()) label = t("sidebar.timeline.yesterday");
      else label = dk;
    }

    if (!groups.has(key)) groups.set(key, { label, entries: [] });
    groups.get(key)!.entries.push(entry);
  }

  // Sort groups newest first by key (YYYY… sorts well enough with week numbers)
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, g]) => ({
      key,
      label: g.label,
      entries: g.entries.sort((x, y) => String(y.mtime).localeCompare(String(x.mtime))),
    }));
}

function formatTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TimelineView({ onNavigate }: TimelineViewProps) {
  const { t } = useTranslation("shell");
  const [entries, setEntries] = useState<NoteMeta[]>([]);
  const [packing, setPacking] = useState("weekly");
  const [truncated, setTruncated] = useState(false);
  const [scannedTotal, setScannedTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileMenu = useFileContextMenu();

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [result, ctx] = await Promise.all([
        getCachedAllNotes(200),
        api.ws.getStreamContext().catch(() => null),
      ]);
      setEntries(result.notes);
      setTruncated(Boolean(result.truncated));
      setScannedTotal(
        typeof result.scannedTotal === "number" ? result.scannedTotal : result.total,
      );
      if (ctx?.packing) setPacking(ctx.packing);
      if (silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocal("workspace:file-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load({ silent: true }), 200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [load]);

  const groups = useMemo(() => groupByPacking(entries, packing, t), [entries, packing, t]);

  const packingHint =
    packing === "weekly"
      ? t("sidebar.timeline.packingWeekly")
      : packing === "daily"
        ? t("sidebar.timeline.packingDaily")
        : packing === "monthly"
          ? t("sidebar.timeline.packingMonthly")
          : t("sidebar.timeline.packingAtom");

  if (loading) {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-3 text-3xs text-text-tertiary"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> {t("sidebar.timeline.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2" role="alert">
        <div className="flex items-center gap-1.5 text-3xs text-error">
          <AlertCircle size={ICON.micro} className="shrink-0" aria-hidden />
          <span className="truncate">{error}</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 self-start rounded-[var(--radius-md)] border border-border-subtle px-2 py-1 text-3xs text-text-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          <RefreshCw size={ICON.nano} /> {t("sidebar.timeline.retry")}
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="px-2 py-3">
        <EmptyState
          compact
          icon={<Calendar size={ICON.sm} />}
          title={t("sidebar.timeline.emptyTitle")}
          hint={t("sidebar.timeline.emptyHint")}
          action={
            <button
              type="button"
              onClick={() => useViewStore.getState().openOverlay("quick-capture")}
              className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-accent-color px-2 py-1 text-3xs font-medium text-primary-foreground shadow-[var(--shadow-button)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <Zap size={ICON.nano} aria-hidden />
              {t("sidebar.timeline.capture")}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="v4-sidebar-scroll max-h-full overflow-auto overscroll-contain">
      <div className="mx-2 mb-1 px-1 text-3xs text-text-quaternary" role="status">
        {packingHint}
      </div>
      {truncated && scannedTotal != null && scannedTotal > entries.length ? (
        <div
          className="mx-2 mb-1 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/50 px-2 py-1 text-3xs text-text-tertiary"
          role="status"
        >
          {t("sidebar.timeline.truncatedHint", { shown: entries.length, total: scannedTotal })}
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.key} className="mb-1.5">
          <div className="sticky top-0 z-local flex items-center gap-1.5 bg-chrome px-3 py-1.5 text-3xs font-medium tracking-wide text-text-quaternary">
            <Calendar size={ICON.nano} className="text-text-quaternary" />
            <span>{group.label}</span>
            <span className="rounded-full bg-surface-muted px-1.5 tabular-nums text-text-quaternary/70">
              {group.entries.length}
            </span>
          </div>
          {group.entries.map((entry, i) => (
            <button
              key={`${entry.path}-${i}`}
              type="button"
              onClick={() => onNavigate({ kind: "file", path: entry.path })}
              onContextMenu={(e) =>
                fileMenu.open(e, {
                  path: entry.path,
                  label: entry.name,
                  kind: "note",
                })
              }
              className={cn(
                "v4-dense-row flex w-full items-start gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left",
                "transition-colors duration-[var(--duration-fast)] hover:bg-surface-muted",
              )}
            >
              <FileText size={ICON.xs} className="mt-0.5 shrink-0 text-text-quaternary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">
                  {entry.title || entry.name.replace(/\.md$/u, "")}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-3xs text-text-quaternary">
                  {entry.topic ? <span className="truncate">{entry.topic}</span> : null}
                  {entry.category ? (
                    <span className="shrink-0 text-text-quaternary/60">{entry.category}</span>
                  ) : null}
                </div>
              </div>
              <span className="shrink-0 font-mono text-3xs tabular-nums text-text-quaternary">
                {formatTime(entry.mtime)}
              </span>
            </button>
          ))}
        </div>
      ))}
      <WorkspaceFileContextMenu
        menu={fileMenu.menu}
        onClose={fileMenu.close}
      />
    </div>
  );
}
