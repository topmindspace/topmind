/**
 * PrimaryNav — 动态 / Inbox / 交付 (the three product destinations).
 *
 * Placement (2026-09-16 redesign):
 * - **Sidebar destinations row** (`variant="sidebar"`): full-width segmented
 *   control under the sidebar main header. Destinations are content IA — they
 *   belong next to the tree, not in a 26px status strip. Larger hit targets,
 *   always visible while browsing.
 * - **TitleBar compact** (`variant="compact"`): icon-only, mounted when the
 *   sidebar is collapsed so destinations stay reachable (the reason they once
 *   lived in StatusBar).
 *
 * StatusBar no longer hosts PrimaryNav: that bar is status (path · AI · busy),
 * not navigation. Search is never a peer here (⌘K / ⌘P).
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

type PrimaryNavVariant = "sidebar" | "compact";

export function PrimaryNav({ variant = "sidebar" }: { variant?: PrimaryNavVariant }) {
  const { t } = useTranslation("shell");
  const selection = useViewStore((s) => s.selection);
  const select = useViewStore((s) => s.select);
  const active = primaryViewSwitchKind(selection.kind);
  const compact = variant === "compact";

  return (
    <nav
      role="navigation"
      aria-label={t("primaryNav.ariaLabel")}
      data-primary-nav={variant}
      data-status-primary-nav={compact ? undefined : ""}
      data-view-switcher
      className={cn(
        compact
          ? "v4-titlebar-cluster flex shrink-0 items-center gap-0.5"
          : "flex w-full shrink-0 items-center gap-0.5 rounded-lg border border-border-subtle-dim bg-surface-muted/40 p-0.5",
      )}
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
                compact
                  ? // TitleBar fallback: icon-only chrome buttons (32px hit).
                    cn(
                      "v4-titlebar-btn flex h-8 min-w-8 items-center justify-center rounded-md px-1.5",
                      isActive && "data-active bg-accent-bg-faint text-accent-color",
                    )
                  : // Sidebar destinations: equal-width segmented tabs with labels.
                    "flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors v4-focus-ring",
                !compact &&
                  (isActive
                    ? "bg-surface-elevated text-text-primary shadow-[var(--shadow-card)]"
                    : "text-text-tertiary hover:bg-surface-muted/60 hover:text-text-secondary"),
                !compact && "v4-focus-ring",
              )}
            >
              <Icon size={compact ? ICON.sm : ICON.xs} className="shrink-0" aria-hidden />
              {!compact && <span className="truncate">{label}</span>}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
