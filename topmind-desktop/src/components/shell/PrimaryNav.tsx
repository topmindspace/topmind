/**
 * PrimaryNav — workspace home · 动态 / Inbox / 交付.
 *
 * One icon button on the sidebar header row, the same 32px box as
 * Profile / Search / 记一下. The menu lists 工作区 · 动态 · Inbox · 交付.
 * Home is the open-workspace canvas, not a fourth product concept, and it does
 * uses the home glyph (`RiHome4Line`). 动态 uses `RiNewspaperLine`.
 * Compact icon chips mount on the TitleBar only when the sidebar is collapsed.
 * StatusBar does not host this control. Search stays ⌘K / ⌘P.
 * Icons stay Line-only — active state is color, not a Fill glyph.
 */
import { useState } from "react";
import {
  RiCheckLine,
  RiHome4Line,
  RiInbox2Line,
  RiNewspaperLine,
  RiShareForwardLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { destinationSwitchKind } from "../../lib/titlebar-identity";
import { Tooltip } from "../ui/tooltip";
import { DropdownItem, DropdownMenu } from "../ui/DropdownMenu";
import type { Selection } from "../../types";

export const PRIMARY_NAV_OPTIONS = [
  {
    kind: "home" as const,
    icon: RiHome4Line,
    labelKey: "primaryNav.home",
    tipKey: "primaryNav.homeTip",
  },
  {
    kind: "stream" as const,
    icon: RiNewspaperLine,
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
  const active = destinationSwitchKind(selection.kind);
  const compact = variant === "compact";
  const [open, setOpen] = useState(false);

  const activeOpt = PRIMARY_NAV_OPTIONS.find((o) => o.kind === active) ?? PRIMARY_NAV_OPTIONS[0];
  const ActiveIcon = activeOpt.icon;
  const activeLabel = t(activeOpt.labelKey);
  const activeTip = t(activeOpt.tipKey);

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
                  isActive && "data-active bg-accent-container text-on-accent-container",
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
      className="shrink-0"
    >
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        minWidth={180}
        matchTriggerWidth={false}
        trigger={
          <Tooltip content={`${activeLabel} · ${activeTip}`} side="bottom">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={activeLabel}
              data-sidebar-destination={active}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "v4-icon-btn v4-sidebar-chrome-btn rounded-md text-accent-color v4-focus-ring",
                open && "bg-surface-hover text-text-primary",
              )}
            >
              <ActiveIcon size={ICON.sm} className="shrink-0" aria-hidden />
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
              icon={
                <Icon
                  size={ICON.xs}
                  className={isActive ? "text-accent-color" : "opacity-70"}
                />
              }
              onSelect={() => {
                setOpen(false);
                select({ kind: opt.kind } as Selection);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{t(opt.labelKey)}</span>
              {isActive ? (
                <RiCheckLine size={ICON.micro} className="shrink-0 text-accent-color" />
              ) : null}
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </nav>
  );
}
