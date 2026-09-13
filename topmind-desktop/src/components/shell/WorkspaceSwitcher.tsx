/**
 * Workspace menu — docked in the left-sidebar footer; Shell always mounts
 * this host so ⌘⇧W still opens the menu when the sidebar is collapsed.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiComputerLine,
  RiFolderOpenLine,
  RiFullscreenLine,
  RiGlobalLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiSettings3Line,
  RiSunLine,
} from "@remixicon/react";
import { DropdownItem, DropdownMenu, DropdownSectionLabel } from "../ui/DropdownMenu";
import { api } from "../../services/api";
import { emitLocal } from "../../plugins/host";
import { setCachedSettings } from "../../lib/settings-cache";
import { invalidateWorkspaceDataCache } from "../../lib/workspace-data-cache";
import { ChromePortal } from "../../lib/chrome-portal";
import { useViewStore } from "../../stores/view-store";
import { applyTheme, type Theme } from "../../lib/theme";
import { patchCachedSettings } from "../../lib/settings-cache";
import { applyLocale } from "../../locales";
import type { AppSettings } from "../../types";
import { cn } from "../../lib/cn";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";

interface RecentWs { rootPath: string; lastOpenedAt: string; }

type ThemeMode = Theme;

/** Locale option for the language menu. */
const LOCALE_OPTIONS: Array<{ id: "auto" | "zh-CN" | "en-US"; nativeLabel: string }> = [
  { id: "auto", nativeLabel: "Auto" },
  { id: "zh-CN", nativeLabel: "简体中文" },
  { id: "en-US", nativeLabel: "English" },
];

export function WorkspaceSwitcher({
  currentRoot,
}: {
  currentRoot: string;
}) {
  const { t, i18n } = useTranslation("shell");
  const open = useViewStore((s) => s.workspaceSwitcherOpen);
  const setOpen = useViewStore((s) => s.setWorkspaceSwitcherOpen);
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const focusMode = useViewStore((s) => s.focusMode);
  const docked = !sidebarCollapsed && !focusMode;
  const [recent, setRecent] = useState<RecentWs[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const theme = useViewStore((s) => s.theme);
  const setTheme = useViewStore((s) => s.setTheme);
  const setFocusMode = useViewStore((s) => s.setFocusMode);

  const load = () => {
    void api.sys
      .settings()
      .then(async (s) => {
        try {
          const refreshed = await api.sys.refreshWorkspaceHistory();
          const list = (refreshed.recent ?? s.workspaces?.recent ?? []).map((w) => ({
            rootPath: w.rootPath,
            lastOpenedAt: w.lastOpenedAt || "",
          }));
          setRecent(list);
        } catch {
          setRecent(s.workspaces?.recent ?? []);
        }
      })
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (open) load();
  }, [open]);

  const reloadAfterWorkspaceChange = (settings?: AppSettings | null) => {
    try {
      if (settings) setCachedSettings(settings);
      else setCachedSettings(null);
    } catch {
      /* ignore */
    }
    try {
      invalidateWorkspaceDataCache();
    } catch {
      /* ignore */
    }
    setOpen(false);
    window.setTimeout(() => window.location.reload(), 80);
  };

  const handleSwitch = async (path: string) => {
    if (path === currentRoot) { setOpen(false); return; }
    setSwitching(path);
    setError(null);
    try {
      const res = await api.sys.switchWorkspace(path);
      reloadAfterWorkspaceChange(res?.settings ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSwitching(null);
    }
  };

  const handlePickNew = async () => {
    setSwitching("picking");
    setError(null);
    try {
      const { path } = await api.sys.pickWorkspaceFolder();
      if (!path) { setSwitching(null); return; }
      await api.sys.createWorkspace(path);
      const res = await api.sys.switchWorkspace(path);
      reloadAfterWorkspaceChange(res?.settings ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSwitching(null);
    }
  };

  const handleCloseWorkspace = async () => {
    setSwitching("closing");
    setError(null);
    try {
      await api.sys.closeWorkspace();
      reloadAfterWorkspaceChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSwitching(null);
    }
  };

  const pickTheme = async (next: ThemeMode) => {
    setTheme(next);
    applyTheme(next);
    patchCachedSettings({ theme: next });
    void api.sys.update({ theme: next }).catch(() => {});
  };

  const pickLocale = async (locale: "auto" | "zh-CN" | "en-US") => {
    patchCachedSettings({ ui: { locale } });
    applyLocale(locale);
    void api.sys.update({ ui: { locale } }).catch(() => {});
    // No reload — i18n hot-swaps
  };

  const shortName = (p: string) => {
    const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  };

  const busy = !!switching;
  const sidebar = docked;

  const currentLocale = (() => {
    const saved = i18n.language;
    if (saved?.startsWith("zh")) return "zh-CN";
    if (saved?.startsWith("en")) return "en-US";
    return "auto";
  })();

  const menu = (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      minWidth={260}
      maxHeight={420}
      matchTriggerWidth={false}
      panelClassName="v4-no-drag p-0"
      trigger={
        <Tooltip content={t("titleBar.workspaceTip", { root: currentRoot })}>
          <button
            type="button"
            data-workspace-switcher
            data-workspace-switcher-variant={docked ? "sidebar" : "float"}
            onClick={() => setOpen(!open)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              sidebar
                ? "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-3xs font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
                : "v4-titlebar-btn max-w-30 gap-1 px-1.5 font-mono text-3xs sm:max-w-40 xl:max-w-50",
              open && (sidebar ? "bg-surface-muted text-text-primary" : "bg-surface-muted text-text-secondary"),
              !sidebar && !open && "pointer-events-none h-8 w-8 overflow-hidden p-0 opacity-0",
            )}
          >
            <RiFolderOpenLine size={sidebar ? ICON.xs : ICON.xs} className="shrink-0" />
            <span className={cn("min-w-0 flex-1 truncate", sidebar ? "font-medium" : "font-mono")}>
              {shortName(currentRoot)}
            </span>
            <RiArrowDownSLine
              size={ICON.nano}
              className={cn("shrink-0 text-text-quaternary transition-transform", open && "rotate-180")}
            />
          </button>
        </Tooltip>
      }
    >
      {/* Recent workspaces — compact list, name only (path in tooltip) */}
      <DropdownSectionLabel>{t("titleBar.recentWorkspaces")}</DropdownSectionLabel>
      <div className="v4-sidebar-scroll max-h-40 overflow-auto px-1 pb-1">
        {recent.length === 0 ? (
          <div className="px-2.5 py-2 text-3xs text-text-quaternary">{t("titleBar.noRecentWorkspaces")}</div>
        ) : (
          recent.map((w) => {
            const active = w.rootPath === currentRoot;
            return (
              <DropdownItem
                key={w.rootPath}
                disabled={busy}
                active={active}
                onSelect={() => { void handleSwitch(w.rootPath); }}
              >
                <RiFolderOpenLine size={ICON.micro} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate" title={w.rootPath}>
                  {shortName(w.rootPath)}
                </span>
                {switching === w.rootPath ? (
                  <RiLoader4Line size={ICON.micro} className="shrink-0 animate-spin" />
                ) : active ? (
                  <RiCheckLine size={ICON.micro} className="shrink-0 text-accent-color" />
                ) : null}
              </DropdownItem>
            );
          })
        )}
      </div>

      {/* Workspace actions */}
      <div className="border-t border-border-subtle-dim p-1">
        <DropdownItem disabled={busy} onSelect={() => { void handlePickNew(); }}>
          {switching === "picking" ? (
            <RiLoader4Line size={ICON.xs} className="shrink-0 animate-spin" />
          ) : (
            <RiAddLine size={ICON.xs} className="shrink-0" />
          )}
          <span>{t("titleBar.openOrCreateWorkspace")}</span>
        </DropdownItem>
        <DropdownItem disabled={busy} onSelect={() => { void handleCloseWorkspace(); }}>
          {switching === "closing" ? (
            <RiLoader4Line size={ICON.xs} className="shrink-0 animate-spin" />
          ) : (
            <RiLogoutBoxRLine size={ICON.xs} className="shrink-0" />
          )}
          <span>{t("titleBar.closeWorkspace")}</span>
        </DropdownItem>
      </div>

      {/* Preferences: theme + language in a compact row group */}
      <DropdownSectionLabel>{t("titleBar.preferencesSection")}</DropdownSectionLabel>
      <div className="px-1 pb-1">
        {([
          { id: "auto", icon: <RiComputerLine size={ICON.micro} /> },
          { id: "light", icon: <RiSunLine size={ICON.micro} /> },
          { id: "dark", icon: <RiMoonLine size={ICON.micro} /> },
        ] as Array<{ id: ThemeMode; icon: React.ReactNode }>).map((opt) => (
          <DropdownItem
            key={opt.id}
            active={theme === opt.id}
            onSelect={() => {
              void pickTheme(opt.id);
            }}
          >
            <span className="flex h-[1em] w-[1em] shrink-0 items-center justify-center opacity-70">
              {opt.icon}
            </span>
            <span className="flex-1">
              {opt.id === "auto" ? t("titleBar.themeAuto") : opt.id === "light" ? t("titleBar.themeLight") : t("titleBar.themeDark")}
            </span>
            {theme === opt.id ? <RiCheckLine size={ICON.micro} className="text-accent-color" /> : null}
          </DropdownItem>
        ))}
      </div>
      <div className="px-1 pb-1">
        {LOCALE_OPTIONS.map((opt) => (
          <DropdownItem
            key={opt.id}
            active={currentLocale === opt.id}
            onSelect={() => {
              void pickLocale(opt.id);
            }}
          >
            <RiGlobalLine size={ICON.micro} className="shrink-0 opacity-70" />
            <span className="flex-1">{opt.nativeLabel}</span>
            {currentLocale === opt.id ? <RiCheckLine size={ICON.micro} className="text-accent-color" /> : null}
          </DropdownItem>
        ))}
      </div>

      {/* Settings + Focus mode */}
      <div className="border-t border-border-subtle-dim p-1">
        <DropdownItem
          onSelect={() => {
            setOpen(false);
            void import("../overlays/SettingsDialog");
            emitLocal("overlay:open", { kind: "settings" });
          }}
        >
          <RiSettings3Line size={ICON.xs} className="shrink-0" />
          <span className="flex-1">{t("titleBar.settingsLabel")}</span>
          <kbd className="v4-kbd v4-kbd-sm">⌘,</kbd>
        </DropdownItem>
        <DropdownItem
          active={focusMode}
          onSelect={() => {
            setFocusMode(!focusMode);
            setOpen(false);
          }}
        >
          <RiFullscreenLine size={ICON.xs} className="shrink-0" />
          <span className="flex-1">{t("titleBar.focusMode")}</span>
          <kbd className="v4-kbd v4-kbd-sm">⌘⌥F</kbd>
        </DropdownItem>
      </div>

      {error ? (
        <div className="border-t border-border-subtle px-2.5 py-2 text-3xs text-error" role="alert">
          {error}
        </div>
      ) : null}
    </DropdownMenu>
  );

  if (docked) {
    return <ChromePortal selector="[data-sidebar-workspace]">{menu}</ChromePortal>;
  }

  return (
    <div
      className="fixed bottom-10 left-3 z-menu"
      data-workspace-switcher-host="float"
    >
      {menu}
    </div>
  );
}
