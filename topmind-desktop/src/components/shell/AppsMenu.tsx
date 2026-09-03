/**
 * Apps 菜单 — 标题栏 launchpad（2026-08-30 取代侧栏底部插件区 + launcher overlay）。
 *
 * 数据正确性：菜单打开时实时拉取 settings（不依赖启动时的缓存快照），
 * 并订阅 `plugins:settings-changed`（设置开关 / 外部插件热加载后即时刷新）。
 * 已启用的首方候选 + 活跃外部插件全部列出；未配置的连接器标注「待配置」，
 * 点击直达其设置页（配置完成后回到菜单即变为主入口）。
 * 打开方式由 lib/apps-menu.resolveLaunchableOpenTarget 决定：
 * connector hub 进主画布，其余开 plugin-app overlay。
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
import {
  openLaunchablePlugin,
  pluginReadiness,
  APPS_MENU_TOGGLE_EVENT,
} from "../../lib/apps-menu";
import { api } from "../../services/api";
import { onLocal } from "../../plugins/host";
import { DropdownItem, DropdownMenu, DropdownSectionLabel } from "../ui/DropdownMenu";
import { Tooltip } from "../ui/tooltip";
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

/** Warm the settings dialog module so the manage entry opens snappy. */
function warmSettings() {
  void import("../overlays/SettingsDialog");
}

function openConfigure(topicId: string | null) {
  useViewStore.getState().openOverlay("settings", { topicId: topicId || "plugins" });
}

export function AppsMenu() {
  const { t } = useTranslation(["shell", "overlays"]);
  const [open, setOpen] = useState(false);
  const plugins = usePluginStore((s) => s.plugins);
  // 实时 settings：cache 只做首帧，打开菜单 / 插件设置变化时都拉最新。
  const [settings, setSettings] = useState<AppSettings | null>(getCachedSettings());

  // 实时 settings：打开菜单时拉最新 + 订阅插件设置变化（开关 / 热加载后即时刷新）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    warmSettings();
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
  }, [open]);

  const launchable = useMemo(
    () => listLaunchablePlugins(plugins, settings as unknown as Record<string, unknown>),
    [plugins, settings],
  );

  // 命令面板 / 快捷键与按钮共用一个开关事件（同 workspace-switcher 模式）。
  useEffect(() => {
    return onLocal(APPS_MENU_TOGGLE_EVENT, () => setOpen((v) => !v));
  }, []);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      minWidth={276}
      maxWidth={312}
      maxHeight={440}
      matchTriggerWidth={false}
      panelClassName="v4-no-drag"
      trigger={
        <Tooltip content={t("shell:titleBar.appsTip")}>
          <button
            type="button"
            className={cn("v4-titlebar-btn", open && "bg-surface-muted")}
            data-titlebar-apps
            data-menu-trigger
            onMouseEnter={warmSettings}
            onClick={() => setOpen((v) => !v)}
            aria-label={t("shell:titleBar.appsAriaLabel")}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <RiLayoutGridLine size={ICON.sm} />
          </button>
        </Tooltip>
      }
    >
      <DropdownSectionLabel>{t("shell:appsMenu.section")}</DropdownSectionLabel>
      {launchable.length === 0 ? (
        <div className="px-2.5 pb-2 pt-1">
          <p className="text-3xs leading-relaxed text-text-quaternary">
            {t("shell:appsMenu.empty")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 px-1.5 pb-1.5" data-apps-menu-grid>
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
                role="option"
                aria-label={readiness.needsConfig ? `${name} · ${t("shell:appsMenu.needsConfig")}` : name}
                data-apps-menu-entry={p.id}
                data-apps-needs-config={readiness.needsConfig ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  if (readiness.needsConfig) {
                    warmSettings();
                    openConfigure(readiness.settingsTopicId);
                    return;
                  }
                  openLaunchablePlugin(p.id);
                }}
                className={cn(
                  "v4-menu-item flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] border border-transparent px-2 py-2 text-left outline-none",
                  "hover:border-border-subtle-dim hover:bg-surface-muted",
                  "focus-visible:bg-accent-bg-faint focus-visible:shadow-[inset_0_0_0_1px_var(--color-focus-soft)]",
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
      <div className="border-t border-border-subtle-dim p-1">
        <DropdownItem
          onSelect={() => {
            setOpen(false);
            warmSettings();
            openConfigure("plugins");
          }}
        >
          <RiSettingsLine size={ICON.micro} className="shrink-0 opacity-70" />
          <span className="flex-1">{t("shell:appsMenu.manage")}</span>
        </DropdownItem>
      </div>
    </DropdownMenu>
  );
}
