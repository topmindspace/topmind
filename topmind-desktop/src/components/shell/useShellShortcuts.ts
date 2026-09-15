import { useEffect } from "react";
import { api } from "../../services/api";

/**
 * Zoom keys, including the shifted forms of the same physical keys. `+` and `_`
 * are listed explicitly because on most layouts they are Shift+`=` / Shift+`-`,
 * and the browser convention is that both spellings zoom.
 */
const ZOOM_KEYS: Record<string, "in" | "out" | "reset"> = {
  "=": "in",
  "+": "in",
  "-": "out",
  _: "out",
  "0": "reset",
};

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
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const mode = ZOOM_KEYS[e.key];
      if (!mode) return;
      // `=` and `-` are the unshifted keys; `+` and `_` are what the same
      // physical keys produce with Shift. Those two are the only chords that may
      // carry Shift — and they must, because on Windows "Ctrl +" *is*
      // Ctrl+Shift+=. The previous handler rejected every Shift press outright,
      // so the conventional zoom-in chord returned early and the `"+"` branch was
      // unreachable code: Windows users could only zoom in with Ctrl+= .
      if (e.shiftKey && mode === "reset") return;
      e.preventDefault();
      void api.sys.zoom(mode);
    };
    window.addEventListener("keydown", onZoomKey);
    return () => window.removeEventListener("keydown", onZoomKey);
  }, []);
}
