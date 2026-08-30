import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { emitLocal, reloadExternalPlugins, togglePlugin } from "../../plugins/host";
import type { AppSettings, AppSettingsPatch } from "../../types";
import { getCachedSettings, setCachedSettings } from "../../lib/settings-cache";
import { applyOptimistic, mergeSettingsPatch } from "../../lib/settings-merge";
import {
  applyLiveUiSnapshot,
  extractLiveUiFromSettingsPatch,
  UI_SETTINGS_APPLIED_EVENT,
} from "../../lib/ui-settings-sync";
import { applyEditorSettingsToView } from "../../lib/editor-prefs";

/**
 * Settings state + optimistic debounced persistence for SettingsDialog.
 * Owns load, patch merge, auto-save flush, and live store sync.
 */
export function useSettingsController() {
  const setEditorSettings = useViewStore((s) => s.setEditorSettings);
  const setTheme = useViewStore((s) => s.setTheme);
  const setWritebackMode = useViewStore((s) => s.setWritebackMode);
  const setSidebarView = useViewStore((s) => s.setSidebarView);
  // Paint from last-known settings immediately (no spinner on re-open)
  const [settings, setSettings] = useState<AppSettings | null>(() => getCachedSettings());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<AppSettingsPatch>({});
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    void api.sys.settings().then((s) => {
      // A fast edit made while this IPC round-trip was in flight must win —
      // painting the disk snapshot now would visually revert it until the
      // debounced flush response lands.
      if (pendingPatch.current && Object.keys(pendingPatch.current).length > 0) return;
      const next = s as AppSettings;
      setCachedSettings(next);
      setSettings(next);
      if (typeof next.ai?.agentEnabled === "boolean") {
        useAiStore.getState().setAgentEnabled(next.ai.agentEnabled);
      }
    });
  }, []);

  /** Strip modelCache so UI patches never wipe a live-fetched catalog on disk. */
  const toApiBatch = (batch: AppSettingsPatch): Record<string, unknown> => {
    const apiBatch: Record<string, unknown> = { ...batch };
    if (batch.ai && typeof batch.ai === "object") {
      const { modelCache: _discard, ...aiRest } = batch.ai;
      apiBatch.ai = aiRest;
    }
    return apiBatch;
  };

  const applyPersistResponse = (ns: AppSettings, apiBatch: Record<string, unknown>) => {
    setCachedSettings(ns);
    setSettings(ns);
    if (ns.editor) {
      applyEditorSettingsToView(ns.editor, setEditorSettings);
      const tm = (ns.editor as { tabMode?: string }).tabMode;
      if (tm === "single" || tm === "multi") {
        useViewStore.getState().setEditorTabMode(tm);
      }
    }
    if (apiBatch.ai) emitLocal("ai:settings-changed", null);
    const wsRoot = ns.workspaceRoot;
    if (apiBatch.weread) void togglePlugin("topmind-weread", wsRoot);
    if (apiBatch.x) void togglePlugin("topmind-x", wsRoot);
    if (apiBatch.ledger) void togglePlugin("topmind-ledger", wsRoot);
    // Re-apply external enable map after persist (hot reload without app restart)
    if (apiBatch.plugins && wsRoot) void reloadExternalPlugins(wsRoot, { cacheBust: false });
  };

  const flushPending = useCallback(async () => {
    const batch = pendingPatch.current;
    if (!batch || Object.keys(batch).length === 0) return;
    pendingPatch.current = {};
    if (updateTimer.current) {
      clearTimeout(updateTimer.current);
      updateTimer.current = null;
    }
    const apiBatch = toApiBatch(batch);
    setSaving(true);
    setError(null);
    try {
      const next = await api.sys.update(apiBatch);
      applyPersistResponse(next as AppSettings, apiBatch);
    } catch (e) {
      // Re-queue instead of dropping: the dialog keeps showing the edits as
      // pending (not saved) and the next flush retries the whole batch.
      pendingPatch.current = mergeSettingsPatch(batch, pendingPatch.current);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEditorSettings]);

  // Flush pending debounce on unmount — safety net for close paths that skip
  // the guard (app quit, store-driven overlay swap). Response side effects are
  // applied the same way as an in-dialog flush; setState calls no-op safely.
  const flushRef = useRef(flushPending);
  flushRef.current = flushPending;
  useEffect(() => {
    return () => {
      if (updateTimer.current) clearTimeout(updateTimer.current);
      void flushRef.current();
    };
  }, []);

  const update = (patch: AppSettingsPatch) => {
    if (!settingsRef.current) return;
    const optimistic = applyOptimistic(settingsRef.current, patch);
    setCachedSettings(optimistic);
    setSettings(optimistic);

    if (patch.editor) {
      applyEditorSettingsToView(optimistic.editor, setEditorSettings);
      const tm = (optimistic.editor as { tabMode?: string }).tabMode;
      if (tm === "single" || tm === "multi") {
        useViewStore.getState().setEditorTabMode(tm);
      }
    }
    if (patch.theme) setTheme(patch.theme);
    if (patch.writebackMode) {
      const mode = patch.writebackMode as "auto" | "confirm";
      if (mode === "auto" || mode === "confirm") setWritebackMode(mode);
    }
    if (patch.ai && typeof patch.ai.agentEnabled === "boolean") {
      useAiStore.getState().setAgentEnabled(patch.ai.agentEnabled);
    }
    // skillsEnabled / enabledSkillIds persist via disk only; agent reloads catalog each invoke
    // Live-sync only keys own-present on the ui *delta* (never re-apply full cached layout).
    if (patch.ui) {
      const snap = extractLiveUiFromSettingsPatch(patch.ui);
      const vs = useViewStore.getState();
      const applied = applyLiveUiSnapshot(snap, {
        setSidebarWidth: vs.setSidebarWidth,
        setSidebarCollapsed: vs.setSidebarCollapsed,
        setSidebarView: vs.setSidebarView,
        setAiPanelOpen: vs.setAiPanelOpen,
        setAiPanelWidth: vs.setAiPanelWidth,
        setFeedLayout: vs.setFeedLayout,
      });
      if (snap.sidebarView) setSidebarView(snap.sidebarView);
      if (applied) emitLocal(UI_SETTINGS_APPLIED_EVENT, snap);
    }

    pendingPatch.current = mergeSettingsPatch(pendingPatch.current, patch);
    if (updateTimer.current) clearTimeout(updateTimer.current);
    updateTimer.current = setTimeout(() => {
      void flushPending();
    }, 300);
  };

  return { settings, saving, error, update, flushPending };
}
