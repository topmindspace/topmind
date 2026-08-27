/**
 * Capture mode segmented control — FilterChip language (Design System 2.0).
 */
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import type { CaptureMode } from "./quick-capture-helpers";

const MODE_KEYS: { id: CaptureMode; labelKey: string }[] = [
  { id: "auto", labelKey: "overlays:capture.modeAuto" },
  { id: "note", labelKey: "overlays:capture.modeNote" },
  { id: "docs", labelKey: "overlays:capture.modeDocs" },
];

export function CaptureModeBar({
  mode,
  onChange,
  hint,
}: {
  mode: CaptureMode;
  onChange: (mode: CaptureMode) => void;
  /** Override footer hint; defaults to mode hint */
  hint?: string;
}) {
  const { t } = useTranslation();
  const shown = hint ?? "";
  return (
    <div
      className="mb-2.5 flex flex-wrap items-center gap-1"
      role="tablist"
      aria-label={t("overlays:capture.modeAriaLabel")}
      data-capture-mode-bar
    >
      {MODE_KEYS.map(({ id, labelKey }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            data-filter-chip
            data-filter-chip-active={active ? "true" : undefined}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex h-[var(--control-h-chip)] items-center rounded-full px-2.5 text-3xs font-medium leading-none transition-colors",
              "v4-focus-ring",
              active
                ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                : "bg-surface-muted/35 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
            )}
          >
            {t(labelKey)}
          </button>
        );
      })}
      <span className="ml-1 max-w-[12rem] truncate text-3xs text-text-quaternary" title={shown}>
        {shown}
      </span>
    </div>
  );
}
