/**
 * Editor inline AI (Notion-style) — selection bar + explicit toolbar panel.
 *
 * Visibility policy (non-intrusive):
 *  - Non-empty selection → floating action bar (can dismiss with Esc / ×)
 *  - Toolbar ✨ / context menu → open pinned panel (same actions)
 *  - Empty-line chip → OFF (avoid always-on noise); use toolbar「续写」
 *  - Auto-popup can be toggled off from the bar header or Settings → Editor
 *
 * Runtime: ai.complete only; single-flight request; cancel ignores late results.
 * Switching notes / remount clears and aborts.
 *
 * Composition layer: state + request lifecycle live in useSelectionAi; toolbar,
 * diff preview, and error blocks live in SelectionAi{Toolbar,Diff,Error}.
 */
import type { Editor } from "@tiptap/react";
import {
  RiCheckLine,
  RiCloseLine,
  RiDraggable,
  RiFileCopyLine,
  RiFlashlightFill,
  RiFlashlightLine,
  RiLoader4Line,
  RiSparklingLine,
} from "@remixicon/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/tooltip";
import { useSelectionAi } from "./useSelectionAi";
import { SelectionAiToolbar } from "./SelectionAiToolbar";
import { SelectionAiDiff } from "./SelectionAiDiff";
import { SelectionAiError } from "./SelectionAiError";
import { clampSelectionAiPanel } from "../../lib/inline-ai-panel";

export type { EditorAiAction } from "./useSelectionAi";

export function SelectionAiBar({
  editor,
  readOnly,
  /** Note path — abort UI when user switches documents */
  notePath,
  /** YAML frontmatter block from the file (for AI context injection) */
  frontmatter,
}: {
  editor: Editor | null;
  readOnly?: boolean;
  notePath?: string;
  frontmatter?: string | null;
}) {
  const {
    t,
    ready,
    runtimeLabel,
    target,
    error,
    customOpen,
    customInstr,
    instrHistory,
    preview,
    showDiff,
    pinnedOpen,
    previewMaxH,
    statusHint,
    dragPos,
    panelId,
    busy,
    visible,
    inlineAiAutoPopup,
    setInlineAiAutoPopup,
    setCustomInstr,
    setPreviewMaxH,
    run,
    cancelRun,
    applyPreview,
    insertBelowPreview,
    editPreview,
    clearUi,
    discardPreview,
    dismissError,
    toggleCustomOpen,
    toggleShowDiff,
    recordInstruction,
    onDragStart,
  } = useSelectionAi({ editor, readOnly, notePath, frontmatter });
  const openOverlay = useViewStore((s) => s.openOverlay);
  const overlay = useViewStore((s) => s.overlay);

  // ── Dynamic panel height measurement for smart repositioning ──
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelH, setPanelH] = useState(0);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? el.offsetHeight;
      setPanelH(h);
    });
    ro.observe(el);
    setPanelH(el.offsetHeight);
    return () => ro.disconnect();
  }, [visible, preview, customOpen, busy, error]);

  // ── Copy preview to clipboard ──
  const [copied, setCopied] = useState(false);
  const copyPreview = useCallback(() => {
    if (!preview) return;
    void navigator.clipboard.writeText(preview).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }, [preview]);

  if (overlay !== "none") return null;

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
  // clamp horizontally so ~28rem panel stays in viewport. Drag override honored.
  const panelW = Math.min(window.innerWidth * 0.96, 28 * 16);
  const { top: barTop, left: barLeft } = clampSelectionAiPanel({
    dragPos,
    target,
    panelW,
    panelH,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
  });

  return (
    <div
      data-selection-ai
      id={panelId}
      ref={panelRef}
      role="dialog"
      aria-label={t("selectionAi.headerSelection")}
      aria-busy={busy}
      className="pointer-events-auto fixed z-floating v4-ai-panel-enter"
      style={{ top: Math.max(8, barTop), left: barLeft, maxWidth: panelW }}
      onMouseDown={(e) => {
        // Blanket preventDefault kept the editor selection but also made the
        // editable-preview textarea and inputs mouse-unfocusable — guard
        // interactive targets instead.
        const el = e.target as HTMLElement | null;
        if (el?.closest?.("input, textarea, select, button, [contenteditable='true']")) return;
        e.preventDefault();
      }}
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
        {/* Header: drag handle + status + auto-popup toggle + close */}
        <div className="flex items-center gap-1 border-b border-border-subtle-dim px-1 pb-1">
          <span
            className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-text-quaternary/50 hover:text-text-tertiary active:cursor-grabbing"
            onMouseDown={onDragStart}
            title={t("selectionAi.dragHint")}
            aria-label={t("selectionAi.dragHint")}
            role="button"
          >
            <RiDraggable size={ICON.micro} />
          </span>
          <span className="flex h-6 w-6 items-center justify-center text-accent-color" aria-hidden>
            {busy ? (
              <RiLoader4Line size={ICON.xs} className="animate-spin" />
            ) : (
              <RiSparklingLine size={ICON.xs} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-3xs font-medium text-text-secondary">
              {busy
                ? t("selectionAi.headerWorking")
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
              className="rounded px-1.5 py-0.5 text-3xs font-medium text-accent-color hover:bg-accent-bg-faint v4-focus-ring"
              onClick={() => openOverlay("settings", { topicId: "ai" })}
            >
              {t("selectionAi.configure")}
            </button>
          ) : null}
          {/* Auto-popup toggle — quick switch without going to settings */}
          <Tooltip content={inlineAiAutoPopup ? t("selectionAi.autoPopupOnTip") : t("selectionAi.autoPopupOffTip")}>
            <button
              type="button"
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
                "v4-focus-ring",
                inlineAiAutoPopup
                  ? "text-accent-color hover:bg-accent-bg-faint"
                  : "text-text-quaternary hover:bg-surface-muted",
              )}
              onClick={() => setInlineAiAutoPopup(!inlineAiAutoPopup)}
              aria-pressed={inlineAiAutoPopup}
              aria-label={inlineAiAutoPopup ? t("selectionAi.autoPopupOnTip") : t("selectionAi.autoPopupOffTip")}
            >
              {inlineAiAutoPopup ? <RiFlashlightFill size={ICON.xs} /> : <RiFlashlightLine size={ICON.xs} />}
            </button>
          </Tooltip>
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
            <RiCloseLine size={ICON.xs} />
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
          <div className="flex flex-col gap-1 border-t border-border-subtle-dim px-1 pt-1.5">
            <div className="flex gap-1">
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
                    recordInstruction(customInstr.trim());
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
                  recordInstruction(customInstr.trim());
                  void run("custom", customInstr.trim());
                }}
              >
                {t("selectionAi.generate")}
              </Button>
            </div>
            {instrHistory.length > 0 ? (
              <div className="flex flex-wrap gap-0.5">
                {instrHistory.map((h, i) => (
                  <button
                    key={`${h}-${i}`}
                    type="button"
                    className="max-w-[12rem] truncate rounded-[var(--radius-sm)] bg-surface-muted px-1.5 py-0.5 text-4xs text-text-tertiary hover:bg-accent-bg-faint hover:text-accent-color"
                    title={h}
                    onClick={() => setCustomInstr(h)}
                  >
                    {h}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {busy ? (
          <div
            className="flex flex-col gap-1.5 rounded-[var(--radius-md)] bg-accent-bg-faint px-2 py-1.5 text-3xs text-accent-color"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <RiLoader4Line size={ICON.xs} className="animate-spin shrink-0" />
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
            onInsertBelow={insertBelowPreview}
            onPreviewEdit={editPreview}
            onCopy={copyPreview}
            copied={copied}
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
