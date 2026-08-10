/**
 * Select — design-system control.
 *
 * Implementation: portal MenuSelect (not native HTML select).
 * Native option lists mis-position under Electron overlays/settings;
 * portal listboxes stay flush to the control with correct z-index.
 *
 * API stays form-friendly: value + onChange(e) with e.target.value.
 */
import { forwardRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MenuSelect, type MenuSelectVariant } from "./menu-select";
import { cn } from "../../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

type SelectVariant = "default" | "chip" | "ghost";

export interface SelectProps {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (e: { target: { value: string } }) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  /**
   * default — form field (settings)
   * chip — pill control
   * ghost — borderless toolbar
   */
  variant?: SelectVariant;
  leading?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  /** Show a search input to filter options (for long lists like model pickers). */
  searchable?: boolean;
}

function toStr(v: SelectProps["value"]): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function mapVariant(v: SelectVariant | undefined): MenuSelectVariant {
  if (v === "chip") return "chip";
  if (v === "ghost") return "ghost";
  return "field";
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      options,
      groups,
      placeholder,
      variant = "default",
      leading,
      disabled,
      value,
      defaultValue,
      onChange,
      id,
      name,
      "aria-label": ariaLabel,
      searchable,
    },
    _ref,
  ) => {
    const { t } = useTranslation("common");
    const current = toStr(value !== undefined ? value : defaultValue);
    const handleChange = useCallback(
      (v: string) => {
        onChange?.({ target: { value: v } });
      },
      [onChange],
    );

    return (
      <MenuSelect
        variant={mapVariant(variant)}
        value={current}
        onChange={handleChange}
        options={options}
        groups={groups}
        placeholder={placeholder || t("action.select")}
        disabled={disabled}
        leading={leading}
        className={cn(variant === "default" && "w-full", className)}
        aria-label={ariaLabel}
        id={id}
        name={name}
        align="start"
        // Settings / forms: stick to field width, open flush below
        matchTriggerWidth={variant !== "ghost"}
        maxHeight={280}
        searchable={searchable}
      />
    );
  },
);
Select.displayName = "Select";
