import { useEffect, useState, useMemo, useRef, memo } from "react";
import {
  MessageSquare, Plus, Trash2, ChevronDown, Search,
  Sparkles, RefreshCw, Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "../../stores/ai-store";
import { useViewStore } from "../../stores/view-store";
import { emitLocal, onLocal } from "../../plugins/host";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ContextPills } from "./ContextPills";
import { RuntimeBadge } from "./RuntimeBadge";
import { ActionBar } from "./ActionBar";
import { Tooltip } from "../ui/tooltip";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSectionLabel,
} from "../ui/DropdownMenu";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import type { Selection, AiMessage } from "../../types";
import { useTaskStore } from "../../stores/task-store";

export function AiPanel() {
  const { t } = useTranslation("editor");
  const messages = useAiStore((s) => s.messages);
  const streaming = useAiStore((s) => s.streaming);
  const streamStatus = useAiStore((s) => s.streamStatus);
  const streamToolName = useAiStore((s) => s.streamToolName);
  const streamToolCount = useAiStore((s) => s.streamToolCount);
  const streamMaxSteps = useAiStore((s) => s.streamMaxSteps);
  const regenerate = useAiStore((s) => s.regenerate);
  const refreshRuntimeStatus = useAiStore((s) => s.refreshRuntimeStatus);
  const loadSessions = useAiStore((s) => s.loadSessions);
  const loadModelCatalog = useAiStore((s) => s.loadModelCatalog);
  const invalidateModelCatalog = useAiStore((s) => s.invalidateModelCatalog);
  const setModel = useAiStore((s) => s.setModel);
  const mountedFiles = useAiStore((s) => s.mountedFiles);
  const selection = useViewStore((s) => s.selection);

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    autoScrollRef.current = atBottom;
  };

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, streaming, streamStatus]);

  useEffect(() => {
    void refreshRuntimeStatus();
    void loadSessions();
    void loadModelCatalog({ forceLive: false, silent: true });
  }, [refreshRuntimeStatus, loadSessions, loadModelCatalog]);

  useEffect(() => {
    return onLocal("ai:settings-changed", () => {
      invalidateModelCatalog();
      void loadModelCatalog({ forceLive: false, silent: true });
      setModel(null);
    });
  }, [setModel, loadModelCatalog, invalidateModelCatalog]);

  const lastMsg = messages[messages.length - 1];
  const canRegenerate = !streaming && messages.length > 0 && lastMsg?.role === "assistant";

  return (
    <div className="v4-panel-contain v4-ai-panel flex h-full flex-col">
      <PanelChrome />
      {mountedFiles.length > 0 ? <ContextPills /> : null}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="v4-content-scroll min-h-0 flex-1 overflow-auto overscroll-contain px-2.5 py-2.5"
      >
        {messages.length === 0 ? (
          <EmptyConversation selection={selection} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const isStreamingTail = streaming && isLast && m.role === "assistant";
              return (
                <MessageRow
                  key={`msg-${i}-${m.role}`}
                  message={m}
                  isLast={isLast}
                  streaming={isStreamingTail}
                  streamStatus={isStreamingTail ? streamStatus : null}
                  streamToolName={isStreamingTail ? streamToolName : null}
                  streamToolCount={isStreamingTail ? streamToolCount : null}
                  streamMaxSteps={isStreamingTail ? streamMaxSteps : null}
                />
              );
            })}
            {canRegenerate ? (
              <div className="flex justify-start pl-8">
                <Tooltip content={t("ai.regenerateTooltip")}>
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    className="v4-chip text-text-tertiary"
                  >
                    <RefreshCw size={ICON.xs} /> {t("ai.regenerateLabel")}
                  </button>
                </Tooltip>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ActionBar />
      <ChatInput />
    </div>
  );
}

/** 微型 Task Badge — Header 中的 spinner + 数字，点击展开 TaskPanel */
function TaskBadge() {
  const { t } = useTranslation("shell");
  const tasks = useTaskStore((s) => s.tasks);
  const active = tasks.filter((x) => x.status === "running" || x.status === "queued");

  if (active.length === 0) return null;

  const label = t("taskPanel.tasksRunning", { count: active.length });
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
        onClick={() => emitLocal("task-panel:toggle")}
        aria-label={label}
      >
        <span className="relative">
          <Loader2 size={ICON.xs} className="animate-spin text-accent-color" />
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-color px-0.5 text-5xs font-bold leading-none text-primary-foreground">
            {active.length}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

// 写回凭证内联到 ChatMessage 工具结果卡片中

const MessageRow = memo(function MessageRow({
  message,
  isLast,
  streaming,
  streamStatus,
  streamToolName,
  streamToolCount,
  streamMaxSteps,
}: {
  message: AiMessage;
  isLast: boolean;
  streaming: boolean;
  streamStatus: string | null;
  streamToolName: string | null;
  streamToolCount: number | null;
  streamMaxSteps: number | null;
}) {
  return (
    <div className={cn(!isLast && "v4-list-virtual", isLast && streaming && "v4-msg-enter")}>
      <ChatMessage
        message={message}
        streaming={streaming}
        streamStatus={streamStatus}
        streamToolName={streamToolName}
        streamToolCount={streamToolCount}
        streamMaxSteps={streamMaxSteps}
      />
    </div>
  );
});

/**
 * Single compact chrome row: session switcher + status + new/clear.
 * No duplicate "协作" title (panel position already signals AI).
 */
function PanelChrome() {
  const { t, i18n } = useTranslation("editor");
  const sessions = useAiStore((s) => s.sessions);
  const activeSessionId = useAiStore((s) => s.activeSessionId);
  const selectSession = useAiStore((s) => s.selectSession);
  const createSession = useAiStore((s) => s.createSession);
  const clearSession = useAiStore((s) => s.clearSession);
  const messages = useAiStore((s) => s.messages);
  const [showSessionList, setShowSessionList] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");

  const handleNewSession = async () => {
    await createSession();
    setShowSessionList(false);
    setConfirmingClear(false);
  };

  const handleClear = async () => {
    if (!activeSessionId) return;
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    await clearSession(activeSessionId);
    setConfirmingClear(false);
    setShowSessionList(false);
  };

  const locale = i18n.language;
  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const label = [
        s.title,
        s.updatedAt
          ? new Date(s.updatedAt).toLocaleString(locale, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : s.id,
      ]
        .filter(Boolean)
        .join(" ");
      return label.toLowerCase().includes(q);
    });
  }, [sessions, sessionSearch, locale]);

  const activeSessionLabel = (() => {
    const s = sessions.find((sess) => sess.id === activeSessionId);
    if (!s) return t("ai.newConversation");
    const defaultTitles = [t("ai.newSessionLabel"), t("ai.newConversation")];
    if (s.title && !defaultTitles.includes(s.title)) return s.title;
    return s.updatedAt
      ? new Date(s.updatedAt).toLocaleString(locale, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : t("ai.newConversation");
  })();

  return (
    <div className="v4-ai-chrome shrink-0">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <DropdownMenu
          open={showSessionList}
          onOpenChange={(open) => {
            setShowSessionList(open);
            if (!open) setSessionSearch("");
            setConfirmingClear(false);
          }}
          align="start"
          minWidth={260}
          maxHeight={360}
          matchTriggerWidth={false}
          className="min-w-0 flex-1"
          autoFocus={sessions.length <= 8}
          trigger={
            <Tooltip content={t("ai.switchSessionTooltip")}>
              <button
                type="button"
                onClick={() => {
                  setShowSessionList((v) => !v);
                  setConfirmingClear(false);
                }}
                className="flex min-w-0 w-full items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                aria-expanded={showSessionList}
                aria-haspopup="listbox"
              >
                <MessageSquare size={ICON.xs} className="shrink-0 text-text-quaternary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-text-primary">
                  {activeSessionLabel}
                </span>
                <ChevronDown
                  size={ICON.micro}
                  className={cn(
                    "shrink-0 text-text-quaternary transition-transform",
                    showSessionList && "rotate-180",
                  )}
                />
              </button>
            </Tooltip>
          }
        >
          <DropdownItem
            onSelect={() => {
              void handleNewSession();
            }}
          >
            <Plus size={ICON.xs} className="shrink-0 text-accent-color" />
            <span className="font-medium text-accent-color">{t("ai.newSessionLabel")}</span>
          </DropdownItem>
          {sessions.length > 8 ? (
            <div className="flex items-center gap-1.5 border-y border-border-subtle-dim px-2.5 py-1.5">
              <Search size={ICON.micro} className="shrink-0 text-text-quaternary" />
              <input
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder={t("ai.searchSessionPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-3xs text-text-primary outline-none placeholder:text-text-quaternary"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          ) : (
            <DropdownSectionLabel>{t("ai.recentSessions")}</DropdownSectionLabel>
          )}
          {filteredSessions.map((s) => {
            const defaultTitles = [t("ai.newSessionLabel"), t("ai.newConversation")];
            const label =
              s.title && !defaultTitles.includes(s.title)
                ? s.title
                : s.updatedAt
                  ? new Date(s.updatedAt).toLocaleString(locale, {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : s.id;
            return (
              <DropdownItem
                key={s.id}
                active={s.id === activeSessionId}
                onSelect={() => {
                  void selectSession(s.id);
                  setShowSessionList(false);
                  setSessionSearch("");
                }}
              >
                <MessageSquare size={ICON.micro} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </DropdownItem>
            );
          })}
          {filteredSessions.length === 0 ? (
            <div className="px-2.5 py-2 text-3xs text-text-quaternary">{t("ai.noMatchingSessions")}</div>
          ) : null}
        </DropdownMenu>

        <RuntimeBadge />

        <TaskBadge />

        <Tooltip content={t("ai.newSessionTooltip")}>
          <button
            type="button"
            onClick={() => void handleNewSession()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
            aria-label={t("ai.newSessionLabel")}
          >
            <Plus size={ICON.xs} />
          </button>
        </Tooltip>

        {activeSessionId && messages.length > 0 ? (
          <Tooltip content={confirmingClear ? t("ai.clearConfirmTooltip") : t("ai.clearConversationTooltip")}>
            <button
              type="button"
              onClick={() => void handleClear()}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors",
                confirmingClear
                  ? "bg-status-error-bg text-error"
                  : "text-text-tertiary hover:bg-surface-muted hover:text-error",
              )}
              aria-label={t("ai.clearLabel")}
            >
              <Trash2 size={ICON.xs} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function EmptyConversation({ selection }: { selection: Selection }) {
  const { t } = useTranslation("editor");
  const sendMessage = useAiStore((s) => s.sendMessage);
  const streaming = useAiStore((s) => s.streaming);
  const ready = useAiStore((s) => s.runtimeStatus?.ready ?? false);
  // Two contextual prompts max — enough to suggest actions without overwhelming
  const prompts = quickPromptsFor(selection, t);
  const hint = emptyHintFor(selection, t);

  return (
    <div className="flex flex-col items-stretch px-1 pt-4 text-center" data-ai-empty>
      <div className="mx-auto mb-2 text-3xs font-medium tracking-tight text-text-secondary">
        {ready ? t("ai.emptyReadyHint") : t("ai.emptyNotReadyHint")}
      </div>
      <div className="mx-auto mb-3 max-w-[220px] text-3xs leading-relaxed text-text-quaternary">
        {ready ? hint : t("ai.emptyReadyBody")}
      </div>
      {ready ? (
        <div className="flex w-full flex-col gap-1" data-ai-empty-prompts>
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void sendMessage(p)}
              disabled={streaming}
              className="group flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface/80 px-2.5 py-1.5 text-left text-3xs text-text-secondary transition-colors hover:border-accent-border-subtle hover:bg-surface-muted hover:text-text-primary disabled:opacity-50"
            >
              <Sparkles size={ICON.xs} className="shrink-0 text-accent-color/70" />
              <span className="min-w-0 flex-1 truncate">{p}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => useViewStore.getState().openOverlay("settings", { topicId: "ai" })}
          className="mx-auto rounded-[var(--radius-md)] bg-accent-color px-3 py-1.5 text-3xs font-medium text-primary-foreground shadow-[var(--shadow-button)] transition-opacity hover:opacity-90"
        >
          {t("ai.goConfigureLabel")}
        </button>
      )}
    </div>
  );
}

function emptyHintFor(selection: Selection, t: (key: string) => string): string {
  if (selection.kind === "file") return t("ai.hintFile");
  if (selection.kind === "topic") return t("ai.hintTopic");
  if (selection.kind === "inbox") return t("ai.hintInbox");
  if (selection.kind === "stream") return t("ai.hintStream");
  if (selection.kind === "outputs") return t("ai.hintOutputs");
  return t("ai.hintDefault");
}

/** Contextual prompts for empty conversation — up to 2 per selection kind. */
function quickPromptsFor(selection: Selection, t: (key: string) => string): string[] {
  if (selection.kind === "file") return [t("ai.promptSummarize"), t("ai.promptDefault1")];
  if (selection.kind === "topic") return [t("ai.promptTopicWhat"), t("ai.promptDefault1")];
  if (selection.kind === "inbox") return [t("ai.promptInboxOrganize"), t("ai.promptDefault1")];
  if (selection.kind === "stream") return [t("ai.promptStreamOrganize"), t("ai.promptDefault1")];
  if (selection.kind === "outputs") return [t("ai.promptOutputsRecent"), t("ai.promptDefault1")];
  if (selection.kind === "connector" && selection.id === "weread") return [t("ai.promptWereadReading")];
  if (selection.kind === "connector" && selection.id === "x") return [t("ai.promptXOrganize")];
  return [t("ai.promptDefault1")];
}

// 焦点信息内联到 Composer 的 placeholder 中
