/**
 * Shared connector UI primitives — keep weread / x / ingest hubs visually aligned.
 * Design System 2.0: text-lg hub titles, status pills, soft toast banners.
 */
import type { ReactNode } from "react";
import { ConfirmDialog } from "../components/ui/Dialog";
import { listRowClass } from "../components/ui/view";
import { useTranslation } from "react-i18next";
import { RiAlertLine, RiCheckboxCircleLine, RiCloseLine, RiLoader4Line } from "@remixicon/react";
import { cn } from "../lib/kit";
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


/** ConfirmLeaveDialog — one leave/unsaved confirm (replaces window.confirm). */
export function ConfirmLeaveDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText={cancelText}
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** ChipToggleGroup — single-select chips (direction / dest / category). */
export function ChipToggleGroup<T extends string>({
  items,
  value,
  onChange,
  tone,
}: {
  items: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  tone?: (id: T, active: boolean) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-chip-toggle-group>
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-3xs v4-focus-ring",
              tone
                ? tone(item.id, active)
                : active
                  ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color"
                  : "border-border-subtle-dim text-text-tertiary hover:bg-state-hover",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Overlay mini-app header (plugin-app sheet) — compact DS 4.2 chrome.
 * Same icon-chip + title/subtitle hierarchy as ConnectorHubHeader, plus close.
 * Used by ledger / wechat (and future mini-apps) so shells stay identical.
 */
export function PluginAppHeader({
  icon,
  title,
  subtitle,
  meta,
  tools,
  onClose,
  closeLabel,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  meta?: ReactNode;
  tools?: ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b border-border-subtle-dim px-4 py-2.5"
      data-plugin-app-header
    >
      <span className="v4-icon-chip-accent flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-tight text-text-primary">{title}</div>
        <div className="truncate text-3xs text-text-quaternary">{subtitle}</div>
      </div>
      {tools ? <div className="flex shrink-0 items-center gap-1">{tools}</div> : null}
      {meta ? <div className="hidden max-w-[12rem] shrink-0 truncate text-3xs text-text-quaternary sm:block">{meta}</div> : null}
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="v4-focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-state-hover hover:text-text-primary"
      >
        <RiCloseLine size={ICON.xs} aria-hidden />
      </button>
    </header>
  );
}

/**
 * Unified mode / step chip tabs — one pressed style across mini-apps.
 * Chip-weight only (FilterChip language), never a second solid CTA.
 */
export function AppModeTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: Array<{ id: T; label: string; icon?: ReactNode; disabled?: boolean; done?: boolean }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={ariaLabel} data-app-mode-tabs>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          disabled={item.disabled}
          aria-selected={value === item.id}
          aria-current={value === item.id ? "page" : undefined}
          onClick={() => !item.disabled && onChange(item.id)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2.5 text-3xs font-medium transition-colors v4-focus-ring",
            value === item.id
              ? "bg-accent-container text-on-accent-container"
              : item.disabled
                ? "text-text-quaternary"
                : "text-text-tertiary hover:bg-state-hover hover:text-text-secondary",
          )}
        >
          {item.icon}
          {item.label}
          {item.done ? <RiCheckboxCircleLine size={ICON.micro} className="text-success" aria-hidden /> : null}
        </button>
      ))}
    </div>
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

/**
 * AppSlot — unified content card slot (one claim per card).
 * Modern sheet language: elevated surface, hairline, radius-card. No nested cards.
 */
export function AppSlot({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
  titleIcon,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  titleIcon?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border border-border-subtle-dim bg-surface-elevated px-3.5 py-3",
        className,
      )}
      data-app-slot
    >
      {title || actions ? (
        <header className="mb-2 flex items-center gap-2">
          {titleIcon ? <span className="text-accent-color">{titleIcon}</span> : null}
          {title ? (
            <h3 className="min-w-0 flex-1 truncate text-3xs font-semibold tracking-tight text-text-secondary">{title}</h3>
          ) : (
            <span className="flex-1" />
          )}
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      {hint ? <p className="mb-2 text-3xs leading-relaxed text-text-quaternary">{hint}</p> : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** StatSlot — large number + label (balance / AI score / density). */
export function StatSlot({
  label,
  value,
  unit,
  tone = "default",
  extra,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "default" | "success" | "warning" | "error" | "accent";
  extra?: ReactNode;
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "error"
          ? "text-error"
          : tone === "accent"
            ? "text-on-accent-container"
            : "text-text-primary";
  return (
    <div
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1",
        tone === "accent" ? "bg-accent-container" : "bg-surface-muted/40",
      )}
      data-stat-slot
    >
      <span className="text-3xs text-text-quaternary">{label}</span>
      <span className={cn("font-mono text-base font-semibold tabular-nums", toneCls)}>{value}</span>
      {unit ? <span className="text-3xs text-text-quaternary">{unit}</span> : null}
      {extra}
    </div>
  );
}

/** ListRow — selectable row over listRowClass (one list language). */
export function ListRow({
  active,
  leading,
  title,
  meta,
  actions,
  onClick,
  className,
  disabled,
}: {
  active?: boolean;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (!onClick || disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(listRowClass(active), "min-w-0", className)}
      data-list-row
    >
      {leading ? <span className="shrink-0 text-text-quaternary">{leading}</span> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-3xs font-medium text-text-primary">{title}</div>
        {meta ? <div className="mt-0.5 flex flex-wrap gap-2 text-3xs text-text-quaternary">{meta}</div> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/** AppCheckbox — shared checkbox row (X select-all / multi-pick). */
export function AppCheckbox({
  checked,
  onChange,
  label,
  indeterminate,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  indeterminate?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-3xs text-text-secondary" data-app-checkbox>
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate && !checked);
        }}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      {label != null ? <span>{label}</span> : null}
    </label>
  );
}
