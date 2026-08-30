/**
 * Dialog primitives — lightweight modal with focus trap + labelled prompts.
 * Design System 2.0: Escape / scrim dismiss; restore focus on close.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { cn } from "../../lib/cn";

interface BaseDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
  );
}

function DialogBackdrop({
  children,
  onClose,
  labelledBy,
  describedBy,
  panelClassName,
  focusSelector,
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  panelClassName?: string;
  /** Optional selector (resolved inside the panel) that takes initial focus. */
  focusSelector?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    if (panel) {
      const preferred = focusSelector ? panel.querySelector<HTMLElement>(focusSelector) : null;
      const target = preferred ?? getFocusable(panel)[0] ?? panel;
      requestAnimationFrame(() => target.focus());
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = getFocusable(panelRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function" && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [onClose, focusSelector]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4 animate-fade-in"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn("v4-overlay-sheet w-full max-w-md p-5 outline-none", panelClassName)}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  destructive,
  onConfirm,
  onCancel,
  children,
  panelClassName,
}: BaseDialogProps & { panelClassName?: string }) {
  const { t } = useTranslation("common");
  const titleId = useId();
  const descId = useId();

  const finalConfirmText = confirmText ?? t("action.confirm");
  const finalCancelText = cancelText ?? t("action.cancel");

  if (!open) return null;
  return (
    <DialogBackdrop
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={description ? descId : undefined}
      panelClassName={panelClassName}
      // Non-destructive confirms start on the primary action; destructive
      // keeps focus on Cancel (first focusable) so Enter is always safe.
      focusSelector={destructive ? undefined : "[data-dialog-focus]"}
    >
      <h2 id={titleId} className="mb-1.5 text-sm font-semibold tracking-tight text-text-primary">
        {title}
      </h2>
      {description ? (
        <p id={descId} className="mb-3 whitespace-pre-line text-3xs leading-relaxed text-text-tertiary">
          {description}
        </p>
      ) : null}
      {children ? <div className="mb-4">{children}</div> : description ? null : <div className="mb-4" />}
      <div className="flex justify-end gap-2" data-dialog-footer>
        <Button variant="outline" size="sm" onClick={onCancel}>{finalCancelText}</Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          size="sm"
          onClick={onConfirm}
          data-dialog-focus={!destructive ? "" : undefined}
        >
          {finalConfirmText}
        </Button>
      </div>
    </DialogBackdrop>
  );
}

export function 
PromptDialog({
  open,
  title,
  description,
  defaultValue = "",
  placeholder = "",
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  maxWidth,
}: Omit<BaseDialogProps, "onConfirm"> & {
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  /** Override default max-w-md (28rem) for wider inputs (e.g. long filenames). */
  maxWidth?: string;
}) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const titleId = useId();
  const descId = useId();
  const inputId = useId();

  const finalConfirmText = confirmText ?? t("action.confirm");
  const finalCancelText = cancelText ?? t("action.cancel");

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const handleSubmit = () => onConfirm(value);

  return (
    <DialogBackdrop
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={description ? descId : undefined}
      panelClassName={maxWidth}
    >
      <h2 id={titleId} className="mb-1 text-sm font-semibold tracking-tight text-text-primary">
        {title}
      </h2>
      {description ? (
        <p id={descId} className="mb-3 text-3xs leading-relaxed text-text-tertiary">
          {description}
        </p>
      ) : null}
      <input
        id={inputId}
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (composingRef.current || e.nativeEvent.isComposing) return;
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder || title}
        className="mb-4 h-[var(--control-h-md,34px)] w-full rounded-[var(--radius-md)] border border-border-subtle bg-input px-3 text-sm text-text-primary outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-visible:border-accent-color focus-visible:ring-2 focus-visible:ring-ring/35"
      />
      <div className="flex justify-end gap-2" data-dialog-footer>
        <Button variant="outline" size="sm" onClick={onCancel}>{finalCancelText}</Button>
        <Button variant="default" size="sm" onClick={handleSubmit}>{finalConfirmText}</Button>
      </div>
    </DialogBackdrop>
  );
}

export function ErrorDialog({
  open,
  title,
  message,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const titleId = useId();
  const descId = useId();
  if (!open) return null;
  return (
    <DialogBackdrop onClose={onClose} labelledBy={titleId} describedBy={descId}>
      <h2 id={titleId} className="mb-2 text-sm font-semibold text-error">
        {title}
      </h2>
      <p id={descId} className={cn("mb-4 text-3xs leading-relaxed text-text-tertiary")}>
        {message}
      </p>
      <div className="flex justify-end">
        <Button size="sm" onClick={onClose}>
          {t("action.ok")}
        </Button>
      </div>
    </DialogBackdrop>
  );
}
