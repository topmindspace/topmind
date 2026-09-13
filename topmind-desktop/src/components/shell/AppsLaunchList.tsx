/**
 * Launchable apps / connectors / mini-apps — used by the AI workspace 应用 pane.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiBookOpenLine,
  RiFileTransferLine,
  RiLayoutGridLine,
  RiPuzzleLine,
  RiSettingsLine,
  RiTwitterXLine,
  RiWallet3Line,
} from "@remixicon/react";
import { usePluginStore } from "../../stores/plugin-store";
import { useViewStore } from "../../stores/view-store";
import { getCachedSettings, setCachedSettings } from "../../lib/settings-cache";
import { listLaunchablePlugins } from "../../lib/plugin-launcher";
import { openLaunchablePlugin, pluginReadiness } from "../../lib/apps-menu";
import { api } from "../../services/api";
import { onLocal } from "../../plugins/host";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import type { RemixiconComponentType } from "@remixicon/react";
import type { AppSettings } from "../../types";

const ICON_MAP: Record<string, RemixiconComponentType> = {
  wallet: RiWallet3Line,
  puzzle: RiPuzzleLine,
  "layout-grid": RiLayoutGridLine,
  "book-open": RiBookOpenLine,
  twitter: RiTwitterXLine,
  "file-input": RiFileTransferLine,
};

function openConfigure(topicId: string | null) {
  useViewStore.getState().openOverlay("settings", { topicId: topicId || "plugins" });
}

export function AppsLaunchList() {
  const { t } = useTranslation(["shell", "overlays"]);
  const plugins = usePluginStore((s) => s.plugins);
  const [settings, setSettings] = useState<AppSettings | null>(getCachedSettings());

  useEffect(() => {
    let cancelled = false;
    void api.sys.settings().then((s) => {
      if (cancelled) return;
      setSettings(s);
      setCachedSettings(s);
    }).catch(() => {});
    const unsub = onLocal("plugins:settings-changed", () => {
      void api.sys.settings().then((s) => {
        if (!cancelled) setSettings(s);
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const launchable = useMemo(
    () => listLaunchablePlugins(plugins, settings as unknown as Record<string, unknown>),
    [plugins, settings],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-apps-workspace>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle-dim px-3 py-2">
        <RiLayoutGridLine size={ICON.xs} className="text-accent-color" aria-hidden />
        <span className="min-w-0 flex-1 text-3xs font-semibold text-text-primary">
          {t("shell:appsMenu.section")}
        </span>
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-3xs text-text-tertiary hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
          onClick={() => openConfigure("plugins")}
        >
          <RiSettingsLine size={ICON.micro} />
          {t("shell:appsMenu.manage")}
        </button>
      </div>
      <div className="v4-content-scroll min-h-0 flex-1 overflow-auto px-2 py-2">
        {launchable.length === 0 ? (
          <p className="px-1.5 py-2 text-3xs leading-relaxed text-text-quaternary">
            {t("shell:appsMenu.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5" data-apps-menu-grid>
            {launchable.map((p) => {
              const Icon = ICON_MAP[p.manifest?.icon || ""] || RiPuzzleLine;
              const name = p.manifest?.nameKey
                ? t(p.manifest.nameKey)
                : p.manifest?.name || p.id;
              const desc = p.manifest?.descriptionKey
                ? t(p.manifest.descriptionKey)
                : p.manifest?.description || "";
              const readiness = pluginReadiness(p.id, settings);
              return (
                <button
                  key={p.id}
                  type="button"
                  data-apps-menu-entry={p.id}
                  data-apps-needs-config={readiness.needsConfig ? "true" : undefined}
                  onClick={() => {
                    if (readiness.needsConfig) {
                      openConfigure(readiness.settingsTopicId);
                      return;
                    }
                    openLaunchablePlugin(p.id);
                  }}
                  className={cn(
                    "flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] border border-transparent px-2 py-2 text-left",
                    "hover:border-border-subtle-dim hover:bg-surface-muted v4-focus-ring",
                  )}
                >
                  <span className="v4-icon-chip-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)]">
                    <Icon size={ICON.sm} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-3xs font-medium text-text-primary">{name}</span>
                      {readiness.needsConfig ? (
                        <span className="shrink-0 rounded-full bg-status-warning-bg px-1.5 py-px text-4xs font-medium leading-none text-warning">
                          {t("shell:appsMenu.needsConfig")}
                        </span>
                      ) : null}
                    </span>
                    {desc ? (
                      <span className="line-clamp-2 text-3xs leading-snug text-text-quaternary">{desc}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
