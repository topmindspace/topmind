import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Compass, Radio, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRegistry } from "../../plugins/registry";
import { useViewStore } from "../../stores/view-store";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/view";
import { LazyBoundary } from "../ui/LazyBoundary";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { EditorRecentBar } from "./EditorRecentBar";
import { isMarkdownNotePath } from "../../lib/file-preview";
import type { Selection } from "../../types";

const FileEditorView = lazy(() =>
  import("../../plugins/topmind-workspace/views/FileEditorView").then((m) => ({
    default: m.FileEditorView,
  })),
);
const FilePreviewView = lazy(() =>
  import("../../plugins/topmind-workspace/views/FilePreviewView").then((m) => ({
    default: m.FilePreviewView,
  })),
);

function topicIdFromPath(path: string): string | undefined {
  const parts = path.split("/");
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
}

/**
 * Main canvas. Always keeps tab strip when tabs exist and never leaves a
 * fully blank pane after closing all file tabs — falls back to stream.
 *
 * Vertical split: session-only secondary path (对照) beside primary file
 * selection — not a dual navigation history.
 */
export function EditorArea() {
  const { t } = useTranslation("shell");
  const selection = useViewStore((s) => s.selection);
  const resolveView = useRegistry((s) => s.resolveView);
  const select = useViewStore((s) => s.select);
  const focusMode = useViewStore((s) => s.focusMode);
  const viewSlots = useRegistry((s) => s.viewSlots);
  const splitSecondaryPath = useViewStore((s) => s.splitSecondaryPath);
  const splitPrimaryRatio = useViewStore((s) => s.splitPrimaryRatio);
  const setSplitPrimaryRatio = useViewStore((s) => s.setSplitPrimaryRatio);
  const clearSplit = useViewStore((s) => s.clearSplit);
  const swapSplitPanes = useViewStore((s) => s.swapSplitPanes);

  const effectiveSel: Selection = useMemo(() => {
    if (resolveView(selection)) return selection;
    return { kind: "stream" };
  }, [selection, resolveView, viewSlots.length]);

  const viewSlot = resolveView(effectiveSel);

  const showSplit =
    effectiveSel.kind === "file" &&
    Boolean(splitSecondaryPath) &&
    splitSecondaryPath !== effectiveSel.path;

  // Heal unknown/orphan selection → stream
  useEffect(() => {
    if (viewSlots.length === 0) return;
    if (!resolveView(selection)) {
      select({ kind: "stream" });
    }
  }, [selection, viewSlots.length, resolveView, select]);

  // Drop split when leaving file canvas
  useEffect(() => {
    if (effectiveSel.kind !== "file" && splitSecondaryPath) {
      clearSplit();
    }
  }, [effectiveSel.kind, splitSecondaryPath, clearSplit]);

  if (!viewSlot) {
    return (
      <div className="v4-main-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {focusMode ? null : <EditorRecentBar />}
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<Compass size={ICON.md} />}
            title={viewSlots.length === 0 ? t("editorArea.loadingWorkspace") : t("editorArea.noViewMatch")}
            hint={viewSlots.length === 0 ? undefined : t("editorArea.noViewMatchHint")}
            action={
              <Tooltip content={t("editorArea.backToStream")}>
                <Button variant="outline" size="sm" onClick={() => select({ kind: "stream" })}>
                  <Radio size={ICON.xs} /> {t("editorArea.goStream")}
                </Button>
              </Tooltip>
            }
            className="max-w-sm px-8 py-10"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="v4-main-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {focusMode ? null : <EditorRecentBar />}
      {showSplit ? (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="min-h-0 min-w-0 overflow-auto"
            style={{ flex: `${splitPrimaryRatio} 1 0%` }}
          >
            {viewSlot.render({ sel: effectiveSel })}
          </div>
          <SplitDivider
            ratio={splitPrimaryRatio}
            onRatioChange={setSplitPrimaryRatio}
          />
          <div
            className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border-subtle-dim"
            style={{ flex: `${1 - splitPrimaryRatio} 1 0%` }}
          >
            <div className="v4-split-chrome flex h-7 shrink-0 items-center gap-1 border-b border-border-subtle-dim bg-app-chrome/60 px-2">
              <Columns2 size={ICON.micro} className="shrink-0 text-accent-color" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-3xs text-text-tertiary" title={splitSecondaryPath!}>
                {splitSecondaryPath!.split("/").pop()}
              </span>
              <Tooltip content={t("editorArea.swapPanes")}>
                <button
                  type="button"
                  className="v4-titlebar-btn h-6 w-6"
                  onClick={() => swapSplitPanes()}
                  aria-label={t("editorArea.swapPanesAriaLabel")}
                >
                  <Columns2 size={ICON.micro} />
                </button>
              </Tooltip>
              <Tooltip content={t("editorArea.closeSplit")}>
                <button
                  type="button"
                  className="v4-titlebar-btn h-6 w-6"
                  onClick={() => clearSplit()}
                  aria-label={t("editorArea.closeSplitAriaLabel")}
                >
                  <X size={ICON.micro} />
                </button>
              </Tooltip>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              <LazyBoundary label={t("editorArea.loadingSplit")}>
                {isMarkdownNotePath(splitSecondaryPath!) ? (
                  <FileEditorView
                    path={splitSecondaryPath!}
                    topicId={topicIdFromPath(splitSecondaryPath!)}
                  />
                ) : (
                  <FilePreviewView
                    key={splitSecondaryPath!}
                    path={splitSecondaryPath!}
                    topicId={topicIdFromPath(splitSecondaryPath!)}
                  />
                )}
              </LazyBoundary>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {viewSlot.render({ sel: effectiveSel })}
        </div>
      )}
    </div>
  );
}

/** Lightweight vertical divider — drag to rebalance split panes. */
function SplitDivider({
  ratio,
  onRatioChange,
}: {
  ratio: number;
  onRatioChange: (r: number) => void;
}) {
  const { t } = useTranslation("shell");
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      setActive(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const parent = (e.currentTarget as HTMLElement).parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      if (rect.width < 80) return;
      const next = (e.clientX - rect.left) / rect.width;
      onRatioChange(next);
    },
    [onRatioChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    setActive(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
  }, []);

  return (
    <div
      ref={containerRef}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={t("editorArea.splitSeparatorAriaLabel")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn(
        "group relative z-local flex w-1 shrink-0 cursor-col-resize items-stretch justify-center",
        "bg-border-subtle-dim transition-colors",
        active && "bg-accent-color",
      )}
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <span
        className={cn(
          "my-auto h-8 w-0.5 rounded-full bg-border-strong opacity-0 transition-opacity group-hover:opacity-100",
          active && "opacity-100 bg-accent-color",
        )}
        aria-hidden
      />
    </div>
  );
}
