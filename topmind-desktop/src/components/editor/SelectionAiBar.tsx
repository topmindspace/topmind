/**
 * Editor inline AI (Notion-style) — selection bar + explicit toolbar panel.
 *
 * Visibility policy (non-intrusive):
 *  - Non-empty selection → floating action bar (can dismiss with Esc / ×)
 *  - Toolbar ✨ / context menu → open pinned panel (same actions)
 *  - Empty-line chip → OFF (avoid always-on noise); use toolbar「续写」
 *
 * Runtime: ai.complete only; single-flight request; cancel ignores late results.
 * Switching notes / remount clears and aborts.
 *
 * Composition layer: state + request lifecycle live in useSelectionAi; toolbar,
 * diff preview, and error blocks live in SelectionAi{Toolbar,Diff,Error}.
 */
import type { Editor } from "@tiptap/react";
import { Loader2, Sparkles, X, GripHorizontal } from "lucide-react";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { Button } from "../ui/Button";
import { useSelectionAi } from "./useSelectionAi";
import { SelectionAiToolbar } from "./SelectionAiToolbar";
import { SelectionAiDiff } from "./SelectionAiDiff";
import { SelectionAiError } from "./SelectionAiError";

export type { EditorAiAction } from "./useSelectionAi";

export function SelectionAiBar({
  editor,
  readOnly,
  /** Note path — abort UI when user switches documents */
  notePath,
}: {
  editor: Editor | null;
  readOnly?: boolean;
  notePath?: string;
}) {
  const {
    t,
    ready,
    runtimeLabel,
    target,
    error,
    customOpen,
    customInstr,
    preview,
    showDiff,
    pinnedOpen,
    previewMaxH,
    statusHint,
    dragPos,
    panelId,
    busy,
    visible,
    setCustomInstr,
    setPreviewMaxH,
    run,
    cancelRun,
    applyPreview,
    clearUi,
    discardPreview,
    dismissError,
    toggleCustomOpen,
    toggleShowDiff,
    onDragStart,
  } = useSelectionAi({ editor, readOnly, notePath });
  const openOverlay = useViewStore((s) => s.openOverlay);

  if (!visible || !target) {
    // Floating status chip when we only have a toast hint without target
    if (statusHint && !target) {
      return (
        <div
          data-selection-ai
          className="pointer-events-none fixed bottom-6 left-1/2 z-floating -translate-x-1/2"
        >
          <div className="rounded-full border border-border-subtle bg-surface-elevated px-3 py-1.5 text-3xs text-text-secondary shadow-[var(--shadow-float)]">
            {statusHint}
          </div>
        </div>
      );
    }
    return null;
  }

  // Smart placement: prefer above selection; flip below when not enough space;
  // clamp horizontally so ~28rem panel stays in viewport.
  // When user has dragged the panel, use their position directly.
  const panelW = Math.min(window.innerWidth * 0.96, 28 * 16);
  const estPanelH = 120; // Conservative estimate for position calculation
  let barTop: number;
  let barLeft: number;
  if (dragPos) {
    barTop = Math.max(8, Math.min(dragPos.y, window.innerHeight - estPanelH));
    barLeft = Math.max(8, Math.min(dragPos.x, window.innerWidth - panelW - 8));
  } else {
    const preferAboveTop = target.top - estPanelH - 8;
    const spaceAbove = target.top;
    const spaceBelow = window.innerHeight - target.bottom;
    if (spaceAbove >= estPanelH + 16) {
      // Enough space above — position above the selection
      barTop = Math.max(8, preferAboveTop);
    } else if (spaceBelow >= estPanelH + 16) {
      // Not enough above but enough below — position below the selection
      barTop = Math.min(target.bottom + 8, window.innerHeight - estPanelH - 8);
    } else {
      // Not enough space either way — pick the side with more room
      barTop = spaceAbove >= spaceBelow
        ? Math.max(8, preferAboveTop)
        : Math.min(target.bottom + 8, window.innerHeight - estPanelH - 8);
    }
    barLeft = Math.max(8, Math.min(target.left, window.innerWidth - panelW - 8));
  }

  return (
    <div
      data-selection-ai
      id={panelId}
      role="dialog"
      aria-label={t("selectionAi.headerSelection")}
      aria-busy={busy}
      className="pointer-events-auto fixed z-floating v4-ai-panel-enter"
      style={{ top: Math.max(8, barTop), left: barLeft, maxWidth: panelW }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        className={cn(
          "v4-card-elevated flex w-[min(96vw,28rem)] flex-col gap-1.5 px-1.5 py-1.5",
          busy && "ring-1 ring-accent-color/30 shadow-[0_0_0_1px_var(--color-accent-border-subtle)]",
        )}
      >
        {/* Progress stripe while AI is working */}
        {busy ? (
          <div
            className="animate-shimmer h-0.5 w-full overflow-hidden rounded-full bg-accent-bg-subtle"
            role="progressbar"
            aria-valuetext={statusHint || t("selectionAi.statusHintRewrite")}
          />
        ) : null}
        {/* Header: drag handle + status + close */}
        <div className="flex items-center gap-1 border-b border-border-subtle-dim px-1 pb-1">
          <span
            className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-text-quaternary/50 hover:text-text-tertiary active:cursor-grabbing"
            onMouseDown={onDragStart}
            title={t("selectionAi.dragHint")}
            aria-label={t("selectionAi.dragHint")}
            role="button"
          >
            <GripHorizontal size={ICON.micro} />
          </span>
          <span className="flex h-6 w-6 items-center justify-center text-accent-color" aria-hidden>
            {busy ? (
              <Loader2 size={ICON.xs} className="animate-spin" />
            ) : (
              <Sparkles size={ICON.xs} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-3xs font-medium text-text-secondary">
              {busy
                ? t("selectionAi.headerWorking", { defaultValue: "AI 处理中" })
                : pinnedOpen
                  ? t("selectionAi.headerMenu")
                  : t("selectionAi.headerSelection")}
            </div>
            <div className={cn(
              "truncate text-3xs",
              busy ? "text-accent-color animate-pulse-soft" : "text-text-quaternary",
            )}>
              {statusHint ||
                (ready ? runtimeLabel : t("selectionAi.notConfiguredHint"))}
            </div>
          </div>
          {!ready ? (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-3xs font-medium text-accent-color hover:bg-accent-bg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              onClick={() => openOverlay("settings", { topicId: "ai" })}
            >
              {t("selectionAi.configure")}
            </button>
          ) : null}
          {busy ? (
            <Button size="sm" variant="ghost" onClick={cancelRun}>
              {t("selectionAi.cancel")}
            </Button>
          ) : null}
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary hover:bg-surface-muted hover:text-text-secondary"
            aria-label={t("selectionAi.closeAria")}
            onClick={() => {
              if (busy) cancelRun();
              clearUi();
            }}
          >
            <X size={ICON.xs} />
          </button>
        </div>

        <SelectionAiToolbar
          editor={editor}
          target={target}
          readOnly={readOnly}
          busy={busy}
          ready={ready}
          pinnedOpen={pinnedOpen}
          onRun={run}
          onToggleCustom={toggleCustomOpen}
        />

        {customOpen ? (
          <div className="flex gap-1 border-t border-border-subtle-dim px-1 pt-1.5">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-subtle bg-surface px-2 py-1 text-3xs outline-none focus:border-accent-color"
              placeholder={t("selectionAi.customPlaceholder")}
              value={customInstr}
              disabled={busy}
              onChange={(e) => setCustomInstr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customInstr.trim() && !busy) {
                  e.preventDefault();
                  if (!ready) {
                    openOverlay("settings", { topicId: "ai" });
                    return;
                  }
                  void run("custom", customInstr.trim());
                }
              }}
            />
            <Button
              size="sm"
              disabled={busy || !customInstr.trim()}
              onClick={() => {
                if (!ready) {
                  openOverlay("settings", { topicId: "ai" });
                  return;
                }
                void run("custom", customInstr.trim());
              }}
            >
              {t("selectionAi.generate")}
            </Button>
          </div>
        ) : null}

        {busy ? (
          <div
            className="flex flex-col gap-1.5 rounded-[var(--radius-md)] bg-accent-bg-faint px-2 py-1.5 text-3xs text-accent-color"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <Loader2 size={ICON.xs} className="animate-spin shrink-0" />
              <span className="min-w-0 flex-1">
                {statusHint || t("selectionAi.statusHintRequestModel")} {t("selectionAi.statusHintCancelOrEsc")}
              </span>
            </div>
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-accent-bg-subtle/60">
              <div className="h-full w-1/3 v4-ai-progress-slide rounded-full bg-accent-color/50" />
            </div>
          </div>
        ) : null}

        {error ? (
          <SelectionAiError error={error} onClose={dismissError} />
        ) : null}

        {preview ? (
          <SelectionAiDiff
            preview={preview}
            targetScope={target.scope}
            originalText={target.text}
            showDiff={showDiff}
            previewMaxH={previewMaxH}
            onToggleDiff={toggleShowDiff}
            onPreviewMaxHChange={setPreviewMaxH}
            onDiscard={discardPreview}
            onApply={applyPreview}
          />
        ) : null}
      </div>
    </div>
  );
}

export function requestSelectionAiBar(): void {
  window.dispatchEvent(new Event("topmind:selection-ai"));
}

export function requestEditorAiMenu(): void {
  window.dispatchEvent(new Event("topmind:editor-ai-menu"));
}
