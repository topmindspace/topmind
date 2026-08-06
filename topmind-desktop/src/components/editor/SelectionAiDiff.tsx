/**
 * Selection AI result preview — optional line diff (simple-diff) against the
 * original selection, resizable preview box, discard / accept actions.
 * Pure presentation; request lifecycle lives in useSelectionAi.
 */
import { Columns2, GripHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { lineDiff } from "../../lib/simple-diff";
import { Tooltip } from "../ui/tooltip";
import { Button } from "../ui/Button";
import type { Scope } from "./useSelectionAi";

export function SelectionAiDiff({
  preview,
  targetScope,
  originalText,
  showDiff,
  previewMaxH,
  onToggleDiff,
  onPreviewMaxHChange,
  onDiscard,
  onApply,
}: {
  preview: string;
  targetScope: Scope;
  /** Selection text snapshot used as diff base */
  originalText: string;
  showDiff: boolean;
  previewMaxH: number;
  onToggleDiff: () => void;
  onPreviewMaxHChange: (h: number) => void;
  onDiscard: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation("editor");
  const diffLines =
    showDiff && targetScope === "selection"
      ? lineDiff(originalText, preview)
      : null;

  return (
    <div className="border-t border-border-subtle-dim px-1 pt-1.5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <span className="text-3xs font-medium text-text-quaternary">
          {t("selectionAi.previewLabel", { mode: targetScope === "selection" ? t("selectionAi.previewModeReplace") : t("selectionAi.previewModeInsert") })}
        </span>
        <div className="flex items-center gap-0.5">
          {targetScope === "selection" ? (
            <Tooltip content={showDiff ? t("selectionAi.diffTooltipOn") : t("selectionAi.diffTooltipOff")}>
              <button
                type="button"
                className={cn(
                  "flex h-6 items-center gap-0.5 rounded px-1.5 text-3xs",
                  showDiff ? "bg-accent-bg-subtle text-accent-color" : "text-text-tertiary hover:bg-surface-muted",
                )}
                onClick={onToggleDiff}
                aria-pressed={showDiff}
                aria-label={showDiff ? t("selectionAi.diffAriaOn") : t("selectionAi.diffAriaOff")}
              >
                <Columns2 size={ICON.micro} aria-hidden /> {t("selectionAi.diffButton")}
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={t("selectionAi.resizePreview")}>
            <span className="flex h-6 items-center px-1 text-text-quaternary">
              <GripHorizontal size={ICON.micro} aria-hidden />
            </span>
          </Tooltip>
        </div>
      </div>
      <div
        className="overflow-auto rounded-[var(--radius-sm)] border border-border-subtle-dim bg-surface px-2 py-1.5"
        style={{
          maxHeight: previewMaxH,
          resize: "vertical",
          minHeight: 72,
        }}
        onMouseUp={(e) => {
          const h = (e.currentTarget as HTMLElement).offsetHeight;
          if (h >= 72 && h <= 420) onPreviewMaxHChange(h);
        }}
      >
        {diffLines ? (
          <div className="space-y-0.5 font-mono text-3xs leading-snug">
            {diffLines.map((line, idx) => (
              <div
                key={idx}
                className={cn(
                  "whitespace-pre-wrap break-words rounded-sm px-0.5",
                  line.kind === "removed" && "bg-status-error-bg text-error line-through opacity-90",
                  line.kind === "added" && "bg-status-success-bg text-success",
                  line.kind === "same" && "text-text-quaternary opacity-70",
                )}
              >
                {line.kind === "removed" ? "− " : line.kind === "added" ? "+ " : "  "}
                {line.text || " "}
              </div>
            ))}
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-3xs leading-relaxed text-text-primary">
            {preview}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onDiscard}
        >
          {t("selectionAi.discard")}
          <kbd className="v4-kbd v4-kbd-sm ml-1">Esc</kbd>
        </Button>
        <Button size="sm" onClick={onApply}>
          {targetScope === "selection" ? t("selectionAi.accept") : t("selectionAi.insert")}
          <kbd className="v4-kbd v4-kbd-sm ml-1 opacity-90">⌘↵</kbd>
        </Button>
      </div>
    </div>
  );
}
