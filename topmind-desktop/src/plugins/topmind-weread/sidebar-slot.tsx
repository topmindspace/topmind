/**
 * Weread SidebarSlot — open hub + quick sync + progress.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, RefreshCw, Loader2, Settings, ExternalLink } from "lucide-react";
import { api } from "../../services/api";
import { onLocal } from "../host";
import type { PluginContext, SidebarSlot } from "../types";
import type { AppSettings, WereadSyncResult } from "../../types";
import { cn } from "../../lib/cn";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { Tooltip } from "../../components/ui/tooltip";
import { ICON } from "../../lib/icons";
import { intlLocale } from "../../locales";

export function createWereadSidebarSlot(ctx: PluginContext): SidebarSlot {
  return {
    kind: "sidebar",
    id: "topmind-weread.sidebar",
    label: "Weread",
    labelKey: "weread:name",
    icon: "book-open",
    order: 200,
    render: () => <WereadSidebarEntry ctx={ctx} />,
  };
}

function WereadSidebarEntry({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation("weread");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDesc, setConfirmDesc] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    void api.sys.settings().then((s) => {
      const app = s as AppSettings;
      setSettings(app);
      setLastSync(app.weread?.lastSyncAt ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubP = onLocal("weread:sync-progress", (p: unknown) => {
      const msg = (p as { message?: string } | null)?.message;
      if (msg) setProgress(msg);
    });
    const unsubD = onLocal("weread:sync-done", (p: unknown) => {
      setProgress(null);
      const r = p as WereadSyncResult | null;
      if (r?.lastSyncAt) setLastSync(r.lastSyncAt);
    });
    return () => {
      unsubP();
      unsubD();
    };
  }, []);

  if (!settings?.weread?.enabled) return null;

  const isConfigured = Boolean(settings.weread.apiKey);

  const buildToast = (result: WereadSyncResult): string => {
    const parts: string[] = [];
    if ((result.synced ?? 0) > 0) {
      parts.push(t("sidebar.syncedBooks", { count: result.synced }));
      if (result.totalHighlights) parts.push(t("sidebar.highlights", { count: result.totalHighlights }));
      if (result.totalThoughts) parts.push(t("sidebar.thoughts", { count: result.totalThoughts }));
    } else {
      parts.push(t("sidebar.syncDone"));
    }
    if (result.skippedNoChange) parts.push(t("sidebar.noChange", { count: result.skippedNoChange }));
    if (result.skipped) parts.push(t("sidebar.errors", { count: result.skipped }));
    if (result.syncCategory) parts.push(`→ ${result.syncCategory}/`);
    if ((result.remaining ?? 0) > 0 || result.isPartial) {
      parts.push(t("sidebar.remaining", { count: result.remaining ?? "?" }));
    }
    return parts.join(" · ");
  };

  const startSync = async () => {
    setSyncing(true);
    setToast(null);
    setProgress(t("sidebar.connecting"));
    try {
      const result = await api.weread.sync();
      setToast(buildToast(result));
      if (result.lastSyncAt) setLastSync(result.lastSyncAt);
      ctx.events.emit("workspace:file-changed", null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast(`✗ ${msg.length > 80 ? msg.slice(0, 77) + "…" : msg}`);
    } finally {
      setSyncing(false);
      setProgress(null);
      void api.sys.settings().then((s) => setSettings(s as AppSettings)).catch(() => {});
      setTimeout(() => setToast(null), 6000);
    }
  };

  const openHub = () => {
    if (!isConfigured) {
      ctx.openOverlay("settings", { topicId: "topmind-weread.settings" });
      return;
    }
    ctx.navigate({ kind: "connector", id: "weread" });
  };

  const handleSyncClick = async () => {
    if (syncing) return;
    if (!isConfigured) {
      ctx.openOverlay("settings", { topicId: "topmind-weread.settings" });
      return;
    }
    try {
      const status = await api.weread.status();
      const category = status.syncCategory || t("sidebar.autoResolve");
      if (!status.lastSyncAt) {
        setConfirmDesc(
          t("sidebar.firstSyncConfirm", { category }),
        );
      } else {
        const dateStr = new Date(status.lastSyncAt).toLocaleString(intlLocale());
        setConfirmDesc(
          t("sidebar.resyncConfirm", { date: dateStr, category }),
        );
      }
      setConfirmOpen(true);
    } catch {
      void startSync();
    }
  };

  const statusLine = !isConfigured
    ? t("sidebar.clickConfig")
    : lastSync
      ? t("sidebar.syncAgo", { time: relativeShort(lastSync, t) })
      : t("sidebar.openHubHint");

  return (
    <div className="group relative flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] p-2 transition-colors hover:bg-surface-muted">
      <Tooltip content={isConfigured ? t("sidebar.openHubTooltip") : "WeRead API Key"}>
        <div
          onClick={() => openHub()}
          className="flex flex-1 cursor-pointer select-none items-center gap-2.5 truncate"
        >
          <BookOpen size={ICON.xs} className="shrink-0 text-text-tertiary" />
          <div className="flex flex-col truncate leading-tight">
            <span className="truncate text-3xs font-medium text-text-primary">{t("sidebar.label")}</span>
            <span className="truncate text-3xs text-text-quaternary">{statusLine}</span>
          </div>
        </div>
      </Tooltip>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {isConfigured ? (
          <>
            <Tooltip content={t("sidebar.openHub")}>
              <button
                type="button"
                aria-label={t("sidebar.openHub")}
                onClick={(e) => {
                  e.stopPropagation();
                  openHub();
                }}
                className="rounded-[var(--radius-sm)] p-1 text-text-tertiary transition-colors hover:bg-surface-active v4-focus-ring hover:text-text-primary"
              >
                <ExternalLink size={ICON.micro} />
              </button>
            </Tooltip>
            <Tooltip content={t("sidebar.syncNow")}>
              <button
                type="button"
                aria-label={t("sidebar.syncNow")}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleSyncClick();
                }}
                disabled={syncing}
                className="rounded-[var(--radius-sm)] p-1 text-text-tertiary transition-colors hover:bg-surface-active v4-focus-ring hover:text-text-primary disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 size={ICON.micro} className="animate-spin text-accent-color" />
                ) : (
                  <RefreshCw size={ICON.micro} />
                )}
              </button>
            </Tooltip>
          </>
        ) : null}
        <Tooltip content={t("sidebar.settings")}>
          <button
            type="button"
            aria-label={t("sidebar.settings")}
            onClick={(e) => {
              e.stopPropagation();
              ctx.openOverlay("settings", { topicId: "topmind-weread.settings" });
            }}
            className="rounded-[var(--radius-sm)] p-1 text-text-tertiary transition-colors hover:bg-surface-active v4-focus-ring hover:text-text-primary"
          >
            <Settings size={ICON.micro} />
          </button>
        </Tooltip>
      </div>
      {progress ? (
        <div className="absolute left-1 right-1 -bottom-0.5 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-accent-color/20 bg-accent-color/5 px-2 py-1 text-3xs text-accent-color">
          <Loader2 size={ICON.micro} className="shrink-0 animate-spin" />
          <span className="truncate">{progress}</span>
        </div>
      ) : null}
      {toast && !progress ? (
        <div
          className={cn(
            "absolute left-1 right-1 -bottom-0.5 rounded-[var(--radius-md)] border px-2 py-1 text-3xs",
            toast.startsWith("✓")
              ? "border-success/20 bg-status-success-bg text-success"
              : toast.startsWith("✗")
                ? "border-error/20 bg-status-error-bg text-error"
                : "border-border-subtle bg-surface-muted/40 text-text-tertiary",
          )}
        >
          {toast}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title={t("sidebar.syncConfirmTitle")}
        description={confirmDesc}
        confirmText={t("sidebar.confirmSync")}
        cancelText={t("sidebar.cancel")}
        onConfirm={() => {
          setConfirmOpen(false);
          void startSync();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function relativeShort(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return t("statusBar.justNow");
  if (diffMin < 60) return t("statusBar.minutesAgo", { count: diffMin });
  if (diffMin < 1440) return t("statusBar.hoursAgo", { count: Math.floor(diffMin / 60) });
  return new Date(ts).toLocaleDateString(intlLocale());
}
