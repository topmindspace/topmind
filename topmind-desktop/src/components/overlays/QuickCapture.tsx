/**
 * Unified Capture — smart knowledge intake.
 *
 * One surface for: text notes · URL fetch · clipboard files · drop · document pipeline.
 * Modes auto-detect; user can also force note vs documents.
 *
 * Surfaces:
 *  - overlay (main shell ⌘N)
 *  - float (global ⌘⇧N sticky window via ?surface=capture)
 *
 * Composition layer: sheet chrome, float drag region, keyboard lifecycle.
 * Form state/submit lives in CaptureForm (useCaptureForm); link fetch preview in
 * CapturePreview; paste/drag-drop wiring in CaptureAttachments (useCaptureDrop).
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Brain, ClipboardPaste, FileInput, X, Paperclip } from "lucide-react";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import {
  CaptureAttachmentList,
  CaptureDropHint,
  useCaptureDrop,
} from "./CaptureAttachments";
import { CaptureForm, useCaptureForm } from "./CaptureForm";
import { CapturePreview } from "./CapturePreview";
import { isCaptureSurface, splitTopicId } from "./quick-capture-helpers";

// Re-export attachment type for external callers
export type { CaptureAttachment } from "./quick-capture-helpers";

export type QuickCaptureProps = {
  /** float surface — no full shell chrome */
  variant?: "overlay" | "float";
  onDone?: () => void;
};

export function QuickCapture({ variant, onDone }: QuickCaptureProps = {}) {
  const { t } = useTranslation();
  const surface = variant || (isCaptureSurface() ? "float" : "overlay");
  const isFloat = surface === "float";

  const overlayContext = useViewStore((s) => s.overlayContext);
  const memoryTopicId =
    overlayContext?.intent === "memory" ? overlayContext.topicId : undefined;
  const isMemory = Boolean(memoryTopicId) && !isFloat;
  const topicName = memoryTopicId ? splitTopicId(memoryTopicId).topic : "";

  const form = useCaptureForm({ isFloat, isMemory, memoryTopicId, onDone });
  const { dragOver, containerProps } = useCaptureDrop({
    isFloat,
    addPaths: form.addPaths,
    handleSmartPaste: form.handleSmartPaste,
    setError: form.setError,
  });
  const sheetRef = useRef<HTMLDivElement>(null);

  // ⌘/Ctrl+Enter submit — ref always points at the latest handleSubmit closure
  const submitRef = useRef(form.handleSubmit);
  submitRef.current = form.handleSubmit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submitRef.current();
      }
      if (e.key === "Escape" && isFloat) {
        e.preventDefault();
        void api.sys.closeQuickCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFloat]);

  // Auto-read clipboard files when float opens (smart paste welcome)
  useEffect(() => {
    if (!isFloat) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.sys.settings();
        const smart = (s as { capture?: { smartPaste?: boolean } }).capture?.smartPaste !== false;
        if (!smart || cancelled) return;
        const clip = await api.ingest.readClipboard();
        if (cancelled) return;
        if (clip.filePaths?.length) {
          form.addPaths(clip.filePaths);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFloat, form.addPaths]);

  return (
    <div
      ref={sheetRef}
      className={cn(
        "v4-overlay-sheet w-[min(480px,94vw)] p-4 sm:p-5",
        // Float: fill utility window with opaque sheet (never transparent blank)
        isFloat &&
          "v4-no-drag flex max-h-[100vh] w-full max-w-none flex-1 flex-col rounded-none border-0 bg-surface shadow-none",
        dragOver && "ring-2 ring-accent-color",
      )}
      style={isFloat ? { minHeight: "100%" } : undefined}
      role="dialog"
      aria-label={isMemory ? t("overlays:capture.ariaMemory") : t("overlays:capture.ariaCapture")}
      {...containerProps}
    >
      {/* Float drag region — single chrome (Win uses titleBarOverlay, not second native bar) */}
      {isFloat ? (
        <div
          className={cn(
            "v4-drag mb-2 flex h-8 items-center justify-between px-0.5",
            typeof navigator !== "undefined" &&
              (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent || "")) &&
              "v4-win-float-caption-pad",
          )}
        >
          <span className="text-3xs font-medium tracking-tight text-text-quaternary">
            {t("overlays:capture.floatTitle")}
          </span>
          {/* macOS / Linux: explicit close; Windows caption buttons come from titleBarOverlay */}
          {typeof navigator !== "undefined" &&
          !(/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent || "")) ? (
            <button
              type="button"
              className="v4-no-drag flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              onClick={() => void api.sys.closeQuickCapture()}
              aria-label={t("overlays:capture.close")}
            >
              <X size={ICON.sm} />
            </button>
          ) : (
            <span className="v4-no-drag w-1" aria-hidden />
          )}
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium tracking-tight text-text-primary">
          <span className="v4-icon-chip-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)]" aria-hidden>
            {isMemory ? <Brain size={ICON.sm} /> : form.effectiveMode === "docs" ? <FileInput size={ICON.sm} /> : <Zap size={ICON.sm} />}
          </span>
          <span className="truncate">
            {isMemory
              ? t("overlays:capture.memoryTitle")
              : t("overlays:capture.title")}
          </span>
        </h2>
        <span className="flex shrink-0 items-center gap-1 text-3xs text-text-tertiary">
          {isMemory ? (
            <span className="max-w-[140px] truncate" title={topicName}>
              {topicName}
            </span>
          ) : (
            <>
              <Tooltip content={t("overlays:capture.pasteTooltip")}>
                <button
                  type="button"
                  onClick={() => void form.handleSmartPaste()}
                  className="v4-titlebar-btn h-7 gap-1 border border-border-subtle-dim px-2 text-3xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                  aria-label={t("overlays:capture.pasteAriaLabel")}
                >
                  <ClipboardPaste size={ICON.xs} aria-hidden /> {t("overlays:capture.pasteLabel")}
                </button>
              </Tooltip>
              <Tooltip content={t("overlays:capture.attachTooltip")}>
                <button
                  type="button"
                  onClick={() => void form.pickFiles()}
                  className="v4-titlebar-btn h-7 gap-1 border border-border-subtle-dim px-2 text-3xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                  aria-label={t("overlays:capture.attachAriaLabel")}
                >
                  <Paperclip size={ICON.xs} aria-hidden /> {t("overlays:capture.attachLabel")}
                </button>
              </Tooltip>
              <kbd className="v4-kbd" aria-hidden>
                ⌘↵
              </kbd>
            </>
          )}
        </span>
      </div>

      <CaptureForm
        form={form}
        isFloat={isFloat}
        isMemory={isMemory}
        topicName={topicName}
        wrapperClassName={isFloat ? "flex min-h-0 flex-1 flex-col" : undefined}
        attachmentsSlot={
          <>
            <CaptureAttachmentList attachments={form.attachments} onRemove={form.removeAttachment} />
            <CaptureDropHint
              visible={!isMemory && form.attachments.length === 0 && (form.mode === "docs" || dragOver)}
            />
          </>
        }
        previewSlot={<CapturePreview form={form} isMemory={isMemory} />}
      />
    </div>
  );
}
