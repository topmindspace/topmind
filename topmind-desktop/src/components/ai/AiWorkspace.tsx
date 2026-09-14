/**
 * AI workspace — equal-weight right column (对话 / 建议 / 清单 / 应用).
 * Peer to the center content canvas; not a chat-only sidebar.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  RiApps2Line,
  RiChatAiLine,
  RiLightbulbLine,
  RiListCheck,
} from "@remixicon/react";
import { AiPanel } from "./AiPanel";
import { ChatInput } from "./ChatInput";
import { SuggestPopover } from "./SuggestPopover";
import { TodoListBody } from "../todo/TodoListBody";
import { AppsLaunchList } from "../shell/AppsLaunchList";
import { CountBadge } from "../ui/CountBadge";
import { useViewStore, type AiWorkspaceTab } from "../../stores/view-store";
import { useActionStore } from "../../stores/action-store";
import { useTodoStore } from "../../stores/todo-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";

const TABS: Array<{ id: AiWorkspaceTab; icon: typeof RiChatAiLine; labelKey: string }> = [
  { id: "chat", icon: RiChatAiLine, labelKey: "aiWorkspace.chat" },
  { id: "suggest", icon: RiLightbulbLine, labelKey: "aiWorkspace.suggest" },
  { id: "todo", icon: RiListCheck, labelKey: "aiWorkspace.todo" },
  { id: "apps", icon: RiApps2Line, labelKey: "aiWorkspace.apps" },
];

export function AiWorkspace() {
  const { t } = useTranslation("shell");
  const tab = useViewStore((s) => s.aiWorkspaceTab);
  const setTab = useViewStore((s) => s.setAiWorkspaceTab);
  const suggestCount = useActionStore((s) => s.items.length);
  const suggestHasHigh = useActionStore((s) => s.items.some((i) => i.priority === "high"));
  const todoActive = useTodoStore((s) => s.items.filter((i) => !i.done).length);

  useEffect(() => {
    if (tab === "todo" && !useTodoStore.getState().everLoaded) {
      void useTodoStore.getState().refresh();
    }
  }, [tab]);

  return (
    <div className="v4-panel-contain flex h-full min-h-0 flex-col" data-ai-workspace>
      <div
        className="v4-column-chrome v4-drag gap-0.5"
        role="tablist"
        aria-label={t("aiWorkspace.aria")}
        data-ai-workspace-tabs
        data-column-chrome="right"
      >
        {TABS.map((item) => {
          const active = tab === item.id;
          const badge =
            item.id === "suggest" && suggestCount > 0
              ? suggestCount
              : item.id === "todo" && todoActive > 0
                ? todoActive
                : 0;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-ai-workspace-tab={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "v4-no-drag relative flex h-(--density-chrome-control,32px) min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors v4-focus-ring",
                active
                  ? "bg-accent-bg-faint text-text-primary"
                  : "text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
              )}
            >
              <Icon size={ICON.sm} className="shrink-0" />
              <span className="hidden truncate sm:inline">{t(item.labelKey)}</span>
              <CountBadge
                count={badge}
                tone={item.id === "suggest" && suggestHasHigh ? "alert" : "default"}
                /* 2px proud of the tab's top-right: enough to read as a corner
                   badge, little enough that it never looks owned by the
                   neighbouring tab (tabs are flush, flex-1). */
                className="absolute -right-0.5 -top-0.5"
              />
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1" data-ai-workspace-pane={tab}>
        {tab === "chat" ? <AiPanel hideComposer /> : null}
        {tab === "suggest" ? <SuggestPopover embedded /> : null}
        {tab === "todo" ? (
          <div className="flex h-full min-h-0 flex-col" data-todo-workspace>
            <TodoListBody />
          </div>
        ) : null}
        {tab === "apps" ? <AppsLaunchList /> : null}
      </div>
      <ChatInput />
    </div>
  );
}
