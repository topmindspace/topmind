/**
 * AI workspace column — equal-weight right pane (对话 / 建议 / 清单 / 应用).
 * Not a chat-only rail. TitleBar icons and ⌘⇧T open a pane here.
 */
import { useViewStore, type AiWorkspaceTab, isAiWorkspaceTab } from "../stores/view-store";

export type { AiWorkspaceTab };
export { isAiWorkspaceTab };

export function openAiWorkspace(tab?: AiWorkspaceTab): void {
  useViewStore.getState().openAiWorkspace(tab);
}

/** Composer is pinned on every AI workspace pane; send must show the thread. */
export function revealChatThreadOnSend(): void {
  openAiWorkspace("chat");
}

export function toggleAiWorkspacePane(tab: AiWorkspaceTab): void {
  const s = useViewStore.getState();
  if (s.aiPanelOpen && s.aiWorkspaceTab === tab) {
    s.setAiPanelOpen(false);
    return;
  }
  s.openAiWorkspace(tab);
}

/**
 * Palette / bus 应用 command. Must live outside AiWorkspace — that column
 * unmounts when closed or in focus mode, and the command still has to open it.
 * `openAiWorkspace("apps")` also leaves focus mode so Shell can mount the column.
 */
export function handleAppsMenuToggle(): void {
  openAiWorkspace("apps");
}
