// ── StreamView — compact stream rail (aligned quiet list with StreamDetailView) ─
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Loader2,
  AlertCircle,
  RefreshCw,
  Zap,
  FileText,
  ChevronRight,
  Maximize2,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";
import { api } from "../../services/api";
import { emitLocal, onLocal } from "../../plugins/host";
import { useViewStore } from "../../stores/view-store";
import { EmptyState } from "../ui/view";
import { Tooltip } from "../ui/tooltip";
import { ICON, ICON_STROKE } from "../../lib/icons";
import { useTodoStore } from "../../stores/todo-store";
import { cn } from "../../lib/cn";
import {
  parsePeriodNote,
  extractBodyTimestamp,
  groupEntriesByDay,
  type StreamEntry,
} from "../../lib/stream-period-parse";

interface StreamViewProps {
  onNavigate: (selection: {
    kind: string;
    path: string;
    focusHeading?: string;
  }) => void;
}

export function StreamView({ onNavigate }: StreamViewProps) {
  const { t } = useTranslation("shell");
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [periodPath, setPeriodPath] = useState<string | null>(null);
  const [periodTitle, setPeriodTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const select = useViewStore((s) => s.select);
  const todoMaintaining = useTodoStore((s) => s.maintaining === "maintaining");
  const todoActiveCount = useTodoStore((s) => s.items.filter((i) => !i.done).length);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const ctx = await api.ws.getStreamContext();
      // Silent path: skip state update if period path/title unchanged
      if (silent) {
        setPeriodPath((prev) => {
          if (prev === ctx.periodRelPath) return prev;
          return ctx.periodRelPath;
        });
        setPeriodTitle((prev) => {
          const next = ctx.periodTitle || t("sidebar.stream.defaultTitle");
          if (prev === next) return prev;
          return next;
        });
      } else {
        setPeriodPath(ctx.periodRelPath);
        setPeriodTitle(ctx.periodTitle || t("sidebar.stream.defaultTitle"));
      }

      if (!ctx.periodRelPath) {
        setEntries([]);
        if (silent) setError(null);
        return;
      }

      const content = await api.ws.read(ctx.periodRelPath);
      // Identity check: skip setEntries when content unchanged (anti-flicker on auto-save)
      const nextEntries = parsePeriodNote(content);
      setEntries((prev) => {
        if (silent && prev.length === nextEntries.length) {
          const same = prev.every((e, i) =>
            e.heading === nextEntries[i]?.heading &&
            e.body === nextEntries[i]?.body &&
            e.preview === nextEntries[i]?.preview,
          );
          if (same) return prev;
        }
        return nextEntries;
      });
      if (silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocal("workspace:file-changed", (payload) => {
      // Only react to file-changed events that affect the stream period
      // (no relativePath = structural change, or relativePath matches period path)
      const rel =
        payload && typeof payload === "object" && "relativePath" in payload
          ? String((payload as { relativePath?: string }).relativePath || "")
          : "";
      // If it's a specific file save that's not the period note, skip
      if (rel && periodPath && !rel.startsWith("10-") && rel !== periodPath) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load({ silent: true }), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [load, periodPath]);

  const handleOpenPeriod = useCallback(
    (focusHeading?: string) => {
      if (periodPath) {
        const sel = {
          kind: "file" as const,
          path: periodPath,
          ...(focusHeading?.trim() ? { focusHeading: focusHeading.trim() } : {}),
        };
        select(sel);
        onNavigate(sel);
      } else {
        emitLocal("overlay:open", { kind: "quick-capture" });
      }
    },
    [periodPath, select, onNavigate],
  );

  const handleOpenStreamView = useCallback(() => {
    select({ kind: "stream" });
  }, [select]);

  const handleCapture = useCallback(() => {
    emitLocal("overlay:open", { kind: "quick-capture" });
  }, []);

  const handleOpenTaskBoard = useCallback(() => {
    emitLocal("sidebar:set-view", "kanban");
  }, []);

  const handleMaintainTodos = useCallback(() => {
    // Open todo panel so maintain results + progressive force-retry are visible.
    // First click respects skip hash; if last result was already-processed, re-click forces.
    emitLocal("todo:open-popover");
    const st = useTodoStore.getState();
    const force = st.maintainReason === "all-periods-processed";
    void st.maintain(force ? { force: true } : undefined);
  }, []);

  const dayGroups = useMemo(
    () => groupEntriesByDay(entries, t("sidebar.stream.otherDay")),
    [entries, t],
  );

  if (loading) {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-3 text-3xs text-text-tertiary"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />{" "}
        {t("sidebar.stream.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2" role="alert">
        <div className="flex items-center gap-1.5 text-3xs text-error">
          <AlertCircle size={ICON.micro} aria-hidden />
          <span>{error}</span>
        </div>
        <Tooltip content={t("sidebar.stream.reloadTooltip")}>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1 self-start rounded-md border border-border-subtle px-2 py-1 text-3xs text-text-tertiary hover:text-accent-color focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            <RefreshCw size={ICON.micro} aria-hidden /> {t("sidebar.stream.retry")}
          </button>
        </Tooltip>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="px-2 py-3">
        <EmptyState
          compact
          icon={<CalendarDays size={ICON.sm} />}
          title={t("sidebar.stream.emptyTitle")}
          hint={t("sidebar.stream.emptyHint")}
          action={
            <button
              type="button"
              onClick={handleCapture}
              className="inline-flex items-center gap-1 rounded-md bg-accent-color px-2 py-1 text-3xs font-medium text-primary-foreground shadow-(--shadow-button) transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <Zap size={ICON.nano} aria-hidden />
              {t("sidebar.stream.capture")}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle-dim px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarDays size={ICON.xs} className="shrink-0 text-accent-color" />
          <span className="truncate text-3xs font-semibold text-text-primary">{periodTitle}</span>
          <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-px text-3xs tabular-nums text-text-quaternary">
            {entries.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* AI maintain todos — prominent AI action button */}
          <Tooltip content={t("sidebar.stream.maintainTodosTip")}>
            <button
              type="button"
              onClick={handleMaintainTodos}
              disabled={todoMaintaining}
              className={cn(
                "v4-ai-btn flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-3xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                "disabled:opacity-50",
              )}
              aria-label={t("sidebar.stream.maintainTodos")}
            >
              {todoMaintaining ? (
                <Loader2 size={ICON.nano} className="animate-spin" aria-hidden />
              ) : (
                <Sparkles size={ICON.nano} aria-hidden />
              )}
              {todoActiveCount > 0 ? (
                <span className="tabular-nums text-3xs">{todoActiveCount}</span>
              ) : null}
            </button>
          </Tooltip>
          <Tooltip content={t("sidebar.stream.taskBoardTip")}>
            <button
              type="button"
              onClick={handleOpenTaskBoard}
              aria-label={t("sidebar.stream.taskBoardTip")}
              className="flex items-center rounded-sm p-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-accent-color focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <LayoutDashboard size={ICON.nano} {...{ strokeWidth: ICON_STROKE.chrome }} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={t("sidebar.stream.openFullView")}>
            <button
              type="button"
              onClick={handleOpenStreamView}
              aria-label={t("sidebar.stream.openFullView")}
              className="flex items-center rounded-sm p-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-accent-color focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <Maximize2 size={ICON.nano} {...{ strokeWidth: ICON_STROKE.chrome }} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={t("sidebar.stream.reloadTooltip")}>
            <button
              type="button"
              onClick={() => void load()}
              aria-label={t("sidebar.stream.reloadTooltip")}
              className="flex items-center rounded-sm p-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-accent-color focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <RefreshCw size={ICON.nano} {...{ strokeWidth: ICON_STROKE.chrome }} aria-hidden />
            </button>
          </Tooltip>
          {periodPath ? (
            <Tooltip content={t("sidebar.stream.openFull")}>
              <button
                type="button"
                onClick={() => handleOpenPeriod()}
                aria-label={t("sidebar.stream.openFull")}
                className="flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-3xs text-text-tertiary transition-colors hover:bg-surface-muted hover:text-accent-color focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              >
                <FileText size={ICON.nano} {...{ strokeWidth: ICON_STROKE.chrome }} aria-hidden />
                <ChevronRight size={ICON.nano} {...{ strokeWidth: ICON_STROKE.chrome }} aria-hidden />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* Quiet list — day panels (aligned with StreamDetailView cohesion) */}
      <div className="v4-sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-1 py-1.5">
          {dayGroups.map((group, gi) => (
            <section
              key={group.dayKey}
              className={cn(
                "overflow-hidden rounded-md bg-surface/50",
                gi === 0 && "ring-1 ring-inset ring-accent-color/10",
              )}
            >
              <div className="flex items-center gap-1 bg-surface-muted/20 px-1.5 py-1 text-3xs font-medium tracking-wide text-text-quaternary">
                <span className="truncate font-semibold text-text-tertiary">{group.dayLabel}</span>
                <span className="tabular-nums text-text-quaternary/70">{group.entries.length}</span>
                {gi === 0 ? (
                  <span className="text-accent-color/75">{t("sidebar.stream.todayShort")}</span>
                ) : null}
              </div>
              <div className="divide-y divide-border-subtle-dim/50">
                {group.entries.map((entry) => {
                  const bodyTime = extractBodyTimestamp(entry.body);
                  return (
                    <button
                      key={`${group.dayKey}-${entry.index}`}
                      type="button"
                      onClick={() => handleOpenPeriod(entry.heading || undefined)}
                      className={cn(
                        "group flex w-full items-start gap-1.5 px-2 py-1 text-left",
                        "transition-colors duration-fast",
                        "hover:bg-surface-muted/50",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      )}
                    >
                      {bodyTime ? (
                        <span className="mt-px w-7 shrink-0 text-right text-3xs tabular-nums leading-none text-text-quaternary/80">
                          {bodyTime}
                        </span>
                      ) : (
                        <span className="flex w-7 shrink-0 justify-end pt-1" aria-hidden>
                          <span className="h-1 w-1 rounded-full bg-text-quaternary/30" aria-hidden />
                        </span>
                      )}
                      <div className="line-clamp-4 min-w-0 flex-1 text-3xs leading-snug text-text-primary">
                        {entry.preview || entry.body || entry.heading}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
