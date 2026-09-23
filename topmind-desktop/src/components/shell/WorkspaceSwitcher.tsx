/**
 * Workspace menu — docked in the left-sidebar footer; Shell always mounts
 * this host so ⌘⇧W still opens the menu when the sidebar is collapsed.
 *
 * Footer layout (WorkBuddy-style): identity (icon · name · chevron) opens the
 * menu; Settings and Theme live as peer icon buttons on the same row so the
 * two highest-frequency chrome actions never require a menu open.
 *
 * Menu is sectioned: identity + copy · recent workspaces · open/close ·
 * focus/tools/help · language · (theme/settings no longer buried here).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAddLine,
  RiArrowUpSLine,
  RiCheckLine,
  RiComputerLine,
  RiFileCopyLine,
  RiFolder3Line,
  RiFullscreenLine,
  RiGlobalLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiQuestionLine,
  RiSettingsLine,
  RiStethoscopeLine,
  RiSunLine,
} from "@remixicon/react";
import { DropdownItem, DropdownMenu, DropdownSectionLabel } from "../ui/DropdownMenu";
import { api } from "../../services/api";
import { emitLocal } from "../../plugins/host";
import { applyWorkspaceChange } from "../../lib/workspace-switch";
import { setLocalePreference, setThemePreference } from "../../lib/appearance";
import { ChromePortal } from "../../lib/chrome-portal";
import { useViewStore } from "../../stores/view-store";
import type { Theme } from "../../lib/theme";
import type { AppSettings } from "../../types";
import { cn } from "../../lib/kit";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { formatChord } from "../../lib/chord";

interface RecentWs { rootPath: string; lastOpenedAt: string; }

type ThemeMode = Theme;

/** Locale option — short chip label for the footer-style one-row switcher. */
const LOCALE_OPTIONS: Array<{
  id: "auto" | "zh-CN" | "en-US";
  chip: string;
  nativeLabel: string;
}> = [
  { id: "auto", chip: "A", nativeLabel: "Auto" },
  { id: "zh-CN", chip: "中", nativeLabel: "简体中文" },
  { id: "en-US", chip: "EN", nativeLabel: "English" },
];

const THEME_ORDER: ThemeMode[] = ["auto", "light", "dark"];

function nextTheme(cur: ThemeMode): ThemeMode {
  const i = THEME_ORDER.indexOf(cur);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length] ?? "auto";
}

function themeIcon(theme: ThemeMode) {
  if (theme === "light") return RiSunLine;
  if (theme === "dark") return RiMoonLine;
  return RiComputerLine;
}

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
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const theme = useViewStore((s) => s.theme);
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
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const reloadAfterWorkspaceChange = (settings?: AppSettings | null) => {
    setOpen(false);
    applyWorkspaceChange(settings);
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

  const openSettings = () => {
    setOpen(false);
    void import("../overlays/SettingsDialog");
    emitLocal("overlay:open", { kind: "settings" });
  };

  const copyRoot = async () => {
    try {
      await navigator.clipboard.writeText(currentRoot.replace(/\\/g, "/"));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  // Theme + language go through the shared appearance helpers so this menu, the
  // Settings panel and the native 视图 → 外观/语言 radios can't drift apart.
  const pickTheme = (next: ThemeMode) => {
    setThemePreference(next);
  };

  const pickLocale = (locale: "auto" | "zh-CN" | "en-US") => {
    setLocalePreference(locale);
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

  const themeLabel = (id: ThemeMode) =>
    id === "light" ? t("titleBar.themeLight") : id === "dark" ? t("titleBar.themeDark") : t("titleBar.themeAuto");
  const ThemeIcon = themeIcon(theme);

  const identityButton = (
    <button
      type="button"
      data-workspace-switcher
      data-workspace-switcher-variant={docked ? "sidebar" : "float"}
      onClick={() => setOpen(!open)}
      aria-haspopup="listbox"
      aria-expanded={open}
      className={cn(
        sidebar
          ? "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted v4-focus-ring"
          : "v4-titlebar-btn max-w-30 gap-1 px-1.5 font-mono text-3xs sm:max-w-40 xl:max-w-50",
        open && (sidebar ? "bg-surface-muted" : "bg-surface-muted text-text-secondary"),
        !sidebar && !open && "pointer-events-none h-8 w-8 overflow-hidden p-0 opacity-0",
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg-subtle text-accent-color">
        <RiFolder3Line size={ICON.xs} />
      </span>
      <span className={cn("min-w-0 flex-1 truncate", sidebar ? "text-xs font-semibold text-text-primary" : "font-mono")}>
        {shortName(currentRoot)}
      </span>
      <RiArrowUpSLine
        size={ICON.nano}
        className={cn("shrink-0 text-text-quaternary transition-transform", open && "rotate-180")}
      />
    </button>
  );

  const themeBtn = (
    <Tooltip content={t("titleBar.themeCycleTip", { label: themeLabel(theme), next: themeLabel(nextTheme(theme)) })}>
      <button
        type="button"
        className="v4-icon-btn v4-icon-btn-chrome shrink-0"
        data-workspace-theme
        aria-label={t("titleBar.themeCycleTip", { label: themeLabel(theme), next: themeLabel(nextTheme(theme)) })}
        onClick={() => {
          setOpen(false);
          void pickTheme(nextTheme(theme));
        }}
      >
        <ThemeIcon size={ICON.xs} />
      </button>
    </Tooltip>
  );

  const settingsBtn = (
    <Tooltip content={t("titleBar.settingsTip")}>
      <button
        type="button"
        className="v4-icon-btn v4-icon-btn-chrome shrink-0"
        data-workspace-settings
        aria-label={t("titleBar.settingsAriaLabel")}
        onClick={openSettings}
      >
        <RiSettingsLine size={ICON.xs} />
      </button>
    </Tooltip>
  );

  /**
   * Trigger: identity + trailing chrome actions on one row (docked footer).
   * Float / collapsed keeps a single compact identity control.
   * Tooltip only wraps identity — theme/settings carry their own.
   */
  const trigger = sidebar ? (
    <div className="flex w-full min-w-0 items-center gap-0.5" data-workspace-switcher-row>
      <Tooltip content={t("titleBar.workspaceTip", { root: currentRoot })}>
        <div className="flex min-w-0 flex-1">{identityButton}</div>
      </Tooltip>
      {themeBtn}
      {settingsBtn}
    </div>
  ) : (
    <Tooltip content={t("titleBar.workspaceTip", { root: currentRoot })}>
      {identityButton}
    </Tooltip>
  );

  const menu = (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      minWidth={320}
      maxWidth={400}
      maxHeight={560}
      matchTriggerWidth={false}
      preferPlacement="top"
      padBottom={32}
      panelClassName="v4-no-drag p-0"
      className={sidebar ? "w-full" : undefined}
      trigger={trigger}
    >
      {/* Identity block — name + copy, path as quiet meta (WorkBuddy header) */}
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary" data-workspace-name>
            {shortName(currentRoot)}
          </span>
          <Tooltip content={copied ? t("titleBar.copyWorkspacePathDone") : t("titleBar.copyWorkspacePath")}>
            <button
              type="button"
              className="v4-icon-btn h-6 w-6 shrink-0 rounded-md"
              data-workspace-copy-path
              aria-label={t("titleBar.copyWorkspacePath")}
              onClick={() => { void copyRoot(); }}
            >
              {copied ? (
                <RiCheckLine size={ICON.xs} className="text-accent-color" />
              ) : (
                <RiFileCopyLine size={ICON.xs} />
              )}
            </button>
          </Tooltip>
        </div>
        <div
          className="mt-1 truncate rounded-md bg-surface-muted/50 px-2 py-1 font-mono text-3xs text-text-quaternary"
          title={currentRoot}
        >
          {currentRoot.replace(/\\/g, "/")}
        </div>
      </div>

      <div className="h-px bg-border-subtle-dim" />

      {/* Recent workspaces */}
      <div className="px-1 py-1.5">
        <DropdownSectionLabel>{t("titleBar.recentWorkspaces")}</DropdownSectionLabel>
        <div className="v4-sidebar-scroll max-h-36 overflow-auto">
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
                  icon={
                    <RiFolder3Line
                      size={ICON.xs}
                      className={cn("shrink-0", active ? "text-accent-color" : "opacity-70")}
                    />
                  }
                  onSelect={() => { void handleSwitch(w.rootPath); }}
                >
                  <span className="min-w-0 flex-1 truncate text-3xs font-medium" title={w.rootPath}>
                    {shortName(w.rootPath)}
                  </span>
                  {switching === w.rootPath ? (
                    <RiLoader4Line size={ICON.xs} className="shrink-0 animate-spin" />
                  ) : active ? (
                    <RiCheckLine size={ICON.xs} className="shrink-0 text-accent-color" />
                  ) : null}
                </DropdownItem>
              );
            })
          )}
        </div>
      </div>

      <div className="h-px bg-border-subtle-dim" />

      {/* Open / close */}
      <div className="px-1 py-1.5">
        <DropdownItem
          disabled={busy}
          icon={
            switching === "picking" ? (
              <RiLoader4Line size={ICON.xs} className="animate-spin" />
            ) : (
              <RiAddLine size={ICON.xs} />
            )
          }
          onSelect={() => { void handlePickNew(); }}
        >
          <span className="min-w-0 flex-1 truncate">{t("titleBar.openOrCreateWorkspace")}</span>
        </DropdownItem>
        <DropdownItem
          disabled={busy}
          destructive
          icon={
            switching === "closing" ? (
              <RiLoader4Line size={ICON.xs} className="animate-spin" />
            ) : (
              <RiLogoutBoxRLine size={ICON.xs} />
            )
          }
          onSelect={() => { void handleCloseWorkspace(); }}
        >
          <span className="min-w-0 flex-1 truncate">{t("titleBar.closeWorkspace")}</span>
        </DropdownItem>
      </div>

      <div className="h-px bg-border-subtle-dim" />

      {/* App actions — focus / tools / help (settings + theme live on the footer) */}
      <div className="px-1 py-1.5">
        <DropdownItem
          active={focusMode}
          icon={<RiFullscreenLine size={ICON.xs} />}
          shortcut={formatChord("⌘⌥F")}
          onSelect={() => {
            setFocusMode(!focusMode);
            setOpen(false);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{t("titleBar.focusMode")}</span>
        </DropdownItem>
        <DropdownItem
          icon={<RiStethoscopeLine size={ICON.xs} />}
          shortcut={formatChord("⌘⇧L")}
          onSelect={() => {
            setOpen(false);
            emitLocal("overlay:open", { kind: "tools-logs" });
          }}
        >
          <span className="min-w-0 flex-1 truncate">{t("titleBar.toolsLogs")}</span>
        </DropdownItem>
        <DropdownItem
          icon={<RiQuestionLine size={ICON.xs} />}
          onSelect={() => {
            setOpen(false);
            emitLocal("overlay:open", { kind: "help" });
          }}
        >
          <span className="min-w-0 flex-1 truncate">{t("titleBar.help")}</span>
        </DropdownItem>
      </div>

      <div className="h-px bg-border-subtle-dim" />

      {/* Language — one row: label left, compact chips right (same rhythm as menu items) */}
      <div className="px-1 pb-1.5 pt-1">
        <div className="flex h-8 items-center gap-2 rounded-[var(--radius-md)] px-2.5">
          <RiGlobalLine size={ICON.xs} className="shrink-0 text-text-tertiary" />
          <span className="flex-1 text-3xs font-medium text-text-secondary">
            {t("titleBar.languageMenuSection")}
          </span>
          <div className="flex shrink-0 items-center gap-0.5" data-workspace-locale-switch>
            {LOCALE_OPTIONS.map((opt) => {
              const active = currentLocale === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.nativeLabel}
                  aria-label={opt.nativeLabel}
                  aria-pressed={active}
                  onClick={() => { void pickLocale(opt.id); }}
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-sm)] px-1.5",
                    "text-3xs font-semibold transition-colors v4-focus-ring",
                    active
                      ? "bg-accent-bg-subtle text-accent-color"
                      : "text-text-tertiary hover:bg-surface-hover hover:text-text-secondary",
                  )}
                >
                  {opt.chip}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error ? (
        <div className="border-t border-border-subtle px-3 py-2 text-3xs text-error" role="alert">
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
