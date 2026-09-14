/**
 * Workbench command dispatcher — the one place a `ShortcutAction` becomes a
 * side effect.
 *
 * Extracted from OverlayHost so the **native application menu** can run the
 * exact same commands as the keyboard. Before this, the menu would have needed
 * its own copy of a 12-branch switch; two copies of the same behavior is how
 * "menu item works but the chord doesn't" bugs get born.
 *
 * Everything is read from the view store at call time (never closed over), so
 * both callers — a keydown listener and an IPC menu command — see identical
 * state, and the module stays free of React.
 */
import { useViewStore } from "../stores/view-store";
import { emitLocal } from "../plugins/host";
import { runOverlayCloseGuard } from "./overlay-close-guard";
import type { ShortcutAction } from "./shortcuts";
import type { OverlayKind } from "../types";

/**
 * Execute a workbench action. Returns false when the action could not apply
 * (e.g. 对照分栏 on a non-file selection) so callers can decide to fall through.
 */
export function runWorkbenchAction(action: ShortcutAction): boolean {
  const store = useViewStore.getState();

  switch (action.type) {
    case "close-overlay": {
      if (store.overlay !== "none") {
        void closeOverlayGuarded();
      } else if (store.focusMode) {
        store.setFocusMode(false);
      }
      return true;
    }

    case "overlay": {
      const kind = action.kind as OverlayKind;
      // Toggle semantics: invoking the command for the already-open surface
      // dismisses it (⌘K ⌘K closes the palette).
      if (store.overlay === kind) {
        void closeOverlayGuarded();
      } else {
        store.openOverlay(kind, {
          intent: action.intent as "capture" | "memory" | undefined,
          topicId: action.topicId,
        });
      }
      return true;
    }

    case "navigate":
      void closeOverlayGuarded();
      store.select(action.selection);
      return true;

    case "sidebar-view":
      void closeOverlayGuarded();
      store.setSidebarView(action.mode);
      emitLocal("sidebar:set-view", action.mode);
      return true;

    case "emit":
      emitLocal(action.event, action.payload ?? null);
      return true;

    case "back":
      store.back();
      return true;

    case "forward":
      store.forward();
      return true;

    case "toggle-focus":
      store.toggleFocusMode();
      return true;

    case "close-tab": {
      const active = store.selection;
      const path =
        active.kind === "file"
          ? active.path
          : store.fileTabs.find((t) => !t.pinned)?.path || store.fileTabs[0]?.path;
      if (!path) return false;
      store.closeFileTab(path);
      return true;
    }

    case "close-all-tabs":
      store.closeAllFileTabs({ closePinned: false });
      return true;

    case "toggle-split": {
      // 对照 split: only meaningful on a file selection.
      if (store.selection.kind !== "file") return false;
      if (store.splitSecondaryPath === store.selection.path) store.clearSplit();
      else store.openInSplit(store.selection.path);
      return true;
    }

    default:
      return false;
  }
}

/**
 * Close through the active overlay's guard (settings flush) — `closeOverlay`
 * alone would unmount before the debounced batch is persisted.
 */
export async function closeOverlayGuarded(): Promise<void> {
  await runOverlayCloseGuard();
  useViewStore.getState().closeOverlay();
}
