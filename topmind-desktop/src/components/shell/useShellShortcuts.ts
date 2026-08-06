import { useEffect, type Dispatch, type SetStateAction } from "react";
import { useViewStore } from "../../stores/view-store";
import { emitLocal } from "../../plugins/host";

/** Productivity shortcuts (avoid when typing in inputs). */
export function useShellShortcuts(setTaskPanelOpen: Dispatch<SetStateAction<boolean>>): void {
  useEffect(() => {
    const SIDEBAR_VIEW_KEYS: Record<string, string> = {
      "1": "stream",
      "2": "category",
      "3": "timeline",
      "4": "tags",
      "5": "kanban",
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // ⌘1-5: sidebar view switching (no shift)
      if (!e.shiftKey && SIDEBAR_VIEW_KEYS[e.key]) {
        e.preventDefault();
        emitLocal("sidebar:set-view", SIDEBAR_VIEW_KEYS[e.key]);
        return;
      }

      // ⌘⇧X: navigation and panel shortcuts
      if (!e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "i") {
        e.preventDefault();
        useViewStore.getState().select({ kind: "inbox" });
      } else if (key === "b") {
        e.preventDefault();
        emitLocal("sidebar:set-view", "kanban");
      } else if (key === "o") {
        e.preventDefault();
        useViewStore.getState().select({ kind: "outputs" });
      } else if (key === "a") {
        // Don't steal select-all — only when not in editable (already guarded)
        e.preventDefault();
        useViewStore.getState().select({ kind: "archive" });
      } else if (key === "j") {
        e.preventDefault();
        setTaskPanelOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTaskPanelOpen]);
}
