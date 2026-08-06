/**
 * Responsive chrome action rail — measure width, keep high-priority actions
 * visible, collapse the rest into a 「⋯」 menu (exclusive: never both).
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./cn";
import { ICON } from "./icons";
import { Tooltip } from "../components/ui/tooltip";
import {
  DropdownItem,
  DropdownMenu,
} from "../components/ui/DropdownMenu";

export type ChromeAction = {
  id: string;
  /** Visible label when expanded; always used in overflow menu */
  label: string;
  /** Tooltip (defaults to label) */
  title?: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Lower = stays visible longer (default 50) */
  priority?: number;
  /** Prefer icon-only in tight chrome (still full label in ⋯) */
  iconOnlyWhenCompact?: boolean;
  /** Primary filled style for the main CTA */
  primary?: boolean;
  /** AI action — uses accent-tinted style to highlight AI capability */
  aiAction?: boolean;
  /** Force into overflow even when space allows */
  forceOverflow?: boolean;
  /** Hide completely when true */
  hidden?: boolean;
};

export type ChromeOverflowMode = "comfortable" | "compact" | "icon";

function estimateActionWidth(a: ChromeAction, mode: ChromeOverflowMode): number {
  if (mode === "icon" || a.iconOnlyWhenCompact) return 34;
  // icon + label padding estimate
  const labelChars = Math.min((a.label || "").length, 8);
  return 28 + labelChars * 11 + (a.icon ? 14 : 0);
}

/**
 * Decide which actions stay in the open rail vs overflow menu.
 * `availableWidth` is the container content width in px.
 */
export function partitionChromeActions(
  actions: ChromeAction[],
  availableWidth: number,
  opts: { moreButtonWidth?: number; gap?: number } = {},
): { visible: ChromeAction[]; overflow: ChromeAction[]; mode: ChromeOverflowMode } {
  const gap = opts.gap ?? 6;
  const moreW = opts.moreButtonWidth ?? 32;
  const visibleCandidates = actions.filter((a) => !a.hidden);
  const forced = visibleCandidates.filter((a) => a.forceOverflow);
  const free = visibleCandidates
    .filter((a) => !a.forceOverflow)
    .slice()
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  let mode: ChromeOverflowMode = "comfortable";
  if (availableWidth < 220) mode = "icon";
  else if (availableWidth < 360) mode = "compact";

  const visible: ChromeAction[] = [];
  let used = 0;
  const reserveOverflow = free.length > 0 || forced.length > 0;

  for (const a of free) {
    const w = estimateActionWidth(a, mode);
    const needMore = reserveOverflow || free.indexOf(a) < free.length - 1 || forced.length > 0;
    const budget = availableWidth - (needMore ? moreW + gap : 0);
    if (used + w + (visible.length > 0 ? gap : 0) <= budget) {
      visible.push(a);
      used += w + (visible.length > 1 ? gap : 0);
    } else {
      // remaining free go to overflow
      const rest = free.slice(free.indexOf(a));
      return {
        visible,
        overflow: [...rest, ...forced],
        mode,
      };
    }
  }
  return { visible, overflow: forced, mode };
}

export function ChromeOverflowActions({
  actions,
  className,
  align = "end",
}: {
  actions: ChromeAction[];
  className?: string;
  align?: "start" | "end";
}) {
  const { t } = useTranslation("common");
  const railRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { visible, overflow, mode } = useMemo(
    () => partitionChromeActions(actions, width),
    [actions, width],
  );

  return (
    <div
      ref={railRef}
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        align === "end" ? "justify-end" : "justify-start",
        className,
      )}
    >
      {visible.map((a) => {
        const showLabel = mode === "comfortable" && !a.iconOnlyWhenCompact;
        const tip = a.title || a.label;
        return (
          <Tooltip key={a.id} content={tip}>
            <button
              type="button"
              disabled={a.disabled}
              onClick={a.onClick}
              aria-label={a.label}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-3xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                "disabled:opacity-45",
                a.primary
                  ? "bg-accent-color text-white hover:opacity-90"
                  : a.aiAction
                    ? "v4-ai-btn"
                    : "text-text-tertiary hover:bg-surface-muted hover:text-text-primary",
              )}
            >
              {a.icon ? <span className="shrink-0">{a.icon}</span> : null}
              {showLabel ? <span className="max-w-[6.5rem] truncate">{a.label}</span> : null}
            </button>
          </Tooltip>
        );
      })}
      {overflow.length > 0 ? (
        <DropdownMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          minWidth={180}
          matchTriggerWidth={false}
          trigger={
            <Tooltip content={t("action.more", { defaultValue: "More" })}>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
                  "text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary",
                  menuOpen && "bg-surface-muted text-text-primary",
                )}
                aria-label={t("action.more", { defaultValue: "More" })}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={ICON.xs} />
              </button>
            </Tooltip>
          }
        >
          {overflow.map((a) => (
            <DropdownItem
              key={a.id}
              disabled={a.disabled}
              onSelect={() => {
                setMenuOpen(false);
                a.onClick();
              }}
            >
              {a.icon ? <span className="shrink-0 opacity-80">{a.icon}</span> : null}
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
            </DropdownItem>
          ))}
        </DropdownMenu>
      ) : null}
    </div>
  );
}
