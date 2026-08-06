import { useEffect, useRef } from "react";
import { useAiStore } from "../../stores/ai-store";
import { useTodoStore } from "../../stores/todo-store";
import { onLocal } from "../../plugins/host";
import type { AppSettings } from "../../types";

/**
 * Auto AI todo maintain (opt-in, default off) — once per workspace session when
 * settings.ai.autoMaintainTodos && AI runtime ready. Manual path remains Stream ✨ / Todo panel.
 */
export function useAutoTodoMaintain(settings: AppSettings): void {
  /** Once-per-session gate for settings.ai.autoMaintainTodos */
  const autoTodoArmed = useRef(false);

  // After AI keys / provider saved: a newly configured key can trigger once
  useEffect(() => {
    return onLocal("ai:settings-changed", () => {
      // Re-arm auto-todo so a newly configured key can trigger once
      autoTodoArmed.current = false;
    });
  }, []);

  useEffect(() => {
    // Workspace switch resets the once-per-session arm
    autoTodoArmed.current = false;
  }, [settings.workspaceRoot]);

  useEffect(() => {
    if (autoTodoArmed.current) return;
    if (settings.ai?.autoMaintainTodos !== true) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await useAiStore.getState().refreshRuntimeStatus();
        if (cancelled || autoTodoArmed.current) return;
        if (!useAiStore.getState().runtimeStatus?.ready) return;
        autoTodoArmed.current = true;
        await useTodoStore.getState().maintain();
      } catch {
        /* offline / no period — StatusBar shows error via store */
      }
    };
    const delay = window.setTimeout(() => {
      void tick();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(delay);
    };
  }, [settings.ai?.autoMaintainTodos, settings.workspaceRoot]);
}
