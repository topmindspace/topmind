import { useEffect, useRef } from "react";
import { useAiStore } from "../../stores/ai-store";
import { useTodoStore } from "../../stores/todo-store";
import { useActionStore } from "../../stores/action-store";
import { onLocal } from "../../plugins/host";
import type { AppSettings } from "../../types";

/**
 * Auto AI todo maintain (opt-in, default off) — once per workspace session when
 * settings.ai.autoMaintainTodos && AI runtime ready.
 *
 * Yield policy (multi-AI coexistence):
 * - Wait until agent is not streaming
 * - Wait until suggest prepare is not loading (soft — background lane also serializes)
 * - Cap wait ~45s then run once anyway (avoid permanent starve)
 * Manual path remains Stream ✨ / Todo panel (always available).
 */
export function useAutoTodoMaintain(settings: AppSettings): void {
  /** Once-per-session gate for settings.ai.autoMaintainTodos */
  const autoTodoArmed = useRef(false);

  // After AI keys / provider saved: a newly configured key can trigger once
  useEffect(() => {
    return onLocal("ai:settings-changed", () => {
      autoTodoArmed.current = false;
    });
  }, []);

  useEffect(() => {
    autoTodoArmed.current = false;
  }, [settings.workspaceRoot]);

  useEffect(() => {
    if (autoTodoArmed.current) return;
    if (settings.ai?.autoMaintainTodos !== true) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~45s at 1.5s
    const INTERVAL_MS = 1500;
    const INITIAL_DELAY_MS = 2800; // after suggest boot has a chance to start

    const tryRun = async () => {
      if (cancelled || autoTodoArmed.current) return;
      try {
        await useAiStore.getState().refreshRuntimeStatus();
        if (cancelled || autoTodoArmed.current) return;
        if (!useAiStore.getState().runtimeStatus?.ready) return;

        const streaming = useAiStore.getState().streaming === true;
        const suggestLoading = useActionStore.getState().loading === true;
        const todoBusy = useTodoStore.getState().maintaining === "maintaining";

        if (streaming || suggestLoading || todoBusy) {
          attempts += 1;
          if (attempts < MAX_ATTEMPTS) {
            window.setTimeout(() => {
              void tryRun();
            }, INTERVAL_MS);
            return;
          }
          // Starve-break: run once after wait budget even if agent still busy
          // (lane will serialize behind suggest; agent remains independent)
        }

        autoTodoArmed.current = true;
        await useTodoStore.getState().maintain();
      } catch {
        /* offline / no period — StatusBar / store surfaces error */
        autoTodoArmed.current = true; // do not thrash retries this session
      }
    };

    const delay = window.setTimeout(() => {
      void tryRun();
    }, INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(delay);
    };
  }, [settings.ai?.autoMaintainTodos, settings.workspaceRoot]);
}
