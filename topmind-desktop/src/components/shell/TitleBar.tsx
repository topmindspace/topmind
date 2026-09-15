/**
 * Center-column chrome — context-driven product header.
 *
 * 2026-09 v4 redesign:
 * - Sidebar header has Profile + Search + 记一下.
 * - TitleBar left: Toggle + history + clickable breadcrumb + stats.
 * - PrimaryNav (动态 / Inbox / 交付) lives in the sidebar destinations row;
 *   when the sidebar is collapsed, compact icon PrimaryNav mounts here so
 *   destinations stay reachable.
 * - TitleBar right: dynamic injected actions + AI panel toggle.
 * - Three-column headers share `.v4-column-chrome` (44px).
 * - OS chrome (Windows menu strip + caption reserve) lives in OsChromeStrip
 *   above the workbench — never inside this product header.
 */
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from "@remixicon/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/cn";
import { useTitleBarChromeLive } from "../../lib/titlebar-chrome";
import { notifyChromeSlots } from "../../lib/chrome-portal";
import {
  resolveTitleBarIdentity,
  type TitleBarIdentityLabels,
} from "../../lib/titlebar-identity";

import { Tooltip } from "../ui/tooltip";
import { PanelToggleIcon } from "../ui/PanelToggleIcon";
import { PrimaryNav } from "./PrimaryNav";
import { ICON } from "../../lib/icons";
import { isMacOS } from "../../lib/platform";

interface TitleBarProps {
  workspaceRoot: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  macPad?: boolean;
}

export function useTitleBarIdentityLabels(): TitleBarIdentityLabels {
  const { t } = useTranslation(["shell", "workspace"]);
  return useMemo(
    () => ({
      stream: t("shell:primaryNav.stream"),
      inbox: t("workspace:inbox.title", { defaultValue: t("shell:primaryNav.inbox") }),
      outputs: t("workspace:outputsView.title", { defaultValue: t("shell:primaryNav.outputs") }),
      memory: t("shell:sidebar.myProfile"),
      archive: t("workspace:archiveView.title"),
    }),
    [t],
  );
}

export function TitleBar({ workspaceRoot: _workspaceRoot, sidebarCollapsed, onToggleSidebar, macPad = false }: TitleBarProps) {
  void _workspaceRoot;
  const trafficMac = Boolean(macPad && isMacOS);
  const { t } = useTranslation(["shell", "workspace"]);
  const back = useViewStore((s) => s.back);
  const forward = useViewStore((s) => s.forward);
  const canGoBack = useViewStore((s) => s.historyIndex > 0);
  const canGoForward = useViewStore((s) => s.historyIndex < s.history.length - 1);
  const focusMode = useViewStore((s) => s.focusMode);
  const setFocusMode = useViewStore((s) => s.setFocusMode);
  const aiPanelOpen = useViewStore((s) => s.aiPanelOpen);
  const selection = useViewStore((s) => s.selection);
  const select = useViewStore((s) => s.select);

  const labels = useTitleBarIdentityLabels();
  const live = useTitleBarChromeLive();
  const { crumbs, title, stats } = resolveTitleBarIdentity(selection, labels, live);

  return (
    <header
      data-canvas-chrome
      data-column-chrome="center"
      className={cn(
        "v4-column-chrome v4-drag relative justify-between gap-2 text-text-secondary select-none",
      )}
    >
      {focusMode ? (
        <div className={cn("flex min-w-0 items-center gap-1.5", trafficMac && "v4-mac-titlebar-pad")}>
          {/* Focus mode quietens the canvas. On Windows the OS chrome strip stays
              mounted above the workbench, so the menu remains reachable without
              parking OS chrome inside this product header. */}
          <span className="text-xs font-semibold tracking-tight text-text-primary">{t("titleBar.focusMode")}</span>
        </div>
      ) : (
      <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", trafficMac && "v4-mac-titlebar-pad")}>
        {/* Product chrome only. Windows menu + caption live in OsChromeStrip. */}
        <div className="v4-titlebar-cluster flex items-center gap-0.5">
          <Tooltip content={sidebarCollapsed ? t("titleBar.showSidebar") : t("titleBar.hideSidebar")}>
            <button
              type="button"
              className="v4-titlebar-btn v4-titlebar-panel-toggle"
              onClick={onToggleSidebar}
              aria-pressed={!sidebarCollapsed}
              data-active={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? t("titleBar.showSidebar") : t("titleBar.hideSidebar")}
            >
              <PanelToggleIcon side="left" open={!sidebarCollapsed} size={ICON.sm} />
            </button>
          </Tooltip>
          {/* History nav */}
          <Tooltip content={t("titleBar.back")}>
            <button type="button" className="v4-titlebar-btn" onClick={back} disabled={!canGoBack} aria-label={t("titleBar.backAriaLabel")}>
              <RiArrowLeftSLine size={ICON.sm} />
            </button>
          </Tooltip>
          <Tooltip content={t("titleBar.forward")}>
            <button type="button" className="v4-titlebar-btn" onClick={forward} disabled={!canGoForward} aria-label={t("titleBar.forwardAriaLabel")}>
              <RiArrowRightSLine size={ICON.sm} />
            </button>
          </Tooltip>
        </div>

        {/* Collapsed-sidebar reach: destinations stay on the chrome row. */}
        {sidebarCollapsed && !focusMode ? <PrimaryNav variant="compact" /> : null}

        {/* Breadcrumb + title + stats — first crumb keeps a longer readable cap. */}
        {title ? (
          <div className="v4-no-drag flex min-w-0 items-center gap-1" data-breadcrumb-title>
            {crumbs.length > 0 ? (
              <>
                {crumbs.map((c, i) => (
                  <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
                    {c.target ? (
                      <button
                        type="button"
                        data-breadcrumb-crumb
                        data-breadcrumb-index={i}
                        onClick={() => select(c.target!)}
                        title={c.label}
                        className={cn(
                          "truncate text-xs text-text-tertiary transition-colors hover:text-text-primary",
                          i === 0 ? "max-w-36 shrink-0" : "max-w-28",
                        )}
                      >
                        {c.label}
                      </button>
                    ) : (
                      <span
                        title={c.label}
                        data-breadcrumb-index={i}
                        className={cn(
                          "truncate text-xs text-text-tertiary",
                          i === 0 ? "max-w-36 shrink-0" : "max-w-28",
                        )}
                      >
                        {c.label}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-text-quaternary/80" aria-hidden>/</span>
                  </span>
                ))}
              </>
            ) : null}
            <span className="truncate text-xs font-semibold tracking-tight text-text-primary" data-page-title title={title}>
              {title}
            </span>
            {stats ? (
              <span className="ml-1 min-w-0 truncate text-3xs text-text-tertiary" data-titlebar-stats title={stats}>
                {stats}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      )}

      {/* Slot stays mounted in focus mode (hidden) so portals are not left on a detached node. */}
      <div
        className={cn(
          "flex min-w-0 max-w-[min(52%,28rem)] items-center justify-end gap-1.5",
          focusMode && "hidden",
        )}
      >
        <div
          className="v4-no-drag flex min-w-0 items-center justify-end gap-1"
          data-titlebar-actions-slot
          ref={() => {
            notifyChromeSlots();
          }}
        />
        {!focusMode ? (
          <Tooltip content={aiPanelOpen ? t("titleBar.hideAiPanel") : t("titleBar.showAiPanel")}>
            <button
              type="button"
              className="v4-titlebar-btn v4-titlebar-btn-ai v4-titlebar-panel-toggle"
              data-chrome-tier="l1"
              onClick={() => useViewStore.getState().toggleAiPanel()}
              aria-pressed={aiPanelOpen}
              data-active={aiPanelOpen}
              aria-label={aiPanelOpen ? t("titleBar.hideAiPanel") : t("titleBar.showAiPanel")}
            >
              <PanelToggleIcon side="right" open={aiPanelOpen} size={ICON.sm} />
            </button>
          </Tooltip>
        ) : null}
      </div>

      {focusMode ? (
        <div className="flex items-center gap-1.5">
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
      ) : null}
    </header>
  );
}
