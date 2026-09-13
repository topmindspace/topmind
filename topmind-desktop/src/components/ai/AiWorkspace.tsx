/**
 * AI workspace — equal-weight right column (对话 / 建议 / 清单 / 应用).
 * Peer to the center content canvas; not a chat-only sidebar.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  RiLayoutGridLine,
  RiLightbulbLine,
  RiListCheck,
  RiRobot2Line,
} from "@remixicon/react";
import { AiPanel } from "./AiPanel";
import { ChatInput } from "./ChatInput";
import { SuggestPopover } from "./SuggestPopover";
import { TodoListBody } from "../todo/TodoListBody";
import { AppsLaunchList } from "../shell/AppsLaunchList";
import { useViewStore, type AiWorkspaceTab } from "../../stores/view-store";
import { useActionStore } from "../../stores/action-store";
import { useTodoStore } from "../../stores/todo-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { isWindows } from "../../lib/platform";

const TABS: Array<{ id: AiWorkspaceTab; icon: typeof RiRobot2Line; labelKey: string }> = [
  { id: "chat", icon: RiRobot2Line, labelKey: "aiWorkspace.chat" },
  { id: "suggest", icon: RiLightbulbLine, labelKey: "aiWorkspace.suggest" },
  { id: "todo", icon: RiListCheck, labelKey: "aiWorkspace.todo" },
  { id: "apps", icon: RiLayoutGridLine, labelKey: "aiWorkspace.apps" },
];

export function AiWorkspace() {
  const { t } = useTranslation("shell");
  const tab = useViewStore((s) => s.aiWorkspaceTab);
  const setTab = useViewStore((s) => s.setAiWorkspaceTab);
  const suggestCount = useActionStore((s) => s.items.length);
  const todoActive = useTodoStore((s) => s.items.filter((i) => !i.done).length);

  useEffect(() => {
    if (tab === "todo" && !useTodoStore.getState().everLoaded) {
      void useTodoStore.getState().refresh();
    }
  }, [tab]);

  return (
    <div className="v4-panel-contain flex h-full min-h-0 flex-col" data-ai-workspace>
      <div
        className={cn(
          "v4-column-chrome v4-drag gap-0.5",
          isWindows && "v4-win-titlebar-pad",
        )}
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
              {badge > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-xs bg-skill-loop px-1 text-4xs font-bold leading-none text-text-on-accent">
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
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
