/**
 * Overlay host + workbench keyboard shortcuts.
 * Shortcut definitions: src/lib/shortcuts.ts (single source of truth).
 * Overlay bodies are code-split — opened only when the user invokes them.
 */
import { lazy, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { onLocal, emitLocal } from "../../plugins/host";
import { registry } from "../../plugins/registry";
import { matchWorkbenchShortcut } from "../../lib/shortcuts";
import { runOverlayCloseGuard } from "../../lib/overlay-close-guard";
import { LazyBoundary } from "../ui/LazyBoundary";
import type { OverlayKind, Selection } from "../../types";
import { cn } from "../../lib/cn";

const QuickCapture = lazy(() =>
  import("../overlays/QuickCapture").then((m) => ({ default: m.QuickCapture })),
);
const CommandPalette = lazy(() =>
  import("../overlays/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const GlobalSearch = lazy(() =>
  import("../overlays/GlobalSearch").then((m) => ({ default: m.GlobalSearch })),
);
const SettingsDialog = lazy(() =>
  import("../overlays/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const LoopReport = lazy(() =>
  import("../overlays/LoopReport").then((m) => ({ default: m.LoopReport })),
);

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return Boolean(
    el.closest("input, textarea, select, [contenteditable='true'], .ProseMirror"),
  );
}

export function OverlayHost() {
  const { t } = useTranslation("shell");
  const overlay = useViewStore((s) => s.overlay);
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const select = useViewStore((s) => s.select);
  const back = useViewStore((s) => s.back);
  const forward = useViewStore((s) => s.forward);
  const setSidebarView = useViewStore((s) => s.setSidebarView);
  const closeFileTab = useViewStore((s) => s.closeFileTab);
  const closeAllFileTabs = useViewStore((s) => s.closeAllFileTabs);
  const toggleFocusMode = useViewStore((s) => s.toggleFocusMode);
  const setFocusMode = useViewStore((s) => s.setFocusMode);
  const fileTabs = useViewStore((s) => s.fileTabs);
  const selection = useViewStore((s) => s.selection);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Close through the active overlay's guard (settings flush) — closeOverlay
  // alone would unmount before the debounced batch is persisted.
  const requestCloseOverlay = useCallback(async () => {
    await runOverlayCloseGuard();
    closeOverlay();
  }, [closeOverlay]);

  // Restore focus + lock page scroll while any overlay is open
  useEffect(() => {
    if (overlay === "none") return;
    prevFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      const prev = prevFocusRef.current;
      if (prev && document.contains(prev) && typeof prev.focus === "function") {
        requestAnimationFrame(() => prev.focus());
      }
    };
  }, [overlay]);

  // Idle-prefetch heavy overlays so first open isn't a cold chunk parse
  useEffect(() => {
    const warm = () => {
      void import("../overlays/SettingsDialog");
      void import("../overlays/GlobalSearch");
      void import("../overlays/CommandPalette");
      void import("../overlays/QuickCapture");
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(warm, { timeout: 3500 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hit = matchWorkbenchShortcut(e);
      if (!hit) return;
      if (e.isComposing || e.keyCode === 229) return;

      // Tab close shortcuts: skip when typing in native fields (keep browser-like when editing text)
      if (
        (hit.action.type === "close-tab" || hit.action.type === "close-all-tabs") &&
        isEditableTarget(e.target)
      ) {
        return;
      }

      e.preventDefault();

      switch (hit.action.type) {
        case "close-overlay": {
          const st = useViewStore.getState();
          if (st.overlay !== "none") {
            void requestCloseOverlay();
          } else if (st.focusMode) {
            setFocusMode(false);
          }
          break;
        }
        case "overlay":
          openOverlay(hit.action.kind as OverlayKind, {
            intent: hit.action.intent as "capture" | "memory" | undefined,
            topicId: hit.action.topicId,
          });
          break;
        case "navigate":
          void requestCloseOverlay();
          select(hit.action.selection);
          break;
        case "sidebar-view":
          void requestCloseOverlay();
          setSidebarView(hit.action.mode);
          emitLocal("sidebar:set-view", hit.action.mode);
          break;
        case "emit":
          emitLocal(hit.action.event, hit.action.payload ?? null);
          break;
        case "back":
          back();
          break;
        case "forward":
          forward();
          break;
        case "toggle-focus":
          toggleFocusMode();
          break;
        case "close-tab": {
          const path =
            selection.kind === "file"
              ? selection.path
              : fileTabs.find((t) => !t.pinned)?.path || fileTabs[0]?.path;
          if (path) closeFileTab(path);
          break;
        }
        case "close-all-tabs":
          closeAllFileTabs({ closePinned: false });
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    openOverlay,
    requestCloseOverlay,
    select,
    back,
    forward,
    setSidebarView,
    closeFileTab,
    closeAllFileTabs,
    toggleFocusMode,
    setFocusMode,
    fileTabs,
    selection,
  ]);

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        back();
      } else if (e.button === 4) {
        e.preventDefault();
        forward();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [back, forward]);

  useEffect(() => {
    const unsub = onLocal("overlay:open", (payload) => {
      const p = payload as { kind?: string; intent?: "capture" | "memory"; topicId?: string };
      if (p?.kind === "quick-capture")
        openOverlay("quick-capture", { intent: p.intent, topicId: p.topicId });
      else if (p?.kind === "command-palette") openOverlay("command-palette");
      else if (p?.kind === "search") openOverlay("search");
      else if (p?.kind === "settings") openOverlay("settings", { topicId: p.topicId });
      else if (p?.kind === "loop-report")
        openOverlay("loop-report", {
          loopReport: (p as { loopReport?: unknown }).loopReport as import("../../types").LoopReportPayload,
        });
      else if (p?.kind) openOverlay(p.kind as OverlayKind);
    });
    return unsub;
  }, [openOverlay]);

  useEffect(() => {
    const unsub = onLocal("navigate:select", (payload) => {
      if (payload && typeof payload === "object" && "kind" in payload) {
        select(payload as Selection);
      }
    });
    return unsub;
  }, [select]);

  if (overlay === "none") return null;

  const isPalette = overlay === "command-palette" || overlay === "search";

  return (
    <div
      onClick={() => void requestCloseOverlay()}
      onContextMenu={(e) => {
        // Don't let native menu appear over our overlays
        e.preventDefault();
      }}
      role="presentation"
      className={cn(
        // Solid scrim — no full-viewport blur (major open jank)
        "fixed inset-0 z-overlay flex justify-center bg-scrim animate-fade-in",
        isPalette ? "items-start pt-[9vh] sm:pt-[11vh]" : "items-center",
      )}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "v4-panel-contain max-h-[90vh]",
          isPalette ? "max-w-[min(96vw,620px)]" : "max-w-[min(96vw,1040px)]",
        )}
      >
        <LazyBoundary
          className="min-h-[6rem] min-w-[14rem] rounded-[var(--radius-xl)] bg-surface p-4"
          label={t("overlayHost.loading")}
        >
          <Overlay kind={overlay} />
        </LazyBoundary>
      </div>
    </div>
  );
}

function Overlay({ kind }: { kind: OverlayKind }) {
  switch (kind) {
    case "quick-capture":
      return <QuickCapture />;
    case "command-palette":
      return <CommandPalette />;
    case "search":
      return <GlobalSearch />;
    case "settings":
      return <SettingsDialog />;
    case "loop-report":
      return <LoopReport />;
    default: {
      const slot = registry.resolveOverlay(kind);
      if (slot) return <>{slot.render()}</>;
      return null;
    }
  }
}
