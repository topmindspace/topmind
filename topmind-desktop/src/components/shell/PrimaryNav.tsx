/**
 * PrimaryNav — 动态 / Inbox / 交付 (the three product destinations).
 *
 * Placement (2026-09 header lift):
 * - **Sidebar** (`variant="sidebar"`): one compact dropdown trigger on the
 *   *primary* header row, next to Profile / Search / 记一下. Destinations
 *   stay one hop from the other primary actions; the secondary row is only
 *   ViewSwitcher + tree tools.
 * - **TitleBar compact** (`variant="compact"`): icon-only chips when the sidebar
 *   is collapsed so destinations stay reachable.
 *
 * StatusBar no longer hosts PrimaryNav: that bar is status (path · AI · busy),
 * not navigation. Search is never a peer here (⌘K / ⌘P).
 * Icons stay Line-only — active state is color, not a Fill glyph.
 */
import { useState } from "react";
import {
  RiArrowDownSLine,
  RiHome4Line,
  RiInbox2Line,
  RiShareForwardLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { primaryViewSwitchKind } from "../../lib/titlebar-identity";
import { Tooltip } from "../ui/tooltip";
import { DropdownItem, DropdownMenu } from "../ui/DropdownMenu";
import type { Selection } from "../../types";

export const PRIMARY_NAV_OPTIONS = [
  {
    kind: "stream" as const,
    icon: RiHome4Line,
    labelKey: "primaryNav.stream",
    tipKey: "primaryNav.streamTipIdle",
  },
  {
    kind: "inbox" as const,
    icon: RiInbox2Line,
    labelKey: "primaryNav.inbox",
    tipKey: "primaryNav.inboxTipIdle",
  },
  {
    kind: "outputs" as const,
    icon: RiShareForwardLine,
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
  const [open, setOpen] = useState(false);

  const activeOpt = PRIMARY_NAV_OPTIONS.find((o) => o.kind === active) ?? PRIMARY_NAV_OPTIONS[0];
  const ActiveIcon = activeOpt.icon;
  const activeLabel = t(activeOpt.labelKey);

  if (compact) {
    return (
      <nav
        role="navigation"
        aria-label={t("primaryNav.ariaLabel")}
        data-primary-nav="compact"
        data-view-switcher
        className="v4-titlebar-cluster flex shrink-0 items-center gap-0.5"
      >
        {PRIMARY_NAV_OPTIONS.map((opt) => {
          const isActive = active === opt.kind;
          const Icon = opt.icon;
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
                  "v4-titlebar-btn flex h-8 min-w-8 items-center justify-center rounded-md px-1.5",
                  isActive && "data-active bg-accent-bg-faint text-accent-color",
                )}
              >
                <Icon size={ICON.sm} className="shrink-0" aria-hidden />
              </button>
            </Tooltip>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      role="navigation"
      aria-label={t("primaryNav.ariaLabel")}
      data-primary-nav="sidebar"
      data-status-primary-nav=""
      data-view-switcher
      className="min-w-0 max-w-[9.5rem]"
    >
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        minWidth={180}
        matchTriggerWidth={false}
        trigger={
          <Tooltip content={t(activeOpt.tipKey)} side="bottom">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={activeLabel}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border-subtle-dim",
                "bg-surface-muted/40 px-2 text-xs font-medium text-text-secondary",
                "transition-colors hover:bg-surface-muted/70 hover:text-text-primary",
                open && "bg-surface-muted/70 text-text-primary",
                "v4-focus-ring",
              )}
            >
              <ActiveIcon size={ICON.xs} className="shrink-0 text-accent-color" aria-hidden />
              <span className="truncate">{activeLabel}</span>
              <RiArrowDownSLine size={ICON.nano} className="ml-auto shrink-0 opacity-60" aria-hidden />
            </button>
          </Tooltip>
        }
      >
        {PRIMARY_NAV_OPTIONS.map((opt) => {
          const isActive = active === opt.kind;
          const Icon = opt.icon;
          return (
            <DropdownItem
              key={opt.kind}
              onSelect={() => {
                setOpen(false);
                select({ kind: opt.kind } as Selection);
              }}
            >
              <Icon size={ICON.xs} className={cn("shrink-0", isActive ? "text-accent-color" : "opacity-70")} />
              <span className="flex-1">{t(opt.labelKey)}</span>
              {isActive ? <span className="text-3xs text-accent-color">✓</span> : null}
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </nav>
  );
}
