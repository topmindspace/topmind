/**
 * ActivityBar — the app's primary destination rail (48px, leftmost).
 *
 * Three groups (top → bottom):
 *   1. Workspace views + capture   (动态/Inbox/交付/我的情况/记一下)
 *   2. Apps                        (dropdown menu → openLaunchablePlugin)
 *   3. App chrome: focus · theme · settings
 *
 * home ≡ stream (one icon). Search lives on the Sidebar header.
 * No brand logo — the top band is a traffic-light reserve so the icon stack
 * stays clear of native macOS window buttons. One icon per concept (DESIGN §0.0.2).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiHome4Line,
  RiInbox2Line,
  RiShareForwardLine,
  RiUserLine,
  RiPencilLine,
  RiApps2Line,
  RiFocus3Line,
  RiSettingsLine,
  RiArrowRightSLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { useViewStore } from "../../stores/view-store";
import { usePluginStore } from "../../stores/plugin-store";
import { listLaunchablePlugins } from "../../lib/plugin-launcher";
import { openLaunchablePlugin, pluginReadiness } from "../../lib/apps-menu";
import { getCachedSettings } from "../../lib/settings-cache";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { DropdownMenu, DropdownItem } from "../ui/DropdownMenu";
import { ThemeMenuButton } from "./ThemeMenuButton";
import type { Selection } from "../../types";

interface ActivityItem {
  id: string;
  icon: RemixiconComponentType;
  labelKey: string;
  onSelect: () => void;
  active?: boolean;
  capture?: boolean;
}

function ActivityButton({ item }: { item: ActivityItem }) {
  const { t } = useTranslation("shell");
  return (
    <Tooltip content={t(item.labelKey as never)} side="right">
      <button
        type="button"
        className={cn(
          "v4-no-drag relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] transition-colors v4-focus-ring",
          item.active
            ? "bg-accent-container text-on-accent-container"
            : item.capture
              ? "text-accent-color hover:bg-state-hover"
              : "text-text-tertiary hover:bg-state-hover hover:text-text-primary",
        )}
        aria-label={t(item.labelKey as never)}
        aria-pressed={item.active}
        data-activity={item.id}
        onClick={item.onSelect}
      >
        <item.icon size={ICON.md} />
      </button>
    </Tooltip>
  );
}

/** Apps dropdown — launchpad menu (opens apps directly, not the AI apps tab). */
function AppsMenuButton() {
  const { t } = useTranslation("shell");
  const plugins = usePluginStore((s) => s.plugins);
  const settings = getCachedSettings();
  const [open, setOpen] = useState(false);
  const apps = useMemo(
    () => listLaunchablePlugins(plugins, settings as unknown as Record<string, unknown>),
    [plugins, settings],
  );

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
            align="start"
      minWidth={240}
      maxWidth={320}
      matchTriggerWidth={false}
      preferPlacement="right"
      trigger={
        <button
          type="button"
          className={cn(
            "v4-no-drag flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] transition-colors v4-focus-ring",
            open ? "bg-accent-container text-on-accent-container" : "text-text-tertiary hover:bg-state-hover hover:text-text-primary",
          )}
          aria-label={t("activityBar.apps")}
          aria-haspopup="menu"
          aria-expanded={open}
          data-activity="apps"
          onClick={() => setOpen((v) => !v)}
        >
          <RiApps2Line size={ICON.md} />
        </button>
      }
    >
      <div className="px-2.5 pb-1.5 pt-2 text-3xs font-medium tracking-wide text-text-quaternary">
        {t("activityBar.apps")}
      </div>
      {apps.length === 0 ? (
        <DropdownItem onSelect={() => setOpen(false)} disabled>
          {t("appsMenu.empty")}
        </DropdownItem>
      ) : (
        apps.map((p) => {
          const readiness = pluginReadiness(p.id, settings as never);
          const name = p.manifest?.name || p.id.replace(/^topmind-/, "");
          return (
            <DropdownItem
              key={p.id}
              icon={<RiExternalLinkLine size={ICON.sm} />}
              onSelect={() => {
                setOpen(false);
                if (readiness.needsConfig && readiness.settingsTopicId) {
                  useViewStore.getState().openOverlay("settings", { topicId: readiness.settingsTopicId });
                  return;
                }
                openLaunchablePlugin(p.id);
              }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 truncate text-xs text-text-primary">{name}</span>
                {readiness.needsConfig ? (
                  <span className="shrink-0 text-4xs text-warning">{t("appsMenu.needsConfig")}</span>
                ) : null}
              </span>
            </DropdownItem>
          );
        })
      )}
    </DropdownMenu>
  );
}

export function ActivityBar({ onCapture }: { onCapture?: () => void }) {
  const { t } = useTranslation("shell");
  const selection = useViewStore((s) => s.selection);
  const select = useViewStore((s) => s.select);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const focusMode = useViewStore((s) => s.focusMode);
  const toggleFocusMode = useViewStore((s) => s.toggleFocusMode);

  const dest = (kind: Selection["kind"]) => () => select({ kind } as Selection);
  // home ≡ stream — one icon on the rail.
  const streamActive = selection.kind === "stream" || selection.kind === "home";

  /** Group 1 — workspace views + capture */
  const viewItems: ActivityItem[] = [
    {
      id: "stream",
      icon: RiHome4Line,
      labelKey: "primaryNav.workspace",
      onSelect: dest("stream"),
      active: streamActive,
    },
    {
      id: "inbox",
      icon: RiInbox2Line,
      labelKey: "primaryNav.inbox",
      onSelect: dest("inbox"),
      active: selection.kind === "inbox",
    },
    {
      id: "outputs",
      icon: RiShareForwardLine,
      labelKey: "primaryNav.outputs",
      onSelect: dest("outputs"),
      active: selection.kind === "outputs",
    },
    {
      id: "memory",
      icon: RiUserLine,
      labelKey: "primaryNav.profile",
      onSelect: dest("memory"),
      active: selection.kind === "memory",
    },
    {
      id: "capture",
      icon: RiPencilLine,
      labelKey: "activityBar.capture",
      onSelect: () => (onCapture ? onCapture() : openOverlay("quick-capture")),
      capture: true,
    },
  ];

  /** Group 3 — app chrome (focus / theme menu / settings) */
  const focusItem: ActivityItem = {
    id: "focus",
    icon: RiFocus3Line,
    labelKey: "activityBar.focus",
    onSelect: toggleFocusMode,
    active: focusMode,
  };
  const settingsItem: ActivityItem = {
    id: "settings",
    icon: RiSettingsLine,
    labelKey: "activityBar.settings",
    onSelect: () => openOverlay("settings"),
  };

  return (
    <nav
      className="v4-activity-bar flex h-full w-[48px] shrink-0 flex-col items-center gap-1 border-r border-border-subtle-dim bg-app-chrome py-2"
      data-activity-bar
      aria-label={t("activityBar.ariaLabel")}
    >
      {/* Traffic-light reserve — same 36px band the retired logo occupied.
          Keeps the icon stack clear of native macOS window buttons. Not a
          brand slot; stays put so icons never jump under the traffic lights. */}
      <div
        className="mb-1 h-8 w-full shrink-0"
        data-activity-traffic-reserve
        aria-hidden
      />

      {/* Group 1 — workspace views */}
      <div className="flex flex-col items-center gap-1" data-activity-group="views">
        {viewItems.map((item) => (
          <ActivityButton key={item.id} item={item} />
        ))}
      </div>

      <div className="my-1 h-px w-6 bg-border-subtle-dim" aria-hidden />

      {/* Group 2 — apps (menu) */}
      <div className="flex flex-col items-center gap-1" data-activity-group="apps">
        <AppsMenuButton />
      </div>

      <div className="flex-1" aria-hidden />

      {/* Group 3 — app chrome (theme menu sits between focus and settings) */}
      <div className="flex flex-col items-center gap-1" data-activity-group="chrome">
        <ActivityButton item={focusItem} />
        <ThemeMenuButton />
        <ActivityButton item={settingsItem} />
      </div>
    </nav>
  );
}
