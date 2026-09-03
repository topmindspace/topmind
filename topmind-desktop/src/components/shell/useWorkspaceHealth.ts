import { useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { useActionStore } from "../../stores/action-store";

export interface EngineHealth {
  ok: boolean;
  engineRoot: string | null;
  workspaceRoot: string | null;
}

/**
 * Workspace health probe + boot guidance: once the workspace reports healthy,
 * re-arm the suggest store with a soft refresh (boot IPC may race empty root).
 */
export function useWorkspaceHealth(): EngineHealth | null {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  /** Re-arm suggest auto-prepare once workspace is healthy (boot IPC may race empty root). */
  const suggestBootArmed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.sys.health();
        if (!cancelled) setHealth(h as EngineHealth);
      } catch {
        if (!cancelled) setHealth({ ok: false, engineRoot: null, workspaceRoot: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // After workspace is healthy, re-arm suggest once (boot may race empty root before settings).
  // Soft refresh only — force would clear durable activity fingerprints and thrash AI every launch.
  // Manual regenerate / user toggle autoPrepare still uses force via SuggestPopover & setAutoPrepare.
  useEffect(() => {
    if (!health?.ok || !health.workspaceRoot) return;
    if (suggestBootArmed.current) return;
    suggestBootArmed.current = true;
    const st = useActionStore.getState();
    // Soft path: kernel generateSuggestions without force; durable fingerprint skip survives restart
    void st.refresh();
  }, [health?.ok, health?.workspaceRoot]);

  return health;
}
