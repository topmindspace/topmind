/**
 * Shared connector UI primitives — keep weread / x / ingest hubs visually aligned.
 * Design System 2.0: text-lg hub titles, status pills, soft toast banners.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RiAlertLine, RiCheckboxCircleLine, RiLoader4Line } from "@remixicon/react";
import { cn } from "../lib/cn";
import { ICON } from "../lib/icons";

export function ConnectorStatusPill({
  ok,
  loading,
  okLabel,
  badLabel,
  /** When not ok: warning (default) or quiet muted (e.g. optional capability off) */
  badTone = "warning",
}: {
  ok: boolean;
  loading?: boolean;
  okLabel: string;
  badLabel: string;
  badTone?: "warning" | "muted";
}) {
  const { t } = useTranslation("common");
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted/60 px-1.5 py-0.5 text-3xs text-text-quaternary">
        <RiLoader4Line size={ICON.micro} className="animate-spin" aria-hidden /> {t("action.loading")}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs font-medium",
        ok
          ? "bg-status-success-bg text-success"
          : badTone === "muted"
            ? "bg-surface-muted text-text-quaternary"
            : "bg-status-warning-bg text-warning",
      )}
    >
      {ok ? (
        <RiCheckboxCircleLine size={ICON.micro} aria-hidden />
      ) : (
        <RiAlertLine size={ICON.micro} aria-hidden />
      )}
      {ok ? okLabel : badLabel}
    </span>
  );
}

export function ConnectorHubHeader({
  icon,
  title,
  subtitle,
  meta,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-5"
      data-connector-hub-header
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div
          className="v4-icon-chip-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] opacity-90"
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0">
          {/* Match PageHeader hierarchy: subtitle role, not display marketing */}
          <h1 className="truncate text-xl font-semibold tracking-tight text-text-primary">{title}</h1>
          <p className="mt-0.5 max-w-prose text-3xs leading-relaxed text-text-quaternary">{subtitle}</p>
          {meta ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-3xs text-text-quaternary">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5" data-connector-hub-actions>
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function ConnectorToastBanner({
  progress,
  result,
  children,
}: {
  progress?: string | null;
  /** Prefer string with ✓ / ✗ prefix for auto coloring; ReactNode for rich content */
  result?: ReactNode;
  children?: ReactNode;
}) {
  if (!progress && result == null && !children) return null;
  const resultText = typeof result === "string" ? result : null;
  return (
    <div
      className={cn(
        "mb-4 rounded-[var(--radius-lg)] border px-3.5 py-2.5 text-3xs",
        progress
          ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color"
          : resultText?.startsWith("✓")
            ? "border-success/20 bg-status-success-bg text-success"
            : resultText?.startsWith("✗")
              ? "border-error/20 bg-status-error-bg text-error"
              : "border-border-subtle bg-surface-muted/40 text-text-tertiary",
      )}
      role="status"
    >
      {progress ? (
        <span className="inline-flex items-center gap-1.5">
          <RiLoader4Line size={ICON.xs} className="animate-spin" aria-hidden /> {progress}
        </span>
      ) : (
        <div className="space-y-1.5">
          {result != null ? <div>{result}</div> : null}
          {children}
        </div>
      )}
    </div>
  );
}

/** Compact tool availability chip (anydoc / markitdown / pandoc / similar). */
export function ConnectorToolChip({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-3xs font-medium",
        ok ? "bg-status-success-bg text-success" : "bg-surface-muted text-text-tertiary",
      )}
    >
      {ok ? <RiCheckboxCircleLine size={ICON.micro} aria-hidden /> : <RiAlertLine size={ICON.micro} aria-hidden />}
      {label}
    </span>
  );
}

