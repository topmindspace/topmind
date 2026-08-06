/**
 * Landing / workspace picker — shown on first launch, after close workspace,
 * or when launchStatus.ok === false.
 */
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen, Plus, Loader2, AlertCircle, ArrowRight,
  Clock, Layers, Zap, Radio, X, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { api } from "../../services/api";
import { Button } from "../ui/Button";
import { Tooltip, TooltipProvider } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import type { AppSettings, RecentWorkspace } from "../../types";
import { cn } from "../../lib/cn";
import { dedupeRecentWorkspaces } from "../../lib/workspace-recent";

type RecentHealth = {
  kind: string;
  suitable: boolean;
  message?: string;
};

interface Props {
  settings: AppSettings;
  recent: RecentWorkspace[];
  onWorkspaceSwitched: () => void;
  /** Optional reason from launchStatus for status line */
  launchReason?: string | null;
  launchError?: string | null;
}

function shortName(p: string) {
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function formatOpened(iso: string | undefined, locale: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function OnboardingScreen({
  settings,
  recent: recentProp,
  onWorkspaceSwitched,
  launchReason,
  launchError,
}: Props) {
  const { t, i18n } = useTranslation(["common", "shell"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(launchError || null);
  const [recent, setRecent] = useState<RecentWorkspace[]>(() =>
    dedupeRecentWorkspaces(recentProp) as RecentWorkspace[],
  );
  const [healthByPath, setHealthByPath] = useState<Record<string, RecentHealth>>({});

  // Server-side dedupe + prune forbidden/missing; then classify for badges
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const refreshed = await api.sys.refreshWorkspaceHistory();
        if (cancelled) return;
        const list = dedupeRecentWorkspaces(refreshed.recent || []) as RecentWorkspace[];
        setRecent(list);
        const next: Record<string, RecentHealth> = {};
        await Promise.all(
          list.map(async (w) => {
            try {
              const c = await api.sys.classifyWorkspace(w.rootPath);
              next[w.rootPath] = {
                kind: String(c.kind || c.status || "unknown"),
                suitable: c.suitable !== false && c.ok !== false,
                message: c.message,
              };
            } catch {
              next[w.rootPath] = { kind: "unknown", suitable: true };
            }
          }),
        );
        if (!cancelled) setHealthByPath(next);
      } catch {
        // Offline classify — still show deduped prop list
        if (!cancelled) setRecent(dedupeRecentWorkspaces(recentProp) as RecentWorkspace[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recentProp]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return t("common:greeting.lateNight");
    if (h < 12) return t("common:greeting.morning");
    if (h < 18) return t("common:greeting.afternoon");
    return t("common:greeting.evening");
  }, [t]);

  const statusHint = useMemo(() => {
    if (launchReason === "closed") return t("shell:onboarding.statusClosed");
    if (launchReason === "invalid-workspace") return t("shell:onboarding.statusInvalid");
    if (launchReason === "no-workspace") return t("shell:onboarding.statusNoWorkspace");
    return null;
  }, [launchReason, t]);

  const handleSwitch = async (rootPath: string) => {
    setBusy(rootPath);
    setError(null);
    try {
      await api.sys.switchWorkspace(rootPath, { createIfMissing: false });
      // Keep busy=true — parent shows full-screen loading until reload
      onWorkspaceSwitched();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Dead path already pruned in main — drop from local list
      setRecent((prev) => prev.filter((w) => w.rootPath !== rootPath));
      setBusy(null);
    }
  };

  const handleRemoveRecent = async (rootPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setBusy(`rm:${rootPath}`);
    setError(null);
    try {
      const res = await api.sys.removeRecentWorkspace(rootPath);
      setRecent(res.settings?.workspaces?.recent ?? recent.filter((w) => w.rootPath !== rootPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handlePickFolder = async () => {
    setBusy("picking");
    setError(null);
    try {
      const { path } = await api.sys.pickWorkspaceFolder();
      if (!path) {
        setBusy(null);
        return;
      }
      setBusy("opening");
      await api.sys.openOrCreateWorkspace(path);
      onWorkspaceSwitched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  // Full-screen wait after successful open (reload in flight)
  if (busy && busy !== "picking" && !busy.startsWith("rm:")) {
    return (
      <TooltipProvider>
        <div className="v4-boot v4-drag flex h-screen flex-col items-center justify-center gap-3 p-6">
          <div className="v4-brand-mark flex h-14 w-14 items-center justify-center overflow-hidden rounded-[var(--radius-2xl)] bg-surface-elevated shadow-[var(--shadow-md)] ring-1 ring-border-subtle-dim">
            <img
              src="./favicon.svg"
              alt=""
              width={56}
              height={56}
              className="h-full w-full object-cover"
              draggable={false}
              onError={(e) => {
                const el = e.currentTarget;
                if (el.dataset.fb === "1") return;
                el.dataset.fb = "1";
                el.src = "./icon-256.png";
              }}
            />
          </div>
          <Loader2 size={ICON.sm} className="animate-spin text-accent-color" aria-hidden />
          <div className="text-sm font-medium text-text-primary">{t("shell:onboarding.openingWorkspace")}</div>
          <div className="max-w-sm truncate text-center text-3xs text-text-quaternary font-mono">
            {busy === "opening" ? t("shell:onboarding.initFolder") : busy}
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="v4-landing v4-drag flex h-screen flex-col items-center justify-center p-6">
        <div className="v4-no-drag w-full max-w-[420px]">
          {/* Brand — logo-aligned mark; gradient reserved for brand title moment */}
          <div className="mb-8 text-center">
            <div className="v4-brand-mark mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-[var(--radius-2xl)] bg-surface-elevated shadow-[var(--shadow-md)] ring-1 ring-border-subtle-dim">
              <img
                src="./favicon.svg"
                alt="topmind"
                width={56}
                height={56}
                className="h-full w-full object-cover"
                draggable={false}
                onError={(e) => {
                  // Electron file:// / pack: try png fallbacks
                  const el = e.currentTarget;
                  if (el.dataset.fb === "1") return;
                  el.dataset.fb = "1";
                  el.src = "./icon-256.png";
                }}
              />
            </div>
            <p className="mb-1 text-3xs font-medium uppercase tracking-wider text-text-quaternary">
              {greeting}
            </p>
            <h1 className="v4-brand-gradient-text text-[var(--type-size-display)] font-semibold tracking-tight">
              topmind
            </h1>
            <p className="mt-2 text-3xs leading-relaxed text-text-tertiary">
              {t("common:app.tagline")}
            </p>
            {statusHint ? (
              <p className="mt-2 text-3xs text-text-quaternary">{statusHint}</p>
            ) : null}
          </div>

          {/* Workflow chips — quiet education only; not CTAs */}
          <div className="mb-6 flex flex-wrap items-center justify-center gap-1.5" data-landing-workflow>
            {(
              [
                { icon: Zap, label: t("shell:onboarding.workflowCapture"), tip: t("shell:onboarding.workflowCaptureTip") },
                { icon: Radio, label: t("shell:onboarding.workflowOrganize"), tip: t("shell:onboarding.workflowOrganizeTip") },
                { icon: Layers, label: t("shell:onboarding.workflowDeliver"), tip: t("shell:onboarding.workflowDeliverTip") },
                { icon: Clock, label: t("shell:onboarding.workflowRetrieve"), tip: t("shell:onboarding.workflowRetrieveTip") },
              ] as const
            ).map(({ icon: Icon, label, tip }) => (
              <Tooltip key={label} content={tip}>
                <span className="inline-flex cursor-help items-center gap-1 rounded-full bg-surface-muted/55 px-2.5 py-1 text-3xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-tertiary">
                  <Icon size={ICON.xs} className="opacity-70 text-accent-color" aria-hidden />
                  {label}
                </span>
              </Tooltip>
            ))}
          </div>

          {error ? (
            <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-lg)] border border-error/30 bg-status-error-bg px-3 py-2.5 text-3xs text-error" role="alert">
              <AlertCircle size={ICON.sm} className="shrink-0" aria-hidden />
              <span className="flex-1">{error}</span>
            </div>
          ) : null}

          {/* Recent */}
          {recent.length > 0 ? (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 px-0.5 text-3xs font-semibold tracking-wide text-text-quaternary">
                <Clock size={ICON.xs} aria-hidden />
                {t("shell:onboarding.recentWorkspaces")}
              </div>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {recent.slice(0, 6).map((w) => {
                  const active = busy === w.rootPath;
                  const health = healthByPath[w.rootPath];
                  const broken = health && health.suitable === false;
                  return (
                    <li key={w.rootPath}>
                      <Tooltip content={health?.message || w.rootPath} side="right">
                        <button
                          type="button"
                          disabled={!!busy || broken}
                          onClick={() => void handleSwitch(w.rootPath)}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle-dim bg-surface-elevated px-3.5 py-3.5 text-left shadow-[var(--shadow-card)]",
                            "transition-[border-color,box-shadow,transform,background-color] duration-[var(--duration-fast)]",
                            "hover:border-border-subtle hover:shadow-[var(--shadow-sm)] hover:-translate-y-px",
                            "disabled:opacity-60",
                            active && "border-accent-border-subtle bg-accent-bg-subtle/40",
                            broken && "border-error/25 bg-status-error-bg/30",
                          )}
                          data-landing-recent
                        >
                          <span className="v4-icon-chip v4-icon-chip-accent flex h-9 w-9 shrink-0">
                            <FolderOpen size={ICON.sm} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-text-primary">
                                {shortName(w.rootPath)}
                              </span>
                              {health?.kind === "healthy" ? (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-px text-3xs font-medium text-success">
                                  <CheckCircle2 size={ICON.micro} aria-hidden />
                                  {t("shell:onboarding.healthOk")}
                                </span>
                              ) : null}
                              {health?.kind === "empty" ? (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-muted px-1.5 py-px text-3xs text-text-quaternary">
                                  {t("shell:onboarding.healthEmpty")}
                                </span>
                              ) : null}
                              {broken ? (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-error/10 px-1.5 py-px text-3xs font-medium text-error">
                                  <AlertTriangle size={ICON.micro} aria-hidden />
                                  {t("shell:onboarding.healthBroken")}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-3xs text-text-quaternary">
                              {w.rootPath}
                            </div>
                            {w.lastOpenedAt ? (
                              <div className="mt-0.5 text-3xs text-text-quaternary">
                                {t("common:time.lastOpened", { time: formatOpened(w.lastOpenedAt, i18n.language) })}
                              </div>
                            ) : null}
                          </div>
                          {active ? (
                            <Loader2 size={ICON.sm} className="shrink-0 animate-spin text-accent-color" aria-label={t("shell:shell.opening")} />
                          ) : (
                            <>
                              <Tooltip content={t("shell:onboarding.removeFromList")}>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label={t("shell:onboarding.removeLabel", { name: shortName(w.rootPath) })}
                                  className="rounded p-1 text-text-quaternary opacity-0 transition-opacity hover:bg-surface-muted hover:text-error group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                                  onClick={(ev) => void handleRemoveRecent(w.rootPath, ev)}
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter" || ev.key === " ") {
                                      void handleRemoveRecent(w.rootPath, ev as unknown as React.MouseEvent);
                                    }
                                  }}
                                >
                                  <X size={ICON.xs} />
                                </span>
                              </Tooltip>
                              <ArrowRight
                                size={ICON.sm}
                                className="shrink-0 text-text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-accent-color"
                              />
                            </>
                          )}
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="mb-4 rounded-[var(--radius-xl)] border border-dashed border-border-subtle bg-surface/50 px-4 py-6 text-center">
              <p className="text-sm text-text-tertiary">{t("shell:onboarding.noWorkspaceTitle")}</p>
              <p className="mt-1 text-3xs text-text-quaternary">{t("shell:onboarding.noWorkspaceHint")}</p>
            </div>
          )}

          {/* Sole solid CTA on landing */}
          <div className="flex flex-col gap-2" data-landing-primary>
            <Tooltip content={t("shell:onboarding.selectFolderTip")}>
              <Button
                onClick={() => void handlePickFolder()}
                disabled={!!busy}
                className="h-10 w-full justify-center rounded-[var(--radius-xl)] text-sm"
                data-landing-primary-cta
              >
                {busy === "picking" ? (
                  <Loader2 size={ICON.sm} className="animate-spin" aria-hidden />
                ) : (
                  <Plus size={ICON.sm} aria-hidden />
                )}
                {t("shell:onboarding.selectFolder")}
              </Button>
            </Tooltip>
          </div>

          <p className="mt-8 text-center text-3xs leading-relaxed text-text-quaternary">
            {t("shell:onboarding.footerLine1")}
            <br />
            {t("shell:onboarding.footerLine2")}
            <br />
            {t("shell:onboarding.footerLine3")}
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
