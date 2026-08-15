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
  const sidebarWidth = useViewStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const sidebarView = useViewStore((s) => s.sidebarView);
  const aiPanelOpen = useViewStore((s) => s.aiPanelOpen);
  const aiPanelWidth = useViewStore((s) => s.aiPanelWidth);

  const uiHydrated = useRef(false);
  /** Skip the first post-hydrate UI persist so boot does not race-write defaults. */
  const skipNextUiPersist = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (typeof settings.ui?.aiPanelWidth === "number" && settings.ui.aiPanelWidth >= 280 && settings.ui.aiPanelWidth <= 560) {
      useViewStore.getState().setAiPanelWidth(settings.ui.aiPanelWidth);
    }
    setWorkspaceRoot(settings.workspaceRoot);
    // Only re-apply when UI/editor settings change — setWorkspaceRoot is a stable setter.
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
    };
    return api.sys
      .update({ ui: uiPatch })
      .then((next) => {
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

  // Settings dialog wrote ui fields → view-store already matches disk; skip the
  // next auto-persist so we never overwrite a Settings write with a stale frame.
  useEffect(() => {
    return onLocal(UI_SETTINGS_APPLIED_EVENT, () => {
      skipNextUiPersist.current = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    });
  }, []);

  // Persist UI state changes (debounced). Skip the first run after hydrate so
  // we never overwrite disk with pre-hydrate store defaults (or empty-file
  // recovery race on cold start). Also skip once after settings-driven apply.
  useEffect(() => {
    if (!uiHydrated.current) return;
    if (skipNextUiPersist.current) {
      skipNextUiPersist.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistUiNow();
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sidebarWidth, sidebarCollapsed, sidebarView, aiPanelOpen, aiPanelWidth, persistUiNow]);

  // Flush pending UI layout on hide/unload so last drag widths survive quit
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!uiHydrated.current || skipNextUiPersist.current) return;
      void persistUiNow();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [persistUiNow]);
}
