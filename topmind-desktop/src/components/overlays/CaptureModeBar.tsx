/**
 * Capture mode segmented control — Chip language (DS 4.0.5).
 */
import { useTranslation } from "react-i18next";
import { Chip } from "../ui/Chip";
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
          <Chip
            key={id}
            tone={active ? "accent" : "neutral"}
            active={active}
            size="md"
            role="tab"
            aria-selected={active}
            /* Tabs announce selection via aria-selected, not aria-pressed. */
            aria-pressed={undefined}
            data-filter-chip
            data-filter-chip-active={active ? "true" : undefined}
            onClick={() => onChange(id)}
          >
            {t(labelKey)}
          </Chip>
        );
      })}
      <span className="ml-1 max-w-[12rem] truncate text-3xs text-text-quaternary" title={shown}>
        {shown}
      </span>
    </div>
  );
}
