/**
 * Selection AI toolbar — action buttons row (polish / shorter / expand / …)
 * plus the quick markdown format row for selection scope.
 * Pure presentation; all request behavior comes via props from useSelectionAi.
 */
import type { Editor } from "@tiptap/react";
import {
  RiAlignLeft,
  RiBold,
  RiCodeLine,
  RiContractUpDownLine,
  RiExpandUpDownLine,
  RiFileList3Line,
  RiFileTextLine,
  RiH2,
  RiItalic,
  RiListOrdered,
  RiListUnordered,
  RiPencilLine,
  RiQuillPenLine,
  RiSparklingLine,
  RiText,
  RiTranslate2,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import type { EditorAiAction, Target } from "./useSelectionAi";

const SELECTION_ACTIONS: {
  id: EditorAiAction;
  icon: typeof RiSparklingLine;
  labelKey: string;
  tipKey: string;
}[] = [
  { id: "polish", icon: RiSparklingLine, labelKey: "editor:selectionAi.polishLabel", tipKey: "editor:selectionAi.polishTip" },
  { id: "shorter", icon: RiContractUpDownLine, labelKey: "editor:selectionAi.shorterLabel", tipKey: "editor:selectionAi.shorterTip" },
  { id: "expand", icon: RiExpandUpDownLine, labelKey: "editor:selectionAi.expandLabel", tipKey: "editor:selectionAi.expandTip" },
  { id: "bullets", icon: RiListUnordered, labelKey: "editor:selectionAi.bulletsLabel", tipKey: "editor:selectionAi.bulletsTip" },
  { id: "format", icon: RiAlignLeft, labelKey: "editor:selectionAi.formatLabel", tipKey: "editor:selectionAi.formatTip" },
  { id: "fix", icon: RiPencilLine, labelKey: "editor:selectionAi.fixLabel", tipKey: "editor:selectionAi.fixTip" },
  { id: "summarize", icon: RiFileList3Line, labelKey: "editor:selectionAi.summarizeLabel", tipKey: "editor:selectionAi.summarizeTip" },
  { id: "translate", icon: RiTranslate2, labelKey: "editor:selectionAi.translateLabel", tipKey: "editor:selectionAi.translateTip" },
];

export function SelectionAiToolbar({
  editor,
  target,
  readOnly,
  busy,
  ready,
  pinnedOpen,
  onRun,
  onToggleCustom,
}: {
  editor: Editor | null;
  target: Target;
  readOnly?: boolean;
  busy: boolean;
  ready: boolean;
  pinnedOpen: boolean;
  onRun: (action: EditorAiAction, instruction?: string) => void;
  onToggleCustom: () => void;
}) {
  const { t } = useTranslation("editor");
  const openOverlay = useViewStore((s) => s.openOverlay);

  return (
    <>
      {/* Primary actions — wrap-friendly row so a wide panel shows full labels */}
      <div
        className="flex flex-wrap items-center gap-0.5"
        role="toolbar"
        aria-label={t("selectionAi.headerSelection")}
      >
        {SELECTION_ACTIONS.map((a) => (
          <Tooltip key={a.id} content={ready ? t(a.tipKey) : t("selectionAi.errorAiNotReady")}>
            <button
              type="button"
              /* busy = soft-off (discoverable); !ready stays clickable → settings */
              data-soft-disabled={busy ? "true" : undefined}
              aria-disabled={busy || undefined}
              disabled={false}
              onClick={() => {
                if (busy) return;
                if (!ready) {
                  openOverlay("settings", { topicId: "ai" });
                  return;
                }
                void onRun(a.id);
              }}
              className={cn(
                "flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2",
                "text-3xs font-medium v4-ai-btn",
                busy && "opacity-45",
              )}
            >
              <a.icon size={ICON.micro} className="shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{t(a.labelKey)}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Secondary row — continue / custom (and pinned summarize-all) */}
      <div className="flex flex-wrap items-center gap-0.5">
        <Tooltip content={ready ? t("selectionAi.continueTip") : t("selectionAi.needConfig")}>
          <button
            type="button"
            data-soft-disabled={busy ? "true" : undefined}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              if (!ready) {
                openOverlay("settings", { topicId: "ai" });
                return;
              }
              void onRun("continue");
            }}
            className={cn(
              "flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-3xs font-medium v4-ai-btn-ghost hover:text-accent-color",
              busy && "opacity-45",
            )}
          >
            <RiQuillPenLine size={ICON.micro} /> {t("selectionAi.continueLabel")}
          </button>
        </Tooltip>

        {pinnedOpen ? (
          <Tooltip content={t("selectionAi.summarizeAllTip")}>
            <button
              type="button"
              data-soft-disabled={busy || !ready ? "true" : undefined}
              aria-disabled={busy || !ready || undefined}
              onClick={() => {
                if (busy || !ready) return;
                void onRun("summarize");
              }}
              className={cn(
                "flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-3xs font-medium v4-ai-btn-ghost hover:text-accent-color",
                (busy || !ready) && "opacity-45",
              )}
            >
              <RiFileTextLine size={ICON.micro} /> {t("selectionAi.summarizeAllLabel")}
            </button>
          </Tooltip>
        ) : null}

        <Tooltip content={t("selectionAi.customTip")}>
          <button
            type="button"
            data-soft-disabled={busy ? "true" : undefined}
            aria-disabled={busy || undefined}
            onClick={() => { if (!busy) onToggleCustom(); }}
            className={cn(
              "ml-auto flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-3xs text-text-tertiary hover:bg-surface-muted",
              busy && "opacity-45",
            )}
          >
            <RiText size={ICON.micro} /> {t("selectionAi.customLabel")}
          </button>
        </Tooltip>
      </div>

      {/*
        Quick markdown format — usable while selection AI is open.
        Restores selection range then applies toolbar-equivalent commands
        so the main EditorFormatBar is not the only path (and is not blocked).
      */}
      {target.scope === "selection" && !readOnly ? (
        <div
          className="flex flex-wrap items-center gap-0.5 border-t border-border-subtle-dim px-1 pt-1"
          role="toolbar"
          aria-label={t("selectionAi.quickFormatAria")}
          data-selection-ai-format-toolbar
        >
          {(
            [
              {
                id: "bold",
                tip: t("selectionAi.quickFormatBold"),
                icon: RiBold,
                run: () => editor?.chain().focus().setTextSelection({ from: target.from, to: target.to }).toggleBold().run(),
                active: () => editor?.isActive("bold") ?? false,
              },
              {
                id: "italic",
                tip: t("selectionAi.quickFormatItalic"),
                icon: RiItalic,
                run: () => editor?.chain().focus().setTextSelection({ from: target.from, to: target.to }).toggleItalic().run(),
                active: () => editor?.isActive("italic") ?? false,
              },
              {
                id: "code",
                tip: t("selectionAi.quickFormatCode"),
                icon: RiCodeLine,
                run: () => editor?.chain().focus().setTextSelection({ from: target.from, to: target.to }).toggleCode().run(),
                active: () => editor?.isActive("code") ?? false,
              },
              {
                id: "h2",
                tip: t("selectionAi.quickFormatH2"),
                icon: RiH2,
                run: () => editor?.chain().focus().setTextSelection({ from: target.from, to: target.to }).toggleHeading({ level: 2 }).run(),
                active: () => editor?.isActive("heading", { level: 2 }) ?? false,
              },
              {
                id: "ul",
                tip: t("selectionAi.quickFormatBullet"),
                icon: RiListUnordered,
                run: () => editor?.chain().focus().setTextSelection({ from: target.from, to: target.to }).toggleBulletList().run(),
                active: () => editor?.isActive("bulletList") ?? false,
              },
              {
                id: "ol",
                tip: t("selectionAi.quickFormatOrdered"),
                icon: RiListOrdered,
                run: () => editor?.chain().focus().setTextSelection({ from: target.from, to: target.to }).toggleOrderedList().run(),
                active: () => editor?.isActive("orderedList") ?? false,
              },
            ] as const
          ).map((btn) => (
            <Tooltip key={btn.id} content={btn.tip}>
              <button
                type="button"
                disabled={busy || !editor || editor.isDestroyed}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  btn.run();
                }}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary",
                  "hover:bg-surface-muted hover:text-text-primary disabled:opacity-40",
                  btn.active() && "bg-accent-bg-subtle text-accent-color",
                )}
                aria-label={btn.tip}
                aria-pressed={btn.active()}
              >
                <btn.icon size={ICON.micro} aria-hidden />
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}
    </>
  );
}
