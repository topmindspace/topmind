/**
 * Persistent PrimaryNav — 动态 / Inbox / 交付.
 *
 * Lives in the StatusBar so it does not compete with TitleBar identity
 * (breadcrumbs change with the open note) and stays reachable in every view.
 */
import {
  RiHome4Fill,
  RiHome4Line,
  RiInbox2Fill,
  RiInbox2Line,
  RiShareForwardFill,
  RiShareForwardLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { primaryViewSwitchKind } from "../../lib/titlebar-identity";
import { Tooltip } from "../ui/tooltip";
import type { Selection } from "../../types";

export const PRIMARY_NAV_OPTIONS = [
  {
    kind: "stream" as const,
    icon: RiHome4Line,
    iconActive: RiHome4Fill,
    labelKey: "primaryNav.stream",
    tipKey: "primaryNav.streamTipIdle",
  },
  {
    kind: "inbox" as const,
    icon: RiInbox2Line,
    iconActive: RiInbox2Fill,
    labelKey: "primaryNav.inbox",
    tipKey: "primaryNav.inboxTipIdle",
  },
  {
    kind: "outputs" as const,
    icon: RiShareForwardLine,
    iconActive: RiShareForwardFill,
    labelKey: "primaryNav.outputs",
    tipKey: "primaryNav.outputsTipIdle",
  },
] as const;

export function PrimaryNav() {
  const { t } = useTranslation("shell");
  const selection = useViewStore((s) => s.selection);
  const select = useViewStore((s) => s.select);
  const active = primaryViewSwitchKind(selection.kind);

  return (
    <nav
      role="navigation"
      aria-label={t("primaryNav.ariaLabel")}
      data-status-primary-nav
      data-view-switcher
      className="flex shrink-0 items-center gap-1.5"
    >
      {PRIMARY_NAV_OPTIONS.map((opt) => {
        const isActive = active === opt.kind;
        const Icon = isActive ? opt.iconActive : opt.icon;
        const label = t(opt.labelKey);
        return (
          <Tooltip key={opt.kind} content={t(opt.tipKey)}>
            <button
              type="button"
              data-nav-kind={opt.kind}
              aria-current={isActive ? "page" : undefined}
              aria-label={label}
              onClick={() => select({ kind: opt.kind } as Selection)}
              className={cn(
                // Wide, evenly sized hit targets — the status bar is a small
                // strip, so width (not height) is what makes these easy to hit.
                "inline-flex h-6 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-md px-3 text-3xs font-medium transition-colors v4-focus-ring",
                isActive
                  ? "bg-accent-bg-subtle text-accent-color"
                  : "text-text-quaternary hover:bg-surface-muted hover:text-text-secondary",
              )}
            >
              <Icon size={ICON.xs} className="shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
