/**
 * Tools & Logs overlay — workspace maintenance + log browsing.
 * Entry: workspace switcher menu · ⌘⇧L
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiBarChartBoxLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiFolderOpenLine,
  RiLoader4Line,
  RiRefreshLine,
  RiFileTextLine,
  RiHistoryLine,
  RiStethoscopeLine,
  RiSparklingLine,
  RiArrowGoBackLine,
} from "@remixicon/react";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { emitLocal } from "../../plugins/host";
import { Button } from "../ui/Button";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/format-bytes";

type TabId = "overview" | "ops" | "syslog" | "health" | "care";

const TABS: { id: TabId; icon: typeof RiBarChartBoxLine }[] = [
  { id: "overview", icon: RiBarChartBoxLine },
  { id: "ops", icon: RiHistoryLine },
  { id: "syslog", icon: RiFileTextLine },
  { id: "health", icon: RiStethoscopeLine },
  { id: "care", icon: RiSparklingLine },
];

interface Stats {
  scannedAt: string;
  totalFiles: number;
  totalBytes: number;
  byExt: { ext: string; count: number; bytes: number }[];
  byTopLevel: { name: string; count: number; bytes: number; role?: string }[];
  largest: { path: string; bytes: number }[];
  delivery: { count: number; bytes: number; nestedDirs?: number };
  archive: { count: number; bytes: number; backups?: number; receipts?: number; trash?: number; streamArchive?: number };
}

interface Health {
  ok: boolean;
  summary?: {
    categoryCount?: number;
    topicCount?: number;
    inboxCount?: number;
    outputsCount?: number;
    errorCount?: number;
    warningCount?: number;
  };
  checks?: Record<string, { ok?: boolean; status?: string }>;
  issues?: { severity: string; code?: string; message: string; path?: string }[];
}

interface OpsEntry {
  ts?: string;
  actor?: string;
  op?: string;
  ok?: boolean;
  rel?: string | null;
  backup?: string | null;
  receipt?: string | null;
}

interface SysEntry {
  ts?: string;
  level?: string;
  cat?: string;
  msg?: string;
  [k: string]: unknown;
}

interface CarePreview {
  junk: string[];
  emptyDirs: string[];
  outOfConvention: { path: string; kind: string }[];
  archive: { bytes: number; files: number };
}

interface DupGroup {
  hash: string;
  size: number;
  full?: boolean;
  paths: string[];
  mtimes?: string[];
  suggestedKeepIndex?: number;
}

export function ToolsLogsPanel() {
  const { t } = useTranslation("shell");
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const titleId = useId();
  const [tab, setTab] = useState<TabId>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [ops, setOps] = useState<OpsEntry[]>([]);
  const [syslog, setSyslog] = useState<SysEntry[]>([]);
  const [sysLevel, setSysLevel] = useState<string>("");
  const [care, setCare] = useState<CarePreview | null>(null);
  const [dupes, setDupes] = useState<DupGroup[]>([]);
  const [dupWaste, setDupWaste] = useState(0);
  const [confirmCare, setConfirmCare] = useState(false);
  const [keepMap, setKeepMap] = useState<Record<string, number>>({});
  const [trash, setTrash] = useState<
    { trashRelativePath: string; originalRelativePath: string; name: string; size: number; mtime: string }[]
  >([]);

  const loadOverview = useCallback(async () => {
    setBusy("overview");
    setError(null);
    try {
      const [s, h] = await Promise.all([api.ws.stats(), api.ws.health()]);
      setStats(s);
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const loadOps = useCallback(async () => {
    setBusy("ops");
    try {
      const r = await api.sys.logTail({ file: "ops", limit: 200, includeRotated: false });
      setOps(r.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const loadSyslog = useCallback(async (level?: string) => {
    setBusy("syslog");
    try {
      const r = await api.sys.logTail({
        file: "main",
        limit: 200,
        level: level || undefined,
        includeRotated: false,
      });
      setSyslog(r.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const loadCare = useCallback(async () => {
    setBusy("care");
    try {
      const [c, d, tr] = await Promise.all([
        api.ws.cleanupPreview(),
        api.ws.duplicates({ minSize: 1024, maxGroups: 20 }),
        api.ws.listTrashItems(20).catch(() => ({ items: [] })),
      ]);
      setCare(c);
      setDupes(d.groups || []);
      setDupWaste(d.wastedBytes || 0);
      setTrash(tr.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "ops") void loadOps();
    if (tab === "syslog") void loadSyslog(sysLevel);
    if (tab === "care" && !care) void loadCare();
  }, [tab, loadOps, loadSyslog, sysLevel, loadCare, care]);

  const healthIssues = useMemo(() => health?.issues || [], [health]);
  const contractStatus = health?.checks?.contract?.status || "unknown";

  const applyJunkCleanup = async () => {
    if (!care?.junk?.length) return;
    setBusy("apply-junk");
    setConfirmCare(false);
    try {
      const r = await api.ws.cleanupApply({
        targets: [{ kind: "junk", paths: care.junk }],
        confirmed: true,
      });
      if (r.ok) await loadCare();
      else setError(r.reason || "cleanup failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const applyPrune = async () => {
    setBusy("apply-prune");
    setConfirmCare(false);
    try {
      const r = await api.ws.cleanupApply({
        targets: [{ kind: "prune-backups" }],
        confirmed: true,
      });
      if (r.ok) await loadCare();
      else setError(r.reason || "prune failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="v4-overlay-sheet v4-settings-dialog flex h-[min(760px,88vh)] w-[min(960px,calc(100vw-2rem))] max-w-full overflow-hidden"
      data-tools-logs-panel
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <nav
        className="v4-sidebar-scroll v4-settings-nav m-2.5 mr-0 flex w-[160px] shrink-0 flex-col gap-0.5 self-stretch overflow-y-auto rounded-[var(--radius-lg)] border border-border-subtle-dim p-1.5"
        aria-label={t("toolsLogs.title")}
      >
        <div className="mb-1.5 flex items-center gap-2 px-1.5 py-1">
          <RiStethoscopeLine size={ICON.xs} className="shrink-0 text-accent-color" aria-hidden />
          <span className="truncate text-3xs font-semibold text-text-primary">{t("toolsLogs.title")}</span>
        </div>
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-left text-3xs transition-colors v4-focus-ring",
              tab === id
                ? "bg-surface-elevated font-semibold text-text-primary shadow-[var(--shadow-card)] ring-1 ring-border-subtle-dim"
                : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
            )}
          >
            <Icon size={ICON.xs} className="shrink-0 opacity-70" />
            <span className="truncate">{t(`toolsLogs.tabs.${id}`)}</span>
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border-subtle-dim bg-surface-elevated">
        <header
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle-dim bg-[var(--color-dialog-header)] px-5 py-3"
          data-tools-logs-header
        >
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold tracking-tight text-text-primary">
              {t(`toolsLogs.tabs.${tab}`)}
            </h2>
            <p className="mt-0.5 truncate text-3xs text-text-quaternary">{t("toolsLogs.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => {
                if (tab === "overview" || tab === "health") void loadOverview();
                else if (tab === "ops") void loadOps();
                else if (tab === "syslog") void loadSyslog(sysLevel);
                else void loadCare();
              }}
              disabled={!!busy}
              aria-label={t("common:action.refresh")}
            >
              {busy ? <RiLoader4Line size={ICON.xs} className="animate-spin" /> : <RiRefreshLine size={ICON.xs} />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => closeOverlay()}
              aria-label={t("common:action.close")}
            >
              <RiCloseLine size={ICON.xs} />
            </Button>
          </div>
        </header>

        <div className="v4-content-scroll min-h-0 flex-1 overflow-auto overscroll-contain bg-background/30">
          <div className="mx-auto w-full max-w-[42rem] px-4 py-4 sm:px-5">
            {error ? (
              <div
                className="mb-3 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-3 py-2 text-3xs text-error"
                role="alert"
              >
                <span className="break-words">{error}</span>
                <button
                  type="button"
                  className="ml-2 font-medium underline v4-focus-ring"
                  onClick={() => setError(null)}
                  aria-label={t("common:action.close")}
                >
                  ×
                </button>
              </div>
            ) : null}

          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label={t("toolsLogs.metrics.files")} value={String(stats?.totalFiles ?? "—")} />
                <Metric label={t("toolsLogs.metrics.size")} value={stats ? formatBytes(stats.totalBytes) : "—"} />
                <Metric label={t("toolsLogs.metrics.topics")} value={String(health?.summary?.topicCount ?? "—")} />
                <Metric
                  label={t("toolsLogs.metrics.health")}
                  value={health?.ok ? t("toolsLogs.ok") : t("toolsLogs.hasIssues")}
                  tone={health?.ok ? "ok" : "warn"}
                />
              </div>
              <Section title={t("toolsLogs.sections.byTop")}>
                {!stats?.byTopLevel?.length ? (
                  <Empty text={t("toolsLogs.empty.noStats")} />
                ) : (
                  <ul className="space-y-1">
                    {stats.byTopLevel.slice(0, 12).map((row) => (
                      <li key={row.name} className="flex items-center gap-2 text-3xs">
                        <span className="min-w-0 flex-1 truncate text-text-secondary" title={row.name}>
                          {row.name}
                          {row.role ? <span className="ml-1 text-text-quaternary">· {row.role}</span> : null}
                        </span>
                        <span className="tabular-nums text-text-tertiary">{row.count}</span>
                        <span className="w-20 text-right tabular-nums text-text-secondary">{formatBytes(row.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <div className="grid gap-3 sm:grid-cols-2">
                <Section title={t("toolsLogs.sections.delivery")}>
                  <p className="text-3xs text-text-secondary">
                    {stats
                      ? t("toolsLogs.deliveryLine", {
                          count: stats.delivery.count,
                          size: formatBytes(stats.delivery.bytes),
                          nested: stats.delivery.nestedDirs || 0,
                        })
                      : "—"}
                  </p>
                </Section>
                <Section title={t("toolsLogs.sections.archive")}>
                  <p className="text-3xs text-text-secondary">
                    {stats
                      ? t("toolsLogs.archiveLine", {
                          size: formatBytes(stats.archive.bytes),
                          backups: formatBytes(stats.archive.backups || 0),
                          receipts: formatBytes(stats.archive.receipts || 0),
                        })
                      : "—"}
                  </p>
                </Section>
              </div>
              <Section title={t("toolsLogs.sections.largest")}>
                {!stats?.largest?.length ? (
                  <Empty text={t("toolsLogs.empty.noStats")} />
                ) : (
                  <ul className="space-y-1">
                    {stats.largest.slice(0, 8).map((f) => (
                      <li key={f.path} className="flex gap-2 text-3xs">
                        <span className="min-w-0 flex-1 truncate text-text-secondary" title={f.path}>{f.path}</span>
                        <span className="tabular-nums text-text-tertiary">{formatBytes(f.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}

          {tab === "ops" && (
            <div className="space-y-2">
              <p className="text-3xs text-text-tertiary">{t("toolsLogs.ops.hint")}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void api.sys.logOpenFolder()}>
                  <RiFolderOpenLine size={ICON.micro} className="mr-1" />
                  {t("toolsLogs.openFolder")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await api.sys.logClear({ file: "ops" });
                    await loadOps();
                  }}
                >
                  <RiDeleteBinLine size={ICON.micro} className="mr-1" />
                  {t("toolsLogs.clearOps")}
                </Button>
              </div>
              {!ops.length ? (
                <Empty text={t("toolsLogs.ops.empty")} />
              ) : (
                <ul className="divide-y divide-border-subtle-dim rounded-md border border-border-subtle">
                  {[...ops].reverse().map((e, i) => (
                    <li key={`${e.ts}-${i}`} className="flex items-start gap-2 px-2.5 py-2 text-3xs">
                      <span className={cn("mt-0.5 shrink-0", e.ok === false ? "text-error" : "text-success")}>
                        {e.ok === false ? <RiErrorWarningLine size={ICON.micro} /> : <RiCheckboxCircleLine size={ICON.micro} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-text-secondary">
                          <span className="font-medium text-text-primary">{e.op}</span>
                          <span className="text-text-quaternary">{e.actor}</span>
                          {e.ts ? <span className="text-text-quaternary">{e.ts.slice(11, 19)}</span> : null}
                        </div>
                        <div className="truncate text-text-tertiary" title={e.rel || ""}>{e.rel}</div>
                        {e.backup ? (
                          <div className="truncate text-text-quaternary">backup · {e.backup}</div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "syslog" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {["", "info", "warn", "error"].map((lv) => (
                  <button
                    key={lv || "all"}
                    type="button"
                    onClick={() => {
                      setSysLevel(lv);
                      void loadSyslog(lv);
                    }}
                    className={cn(
                      "rounded-md px-2 py-1 text-3xs v4-focus-ring",
                      sysLevel === lv ? "bg-accent-bg-subtle text-accent-color" : "text-text-tertiary hover:bg-surface-muted",
                    )}
                  >
                    {lv || t("toolsLogs.sys.all")}
                  </button>
                ))}
                <div className="flex-1" />
                <Button size="sm" variant="outline" onClick={() => void api.sys.logOpenFolder()}>
                  <RiFolderOpenLine size={ICON.micro} className="mr-1" />
                  {t("toolsLogs.openFolder")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await api.sys.logClear({ file: "main", includeRotated: false });
                    await loadSyslog(sysLevel);
                  }}
                >
                  <RiDeleteBinLine size={ICON.micro} className="mr-1" />
                  {t("toolsLogs.clearMain")}
                </Button>
              </div>
              {!syslog.length ? (
                <Empty text={t("toolsLogs.sys.empty")} />
              ) : (
                <ul className="space-y-1 font-mono text-3xs">
                  {[...syslog].reverse().map((e, i) => (
                    <li key={`${e.ts}-${i}`} className="flex gap-2 rounded px-1.5 py-0.5 hover:bg-surface-muted">
                      <span className="shrink-0 text-text-quaternary">{String(e.ts || "").slice(11, 19)}</span>
                      <span
                        className={cn(
                          "w-10 shrink-0 uppercase",
                          e.level === "error" ? "text-error" : e.level === "warn" ? "text-warning" : "text-text-tertiary",
                        )}
                      >
                        {e.level}
                      </span>
                      <span className="w-16 shrink-0 truncate text-accent-color">{e.cat}</span>
                      <span className="min-w-0 flex-1 truncate text-text-secondary" title={String(e.msg || "")}>
                        {String(e.msg || "")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "health" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-3xs">
                <span className="text-text-tertiary">{t("toolsLogs.health.contract")}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-medium",
                    contractStatus === "ok" ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
                  )}
                >
                  {contractStatus}
                </span>
              </div>
              {!healthIssues.length ? (
                <Empty text={t("toolsLogs.health.clean")} />
              ) : (
                <ul className="space-y-1.5">
                  {healthIssues.map((issue, i) => (
                    <li
                      key={`${issue.code}-${i}`}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-3xs",
                        issue.severity === "error"
                          ? "border-error/30 bg-error/5"
                          : issue.severity === "warning"
                            ? "border-warning/30 bg-warning/5"
                            : "border-border-subtle",
                      )}
                    >
                      <div className="flex gap-2">
                        <span className="shrink-0 font-medium uppercase text-text-quaternary">{issue.severity}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-text-primary">{issue.message}</div>
                          {issue.path ? <div className="truncate text-text-quaternary">{issue.path}</div> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setBusy("doctor");
                  try {
                    await api.tool.doctor(false);
                    await loadOverview();
                  } finally {
                    setBusy(null);
                  }
                }}
                disabled={!!busy}
              >
                {t("toolsLogs.health.runDoctor")}
              </Button>
            </div>
          )}

          {tab === "care" && (
            <div className="space-y-4">
              <Section title={t("toolsLogs.care.archive")}>
                <p className="text-3xs text-text-secondary">
                  {t("toolsLogs.care.archiveLine", {
                    size: formatBytes(care?.archive?.bytes || 0),
                    files: care?.archive?.files || 0,
                  })}
                </p>
                <p className="mt-1 text-3xs text-text-tertiary">{t("toolsLogs.care.pruneHint")}</p>
                {!confirmCare ? (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setConfirmCare(true)}>
                    {t("toolsLogs.care.prune")}
                  </Button>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={!!busy} onClick={() => void applyPrune()}>
                      {busy === "apply-prune" ? <RiLoader4Line size={ICON.micro} className="animate-spin" /> : null}
                      {t("toolsLogs.care.confirm")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmCare(false)}>
                      {t("toolsLogs.care.cancel")}
                    </Button>
                  </div>
                )}
              </Section>

              <Section title={t("toolsLogs.care.trash")}>
                {!trash.length ? (
                  <Empty text={t("toolsLogs.care.noTrash")} />
                ) : (
                  <>
                    <p className="mb-2 text-3xs text-text-tertiary">{t("toolsLogs.care.trashHint")}</p>
                    <ul className="max-h-40 space-y-1 overflow-auto">
                      {trash.map((item) => (
                        <li
                          key={item.trashRelativePath}
                          className="flex items-center justify-between gap-2 text-3xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-text-secondary" title={item.originalRelativePath}>
                              {item.originalRelativePath}
                            </div>
                            <div className="truncate text-text-quaternary">
                              {formatBytes(item.size)} · {new Date(item.mtime).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!busy}
                            onClick={async () => {
                              setBusy("restore-trash");
                              try {
                                const r = await api.ws.restoreTrashItem({
                                  trashRelativePath: item.trashRelativePath,
                                });
                                if (r?.ok || r?.wroteFiles || r?.path) {
                                  setTrash((prev) =>
                                    prev.filter((x) => x.trashRelativePath !== item.trashRelativePath),
                                  );
                                  emitLocal("toast:show", {
                                    text: t("toolsLogs.care.restored", { path: r.path || item.originalRelativePath }),
                                    kind: "success",
                                  });
                                  emitLocal("workspace:file-changed", { relativePath: r.path });
                                } else {
                                  setError(t("toolsLogs.care.restoreFailed"));
                                }
                              } catch (e) {
                                setError(e instanceof Error ? e.message : String(e));
                              } finally {
                                setBusy(null);
                              }
                            }}
                          >
                            {busy === "restore-trash" ? (
                              <RiLoader4Line size={ICON.micro} className="animate-spin" />
                            ) : (
                              <RiArrowGoBackLine size={ICON.micro} aria-hidden />
                            )}
                            {t("toolsLogs.care.restore")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Section>

              <Section title={t("toolsLogs.care.junk")}>
                {!care?.junk?.length ? (
                  <Empty text={t("toolsLogs.care.noJunk")} />
                ) : (
                  <>
                    <ul className="mb-2 max-h-28 space-y-0.5 overflow-auto text-3xs text-text-secondary">
                      {care.junk.map((p) => (
                        <li key={p} className="truncate">{p}</li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => void applyJunkCleanup()}
                    >
                      {t("toolsLogs.care.removeJunk")}
                    </Button>
                  </>
                )}
              </Section>

              <Section title={t("toolsLogs.care.convention")}>
                {!care?.outOfConvention?.length ? (
                  <Empty text={t("toolsLogs.care.noConvention")} />
                ) : (
                  <ul className="space-y-0.5 text-3xs text-text-secondary">
                    {care.outOfConvention.map((x) => (
                      <li key={x.path} className="flex gap-2">
                        <span className="text-text-quaternary">{x.kind}</span>
                        <span className="truncate">{x.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t("toolsLogs.care.emptyDirs")}>
                {!care?.emptyDirs?.length ? (
                  <Empty text={t("toolsLogs.care.noEmptyDirs")} />
                ) : (
                  <>
                    <ul className="mb-2 max-h-28 space-y-0.5 overflow-auto text-3xs text-text-secondary">
                      {care.emptyDirs.map((p) => (
                        <li key={p} className="truncate">{p}</li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={async () => {
                        setBusy("apply-empty");
                        try {
                          const r = await api.ws.cleanupApply({
                            targets: [{ kind: "empty-dirs", paths: care.emptyDirs }],
                            confirmed: true,
                          });
                          if (r.ok) await loadCare();
                          else setError(r.reason || "rmdir failed");
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {t("toolsLogs.care.removeEmptyDirs")}
                    </Button>
                  </>
                )}
              </Section>

              <Section title={t("toolsLogs.care.duplicates")}>
                <p className="text-3xs text-text-secondary">
                  {t("toolsLogs.care.dupLine", {
                    groups: dupes.length,
                    waste: formatBytes(dupWaste),
                  })}
                </p>
                {dupes.length > 0 && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={async () => {
                          const targets = dupes
                            .filter((g) => g.full !== false)
                            .map((g) => {
                              const keepIdx = keepMap[g.hash] ?? g.suggestedKeepIndex ?? 0;
                              const drop = g.paths.filter((_, i) => i !== keepIdx);
                              if (!drop.length) return null;
                              return {
                                kind: "duplicate-group",
                                keepPath: g.paths[keepIdx],
                                dropPaths: drop,
                                mode: "trash",
                              };
                            })
                            .filter(Boolean);
                          if (!targets.length) return;
                          setBusy("dup-all");
                          try {
                            const r = await api.ws.cleanupApply({
                              targets: targets as Array<Record<string, unknown>>,
                              confirmed: true,
                            });
                            if (r.ok) await loadCare();
                            else setError(r.reason || "dup cleanup failed");
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === "dup-all"
                          ? <RiLoader4Line size={ICON.micro} className="animate-spin" />
                          : t("toolsLogs.care.trashAllDupes")}
                      </Button>
                      {dupes.some((g) => g.full === false) ? (
                        <span className="text-3xs text-warning">{t("toolsLogs.care.partialHint")}</span>
                      ) : null}
                    </div>
                    <ul className="mt-2 space-y-2">
                      {dupes.map((g) => {
                        const keepIdx = keepMap[g.hash] ?? g.suggestedKeepIndex ?? 0;
                        return (
                          <li key={g.hash} className="rounded-md border border-border-subtle p-2 text-3xs">
                            <div className="mb-1 flex items-center gap-2 text-text-tertiary">
                              <span>{formatBytes(g.size)} × {g.paths.length}</span>
                              {g.full === false ? (
                                <span className="rounded bg-warning/10 px-1 text-warning">
                                  {t("toolsLogs.care.partialOnly")}
                                </span>
                              ) : null}
                              <div className="flex-1" />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!busy || g.full === false}
                                onClick={async () => {
                                  const drop = g.paths.filter((_, i) => i !== keepIdx);
                                  if (!drop.length) return;
                                  setBusy(`dup-${g.hash}`);
                                  try {
                                    const r = await api.ws.cleanupApply({
                                      targets: [{
                                        kind: "duplicate-group",
                                        keepPath: g.paths[keepIdx],
                                        dropPaths: drop,
                                        mode: "trash",
                                      }],
                                      confirmed: true,
                                    });
                                    if (r.ok) await loadCare();
                                    else setError(r.reason || "dup cleanup failed");
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : String(e));
                                  } finally {
                                    setBusy(null);
                                  }
                                }}
                              >
                                {busy === `dup-${g.hash}`
                                  ? <RiLoader4Line size={ICON.micro} className="animate-spin" />
                                  : t("toolsLogs.care.trashOthers")}
                              </Button>
                            </div>
                            {g.paths.map((p, i) => (
                              <label key={p} className="flex cursor-pointer items-center gap-1.5 truncate text-text-secondary" title={p}>
                                <input
                                  type="radio"
                                  name={`keep-${g.hash}`}
                                  checked={keepIdx === i}
                                  onChange={() => setKeepMap((m) => ({ ...m, [g.hash]: i }))}
                                />
                                <RiFileCopyLine size={ICON.micro} className="opacity-50" />
                                <span className="truncate">{p}</span>
                                {keepIdx === i ? (
                                  <span className="shrink-0 text-3xs text-accent-color">{t("toolsLogs.care.keep")}</span>
                                ) : null}
                              </label>
                            ))}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-3xs text-text-quaternary">{t("toolsLogs.care.dupHint")}</p>
              </Section>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface-muted/40 px-3 py-2">
      <div className="text-3xs text-text-tertiary">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate text-sm font-semibold tabular-nums",
          tone === "ok" && "text-success",
          tone === "warn" && "text-warning",
          !tone && "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-3xs font-medium tracking-wide text-text-quaternary">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-[var(--radius-md)] border border-dashed border-border-subtle px-3 py-4 text-center text-3xs text-text-quaternary">
      {text}
    </p>
  );
}
