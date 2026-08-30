import { useEffect } from "react";
import { api } from "../../services/api";

/**
 * Renderer-level chords that bypass the workbench dispatcher:
 * Ctrl +/-/0 zoom (browser convention, works while typing). Meta is
 * deliberately excluded — macOS's app menu owns its own zoom roles, and
 * handling ⌘ here too would step twice on that platform.
 */
export function useShellShortcuts(): void {
  useEffect(() => {
    const onZoomKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== "=" && e.key !== "+" && e.key !== "-" && e.key !== "0") return;
      e.preventDefault();
      void api.sys.zoom(e.key === "0" ? "reset" : e.key === "-" ? "out" : "in");
    };
    window.addEventListener("keydown", onZoomKey);
    return () => window.removeEventListener("keydown", onZoomKey);
  }, []);
}
