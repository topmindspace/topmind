/**
 * Portal listbox select — Design System 2.0 replacement for native <select>.
 * All settings / form fields should go through Select → MenuSelect so
 * Electron never paints OS option lists (wrong position under overlays).
 *
 * Supports optional `searchable` mode for long option lists (model pickers):
 * a sticky search input appears at the top of the dropdown for quick filtering.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSectionLabel,
} from "./DropdownMenu";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import type { SelectGroup, SelectOption } from "./select";

export type MenuSelectVariant = "composer" | "field" | "chip" | "ghost";

export interface MenuSelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
  variant?: MenuSelectVariant;
  leading?: ReactNode;
  align?: "start" | "end";
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Panel width tracks trigger (default true for field/chip). */
  matchTriggerWidth?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
  name?: string;
  /** Show a search input to filter options (for long lists like model pickers). */
  searchable?: boolean;
  /** Notify parent (e.g. wrap Tooltip with disabled={open}) */
  onOpenChange?: (open: boolean) => void;
}

function flattenLabels(
  value: string,
  options: SelectOption[] | undefined,
  groups: SelectGroup[] | undefined,
  placeholder: string,
): string {
  if (!value) return placeholder;
  if (options) {
    const hit = options.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  if (groups) {
    for (const g of groups) {
      const hit = g.options.find((o) => o.value === value);
      if (hit) return hit.label;
    }
  }
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

export function MenuSelect({
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
  className,
  variant = "field",
  leading,
  align = "start",
  minWidth,
  maxWidth,
  maxHeight = 320,
  matchTriggerWidth,
  allowEmpty = false,
  emptyLabel,
  id,
  name,
  searchable = false,
  onOpenChange,
}: MenuSelectProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const displayPlaceholder = placeholder ?? t("common:action.select", { defaultValue: "Select…" });
  const setOpenBoth = (v: boolean | ((prev: boolean) => boolean)) => {
    setOpen((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });
  };
  const label = useMemo(
    () => flattenLabels(value, options, groups, displayPlaceholder),
    [value, options, groups, displayPlaceholder],
  );

  // Reset search query when dropdown closes
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Auto-focus search input when dropdown opens (after panel is ready)
  useEffect(() => {
    if (!open || !searchable) return;
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open, searchable]);

  // Count total options to decide if search input should show
  const totalCount =
    (options?.length ?? 0) +
    (groups?.reduce((sum, g) => sum + g.options.length, 0) ?? 0);
  const showSearch = searchable && totalCount > 8;

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!query || !options) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const filteredGroups = useMemo(() => {
    if (!query || !groups) return groups;
    const q = query.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  // Form fields: stick to trigger width. Composer/model lists may grow.
  const matchWidth =
    matchTriggerWidth ?? (variant === "field" || variant === "chip" || variant === "ghost");
  const resolvedMinWidth =
    minWidth ?? (variant === "composer" ? 280 : matchWidth ? 0 : 200);
  const resolvedMaxWidth = maxWidth ?? (variant === "composer" ? 420 : 480);

  const triggerClass = cn(
    "inline-flex w-full min-w-0 items-center gap-1 text-left outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/35",
    disabled && "cursor-not-allowed opacity-50",
    variant === "composer" &&
      "h-7 rounded-[var(--radius-md)] border border-transparent bg-surface-muted/70 px-2 text-3xs font-medium text-text-secondary hover:border-border-subtle-dim hover:bg-surface hover:text-text-primary data-[open=true]:border-border-subtle-dim data-[open=true]:bg-surface data-[open=true]:text-text-primary",
    variant === "field" &&
      "h-[var(--control-h-md,34px)] w-full rounded-[var(--radius-md)] border border-border-subtle-dim bg-input px-2.5 text-3xs text-text-primary shadow-[var(--shadow-input-inset)] hover:border-border-subtle data-[open=true]:border-accent-color data-[open=true]:ring-2 data-[open=true]:ring-ring/35",
    variant === "chip" &&
      "h-7 max-w-[12rem] rounded-full border border-border-subtle-dim bg-surface-muted/70 px-2 text-3xs font-medium text-text-secondary hover:bg-surface-muted data-[open=true]:bg-surface-muted",
    variant === "ghost" &&
      "h-[var(--control-h-sm,30px)] border-0 bg-transparent px-1 text-3xs text-text-secondary hover:text-text-primary data-[open=true]:text-text-primary",
    className,
  );

  const pick = (v: string) => {
    onChange(v);
    setOpenBoth(false);
  };

  const hasFlat = (filteredOptions?.length ?? 0) > 0;
  const hasGroups = (filteredGroups?.length ?? 0) > 0;
  const hasAny = hasFlat || hasGroups;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        if (disabled) return;
        setOpenBoth(v);
      }}
      align={align}
      minWidth={resolvedMinWidth}
      maxWidth={resolvedMaxWidth}
      maxHeight={maxHeight}
      matchTriggerWidth={matchWidth}
      closeOnScroll
      className={cn("w-full min-w-0 max-w-full", variant === "chip" && "w-auto")}
      autoFocus={!showSearch}
      trigger={
        <button
          type="button"
          id={id}
          name={name}
          data-menu-trigger
          disabled={disabled}
          aria-label={ariaLabel || displayPlaceholder}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-open={open || undefined}
          className={triggerClass}
          title={undefined}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) setOpenBoth((v) => !v);
          }}
        >
          {leading ? (
            <span className="shrink-0 text-text-quaternary" aria-hidden>
              {leading}
            </span>
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !value && "text-text-quaternary",
              variant === "composer" && "font-mono tracking-tight",
            )}
          >
            {label}
          </span>
          <ChevronDown
            size={ICON.micro}
            className={cn(
              "shrink-0 text-text-quaternary transition-transform duration-100",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      }
    >
      {showSearch ? (
        <div className="sticky top-0 z-10 mb-1 bg-surface px-1 pb-1 pt-1">
          <div className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-subtle-dim bg-input px-2">
            <Search size={ICON.micro} className="shrink-0 text-text-quaternary" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Prevent dropdown keyboard navigation from firing on the search input
                e.stopPropagation();
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder={t("action.search", { defaultValue: "Search…" })}
              className="h-7 min-w-0 flex-1 bg-transparent text-3xs text-text-primary outline-none placeholder:text-text-quaternary"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="shrink-0 text-text-quaternary hover:text-text-secondary"
                aria-label={t("action.clear", { defaultValue: "Clear" })}
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {allowEmpty && !query ? (
        <DropdownItem active={!value} onSelect={() => pick("")}>
          <span className="min-w-0 flex-1 truncate">{emptyLabel || placeholder}</span>
          {!value ? <Check size={ICON.micro} className="shrink-0 text-accent-color" /> : null}
        </DropdownItem>
      ) : null}

      {hasFlat
        ? filteredOptions!.map((o) => (
            <DropdownItem key={o.value || "__empty"} active={o.value === value} onSelect={() => pick(o.value)}>
              <span className="min-w-0 flex-1 truncate" title={o.label}>
                {o.label}
              </span>
              {o.value === value ? (
                <Check size={ICON.micro} className="shrink-0 text-accent-color" />
              ) : null}
            </DropdownItem>
          ))
        : null}

      {hasGroups
        ? filteredGroups!.map((g) => (
            <div key={g.label}>
              <DropdownSectionLabel>{g.label}</DropdownSectionLabel>
              {g.options.map((o) => (
                <DropdownItem
                  key={o.value}
                  active={o.value === value}
                  onSelect={() => pick(o.value)}
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-3xs tracking-tight"
                    title={o.label}
                  >
                    {o.label}
                  </span>
                  {o.value === value ? (
                    <Check size={ICON.micro} className="shrink-0 text-accent-color" />
                  ) : null}
                </DropdownItem>
              ))}
            </div>
          ))
        : null}

      {!hasAny ? (
        <div className="px-2.5 py-2 text-3xs text-text-quaternary">
          {query ? t("action.noResults", { defaultValue: "No results" }) : t("action.noOptions")}
        </div>
      ) : null}
    </DropdownMenu>
  );
}
