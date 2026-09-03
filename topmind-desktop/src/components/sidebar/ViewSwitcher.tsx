// ── ViewSwitcher — segmented sidebar view modes ──────────────────────────
// Primary rail: stream / category / timeline (IA thrift).
// Advanced (tags / kanban): 「更多」overflow — DESIGN §0.0 高级折叠.
// Sliding thumb indicator + icon-only when rail is too narrow for labels.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  RiBroadcastLine,
  RiLayoutColumnLine,
  RiListView,
  RiMoreLine,
  RiPriceTag3Line,
  RiTimeLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { DropdownItem, DropdownMenu } from "../ui/DropdownMenu";
import type { SidebarViewMode } from "../../types";

const PRIMARY_MODES: SidebarViewMode[] = ["stream", "category", "timeline"];
const ADVANCED_MODES: SidebarViewMode[] = ["tags", "kanban"];
const VIEW_ICONS: Record<SidebarViewMode, typeof RiListView> = {
  stream: RiBroadcastLine,
  category: RiListView,
  timeline: RiTimeLine,
  tags: RiPriceTag3Line,
  kanban: RiLayoutColumnLine,
};

/** Below this width per tab (approx), hide text labels. */
const LABEL_MIN_TAB_PX = 56;

interface ViewSwitcherProps {
  active: SidebarViewMode;
  onChange: (mode: SidebarViewMode) => void;
  /** From `topmind.yaml` presentation.views.enabled — omit to show all */
  enabled?: SidebarViewMode[];
}

interface ThumbRect {
  left: number;
  width: number;
  ready: boolean;
}

export function ViewSwitcher({ active, onChange, enabled }: ViewSwitcherProps) {
  const { t } = useTranslation("shell");
  const [moreOpen, setMoreOpen] = useState(false);

  // Memoize tabs so the array reference is stable across renders.
  const { primaryTabs, advancedTabs, railTabs } = useMemo(() => {
    const allow = (mode: SidebarViewMode) =>
      !enabled || enabled.length === 0 || enabled.includes(mode);

    const primaryTabs = PRIMARY_MODES.filter(allow).map((mode) => ({
      mode,
      icon: VIEW_ICONS[mode],
      label: t(`sidebar.viewSwitcher.${mode}Label`),
      hint: t(`sidebar.viewSwitcher.${mode}Hint`),
    }));
    const advancedTabs = ADVANCED_MODES.filter(allow).map((mode) => ({
      mode,
      icon: VIEW_ICONS[mode],
      label: t(`sidebar.viewSwitcher.${mode}Label`),
      hint: t(`sidebar.viewSwitcher.${mode}Hint`),
    }));

    // If config only enables advanced modes, surface them on the rail.
    let railTabs = primaryTabs;
    if (railTabs.length === 0 && advancedTabs.length > 0) {
      railTabs = advancedTabs;
    } else if (ADVANCED_MODES.includes(active) && advancedTabs.some((x) => x.mode === active)) {
      // Active advanced mode joins the rail so the thumb + selection stay visible.
      const activeAdv = advancedTabs.find((x) => x.mode === active)!;
      if (!railTabs.some((x) => x.mode === active)) {
        railTabs = [...railTabs, activeAdv];
      }
    }

    // Fallback: nothing filtered in → show all primary at least
    if (railTabs.length === 0) {
      railTabs = PRIMARY_MODES.map((mode) => ({
        mode,
        icon: VIEW_ICONS[mode],
        label: t(`sidebar.viewSwitcher.${mode}Label`),
        hint: t(`sidebar.viewSwitcher.${mode}Hint`),
      }));
    }

    return { primaryTabs, advancedTabs, railTabs };
  }, [t, enabled, active]);

  const showMore = advancedTabs.length > 0 && primaryTabs.length > 0;
  const advancedActive = ADVANCED_MODES.includes(active);

  const railRef = useRef<HTMLDivElement>(null);
  const [iconOnly, setIconOnly] = useState(false);
  const [thumb, setThumb] = useState<ThumbRect>({ left: 0, width: 0, ready: false });

  const measureThumb = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const idx = Math.max(0, railTabs.findIndex((tab) => tab.mode === active));
    const el = rail.querySelector<HTMLButtonElement>(
      `[data-tab-index="${idx}"]`,
    );
    if (!el) return;
    const railRect = rail.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const left = Math.round(elRect.left - railRect.left);
    const width = Math.round(elRect.width);
    setThumb((prev) => {
      if (prev.ready && prev.left === left && prev.width === width) return prev;
      return { left, width, ready: true };
    });
  }, [active, railTabs]);

  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      // +1 slot when more button present
      const n = Math.max(railTabs.length + (showMore ? 1 : 0), 1);
      setIconOnly(w / n < LABEL_MIN_TAB_PX);
      requestAnimationFrame(measureThumb);
    });
    ro.observe(el);
    const n = Math.max(railTabs.length + (showMore ? 1 : 0), 1);
    setIconOnly(el.clientWidth / n < LABEL_MIN_TAB_PX);
    return () => ro.disconnect();
  }, [railTabs.length, showMore, measureThumb]);

  useLayoutEffect(() => {
    measureThumb();
  }, [measureThumb, iconOnly]);

  return (
    <div
      className="min-w-0 flex-1 px-1 py-1"
      role="tablist"
      aria-label={t("sidebar.viewSwitcher.ariaTablist")}
    >
      <div ref={railRef} className="v4-segmented">
        <span
          className="v4-segmented-thumb"
          aria-hidden
          data-ready={thumb.ready ? "true" : "false"}
          style={
            thumb.ready
              ? { transform: `translateX(${thumb.left}px)`, width: thumb.width }
              : { opacity: 0, width: 0 }
          }
        />
        {railTabs.map((v, i) => {
          const isActive = active === v.mode;
          return (
            <Tooltip key={v.mode} content={`${v.label} · ${v.hint}`} side="bottom">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={v.label}
                data-active={isActive}
                data-tab-index={i}
                data-icon-only={iconOnly ? "true" : undefined}
                onClick={() => onChange(v.mode)}
                className={cn("v4-segmented-item", isActive && "text-text-primary")}
              >
                <v.icon
                  size={ICON.sm}
                  aria-hidden
                  className={cn(isActive ? "text-accent-color" : "opacity-80")}
                />
                {!iconOnly ? <span className="truncate">{v.label}</span> : null}
              </button>
            </Tooltip>
          );
        })}
        {showMore ? (
          <DropdownMenu
            open={moreOpen}
            onOpenChange={setMoreOpen}
            align="end"
            minWidth={160}
            matchTriggerWidth={false}
            trigger={
              <Tooltip
                content={`${t("sidebar.viewSwitcher.moreLabel")} · ${t("sidebar.viewSwitcher.moreHint")}`}
                side="bottom"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={advancedActive && !railTabs.some((x) => x.mode === active)}
                  aria-label={t("sidebar.viewSwitcher.moreLabel")}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  data-active={advancedActive && !railTabs.some((x) => x.mode === active) ? "true" : undefined}
                  data-icon-only={iconOnly ? "true" : undefined}
                  className={cn(
                    "v4-segmented-item",
                    (moreOpen || (advancedActive && !railTabs.some((x) => x.mode === active))) &&
                      "text-text-primary",
                  )}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  <RiMoreLine
                    size={ICON.sm}
                    aria-hidden
                    className={cn(
                      advancedActive || moreOpen ? "text-accent-color" : "opacity-80",
                    )}
                  />
                  {!iconOnly ? (
                    <span className="truncate">{t("sidebar.viewSwitcher.moreLabel")}</span>
                  ) : null}
                </button>
              </Tooltip>
            }
          >
            {advancedTabs.map((v) => (
              <DropdownItem
                key={v.mode}
                onSelect={() => {
                  setMoreOpen(false);
                  onChange(v.mode);
                }}
              >
                <v.icon size={ICON.xs} className="shrink-0 opacity-70" />
                <span className="flex-1">{v.label}</span>
                {active === v.mode ? (
                  <span className="text-3xs text-accent-color">✓</span>
                ) : null}
              </DropdownItem>
            ))}
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
