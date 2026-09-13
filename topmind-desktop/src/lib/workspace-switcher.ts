/**
 * Workspace-switcher open state — always-mounted host (Shell).
 * The sidebar footer is only the visual dock; ⌘⇧W must not die when the
 * left column is collapsed or focus mode hides it.
 */
import { useViewStore } from "../stores/view-store";

export const WORKSPACE_SWITCHER_TOGGLE_EVENT = "titlebar:workspace-switcher-toggle" as const;

export function toggleWorkspaceSwitcher(): void {
  useViewStore.getState().toggleWorkspaceSwitcher();
}

export function setWorkspaceSwitcherOpen(open: boolean): void {
  useViewStore.getState().setWorkspaceSwitcherOpen(open);
}
