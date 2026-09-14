import { useEffect } from "react";
import { api } from "../../services/api";

/**
 * Renderer-level chords that bypass the workbench dispatcher:
 * Ctrl +/-/0 zoom (browser convention, works while typing). Meta is
 * deliberately excluded — on macOS the native 显示 menu owns ⌘0/⌘+/⌘-, and
 * that menu item routes to this very same `api.sys.zoom` call. Handling ⌘ here
 * as well would step twice on that platform.
 *
 * The menu deliberately does NOT use the resetZoom/zoomIn/zoomOut roles: those
 * register CmdOrCtrl+0/± themselves, which is this listener's chord on
 * Windows/Linux too — one keypress, two owners, two zoom steps. See
 * electron/lib/menu-spec.mjs.
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
