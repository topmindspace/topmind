import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RiExternalLinkLine, RiInformationLine } from "@remixicon/react";
import { api } from "../../services/api";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/kit";

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
        className="inline-flex shrink-0 cursor-help rounded-full p-0.5 text-text-quaternary transition-colors hover:bg-state-hover hover:text-text-tertiary v4-focus-ring"
        tabIndex={0}
        aria-label={t("common:action.help", { defaultValue: "Help" })}
      >
        <RiInformationLine size={ICON.micro} aria-hidden />
      </span>
    </Tooltip>
  );
}

/**
 * Settings form row (Cue register): label + description on the left,
 * control on the right. Full-width row inside a SettingsSection card.
 * Narrow rows wrap the control under the copy so nothing overflows.
 */
export function Field({
  label,
  /** Visible one-line guidance under the label. */
  description,
  /** Deep help in tooltip only. */
  hint,
  children,
  className,
  compact,
  /** Drop the card gutter — parent already supplies px-4 (grid cells). */
  flush,
}: {
  label: string;
  description?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  /** Tighter vertical rhythm for grid cells */
  compact?: boolean;
  flush?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2",
        !flush && "px-4 py-3",
        !compact && "border-b border-border-subtle-dim last:border-b-0",
        className,
      )}
      data-settings-row
    >
      <div className="min-w-0 flex-1 basis-[11rem]">
        <div className="flex items-center gap-1">
          <label className="block text-base font-medium tracking-tight text-text-primary">
            {label}
          </label>
          {hint ? <HelpTip content={hint} /> : null}
        </div>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{description}</p>
        ) : null}
      </div>
      {/* Control column: stretch to the shared right rail so inputs align end-to-end. */}
      <div className="flex w-full min-w-0 shrink-0 items-center gap-1.5 sm:w-auto sm:min-w-[12rem] sm:max-w-[24rem] sm:flex-1 sm:justify-end">
        {children}
      </div>
    </div>
  );
}

/**
 * SettingsGroup — Cue section register: large section title **outside** the
 * card, rows share one soft card with hairline dividers.
 */
export function SettingsSection({
  title,
  description,
  help,
  action,
  children,
  className,
}: {
  title: string;
  /** Short visible line under section title (outside the card). */
  description?: string;
  /** Longer / rare docs as tooltip only. */
  help?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-7 last:mb-0", className)} data-settings-section>
      <div className="mb-2 flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h3 className="text-base font-semibold tracking-tight text-text-secondary">
              {title}
            </h3>
            {help ? <HelpTip content={help} /> : null}
          </div>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-[var(--radius-card)] bg-surface",
          "shadow-[var(--shadow-card)]",
        )}
        data-settings-card
      >
        {children}
      </div>
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
  flush,
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
  flush?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        !flush && "px-4 py-3",
        "border-b border-border-subtle-dim last:border-b-0",
        className,
      )}
      data-settings-row
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-base font-medium tracking-tight text-text-primary">
            {label}
          </span>
          {hint ? <HelpTip content={hint} /> : null}
        </div>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{description}</p>
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
    <div className="mb-2 px-4 pt-3 last:mb-0 last:pb-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <label className="text-xs font-medium tracking-tight text-text-secondary">
            {label}
          </label>
          {configured ? (
            <span className="rounded-[var(--radius-xs)] bg-status-success-bg px-1.5 py-0.5 text-3xs font-medium text-success">
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
                className="rounded px-1.5 py-0.5 text-xs text-text-quaternary transition-colors hover:bg-state-hover hover:text-error v4-focus-ring"
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
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-accent-color transition-colors hover:bg-state-hover v4-focus-ring"
              >
                {t("action.getKey")} <RiExternalLinkLine size={ICON.micro} aria-hidden />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {children}
      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{description}</p>
      ) : null}
    </div>
  );
}

/** Subtle status pill for section headers. Delegates to ui/StatusDot tone axis. */
export { StatusDot } from "../ui/StatusDot";
