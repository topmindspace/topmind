import { useEffect, useRef, useCallback } from "react";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { onLocal } from "../../plugins/host";
import { api } from "../../services/api";
import type { AppSettings } from "../../types";
import { setCachedSettings, patchCachedSettings } from "../../lib/settings-cache";
import { UI_SETTINGS_APPLIED_EVENT } from "../../lib/ui-settings-sync";
import { applyEditorSettingsToView } from "../../lib/editor-prefs";

/**
 * Two-way sync between persisted AppSettings and the view store:
 * hydrate UI / editor / AI flags on first mount, then persist UI layout
 * changes (debounced, flushed on hide/unload).
 */
export function useShellSettingsSync(settings: AppSettings): void {
  const setSidebarWidth = useViewStore((s) => s.setSidebarWidth);
  const setSidebarCollapsed = useViewStore((s) => s.setSidebarCollapsed);
  const setEditorSettings = useViewStore((s) => s.setEditorSettings);
  const setWritebackMode = useViewStore((s) => s.setWritebackMode);
  const setWorkspaceRoot = useViewStore((s) => s.setWorkspaceRoot);
  const setSidebarView = useViewStore((s) => s.setSidebarView);
  const setFeedLayout = useViewStore((s) => s.setFeedLayout);
  const sidebarWidth = useViewStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const sidebarView = useViewStore((s) => s.sidebarView);
  const feedLayout = useViewStore((s) => s.feedLayout);
  const aiPanelOpen = useViewStore((s) => s.aiPanelOpen);
  const aiPanelWidth = useViewStore((s) => s.aiPanelWidth);

  const uiHydrated = useRef(false);
  /**
   * Layout snapshot already known to be on disk (or hydrated from it).
   * Persist only when the live snapshot actually drifts from it — this
   * replaces fragile one-shot skip flags: hydrate-triggered store writes
   * used to leak an extra "no-change" persist on every boot.
   */
  const persistedSnapshot = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layoutSnapshot = useCallback(() => {
    const s = useViewStore.getState();
    return JSON.stringify([
      s.sidebarWidth,
      s.sidebarCollapsed,
      s.sidebarView,
      s.aiPanelOpen,
      s.aiPanelWidth,
      s.feedLayout,
    ]);
  }, []);

  // Hydrate UI / editor / AI agent flags from settings on first mount
  useEffect(() => {
    if (uiHydrated.current) return;
    uiHydrated.current = true;
    if (settings.ui) {
      if (typeof settings.ui.sidebarWidth === "number") setSidebarWidth(settings.ui.sidebarWidth);
      if (typeof settings.ui.sidebarCollapsed === "boolean") setSidebarCollapsed(settings.ui.sidebarCollapsed);
      const sv = settings.ui.sidebarView;
      if (sv === "stream" || sv === "category" || sv === "timeline" || sv === "tags" || sv === "kanban") {
        setSidebarView(sv);
      }
      const fl = settings.ui.feedLayout;
      if (fl === "list" || fl === "card") {
        setFeedLayout(fl);
      }
      // Drop one-time localStorage key from early v4 builds (settings.ui is canonical)
      try {
        localStorage.removeItem("topmind:sidebar-view-mode");
      } catch {
        /* ignore */
      }
    }
    if (settings.editor) {
      applyEditorSettingsToView(settings.editor, setEditorSettings);
      const tm = settings.editor.tabMode;
      if (tm === "single" || tm === "multi") {
        useViewStore.getState().setEditorTabMode(tm);
      }
    }
    if (settings.writebackMode) {
      const mode = settings.writebackMode as "auto" | "confirm";
      if (mode === "auto" || mode === "confirm") setWritebackMode(mode);
    }
    if (typeof settings.ai?.agentEnabled === "boolean") {
      useAiStore.getState().setAgentEnabled(settings.ai.agentEnabled);
    }
    if (typeof settings.ui?.aiPanelOpen === "boolean") {
      useViewStore.getState().setAiPanelOpen(settings.ui.aiPanelOpen);
    }
    if (typeof settings.ui?.aiPanelWidth === "number" && settings.ui.aiPanelWidth >= 280 && settings.ui.aiPanelWidth <= 800) {
      useViewStore.getState().setAiPanelWidth(settings.ui.aiPanelWidth);
    }
    setWorkspaceRoot(settings.workspaceRoot);
    // Whatever hydrate produced is by definition what disk holds
    persistedSnapshot.current = layoutSnapshot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ui, settings.editor]);

  const persistUiNow = useCallback(() => {
    const s = useViewStore.getState();
    const uiPatch = {
      sidebarWidth: s.sidebarWidth,
      sidebarCollapsed: s.sidebarCollapsed,
      sidebarView: s.sidebarView,
      aiPanelOpen: s.aiPanelOpen,
      aiPanelWidth: s.aiPanelWidth,
      feedLayout: s.feedLayout,
    };
    // Mark only THIS patch as persisted — a drag landing mid-flight keeps the
    // live snapshot ≠ ref and schedules its own persist.
    const key = JSON.stringify([
      uiPatch.sidebarWidth,
      uiPatch.sidebarCollapsed,
      uiPatch.sidebarView,
      uiPatch.aiPanelOpen,
      uiPatch.aiPanelWidth,
      uiPatch.feedLayout,
    ]);
    return api.sys
      .update({ ui: uiPatch })
      .then((next) => {
        persistedSnapshot.current = key;
        // Keep Settings dialog cache aligned with live shell widths so a later
        // settings toggle never re-applies a stale layout snapshot.
        if (next && typeof next === "object") {
          setCachedSettings(next as AppSettings);
        } else {
          patchCachedSettings({ ui: uiPatch });
        }
      })
      .catch(() => {/* ignore persistence errors */});
  }, []);

  // Settings dialog wrote ui fields → view-store already matches disk; adopt
  // that snapshot so we never overwrite a Settings write with a stale frame.
  useEffect(() => {
    return onLocal(UI_SETTINGS_APPLIED_EVENT, () => {
      persistedSnapshot.current = layoutSnapshot();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    });
  }, [layoutSnapshot]);

  // Persist UI layout drift (debounced 500ms). No-op when the live snapshot
  // equals the last known-on-disk snapshot (hydrate, settings apply).
  useEffect(() => {
    if (!uiHydrated.current) return;
    if (layoutSnapshot() === persistedSnapshot.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistUiNow();
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sidebarWidth, sidebarCollapsed, sidebarView, feedLayout, aiPanelOpen, aiPanelWidth, persistUiNow, layoutSnapshot]);

  // Flush pending UI layout on hide/unload so last drag widths survive quit
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!uiHydrated.current) return;
      if (layoutSnapshot() === persistedSnapshot.current) return;
      void persistUiNow();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [persistUiNow, layoutSnapshot]);
}
