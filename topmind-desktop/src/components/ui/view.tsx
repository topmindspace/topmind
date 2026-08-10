/**
 * Shared view primitives — page scaffolding for workspace views.
 *
 * Token contract (see tokens.css) — Design System 2.0 / long-read:
 *   text-5xs 10px  — kbd glyphs only
 *   text-3xs 12px  — MetaText, empty hints, status (UI floor)
 *   text-2xs 12px  — caption
 *   text-xs  12.5px — form controls
 *   text-sm  13px  — UI body, list primary
 *   text-base 14px — page section titles / dense body
 *   text-lg  15px  — list page titles
 *   text-3xl 22px  — rare display moments
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";

/** Centered content column with density rhythm. */
export function ViewContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[var(--content-max-width-dashboard,880px)]",
        "px-[var(--density-page-x,28px)] py-[var(--density-page-y,24px)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page header: accent icon + title, optional subtitle + actions. */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-3.5 sm:mb-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span className="v4-icon-chip-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] opacity-90">
              {icon}
            </span>
          ) : null}
          {/* Page titles: one step above list body (subtitle role) for hierarchy */}
          <h1 className="truncate text-xl font-semibold tracking-tight text-text-primary">{title}</h1>
        </div>
        {actions ? (
          <div className="flex min-w-0 max-w-[min(58%,24rem)] shrink items-center justify-end gap-1.5 sm:max-w-[28rem]">
            {actions}
          </div>
        ) : null}
      </div>
      {subtitle ? (
        <p className={cn("mt-0.5 max-w-prose text-3xs leading-relaxed text-text-quaternary", icon && "pl-9")}>
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

/** Section label with optional count + trailing actions. */
export function SectionHeader({
  icon,
  label,
  count,
  actions,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: number;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-1.5 flex items-center justify-between gap-2", className)}>
      <h2 className="flex items-center gap-1.5 text-3xs font-medium tracking-wide text-text-tertiary">
        {icon ? <span className="opacity-70">{icon}</span> : null}
        <span>{label}</span>
        {typeof count === "number" ? (
          <span className="rounded-full bg-surface-muted px-1.5 py-px text-3xs tabular-nums text-text-quaternary">
            {count}
          </span>
        ) : null}
      </h2>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/**
 * Empty state — calm soft panel (not marketing dashed box / loud gradient).
 * Contract: icon chip + title + optional hint + **one primary action** (+ optional secondary).
 * compact: sidebar / dense rails
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  /** Prefer a single primary Button; wrap multiple only when secondary is clearly subordinate */
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center border border-border-subtle-dim bg-surface/70 text-center",
        "shadow-[var(--shadow-card)]",
        compact
          ? "rounded-[var(--radius-lg)] px-3 py-5"
          : "rounded-[var(--radius-xl)] px-5 py-8",
        className,
      )}
      role="status"
    >
      {icon ? (
        <div
          className={cn(
            "v4-icon-chip mb-2 flex items-center justify-center rounded-full text-text-quaternary",
            compact ? "h-8 w-8" : "mb-2.5 h-9 w-9",
          )}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div
        className={cn(
          "font-medium tracking-tight text-text-secondary",
          compact ? "text-3xs" : "text-sm",
        )}
      >
        {title}
      </div>
      {hint ? (
        <div
          className={cn(
            "mt-1 leading-relaxed text-text-quaternary",
            compact ? "max-w-[14rem] text-3xs" : "max-w-xs text-3xs",
          )}
        >
          {hint}
        </div>
      ) : null}
      {action ? (
        <div className={cn("flex flex-wrap justify-center gap-2", compact ? "mt-2.5" : "mt-3.5")}>
          {action}
        </div>
      ) : null}
    </div>
  );
}

/** Compact filter / mode chip — chip-weight only (never solid button height/fill). */
export function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  label: ReactNode;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={Boolean(active)}
      data-filter-chip
      data-filter-chip-active={active ? "true" : undefined}
      className={cn(
        "inline-flex h-[var(--control-h-chip)] max-w-full items-center rounded-full px-2.5 text-3xs font-medium leading-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
        active
          ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
          : "bg-surface-muted/35 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {typeof count === "number" ? (
        <span className="ml-1 shrink-0 tabular-nums opacity-70" aria-hidden>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Shared loading state. */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation("common");
  const displayLabel = label ?? t("action.loading");
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-text-tertiary",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 size={ICON.sm} className="animate-spin text-accent-color/75" />
      <span>{displayLabel}</span>
    </div>
  );
}

/** Shared error state with optional retry. */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation("common");
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-[var(--radius-lg)] border border-error/20 bg-status-error-bg px-4 py-3 text-sm text-error",
        className,
      )}
      role="alert"
    >
      <AlertCircle size={ICON.sm} className="shrink-0" />
      <span className="min-w-0 flex-1 text-3xs leading-relaxed">{t("action.loadFailed", { message })}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-1 text-3xs font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary"
        >
          {t("action.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** Inline metadata (relative time · size). */
export function MetaText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-mono text-3xs tabular-nums text-text-tertiary", className)}>
      {children}
    </span>
  );
}

/** Canonical className for selectable list rows — fill highlight, no wireframe borders. */
export function listRowClass(active?: boolean, className?: string) {
  return cn(
    "v4-list-virtual flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-transparent px-2.5 py-1.5 text-sm",
    "transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
    active
      ? "bg-accent-bg-subtle shadow-[inset_3px_0_0_0_var(--color-accent-color)]"
      : "hover:bg-surface-muted/70",
    className,
  );
}

/** Vertical list wrapper. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  // No stagger-children here — long lists stay scroll-smooth without entrance cascade
  return <ul className={cn("m-0 list-none space-y-0.5 p-0", className)}>{children}</ul>;
}

/** Unified file/topic list row. */
export function FileRow({
  icon,
  label,
  secondary,
  meta,
  active,
  onClick,
  onContextMenu,
  actions,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <li
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={listRowClass(
        active,
        cn(
          "v4-row-focus group/row v4-list-virtual",
          onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          className,
        ),
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? <span className="shrink-0 text-text-tertiary opacity-80">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          {/* Content titles: regular weight reads calmer in long lists */}
          <div className="truncate text-sm font-normal leading-snug text-text-primary">{label}</div>
          {secondary ? (
            <div className="mt-px truncate font-mono text-3xs text-text-quaternary">{secondary}</div>
          ) : null}
        </div>
      </div>
      {meta ? <div className="flex shrink-0 items-center gap-1.5 opacity-90">{meta}</div> : null}
      {actions ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover/row:opacity-100">
          {actions}
        </div>
      ) : null}
    </li>
  );
}
