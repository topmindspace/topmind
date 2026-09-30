import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { RiCheckLine } from "@remixicon/react";
import { cn } from "../../lib/kit";
import { Button } from "./Button";
import { ICON } from "../../lib/icons";

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  /** Letter badge override (A/B/C…). Auto-assigned when omitted. */
  badge?: string;
}

/**
 * ChoiceCardGroup — Cue-style clarifying choice cards.
 *
 * Used when the assistant offers a finite, clearly-scoped set of options.
 * Open-ended follow-ups stay plain text. Keyboard: ↑/↓ move, Enter confirm,
 * 1–9 jump. Single-select is default; multi adds checkboxes and requires
 * explicit 继续.
 */
export function ChoiceCardGroup({
  options,
  multiple = false,
  defaultSelectedIds,
  onConfirm,
  onCancel,
  continueLabel,
  cancelLabel,
  className,
  disabled,
}: {
  options: ChoiceOption[];
  multiple?: boolean;
  defaultSelectedIds?: string[];
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
  continueLabel?: string;
  cancelLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("common");
  const [selected, setSelected] = useState<string[]>(defaultSelectedIds ?? []);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultSelectedIds) setSelected(defaultSelectedIds);
  }, [defaultSelectedIds?.join("|")]);

  const badges = options.map((o, i) => o.badge ?? String.fromCharCode(65 + i));

  const toggle = (id: string) => {
    if (disabled) return;
    if (multiple) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + dir + options.length) % options.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const id = options[active]?.id;
      if (!id) return;
      if (multiple) toggle(id);
      else onConfirm([id]);
      return;
    }
    const digit = Number(e.key);
    if (digit >= 1 && digit <= options.length) {
      e.preventDefault();
      const id = options[digit - 1].id;
      setActive(digit - 1);
      if (multiple) toggle(id);
      else onConfirm([id]);
    }
  };

  return (
    <div
      ref={listRef}
      role="group"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "rounded-[var(--radius-card)] bg-surface p-2.5",
        "shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        {options.map((opt, i) => {
          const isSelected = selected.includes(opt.id);
          const isActive = i === active;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setActive(i);
                toggle(opt.id);
                if (!multiple) onConfirm([opt.id]);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border px-2.5 py-2 text-left",
                "transition-colors v4-focus-ring",
                isSelected
                  ? "border-accent-border-subtle bg-accent-bg-subtle"
                  : "border-transparent bg-surface-wash-15 hover:bg-state-hover",
                isActive && !isSelected && "bg-surface-wash-30",
                disabled && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-3xs font-semibold",
                  isSelected
                    ? "bg-accent-color text-text-on-accent"
                    : "bg-surface-wash-15 text-text-tertiary",
                )}
                aria-hidden
              >
                {badges[i]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium tracking-tight text-text-primary">
                  {opt.label}
                </span>
                {opt.description ? (
                  <span className="mt-0.5 block text-xs leading-snug text-text-tertiary">
                    {opt.description}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  isSelected
                    ? "border-accent-color bg-accent-color text-text-on-accent"
                    : "border-border-strong",
                )}
                aria-hidden
              >
                {isSelected ? <RiCheckLine size={ICON.nano} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-3xs text-text-quaternary">
          {t("choice.hint", {
            defaultValue: "没有想要的选项？直接输入你的回复即可。",
          })}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
              {cancelLabel ?? t("action.cancel")}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={disabled || selected.length === 0}
            onClick={() => onConfirm(selected)}
          >
            {continueLabel ?? t("action.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
