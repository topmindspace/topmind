// ── ViewSwitcher — sidebar view mode dropdown ────────────────────────────
// One trigger shows the current mode (default: category / directory tree).
// Advanced modes (tags / kanban) share the same menu — no second overflow tab.
// 2026-09-16: collapsed from a 3-up segmented rail +「更多」into one menu so
// it stops crowding PrimaryNav and tree tools on the same chrome row.
import { useMemo, useState } from "react";
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiNewspaperLine,
  RiFolderOpenLine,
  RiLayoutColumnLine,
  RiListView,
  RiPriceTag3Line,
  RiTimeLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { DropdownItem, DropdownMenu } from "../ui/DropdownMenu";
import type { SidebarViewMode } from "../../types";

const ALL_MODES: SidebarViewMode[] = ["category", "stream", "timeline", "tags", "kanban"];

/** Line-only glyphs. category uses an open folder — the default directory mode. */
const VIEW_ICONS: Record<SidebarViewMode, typeof RiListView> = {
  stream: RiNewspaperLine,
  category: RiFolderOpenLine,
  timeline: RiTimeLine,
  tags: RiPriceTag3Line,
  kanban: RiLayoutColumnLine,
};

interface ViewSwitcherProps {
  active: SidebarViewMode;
  onChange: (mode: SidebarViewMode) => void;
  /** From `topmind.yaml` presentation.views.enabled — omit to show all */
  enabled?: SidebarViewMode[];
  /** Unused legacy flag — dropdown is always compact. Kept for call-site compat. */
  iconOnly?: boolean;
}

export function ViewSwitcher({ active, onChange, enabled }: ViewSwitcherProps) {
  const { t } = useTranslation("shell");
  const [open, setOpen] = useState(false);

  const modes = useMemo(() => {
    const allow = (mode: SidebarViewMode) =>
      !enabled || enabled.length === 0 || enabled.includes(mode);
    const list = ALL_MODES.filter(allow);
    // Always keep the active mode selectable even if config hid it.
    if (list.length === 0) return ALL_MODES.slice();
    if (!list.includes(active)) return [active, ...list];
    return list;
  }, [enabled, active]);

  const activeMode = modes.includes(active) ? active : (modes[0] ?? "category");
  const ActiveIcon = VIEW_ICONS[activeMode];
  const activeLabel = t(`sidebar.viewSwitcher.${activeMode}Label`);

  return (
    <div
      className="inline-flex min-w-0 max-w-full"
      role="navigation"
      aria-label={t("sidebar.viewSwitcher.ariaTablist")}
    >
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        minWidth={168}
        matchTriggerWidth={false}
        trigger={
          <Tooltip content={t("sidebar.viewSwitcher.ariaTablist")} side="bottom">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`${t("sidebar.viewSwitcher.ariaTablist")}: ${activeLabel}`}
              data-sidebar-view-switcher
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "inline-flex h-8 w-auto max-w-full min-w-0 items-center gap-1 rounded-md border border-border-subtle-dim",
                "bg-surface-muted/40 px-2 text-3xs font-medium text-text-secondary",
                "transition-colors hover:bg-surface-muted/70 hover:text-text-primary",
                open && "bg-surface-muted/70 text-text-primary",
                "v4-focus-ring",
              )}
            >
              <ActiveIcon size={ICON.xs} className="shrink-0 text-accent-color" aria-hidden />
              <span className="min-w-0 truncate">{activeLabel}</span>
              <RiArrowDownSLine size={ICON.nano} className="shrink-0 opacity-50" aria-hidden />
            </button>
          </Tooltip>
        }
      >
        {modes.map((mode) => {
          const Icon = VIEW_ICONS[mode];
          const isActive = mode === activeMode;
          return (
            <DropdownItem
              key={mode}
              icon={
                <Icon
                  size={ICON.xs}
                  className={cn(isActive ? "text-accent-color" : "opacity-70")}
                />
              }
              onSelect={() => {
                setOpen(false);
                onChange(mode);
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col items-start gap-px">
                <span className="max-w-full truncate text-3xs font-medium text-text-primary">
                  {t(`sidebar.viewSwitcher.${mode}Label`)}
                </span>
                <span className="max-w-full truncate text-3xs text-text-quaternary">
                  {t(`sidebar.viewSwitcher.${mode}Hint`)}
                </span>
              </span>
              {isActive ? (
                <RiCheckLine size={ICON.micro} className="shrink-0 text-accent-color" />
              ) : null}
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </div>
  );
}
