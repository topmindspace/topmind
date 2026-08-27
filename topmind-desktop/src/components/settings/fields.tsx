import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Info } from "lucide-react";
import { api } from "../../services/api";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";

/**
 * Settings form primitives — dense workbench density.
 *
 * - `description`: short visible helper (preferred for everyday guidance)
 * - `hint` / `help`: deeper detail behind HelpTip (edge cases, security, long docs)
 */

/** Compact help trigger — for long/rare docs only. */
export function HelpTip({
  content,
  side = "top",
}: {
  content: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const { t } = useTranslation("common");
  return (
    <Tooltip content={content} side={side}>
      <span
        className="inline-flex shrink-0 cursor-help rounded-full p-0.5 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-tertiary v4-focus-ring"
        tabIndex={0}
        aria-label={t("common:action.help", { defaultValue: "Help" })}
      >
        <Info size={ICON.nano} aria-hidden />
      </span>
    </Tooltip>
  );
}

export function Field({
  label,
  /** Visible one-line guidance under the control (or next to label when dense). */
  description,
  /** Deep help in tooltip only. */
  hint,
  children,
  className,
  compact,
}: {
  label: string;
  description?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  /** Tighter vertical rhythm for grid cells */
  compact?: boolean;
}) {
  return (
    <div className={cn(compact ? "mb-0" : "mb-2.5 last:mb-0", className)}>
      <div className="mb-1 flex items-center gap-1">
        <label className="block text-3xs font-medium tracking-tight text-text-secondary">
          {label}
        </label>
        {hint ? <HelpTip content={hint} /> : null}
      </div>
      {children}
      {description ? (
        <p className="mt-1 text-3xs leading-snug text-text-tertiary">{description}</p>
      ) : null}
    </div>
  );
}

/** Visual group — dense card; optional visible description + deep help tip. */
export function SettingsSection({
  title,
  description,
  help,
  action,
  children,
  className,
}: {
  title: string;
  /** Short visible line under title (everyday guidance). */
  description?: string;
  /** Longer / rare docs as tooltip only. */
  help?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "mb-2.5 rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-3 py-2.5 last:mb-0",
        "shadow-[var(--shadow-card)]",
        className,
      )}
      data-settings-section
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h4 className="text-3xs font-semibold tracking-tight text-text-primary">
              {title}
            </h4>
            {help ? <HelpTip content={help} /> : null}
          </div>
          {description ? (
            <p className="mt-0.5 text-3xs leading-snug text-text-tertiary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="space-y-0">{children}</div>
    </section>
  );
}

/** Boolean preference: label + optional visible description; tip only for deep help. */
export function SwitchField({
  label,
  description,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: string;
  /** Visible secondary line under label. */
  description?: string;
  /** Deep help tooltip. */
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-1.5 flex items-center justify-between gap-3 py-1 last:mb-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-3xs font-medium tracking-tight text-text-secondary">
            {label}
          </span>
          {hint ? <HelpTip content={hint} /> : null}
        </div>
        {description ? (
          <p className="mt-0.5 text-3xs leading-snug text-text-quaternary">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "v4-switch shrink-0",
          disabled && "opacity-50",
          "v4-focus-ring focus-visible:ring-offset-1",
        )}
        data-checked={checked}
      />
    </div>
  );
}

export function KeyField({
  label,
  helpUrl,
  description,
  hint,
  children,
  configured,
  onClear,
}: {
  label: string;
  helpUrl?: string;
  description?: string;
  hint?: string;
  children: ReactNode;
  configured?: boolean;
  onClear?: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <label className="text-3xs font-medium tracking-tight text-text-secondary">
            {label}
          </label>
          {configured ? (
            <span className="rounded-full bg-status-success-bg px-1.5 py-0.5 text-3xs font-medium text-success">
              {t("action.configured")}
            </span>
          ) : null}
          {hint ? <HelpTip content={hint} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {configured && onClear ? (
            <Tooltip content={t("action.clearKey")}>
              <button
                type="button"
                onClick={onClear}
                className="rounded px-1.5 py-0.5 text-3xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-error v4-focus-ring"
              >
                {t("action.clearKey")}
              </button>
            </Tooltip>
          ) : null}
          {helpUrl ? (
            <Tooltip content={t("action.getKey")}>
              <button
                type="button"
                onClick={() => void api.sys.openUrl(helpUrl)}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-3xs font-medium text-accent-color transition-colors hover:bg-accent-bg-subtle v4-focus-ring"
              >
                {t("action.getKey")} <ExternalLink size={ICON.nano} aria-hidden />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {children}
      {description ? (
        <p className="mt-1 text-3xs leading-snug text-text-quaternary">{description}</p>
      ) : null}
    </div>
  );
}

/** Subtle status pill for section headers. */
export function StatusDot({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-3xs font-medium",
        ok ? "bg-status-success-bg text-success" : "bg-status-warning-bg text-warning",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-warning")} aria-hidden />
      {label}
    </span>
  );
}
