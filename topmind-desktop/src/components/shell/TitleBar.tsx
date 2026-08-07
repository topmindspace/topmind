import {
  Sun, Moon, Monitor, Search, ChevronLeft, ChevronRight, Zap, Layers, RotateCcw, Settings, Radio,
  FolderOpen, ChevronDown, Plus, Check, LogOut, Loader2, Inbox, Command, MoreHorizontal,
  ClipboardList, ListTodo, Lightbulb,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownItem, DropdownMenu, DropdownSectionLabel } from "../ui/DropdownMenu";
import { api } from "../../services/api";
import { emitLocal, onLocal } from "../../plugins/host";
import { useViewStore } from "../../stores/view-store";
import { applyTheme, type Theme } from "../../lib/theme";
import { setCachedSettings } from "../../lib/settings-cache";
import { invalidateWorkspaceDataCache } from "../../lib/workspace-data-cache";
import type { AppSettings } from "../../types";
import { cn } from "../../lib/cn";

import { Tooltip } from "../ui/tooltip";
import { PanelToggleIcon } from "../ui/PanelToggleIcon";
import { ICON, ICON_STROKE } from "../../lib/icons";
import { TodoPopover } from "../todo/TodoPopover";
import { useActionStore } from "../../stores/action-store";
import { toggleSuggestSurface } from "../../lib/suggest-surface";

type ThemeMode = Theme;

/** Badge for global 建议 count (ActionStore). */
function SuggestBadge() {
  const count = useActionStore((s) => s.items.length);
  const hasHigh = useActionStore((s) => s.items.some((i) => i.priority === "high"));
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-[var(--radius-xs)] px-0.5 text-5xs font-bold leading-none tabular-nums text-text-on-accent",
        hasHigh ? "bg-warning" : "bg-skill-loop",
      )}
      aria-hidden
      data-suggest-header-badge
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** Detect platform for chrome padding (traffic lights / Windows caption overlay).
 *  navigator.platform is synchronous and reliable in Electron renderer. */
const isMacOS = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const isWindows =
  typeof navigator !== "undefined" &&
  (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent || ""));

const stroke = { strokeWidth: ICON_STROKE.chrome };

interface TitleBarProps {
  workspaceRoot: string;
  taskPanelOpen: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleTaskPanel: () => void;
}

interface RecentWs { rootPath: string; lastOpenedAt: string; }

function warmOverlay(kind: "command-palette" | "search" | "settings" | "quick-capture") {
  if (kind === "command-palette") void import("../overlays/CommandPalette");
  else if (kind === "search") void import("../overlays/GlobalSearch");
  else if (kind === "settings") void import("../overlays/SettingsDialog");
  else void import("../overlays/QuickCapture");
}

/**
 * Workspace switcher — portal-based menu so the panel is never clipped by the
 * titlebar grid row / FileDropZone stacking context below it.
 */
function WorkspaceSwitcher({ currentRoot }: { currentRoot: string }) {
  const { t } = useTranslation("shell");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentWs[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api.sys
      .settings()
      .then(async (s) => {
        // Prefer server-normalized list (dedupe + prune forbidden)
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
    const unsub = onLocal("titlebar:workspace-switcher-toggle", () => setOpen((v) => !v));
    return unsub;
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open]);

  const reloadAfterWorkspaceChange = (settings?: AppSettings | null) => {
    // Drop renderer caches so next boot never paints stale notes/topics/settings
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
    // Full reload: plugin host + workspace services rebind to new root
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

  const shortName = (p: string) => {
    // Support both POSIX and Windows paths in the chrome label
    const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  };

  const busy = !!switching;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      minWidth={320}
      maxHeight={360}
      matchTriggerWidth={false}
      panelClassName="v4-no-drag p-0"
      trigger={
        <Tooltip content={t("titleBar.workspaceTip", { root: currentRoot })}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "v4-titlebar-btn max-w-[120px] gap-1 px-1.5 font-mono text-3xs sm:max-w-[160px] xl:max-w-[200px]",
              open && "bg-surface-muted text-text-secondary",
            )}
          >
            <FolderOpen size={ICON.xs} {...stroke} className="shrink-0" />
            <span className="truncate">{shortName(currentRoot)}</span>
            <ChevronDown
              size={ICON.nano}
              className={cn("shrink-0 text-text-quaternary transition-transform", open && "rotate-180")}
            />
          </button>
        </Tooltip>
      }
    >
      <div className="border-b border-border-subtle-dim px-2.5 py-2">
        <div className="text-3xs font-semibold uppercase tracking-wide text-text-quaternary">
          {t("titleBar.workspaceMenuTitle")}
        </div>
        <div className="mt-0.5 truncate font-mono text-3xs text-text-tertiary" title={currentRoot}>
          {currentRoot}
        </div>
      </div>

      <DropdownSectionLabel>{t("titleBar.recentWorkspaces")}</DropdownSectionLabel>
      <div className="v4-sidebar-scroll max-h-[180px] overflow-auto px-1 pb-1">
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
                <FolderOpen size={ICON.micro} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-3xs">{shortName(w.rootPath)}</span>
                  <span className="block truncate font-mono text-3xs text-text-quaternary">{w.rootPath}</span>
                </span>
                {switching === w.rootPath ? (
                  <Loader2 size={ICON.micro} className="shrink-0 animate-spin" />
                ) : active ? (
                  <Check size={ICON.micro} className="shrink-0 text-accent-color" />
                ) : null}
              </DropdownItem>
            );
          })
        )}
      </div>

      <div className="border-t border-border-subtle-dim p-1">
        <DropdownItem disabled={busy} onSelect={() => { void handlePickNew(); }}>
          {switching === "picking" ? (
            <Loader2 size={ICON.xs} className="shrink-0 animate-spin" />
          ) : (
            <Plus size={ICON.xs} className="shrink-0" />
          )}
          <span>{t("titleBar.openOrCreateWorkspace")}</span>
        </DropdownItem>
        <DropdownItem disabled={busy} onSelect={() => { void handleCloseWorkspace(); }}>
          {switching === "closing" ? (
            <Loader2 size={ICON.xs} className="shrink-0 animate-spin" />
          ) : (
            <LogOut size={ICON.xs} className="shrink-0" />
          )}
          <span>{t("titleBar.closeWorkspace")}</span>
        </DropdownItem>
      </div>

      {error ? (
        <div className="border-t border-border-subtle px-2.5 py-2 text-3xs text-error" role="alert">
          {error}
        </div>
      ) : null}
    </DropdownMenu>
  );
}

/**
 * Primary nav — 动态（默认） / 收件箱 / 写出来 + archive icon.
 * Target IA (ARCHITECTURE-RESET / DESIGN §0.0); not legacy 工作台 triad.
 */
function PrimaryNav() {
  const { t } = useTranslation(["shell", "common"]);
  const selection = useViewStore((s) => s.selection);
  const select = useViewStore((s) => s.select);
  // Badge discipline (2026-08): badges only when action is required.
  // Inbox = triage queue (badge). Outputs = inventory, not actionable → no badge.
  const [inboxCount, setInboxCount] = useState(0);
  /**
   * Show text labels from window width (not self-measure — label presence changes
   * own width and would thrash ResizeObserver).
   */
  const [showLabels, setShowLabels] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 960,
  );

  useLayoutEffect(() => {
    const update = () => setShowLabels(window.innerWidth >= 960);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const inboxData = await api.ws.inbox().catch(() => ({ files: [] as { relativePath: string }[] }));
        if (cancelled) return;
        setInboxCount(inboxData.files?.length ?? 0);
      } catch {
        /* ignore */
      }
    };
    // Defer badge fan-out so titlebar + tree paint first (cold start / reinstall).
    let idleHandle: number | null = null;
    let t: ReturnType<typeof setTimeout> | null = null;
    const schedule = (ms = 0) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void refresh(), ms);
    };
    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(() => schedule(0), { timeout: 1200 }) as unknown as number;
    } else {
      schedule(280);
    }
    const unsub = onLocal("workspace:file-changed", () => schedule(700));
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      if (idleHandle != null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleHandle as unknown as number);
      }
      unsub();
    };
  }, []);

  const anchors = [
    {
      key: "stream",
      // Radio = stream identity (matches sidebar ViewSwitcher); never Home chrome
      icon: Radio,
      label: t("primaryNav.stream"),
      badge: 0,
      badgeTone: "accent" as const,
      title: t("primaryNav.streamTipIdle"),
      active: selection.kind === "stream",
      action: () => select({ kind: "stream" }),
    },
    {
      key: "inbox",
      icon: Inbox,
      label: t("primaryNav.inbox"),
      badge: inboxCount,
      badgeTone: "warning" as const,
      title:
        inboxCount > 0
          ? t("primaryNav.inboxTipActive", { count: inboxCount })
          : t("primaryNav.inboxTipIdle"),
      active: selection.kind === "inbox",
      action: () => select({ kind: "inbox" }),
    },
    {
      key: "outputs",
      icon: Layers,
      label: t("primaryNav.outputs"),
      badge: 0,
      badgeTone: "accent" as const,
      title: t("primaryNav.outputsTipIdle"),
      active: selection.kind === "outputs",
      action: () => select({ kind: "outputs" }),
    },
  ];

  return (
    <div
      className="v4-titlebar-cluster min-w-0 max-w-full"
      role="navigation"
      aria-label={t("primaryNav.ariaLabel")}
    >
      {anchors.map((a) => (
        <Tooltip key={a.key} content={a.title}>
          <button
            type="button"
            onClick={a.action}
            className={cn(
              "v4-nav-pill relative flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2.5 text-3xs font-medium",
              !a.active && "text-text-tertiary",
            )}
            data-active={a.active}
            aria-label={a.label}
            aria-current={a.active ? "page" : undefined}
          >
            <a.icon size={ICON.xs} {...stroke} className="shrink-0 opacity-90" />
            {showLabels ? <span className="max-w-[4.5rem] truncate">{a.label}</span> : null}
            {a.badge > 0 ? (
              <span
                className={cn(
                  "min-w-[1rem] rounded-full px-1 text-center text-3xs font-semibold tabular-nums",
                  a.badgeTone === "warning"
                    ? "bg-warning/18 text-warning"
                    : "bg-accent-bg-subtle text-accent-color",
                )}
              >
                {a.badge > 99 ? "99+" : a.badge}
              </span>
            ) : null}
          </button>
        </Tooltip>
      ))}
      {/* 2026-08-07: separator removed — gap spacing suffices for visual grouping */}
      <Tooltip content={t("primaryNav.archiveTip")}>
        <button
          type="button"
          onClick={() => select({ kind: "archive" })}
          className={cn(
            "v4-nav-pill ml-0.5 flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]",
            selection.kind !== "archive" && "text-text-tertiary",
          )}
          data-active={selection.kind === "archive"}
          aria-label={t("primaryNav.archiveAriaLabel")}
        >
          <RotateCcw size={ICON.xs} {...stroke} />
        </button>
      </Tooltip>
    </div>
  );
}

export function TitleBar({ workspaceRoot, taskPanelOpen, sidebarCollapsed, onToggleSidebar, onToggleTaskPanel }: TitleBarProps) {
  const { t } = useTranslation("shell");
  const openOverlay = useViewStore((s) => s.openOverlay);
  const back = useViewStore((s) => s.back);
  const forward = useViewStore((s) => s.forward);
  const canGoBack = useViewStore((s) => s.historyIndex > 0);
  const canGoForward = useViewStore((s) => s.historyIndex < s.history.length - 1);
  const focusMode = useViewStore((s) => s.focusMode);
  const setFocusMode = useViewStore((s) => s.setFocusMode);
  const aiPanelOpen = useViewStore((s) => s.aiPanelOpen);
  // Read theme from the store so the icon stays in sync with App.tsx + SettingsDialog.
  const theme = useViewStore((s) => s.theme);
  const setTheme = useViewStore((s) => s.setTheme);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const suggestPanelOpen = useActionStore((s) => s.panelOpen);
  const suggestCount = useActionStore((s) => s.items.length);

  // ⌘⇧T: toggle todo popover
  useEffect(() => {
    const unToggle = onLocal("todo:toggle-popover", () => setTodoOpen((v) => !v));
    const unOpen = onLocal("todo:open-popover", () => setTodoOpen(true));
    return () => {
      unToggle();
      unOpen();
    };
  }, []);
  /**
   * Exclusive chrome: when the right rail is tight, hide search/settings/theme icons
   * and put them only in「更多」— never both (viewport breakpoints alone cause
   * duplication when left brand + nav already consume width).
   */
  const [compactTools, setCompactTools] = useState(false);
  const rightRailRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = rightRailRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
  // 2026-08-07: raised threshold 280→360 so search/settings/theme go into
  // overflow more often on medium screens — cleaner right rail by default.
  const COMPACT_BELOW = 360;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      const next = w < COMPACT_BELOW;
      setCompactTools((prev) => {
        if (prev === next) return prev;
        return next;
      });
      if (!next) setToolsOpen(false); // expanding: close overflow so no orphan menu
    });
    ro.observe(el);
    setCompactTools(el.clientWidth < COMPACT_BELOW);
    return () => ro.disconnect();
  }, [focusMode]);

  const cycleTheme = async () => {
    const order: ThemeMode[] = ["auto", "light", "dark"];
    const idx = order.indexOf(theme);
    const next = order[(idx + 1) % order.length];
    // Update store → App.tsx re-applies + re-listens; persist to settings.
    setTheme(next);
    applyTheme(next);
    void api.sys.update({ theme: next }).catch(() => {/* ignore */});
  };

  const themeIcon = () => {
    switch (theme) {
      case "auto": return <Monitor size={ICON.sm} {...stroke} />;
      case "light": return <Sun size={ICON.sm} {...stroke} />;
      case "dark": return <Moon size={ICON.sm} {...stroke} />;
    }
  };

  const themeLabel = theme === "auto" ? t("titleBar.themeAuto") : theme === "light" ? t("titleBar.themeLight") : t("titleBar.themeDark");

  // Focus mode: quiet chrome — brand + exit only (⌘⌥F / Esc)
  if (focusMode) {
    return (
      <header
        className={cn(
          "v4-drag v4-titlebar-glass relative flex h-[var(--density-chrome-y,36px)] items-center justify-between gap-2 px-2 text-text-secondary select-none sm:px-3",
          isWindows && "v4-win-titlebar-pad",
        )}
      >
        <div className={cn("v4-no-drag flex min-w-0 items-center gap-1.5", isMacOS && "v4-mac-titlebar-pad")}>
          <span className="text-3xs font-semibold tracking-tight text-text-primary">{t("titleBar.focusMode")}</span>
        </div>
        <div className="v4-no-drag flex items-center gap-1.5">
          <Tooltip content={t("titleBar.exitFocusTip")}>
            <button
              type="button"
              className="v4-titlebar-btn-primary"
              onClick={() => setFocusMode(false)}
              aria-label={t("titleBar.exitFocusAriaLabel")}
            >
              {t("titleBar.exitFocus")}
            </button>
          </Tooltip>
        </div>
      </header>
    );
  }

  return (
    <header
      className={cn(
        "v4-drag v4-titlebar-glass relative flex h-[var(--density-chrome-y,36px)] items-center justify-between gap-2 px-2 text-text-secondary select-none sm:px-3",
        isWindows && "v4-win-titlebar-pad",
      )}
    >
      {/* Left: panel · history · brand · workspace */}
      <div className={cn("v4-no-drag flex min-w-0 flex-1 items-center gap-1.5", isMacOS && "v4-mac-titlebar-pad")}>
        <div className="v4-titlebar-cluster">
          <Tooltip content={sidebarCollapsed ? t("titleBar.showSidebar") : t("titleBar.hideSidebar")}>
            <button
              type="button"
              className="v4-titlebar-btn"
              onClick={onToggleSidebar}
              aria-pressed={!sidebarCollapsed}
              data-active={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? t("titleBar.showSidebar") : t("titleBar.hideSidebar")}
            >
              <PanelToggleIcon side="left" open={!sidebarCollapsed} size={ICON.sm} />
            </button>
          </Tooltip>
          <Tooltip content={t("titleBar.back")}>
            <button type="button" className="v4-titlebar-btn" onClick={back} disabled={!canGoBack} aria-label={t("titleBar.backAriaLabel")}>
              <ChevronLeft size={ICON.sm} {...stroke} />
            </button>
          </Tooltip>
          <Tooltip content={t("titleBar.forward")}>
            <button type="button" className="v4-titlebar-btn" onClick={forward} disabled={!canGoForward} aria-label={t("titleBar.forwardAriaLabel")}>
              <ChevronRight size={ICON.sm} {...stroke} />
            </button>
          </Tooltip>
        </div>

        {/* Brand chip removed (2026-08-07): window/taskbar already identify app;
            the decorative icon consumed prime left-rail real estate. */}
        <WorkspaceSwitcher currentRoot={workspaceRoot} />
      </div>

      {/* Center: primary nav + command field (Linear-style quiet well, not a button row) */}
      <div className="v4-no-drag flex shrink-0 items-center gap-1.5">
        <PrimaryNav />
        <Tooltip content={t("titleBar.commandPaletteTip")}>
          <button
            type="button"
            onMouseEnter={() => warmOverlay("command-palette")}
            onClick={() => emitLocal("overlay:open", { kind: "command-palette" })}
            className="v4-cmd-trigger group flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-3xs font-medium text-text-tertiary xl:min-w-[10.5rem]"
            aria-label={t("titleBar.commandPaletteAriaLabel")}
          >
            <Command size={ICON.xs} {...stroke} className="shrink-0 transition-colors group-hover:text-accent-color" />
            <span className="hidden min-w-0 flex-1 truncate text-left xl:inline">{t("titleBar.commandField")}</span>
            <kbd className="v4-kbd ml-auto">⌘K</kbd>
          </button>
        </Tooltip>
      </div>

      {/* Right: capture (L1) · search/settings (L2 or …) · theme (L3 / …) · AI (L1)
          Exclusive: icons XOR overflow menu — ResizeObserver on this rail. */}
      <div
        ref={rightRailRef}
        className="v4-no-drag flex min-w-0 flex-1 items-center justify-end gap-1.5"
      >
        {/* L1: sole solid capture */}
        <Tooltip content={t("titleBar.captureTip")}>
          <button
            type="button"
            className="v4-titlebar-btn-capture"
            data-chrome-tier="l1"
            onMouseEnter={() => warmOverlay("quick-capture")}
            onClick={() => openOverlay("quick-capture")}
            aria-label={t("titleBar.capture")}
          >
            <Zap size={ICON.sm} {...stroke} className="shrink-0" />
            <span className="hidden sm:inline">{t("titleBar.capture")}</span>
          </button>
        </Tooltip>

        {/* L2: 建议 + 个人清单 — quiet icons, not solid CTAs */}
        <div className="v4-titlebar-tier-l2" data-chrome-tier="l2">
          <Tooltip content={t("titleBar.suggestTip")}>
            <button
              type="button"
              className={cn(
                "v4-titlebar-btn relative",
                suggestPanelOpen && "bg-surface-muted",
                // 语义分化：建议（涌现）用 loop 暖金；个人清单保持 accent 墨蓝
                suggestCount > 0 && "text-skill-loop",
              )}
              onClick={() => toggleSuggestSurface()}
              aria-label={t("titleBar.suggestAriaLabel")}
              aria-pressed={suggestPanelOpen}
              data-suggest-header-trigger
            >
              <Lightbulb size={ICON.sm} {...stroke} />
              <SuggestBadge />
            </button>
          </Tooltip>

          <TodoPopover open={todoOpen} onOpenChange={setTodoOpen}>
            <Tooltip content={t("titleBar.todoTip")}>
              <button
                type="button"
                className={cn("v4-titlebar-btn relative", todoOpen && "bg-surface-muted")}
                onClick={() => setTodoOpen((v) => !v)}
                aria-label={t("titleBar.todoAriaLabel")}
                aria-pressed={todoOpen}
              >
                <ListTodo size={ICON.sm} {...stroke} />
              </button>
            </Tooltip>
          </TodoPopover>
        </div>

        {/* L3: search / settings / theme (overflow when compact) */}
        <div className="v4-titlebar-cluster" data-chrome-tier="l3">
          {!compactTools ? (
            <>
              <Tooltip content={t("titleBar.searchTip")}>
                <button
                  type="button"
                  className="v4-titlebar-btn"
                  onMouseEnter={() => warmOverlay("search")}
                  onClick={() => openOverlay("search")}
                  aria-label={t("titleBar.searchAriaLabel")}
                >
                  <Search size={ICON.sm} {...stroke} />
                </button>
              </Tooltip>
              <Tooltip content={t("titleBar.settingsTip")}>
                <button
                  type="button"
                  className="v4-titlebar-btn"
                  onMouseEnter={() => warmOverlay("settings")}
                  onClick={() => emitLocal("overlay:open", { kind: "settings" })}
                  aria-label={t("titleBar.settingsAriaLabel")}
                >
                  <Settings size={ICON.sm} {...stroke} />
                </button>
              </Tooltip>
              {/* 主题切换不在标题栏常驻（低频设置行为）——设置 ⌘, / 窄屏 ⋯ 菜单可达 */}
            </>
          ) : (
            <DropdownMenu
              open={toolsOpen}
              onOpenChange={setToolsOpen}
              align="end"
              minWidth={200}
              matchTriggerWidth={false}
              panelClassName="v4-no-drag"
              trigger={
                <Tooltip content={t("titleBar.moreTip")}>
                  <button
                    type="button"
                    className={cn("v4-titlebar-btn", toolsOpen && "bg-surface-muted")}
                    aria-label={t("titleBar.moreAriaLabel")}
                    aria-haspopup="menu"
                    aria-expanded={toolsOpen}
                    data-menu-trigger
                    onClick={() => setToolsOpen((v) => !v)}
                  >
                    <MoreHorizontal size={ICON.sm} {...stroke} />
                  </button>
                </Tooltip>
              }
            >
              <DropdownItem
                onSelect={() => {
                  setToolsOpen(false);
                  warmOverlay("search");
                  openOverlay("search");
                }}
              >
                <Search size={ICON.micro} className="shrink-0 opacity-70" />
                <span className="flex-1">{t("titleBar.searchLabel")}</span>
                <kbd className="v4-kbd v4-kbd-sm">⌘P</kbd>
              </DropdownItem>
              <DropdownItem
                onSelect={() => {
                  setToolsOpen(false);
                  warmOverlay("settings");
                  emitLocal("overlay:open", { kind: "settings" });
                }}
              >
                <Settings size={ICON.micro} className="shrink-0 opacity-70" />
                <span className="flex-1">{t("titleBar.settingsLabel")}</span>
                <kbd className="v4-kbd v4-kbd-sm">⌘,</kbd>
              </DropdownItem>
              <DropdownItem
                onSelect={() => {
                  setToolsOpen(false);
                  void cycleTheme();
                }}
              >
                <span className="flex h-[1em] w-[1em] shrink-0 items-center justify-center opacity-70">
                  {themeIcon()}
                </span>
                <span className="flex-1">{t("titleBar.themeMenuItem", { label: themeLabel })}</span>
              </DropdownItem>
              <DropdownItem
                onSelect={() => {
                  setToolsOpen(false);
                  onToggleTaskPanel();
                }}
              >
                <ClipboardList size={ICON.micro} className="shrink-0 opacity-70" />
                <span className="flex-1">{taskPanelOpen ? t("titleBar.hideTaskPanel") : t("titleBar.showTaskPanel")}</span>
                <kbd className="v4-kbd v4-kbd-sm">⌘⇧J</kbd>
              </DropdownItem>
            </DropdownMenu>
          )}
          {/* Expanded rail: tasks stay out of primary icons; use AI rail or ⌘⇧J */}
          {/* Task panel: open via ⌘⇧J / command palette — icon only while open (Wave F3 thrift) */}
          {taskPanelOpen ? (
            <Tooltip content={t("titleBar.hideTaskPanel")}>
              <button
                type="button"
                className="v4-titlebar-btn"
                onClick={onToggleTaskPanel}
                aria-pressed
                data-active
                aria-label={t("titleBar.hideTaskPanel")}
              >
                <ClipboardList size={ICON.sm} {...stroke} />
              </button>
            </Tooltip>
          ) : null}
        </div>

        {/* L1: AI rail toggle — equal weight to capture, after L3 tools */}
        <Tooltip content={aiPanelOpen ? t("titleBar.hideAiPanel") : t("titleBar.showAiPanel")}>
          <button
            type="button"
            className="v4-titlebar-btn v4-titlebar-btn-ai"
            data-chrome-tier="l1"
            onClick={() => useViewStore.getState().toggleAiPanel()}
            aria-pressed={aiPanelOpen}
            data-active={aiPanelOpen}
            aria-label={aiPanelOpen ? t("titleBar.hideAiPanel") : t("titleBar.showAiPanel")}
          >
            <PanelToggleIcon side="right" open={aiPanelOpen} size={ICON.sm} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
