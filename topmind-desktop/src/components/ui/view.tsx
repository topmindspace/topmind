/**
 * Shared view primitives — page scaffolding for workspace views.
 *
 * Token contract (see tokens.css) — Design System 2.0 / long-read:
 *   text-5xs 10px  — kbd glyphs only
 *   text-2xs 11px  — muted meta (no sentences)
 *   text-3xs 12px  — MetaText, labels, badges (label floor)
 *   text-xs  13px  — form controls + content floor
 *   text-sm  14px  — UI body, list primary
 *   text-base 15px — reading body
 *   text-lg  16px  — panel titles
 *   text-3xl 24px  — content hero titles (ViewHero)
 */
import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAlignJustify,
  RiErrorWarningLine,
  RiGalleryView2,
  RiLoader4Line,
} from "@remixicon/react";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import type { FeedLayout } from "../../types";
import { Chip } from "./Chip";
import { Tooltip } from "./tooltip";

const CollectionLayoutContext = createContext<FeedLayout>("list");

export function useCollectionLayout(): FeedLayout {
  return useContext(CollectionLayoutContext);
}

/**
 * ViewHero — Muse content-page register: large quiet title + optional lede.
 *
 * Identity and product actions still live in TitleBar; this is the content
 * surface's own breathing header (no command bar, no second nav).
 */
export function ViewHero({
  title,
  subtitle,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-[var(--density-content-section)]", className)} data-view-hero>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary break-words">{title}</h1>
          {subtitle ? (
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-text-tertiary">
              {subtitle}
            </p>
          ) : null}
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-3xs text-text-quaternary">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Centered content column with density rhythm. */
export function ViewContainer({
  children,
  className,
  variant = "page",
}: {
  children: ReactNode;
  className?: string;
  /** `feed` = stream / 我的情况 reading column (header + posts share --feed-column-max). */
  variant?: "page" | "feed";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        variant === "feed"
          ? "max-w-[min(var(--feed-column-max,72rem),100%)]"
          : "max-w-[min(var(--content-max-width-dashboard,72rem),100%)]",
        "px-[var(--density-page-x,28px)] py-[var(--density-page-y,24px)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page header: accent icon + title, optional subtitle + actions. */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-4 sm:mb-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span className="v4-icon-chip-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] opacity-90">
              {icon}
            </span>
          ) : null}
          {/* Content-page titles use ViewHero (24px). PageHeader stays for panels. */}
          <h1 className="truncate text-xl font-semibold tracking-tight text-text-primary">{title}</h1>
        </div>
        {actions ? (
          <div className="flex min-w-0 max-w-[min(58%,24rem)] shrink items-center justify-end gap-1.5 sm:max-w-[28rem]">
            {actions}
          </div>
        ) : null}
      </div>
      {subtitle ? (
        <p className={cn("mt-1 max-w-prose text-xs leading-relaxed text-text-tertiary", icon && "pl-9")}>
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

/** Section label with optional count + trailing actions. */
export function SectionHeader({
  icon,
  label,
  count,
  actions,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: number;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-1.5 flex items-center justify-between gap-2", className)}>
      <h2 className="flex items-center gap-1.5 text-3xs font-medium tracking-wide text-text-tertiary">
        {icon ? <span className="opacity-70">{icon}</span> : null}
        <span>{label}</span>
        {typeof count === "number" ? (
          <span className="rounded-[var(--radius-xs)] bg-surface-wash-30 px-1.5 py-px text-3xs tabular-nums text-text-quaternary">
            {count}
          </span>
        ) : null}
      </h2>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/**
 * Empty state — calm soft panel (not marketing dashed box / loud gradient).
 * Contract: icon chip + title + optional hint + **one primary action** (+ optional secondary).
 * compact: sidebar / dense rails
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  /** Prefer a single primary Button; wrap multiple only when secondary is clearly subordinate */
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center bg-surface text-center",
        "shadow-[var(--shadow-card)]",
        compact
          ? "rounded-[var(--radius-card)] px-3 py-5"
          : "rounded-[var(--radius-card)] px-6 py-10",
        className,
      )}
      role="status"
    >
      {icon ? (
        <div
          className={cn(
            "mb-3 flex items-center justify-center rounded-full bg-surface-wash-30 text-text-tertiary",
            compact ? "h-9 w-9" : "h-12 w-12",
          )}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div
        className={cn(
          "font-medium tracking-tight text-text-primary",
          compact ? "text-xs" : "text-base",
        )}
      >
        {title}
      </div>
      {hint ? (
        <div
          className={cn(
            "mt-1.5 leading-relaxed text-text-tertiary",
            compact ? "max-w-[14rem] text-xs" : "max-w-sm text-sm",
          )}
        >
          {hint}
        </div>
      ) : null}
      {action ? (
        <div className={cn("flex flex-wrap justify-center gap-2", compact ? "mt-2.5" : "mt-4")}>
          {action}
        </div>
      ) : null}
    </div>
  );
}

/** Compact filter / mode chip — thin Chip wrapper (DS 4.0.5 single language). */
export function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  label: ReactNode;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <Chip
      tone={active ? "accent" : "neutral"}
      active={Boolean(active)}
      size="md"
      onClick={onClick}
      aria-pressed={Boolean(active)}
      data-filter-chip
      data-filter-chip-active={active ? "true" : undefined}
      className="max-w-full"
    >
      <span className="min-w-0 truncate">{label}</span>
      {typeof count === "number" ? (
        <span className="ml-1 shrink-0 tabular-nums opacity-70" aria-hidden>
          {count}
        </span>
      ) : null}
    </Chip>
  );
}

/** Shared loading state — quiet spinner chip (Muse calm register). */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation("common");
  const displayLabel = label ?? t("action.loading");
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-text-tertiary",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-wash-30">
        <RiLoader4Line size={ICON.sm} className="animate-spin text-text-tertiary" />
      </span>
      <span>{displayLabel}</span>
    </div>
  );
}

/** Shared error state with optional retry — soft card, not a red alert bar. */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation("common");
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-[var(--radius-card)] bg-status-error-bg px-4 py-3 text-sm text-error shadow-[var(--shadow-card)]",
        className,
      )}
      role="alert"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface/60">
        <RiErrorWarningLine size={ICON.sm} className="shrink-0" />
      </span>
      <span className="min-w-0 flex-1 text-xs leading-relaxed">{t("action.loadFailed", { message })}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-state-hover hover:text-text-primary"
        >
          {t("action.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** Inline metadata (relative time · size). */
export function MetaText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-mono text-3xs tabular-nums text-text-tertiary", className)}>
      {children}
    </span>
  );
}

/**
 * RowActions — hover/focus-reveal action cluster (Muse message-actions register).
 *
 * Parent row should carry `group/row`. Touch devices keep actions visible.
 * Keep the cluster to icon buttons; never put a solid primary here.
 */
export function RowActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        "pointer-events-none opacity-0 transition-opacity",
        "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
        "focus-within:pointer-events-auto focus-within:opacity-100",
        "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Canonical className for selectable list rows — fill highlight, no wireframe borders. */
export function listRowClass(active?: boolean, className?: string) {
  return cn(
    "v4-list-virtual flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-transparent px-2.5 py-2 text-sm",
    "transition-[background-color,box-shadow,color] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
    active
      ? "bg-surface-selected text-text-primary font-medium"
      : "text-text-secondary hover:bg-state-hover hover:text-text-primary active:bg-state-pressed",
    className,
  );
}

/** Vertical list wrapper. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  // No stagger-children here — long lists stay scroll-smooth without entrance cascade
  return <ul className={cn("m-0 list-none space-y-0.5 p-0", className)}>{children}</ul>;
}

/** Unified file/topic list row. */
export function FileRow({
  icon,
  label,
  secondary,
  meta,
  active,
  onClick,
  onContextMenu,
  actions,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  actions?: ReactNode;
  className?: string;
}) {
  const layout = useCollectionLayout();
  const card = layout === "card";
  return (
    <li
      data-collection-item
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={
        card
          ? cn(
              "v4-row-focus group/row flex items-start justify-between gap-2 text-sm",
              "transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-default)]",
              onClick && "cursor-pointer v4-focus-ring",
              active && "ring-1 ring-inset ring-accent-border-subtle",
              className,
            )
          : listRowClass(
              active,
              cn(
                "v4-row-focus group/row v4-list-virtual",
                onClick && "cursor-pointer v4-focus-ring",
                className,
              ),
            )
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? <span className="shrink-0 text-text-tertiary opacity-80">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          {/* Content titles: regular weight reads calmer in long lists */}
          <div className="truncate text-sm font-normal leading-snug text-text-primary">{label}</div>
          {secondary ? (
            <div className="mt-px truncate font-mono text-3xs text-text-quaternary">{secondary}</div>
          ) : null}
        </div>
      </div>
      {meta ? <div className="flex shrink-0 items-center gap-1.5 opacity-90">{meta}</div> : null}
      {actions ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover/row:opacity-100">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

/** Shared reading column for compose + list + cards (single-column feed). */
export function FeedColumn({
  children,
  className,
  stream,
  collection,
}: {
  children: ReactNode;
  className?: string;
  stream?: boolean;
  collection?: boolean;
}) {
  return (
    <div
      className={cn("v4-feed-column", className)}
      data-stream-column={stream ? "true" : undefined}
      data-collection-column={collection ? "true" : undefined}
    >
      {children}
    </div>
  );
}

/** Chrome immediately above the feed body (layout toggle, layer chips) — not page-title actions. */
export function FeedChrome({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "v4-feed-chrome mb-2 flex flex-wrap items-center justify-between gap-2",
        className,
      )}
      data-feed-chrome
    >
      {children}
    </div>
  );
}

/** List vs 卡片式 toggle — one control in view chrome; parent persists via settings.ui. */
export function FeedLayoutToggle({
  value,
  onChange,
  className,
}: {
  value: FeedLayout;
  onChange: (v: FeedLayout) => void;
  className?: string;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  const options: Array<{ id: FeedLayout; icon: typeof RiAlignJustify; label: string; hint: string }> = [
    {
      id: "list",
      icon: RiAlignJustify,
      label: t("workspace:feedLayout.list"),
      hint: t("workspace:feedLayout.listHint"),
    },
    {
      id: "card",
      icon: RiGalleryView2,
      label: t("workspace:feedLayout.card"),
      hint: t("workspace:feedLayout.cardHint"),
    },
  ];
  return (
    <div
      className={cn("v4-feed-layout-toggle inline-flex shrink-0 items-center", className)}
      role="group"
      aria-label={t("workspace:feedLayout.toggleAria")}
      data-feed-layout-toggle
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <Tooltip key={opt.id} content={`${opt.label} · ${opt.hint}`} side="bottom">
            <Chip
              tone={active ? "accent" : "neutral"}
              active={active}
              size="md"
              data-layout-option={opt.id}
              data-active={active ? "true" : undefined}
              aria-pressed={active}
              aria-label={opt.label}
              onClick={() => onChange(opt.id)}
              className="gap-1"
            >
              <opt.icon size={ICON.xs} aria-hidden />
              <span className="hidden sm:inline">{opt.label}</span>
            </Chip>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Shared list/card feed wrapper for Inbox / Category / Topic / Outputs / memory. */
export function CollectionFeed({
  layout,
  children,
  className,
}: {
  layout: FeedLayout;
  children: ReactNode;
  className?: string;
}) {
  return (
    <CollectionLayoutContext.Provider value={layout}>
      <div
        data-collection-feed
        data-layout={layout}
        className={cn(
          "v4-feed",
          layout === "card" ? "v4-feed-card" : "v4-feed-list",
          className,
        )}
      >
        {children}
      </div>
    </CollectionLayoutContext.Provider>
  );
}
