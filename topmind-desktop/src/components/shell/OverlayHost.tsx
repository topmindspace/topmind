/**
 * Overlay host + workbench keyboard shortcuts.
 * Shortcut definitions: src/lib/shortcuts.ts (single source of truth).
 * Overlay bodies are code-split — opened only when the user invokes them.
 */
import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { onLocal, emitLocal } from "../../plugins/host";
import { registry } from "../../plugins/registry";
import { matchWorkbenchShortcut } from "../../lib/shortcuts";
import { runOverlayCloseGuard } from "../../lib/overlay-close-guard";
import {
  OverlayPortalContext,
  acquireOverlayLayer,
  setOverlayPortalRoot,
} from "../../lib/overlay-layer";
import { getFocusable } from "../ui/Dialog";
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
const PluginAppSurface = lazy(() =>
  import("../overlays/PluginAppSurface").then((m) => ({ default: m.PluginAppSurface })),
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
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

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

  // Modal layer: stamps html[data-overlay-open] (flattens list sticky day
  // headers) + inerts #workbench-root. Do not depend on portalEl.
  useEffect(() => {
    if (overlay === "none") return;
    return acquireOverlayLayer();
  }, [overlay]);

  useEffect(() => {
    if (overlay === "none" || !portalEl) return;
    setOverlayPortalRoot(portalEl);
  }, [overlay, portalEl]);

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

  // Initial focus: if the overlay body didn't autofocus anything (e.g.
  // Settings), bring focus inside the dialog so Tab starts in the right place.
  useEffect(() => {
    if (overlay === "none") return;
    const wrap = portalEl;
    if (!wrap) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && wrap.contains(active)) return;
    const focusables = getFocusable(wrap);
    requestAnimationFrame(() => (focusables[0] ?? wrap).focus());
  }, [overlay, portalEl]);

  // Tab trap (bubble phase): cycle focus inside the overlay panel. Yields to
  // dialogs/portaled surfaces — anything that already default-prevented the
  // event, and to `.v4-menu-surface` portals that live outside this subtree.
  useEffect(() => {
    if (overlay === "none") return;
    const onTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const wrap = portalEl;
      if (!wrap) return;
      const active = document.activeElement;
      if (!(active instanceof Element)) return;
      if (!wrap.contains(active)) {
        // Focus escaped to a portaled menu surface — leave it alone.
        if (active.closest(".v4-menu-surface, [role='listbox']")) return;
        const focusables = getFocusable(wrap);
        e.preventDefault();
        (focusables[0] ?? wrap).focus();
        return;
      }
      const focusables = getFocusable(wrap);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = active;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTrap);
    return () => window.removeEventListener("keydown", onTrap);
  }, [overlay, portalEl]);

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
        case "overlay": {
          const kind = hit.action.kind as OverlayKind;
          // Toggle semantics: invoking the shortcut for the already-open
          // surface dismisses it (⌘K ⌘K closes the palette).
          if (useViewStore.getState().overlay === kind) {
            void requestCloseOverlay();
          } else {
            openOverlay(kind, {
              intent: hit.action.intent as "capture" | "memory" | undefined,
              topicId: hit.action.topicId,
            });
          }
          break;
        }
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
        case "toggle-split": {
          // 对照 split: only meaningful on a file selection; toggles the
          // secondary pane for the active file.
          const st = useViewStore.getState();
          if (st.selection.kind !== "file") break;
          if (st.splitSecondaryPath === st.selection.path) st.clearSplit();
          else st.openInSplit(st.selection.path);
          break;
        }
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
      const p = payload as {
        kind?: string;
        intent?: "capture" | "memory";
        topicId?: string;
        pluginId?: string;
        loopReport?: import("../../types").LoopReportPayload;
      };
      if (p?.kind === "quick-capture")
        openOverlay("quick-capture", { intent: p.intent, topicId: p.topicId });
      else if (p?.kind === "command-palette") openOverlay("command-palette");
      else if (p?.kind === "search") openOverlay("search");
      else if (p?.kind === "settings") openOverlay("settings", { topicId: p.topicId });
      else if (p?.kind === "loop-report")
        openOverlay("loop-report", { loopReport: p.loopReport });
      else if (p?.kind === "plugin-app")
        openOverlay("plugin-app", { pluginId: p.pluginId });
      else if (p?.kind) openOverlay(p.kind as OverlayKind, p);
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
  const isMiniApp = overlay === "plugin-app";

  return createPortal(
    <OverlayPortalContext.Provider value={portalEl}>
      <div
        onClick={() => void requestCloseOverlay()}
        onContextMenu={(e) => {
          // Native edit menu stays available in text fields (paste/look-up);
          // suppress it only over non-editable overlay chrome.
          const el = e.target as HTMLElement | null;
          if (el?.closest?.("input, textarea, select, [contenteditable='true'], .ProseMirror")) {
            return;
          }
          e.preventDefault();
        }}
        role="presentation"
        data-overlay-root
        data-overlay-kind={overlay}
        className={cn(
          // Modal layer on <body> — isolate so sticky/backdrop canvas chrome
          // cannot composite above the scrim. v4-no-drag blocks Electron
          // titlebar drag regions punching through the sheet.
          "v4-no-drag isolate fixed inset-0 z-modal flex justify-center bg-scrim animate-fade-in",
          isPalette ? "items-start pt-[9vh] sm:pt-[11vh]" : "items-center",
          isMiniApp && "p-3 sm:p-6",
        )}
      >
        <div
          ref={setPortalEl}
          onClick={(e) => e.stopPropagation()}
          tabIndex={-1}
          className={cn(
            "v4-panel-contain max-h-[90vh] outline-none",
            isPalette ? "max-w-[min(96vw,620px)]" : isMiniApp ? "max-w-[min(96vw,880px)] w-full" : "max-w-[min(96vw,1040px)]",
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
    </OverlayPortalContext.Provider>,
    document.body,
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
    case "plugin-app":
      return <PluginAppSurface />;
    default: {
      const slot = registry.resolveOverlay(kind);
      if (slot) return <>{slot.render()}</>;
      return null;
    }
  }
}
