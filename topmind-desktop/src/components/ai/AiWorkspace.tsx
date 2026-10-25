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
import { ICON } from "../../lib/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Tooltip } from "../ui/tooltip";
import { isAiWorkspaceTab } from "../../stores/view-store";

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

  useEffect(() => {
    if (tab === "todo" && !useTodoStore.getState().everLoaded) {
      void useTodoStore.getState().refresh();
    }
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={(next) => { if (isAiWorkspaceTab(next)) setTab(next); }} className="@container/ai-workspace v4-panel-contain flex h-full min-h-0 flex-col" data-ai-workspace>
      <TabsList
        variant="chrome"
        aria-label={t("aiWorkspace.aria")}
        data-ai-workspace-tabs
        data-column-chrome="right"
        onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.stopPropagation(); }}
      >
        {TABS.map((item) => {
          const badge =
            item.id === "suggest" && suggestCount > 0
              ? suggestCount
              : 0;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id} content={t(item.labelKey)}>
              <TabsTrigger
                variant="chrome"
                value={item.id}
                aria-label={t(item.labelKey)}
                data-ai-workspace-tab={item.id}
              >
                <Icon size={ICON.sm} className="shrink-0" aria-hidden />
                <span className="hidden truncate @min-[360px]/ai-workspace:inline">{t(item.labelKey)}</span>
                <CountBadge
                  count={badge}
                  tone={item.id === "suggest" && suggestHasHigh ? "alert" : "default"}
                  /* 2px proud of the tab's top-right: enough to read as a corner
                     badge, little enough that it never looks owned by the
                     neighbouring tab (tabs are flush, flex-1). */
                  className="absolute -right-0.5 -top-0.5"
                />
              </TabsTrigger>
            </Tooltip>
          );
        })}
      </TabsList>
      <TabsContent variant="chrome" value="chat" data-ai-workspace-pane="chat"><AiPanel hideComposer /></TabsContent>
      <TabsContent variant="chrome" value="suggest" data-ai-workspace-pane="suggest"><SuggestPopover embedded /></TabsContent>
      <TabsContent variant="chrome" value="todo" data-ai-workspace-pane="todo"><TodoListBody /></TabsContent>
      <TabsContent variant="chrome" value="apps" data-ai-workspace-pane="apps"><AppsLaunchList /></TabsContent>
      <ChatInput />
    </Tabs>
  );
}
