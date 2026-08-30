/**
 * WeRead connector hub — status, stats cache, notebook list, sync actions.
 * Selection: { kind: "connector", id: "weread" }
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen, RefreshCw, Loader2, Settings, ChevronRight,
} from "lucide-react";
import { api } from "../../services/api";
import { onLocal } from "../host";
import { useViewStore } from "../../stores/view-store";
import type { PluginContext, ViewSlot } from "../types";
import type { AppSettings, WereadNotebookBook, WereadStatsCache, WereadSyncResult } from "../../types";
import { Button } from "../../components/ui/Button";
import {
  ViewContainer, SectionHeader, EmptyState, LoadingState, ErrorState,
} from "../../components/ui/view";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { formatSyncTime } from "./weread-format";
import { WereadStatsPanel, type StatsMode } from "./WereadStatsPanel";
import {
  ConnectorHubHeader,
  ConnectorStatusPill,
  ConnectorToastBanner,
} from "../connector-ui";


export function createWereadHubView(_ctx: PluginContext): ViewSlot {
  return {
    kind: "view",
    id: "topmind-weread.view.hub",
    order: 20,
    matches: (sel) => sel.kind === "connector" && sel.id === "weread",
    render: () => <WereadHubView />,
  };
}

function WereadHubView() {
  const { t } = useTranslation("weread");
  const openOverlay = useViewStore((s) => s.openOverlay);
  const select = useViewStore((s) => s.select);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.weread.status>> | null>(null);
  const [stats, setStats] = useState<(WereadStatsCache & { fromCache?: boolean }) | null>(null);
  const [books, setBooks] = useState<WereadNotebookBook[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [booksError, setBooksError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statsMode, setStatsMode] = useState<StatsMode>("monthly");
  const [lastPaths, setLastPaths] = useState<string[]>([]);

  const refreshCore = useCallback(async () => {
    setError(null);
    try {
      const [s, st] = await Promise.all([
        api.sys.settings() as Promise<AppSettings>,
        api.weread.status(),
      ]);
      setSettings(s);
      setStatus(st);
      if (st.statsCache) setStats(st.statsCache);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const res = await api.weread.listNotebooks();
      setBooks(res.books || []);
      setBooksError(null);
    } catch (e) {
      setBooksError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  const loadStats = useCallback(async (force = false) => {
    try {
      const res = await api.weread.stats({ mode: statsMode, force });
      setStats(res);
      setStatsError(null);
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : String(e));
    }
  }, [statsMode]);

  useEffect(() => {
    void refreshCore();
  }, [refreshCore]);

  useEffect(() => {
    const unsubProg = onLocal("weread:sync-progress", (p: unknown) => {
      const msg = (p as { message?: string } | null)?.message;
      if (msg) setProgress(msg);
    });
    const unsubDone = onLocal("weread:sync-done", () => {
      setProgress(null);
      void refreshCore();
    });
    return () => {
      unsubProg();
      unsubDone();
    };
  }, [refreshCore]);

  useEffect(() => {
    if (status?.ready) {
      void loadBooks();
      void loadStats(false);
    }
  }, [status?.ready, loadBooks, loadStats]);

  const toggleBook = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(books.map((b) => b.bookId)));
  const clearSel = () => setSelected(new Set());

  const buildToast = (r: WereadSyncResult): string => {
    const parts: string[] = [];
    if ((r.synced ?? 0) > 0) {
      parts.push(t("hub.syncedBooksToast", { count: r.synced }));
      if (r.totalHighlights) parts.push(t("hub.highlightsToast", { count: r.totalHighlights }));
      if (r.totalThoughts) parts.push(t("hub.thoughtsToast", { count: r.totalThoughts }));
    } else {
      parts.push(t("hub.syncDoneToast"));
    }
    if (r.skippedNoChange) parts.push(t("hub.noChangeToast", { count: r.skippedNoChange }));
    if (r.skippedNoHighlights) parts.push(t("hub.noContentToast", { count: r.skippedNoHighlights }));
    if (r.skipped) parts.push(t("hub.errorToast", { count: r.skipped }));
    if (r.syncCategory) parts.push(`→ ${r.syncCategory}/`);
    if ((r.remaining ?? 0) > 0 || r.isPartial) {
      parts.push(t("hub.remainingToast", { count: r.remaining ?? "?" }));
    }
    return parts.join(" · ");
  };

  const runSync = async (opts: { bookIds?: string[]; force?: boolean }) => {
    if (syncing) return;
    setSyncing(true);
    setResult(null);
    setProgress(t("hub.connecting"));
    setLastPaths([]);
    try {
      const r = await api.weread.sync(opts);
      setResult(buildToast(r));
      if (r.paths?.length) {
        setLastPaths(r.paths);
      }
      void refreshCore();
      void loadBooks();
    } catch (e) {
      setResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  const ready = Boolean(status?.ready);
  const category = status?.syncCategory || "—";

  if (loading) return <LoadingState label={t("hub.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void refreshCore()} />;

  if (!settings?.weread?.enabled) {
    return (
      <ViewContainer>
        <EmptyState
          icon={<BookOpen size={ICON.md} />}
          title={t("hub.notEnabled")}
          hint={t("hub.notEnabledHint")}
          action={
            <Button size="sm" onClick={() => openOverlay("settings", { topicId: "topmind-weread.settings" })}>
              <Settings size={ICON.xs} /> {t("hub.openSettings")}
            </Button>
          }
        />
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <ConnectorHubHeader
        icon={<BookOpen size={ICON.md} />}
        title={t("hub.title")}
        subtitle={t("hub.subtitle")}
        meta={
          <>
            <ConnectorStatusPill ok={ready} okLabel={t("hub.connected")} badLabel={t("hub.notConfiguredKey")} />
            <span>·</span>
            <span>→ {category}/</span>
            <span>·</span>
            <span>{t("hub.lastSync", { time: formatSyncTime(status?.lastSyncAt) })}</span>
            {status?.skillVersion ? (
              <>
                <span>·</span>
                <span className="font-mono">skill {status.skillVersion}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || syncing}
              onClick={() => void runSync({})}
            >
              {syncing ? <Loader2 size={ICON.xs} className="animate-spin" aria-hidden /> : <RefreshCw size={ICON.xs} aria-hidden />}
              {t("hub.syncAll")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || syncing || selected.size === 0}
              onClick={() => void runSync({ bookIds: [...selected] })}
            >
              {t("hub.syncSelected", { count: selected.size })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || syncing}
              onClick={() => void runSync({ force: true, bookIds: selected.size ? [...selected] : undefined })}
            >
              {t("hub.forceRewrite")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openOverlay("settings", { topicId: "topmind-weread.settings" })}
              aria-label={t("hub.settings")}
            >
              <Settings size={ICON.xs} />
            </Button>
          </>
        }
      />

      <ConnectorToastBanner progress={progress} result={result}>
        {!progress && lastPaths.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-text-quaternary">{t("hub.openLabel")}</span>
            {lastPaths.slice(0, 5).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => select({ kind: "file", path: p })}
                className="rounded-[var(--radius-sm)] border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-3xs text-text-secondary transition-colors hover:border-accent-color hover:text-accent-color v4-focus-ring"
              >
                {p.split("/").slice(-2).join("/")}
              </button>
            ))}
            {lastPaths.length > 5 ? (
              <span className="text-3xs text-text-quaternary">+{lastPaths.length - 5}</span>
            ) : null}
          </div>
        ) : null}
      </ConnectorToastBanner>

      {statsError ? (
        <ErrorState
          message={t("hub.statsError", { msg: statsError })}
          onRetry={() => void loadStats(true)}
        />
      ) : null}
      <WereadStatsPanel
        ready={ready}
        stats={stats}
        statsMode={statsMode}
        onStatsMode={setStatsMode}
        onRefresh={() => void loadStats(true)}
        onOpenSettings={() => openOverlay("settings", { topicId: "topmind-weread.settings" })}
      />

      {/* Notebooks */}
      <section>
        {booksError ? (
          <ErrorState
            message={t("hub.listError", { msg: booksError })}
            onRetry={() => void loadBooks()}
          />
        ) : null}
        <SectionHeader
          icon={<BookOpen size={ICON.sm} />}
          label={t("hub.booksWithNotes")}
          count={books.length}
          actions={
            <div className="flex items-center gap-1.5 text-3xs">
              <button type="button" className="text-text-tertiary hover:text-accent-color" onClick={selectAll}>
                {t("hub.selectAll")}
              </button>
              <span className="text-text-quaternary">·</span>
              <button type="button" className="text-text-tertiary hover:text-accent-color" onClick={clearSel}>
                {t("hub.clear")}
              </button>
              <button
                type="button"
                disabled={loadingBooks || !ready}
                onClick={() => void loadBooks()}
                className="rounded p-1 text-text-quaternary hover:bg-surface-muted"
              >
                {loadingBooks ? <Loader2 size={ICON.micro} className="animate-spin" /> : <RefreshCw size={ICON.micro} />}
              </button>
            </div>
          }
        />
        {!ready ? null : loadingBooks && books.length === 0 ? (
          <div className="flex items-center gap-1.5 px-1 py-2 text-3xs text-text-quaternary">
            <Loader2 size={ICON.xs} className="animate-spin" /> {t("hub.fetchingBooks")}
          </div>
        ) : books.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={ICON.md} />}
            title={t("hub.noBooks")}
            hint={t("hub.noBooksHint")}
          />
        ) : (
          <div className="v4-dash-card max-h-[420px] overflow-auto p-1">
            {books.map((b) => {
              const on = selected.has(b.bookId);
              return (
                <button
                  key={b.bookId}
                  type="button"
                  onClick={() => toggleBook(b.bookId)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors",
                    on ? "bg-accent-bg-subtle" : "hover:bg-surface-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-3xs",
                      on
                        ? "border-accent-color bg-accent-color text-white"
                        : "border-border-subtle text-transparent",
                    )}
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-3xs font-medium text-text-primary">{b.title || b.bookId}</div>
                    <div className="truncate text-3xs text-text-quaternary">
                      {b.author || t("hub.unknownAuthor")}
                      {" · "}
                      {t("hub.highlights", { count: b.noteCount })}
                      {" · "}
                      {t("hub.thoughts", { count: b.reviewCount })}
                      {b.bookmarkCount ? ` · ${t("hub.bookmarks", { count: b.bookmarkCount })}` : ""}
                    </div>
                  </div>
                  <ChevronRight size={ICON.xs} className="shrink-0 text-text-quaternary" />
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-3xs leading-relaxed text-text-quaternary">
          {t("hub.bookFormatHint")}
        </p>
        {status?.lastSyncSummary ? (
          <p className="mt-1 text-3xs text-text-quaternary">
            {t("hub.lastSummary", { synced: status.lastSyncSummary.synced, skippedNoChange: status.lastSyncSummary.skippedNoChange })}
            {status.lastSyncSummary.remaining
              ? t("hub.lastSummaryRemaining", { remaining: status.lastSyncSummary.remaining })
              : ""}
          </p>
        ) : null}
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => select({ kind: "stream" })}>
            {t("hub.backHome")}
          </Button>
        </div>
      </section>
    </ViewContainer>
  );
}

