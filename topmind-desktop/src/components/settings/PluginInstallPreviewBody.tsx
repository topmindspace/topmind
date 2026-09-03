/**
 * Shared install-preview body for third-party plugins (permissions + risk).
 */
import { RiAlertLine, RiShieldCheckLine, RiShieldFlashLine, RiShieldLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import type { PluginInstallPreview } from "../../services/api";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";

const RISK_ICONS = {
  low: { Icon: RiShieldCheckLine, key: "settings:plugins.riskLow", className: "text-success bg-success/10" },
  medium: { Icon: RiShieldLine, key: "settings:plugins.riskMedium", className: "text-warning bg-warning/10" },
  high: { Icon: RiShieldFlashLine, key: "settings:plugins.riskHigh", className: "text-error bg-error/10" },
} as const;

export function PluginInstallPreviewBody({
  preview,
  sourceKind,
}: {
  preview: PluginInstallPreview;
  sourceKind: "folder" | "zip";
}) {
  const { t } = useTranslation();
  const risk = RISK_ICONS[preview.risk] || RISK_ICONS.medium;
  const RiskIcon = risk.Icon;
  const m = preview.manifest;

  return (
    <div className="space-y-2.5 text-3xs">
      <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-text-primary">{m.name}</span>
          <span className="font-mono text-3xs text-text-quaternary">{m.id}</span>
          <span className="tabular-nums text-text-quaternary">v{m.version}</span>
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-3xs", risk.className)}>
            <RiskIcon size={ICON.micro} />
            {t(risk.key)}
          </span>
        </div>
        {m.description ? (
          <p className="mt-1 text-3xs leading-relaxed text-text-tertiary">{m.description}</p>
        ) : null}
        <p className="mt-1 text-3xs text-text-quaternary">
          {t("settings:plugins.sourceLabel")} · {sourceKind === "zip" ? t("settings:plugins.sourceZip") : t("settings:plugins.sourceFolder")}
          {m.author ? ` · ${m.author}` : ""}
        </p>
      </div>

      {preview.replaces ? (
        <div className="flex items-start gap-1.5 rounded-[var(--radius-md)] border border-warning/30 bg-warning/5 px-2 py-1.5 text-3xs text-warning">
          <RiAlertLine size={ICON.xs} className="mt-0.5 shrink-0" />
          <span>
            {t("settings:plugins.replacesWarning", {
              version: preview.existingVersion
                ? t("settings:plugins.replacesVersion", { version: preview.existingVersion })
                : "",
            })}
          </span>
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-3xs font-medium text-text-secondary">{t("settings:plugins.permissionsLabel")}</div>
        <div className="flex flex-wrap gap-1">
          {(preview.permissions || []).map((p) => (
            <span
              key={p}
              className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-3xs text-text-tertiary"
            >
              {p}
            </span>
          ))}
        </div>
        {preview.slots?.length ? (
          <div className="mt-1.5 text-3xs text-text-quaternary">
            {t("settings:plugins.slotsLabel")} · {preview.slots.join(" · ")}
          </div>
        ) : null}
      </div>

      {preview.riskReasons?.length ? (
        <ul className="m-0 list-disc space-y-0.5 pl-4 text-3xs text-text-tertiary">
          {preview.riskReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-3xs leading-relaxed text-text-quaternary">
        {t("settings:plugins.trustModel")}
      </p>
    </div>
  );
}
