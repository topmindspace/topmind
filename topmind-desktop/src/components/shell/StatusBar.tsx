import {
  CheckCircle2, AlertCircle, Loader2, MessageSquare, FileText, FolderOpen,
  Inbox, Layers, Archive, Bot, CalendarDays, ListTodo, Lightbulb, ListChecks,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { useTaskStore } from "../../stores/task-store";
import { useTodoStore } from "../../stores/todo-store";
import { useActionStore } from "../../stores/action-store";
import { useRegistry } from "../../plugins/registry";
import { api } from "../../services/api";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { sessionStatusLabel } from "../../lib/stream-status";
import { deriveStatusBarBusy } from "../../lib/status-bar-busy";
import { useInlineAiStore } from "../../lib/inline-ai-busy";
import { Tooltip } from "../ui/tooltip";
import type { Selection } from "../../types";
import { emitLocal } from "../../plugins/host";

interface EngineHealth {
  ok: boolean;
  engineRoot: string | null;
  workspaceRoot: string | null;
}

interface StatusBarProps {
  health: EngineHealth | null;
}

function StatusDivider() {
  return <span className="v4-chrome-sep !h-2.5" aria-hidden />;
}

export function StatusBar({ health }: StatusBarProps) {
  const { t } = useTranslation(["shell", "common"]);
  const selection = useViewStore((s) => s.selection);
  const messageCount = useAiStore((s) => s.messages.length);
  const streaming = useAiStore((s) => s.streaming);
  const streamStatus = useAiStore((s) => s.streamStatus);
  const streamToolName = useAiStore((s) => s.streamToolName);
  const streamToolCount = useAiStore((s) => s.streamToolCount);
  const streamMaxSteps = useAiStore((s) => s.streamMaxSteps);
  const runtimeStatus = useAiStore((s) => s.runtimeStatus);
  const statusBarSlots = useRegistry((s) => s.statusBarSlots);
  const tasks = useTaskStore((s) => s.tasks);
  const todoMaintaining = useTodoStore((s) => s.maintaining === "maintaining");
  const suggestLoading = useActionStore((s) => s.loading);
  const suggestCount = useActionStore((s) => s.items.length);
  const suggestHasHigh = useActionStore((s) => s.items.some((i) => i.priority === "high"));
  const suggestPanelOpen = useActionStore((s) => s.panelOpen);
  const inlineSessions = useInlineAiStore((s) => s.sessions);
  const inlineBusy = inlineSessions.length > 0;
  const inlineLabel =
    inlineSessions[inlineSessions.length - 1]?.label
    || t("statusBar.inlineAiWorking");
  const activeTasks = tasks.filter((x) => x.status === "running" || x.status === "queued");
  const busy = deriveStatusBarBusy({
    ready: Boolean(runtimeStatus?.ready),
    streaming,
    activeTaskCount: activeTasks.length,
    todoMaintaining,
    suggestLoading,
    inlineBusy,
    inlineLabel,
  });

  const leftSlots = statusBarSlots.filter((s) => (s.align ?? "right") === "left");
  const rightSlots = statusBarSlots.filter((s) => (s.align ?? "right") === "right");

  const aiPanelOpen = useViewStore((s) => s.aiPanelOpen);
  const sessionLabel = sessionStatusLabel({
    streaming,
    streamStatus,
    streamToolName,
    streamToolCount,
    streamMaxSteps,
    messageCount,
  });
  // Single primary AI control: offline → settings; ready → toggle AI panel.
  // Session state folds into the pill (no second "会话" open-panel button).
  const aiLabel =
    busy.aiLabelMode === "offline"
      ? t("statusBar.aiOffline")
      : busy.aiPillBusy
        ? t("statusBar.aiWorking")
        : streaming || messageCount > 0
          ? sessionLabel
          : t("statusBar.aiReady");
  const aiTip =
    !runtimeStatus?.ready
      ? t("statusBar.openSettingsTip")
      : busy.aiPillBusy
        ? t("statusBar.aiWorkingTip")
        : aiPanelOpen
          ? t("statusBar.aiPanelHideTip", { defaultValue: "收起 AI 面板" })
          : t("statusBar.aiPanelShowTip", { defaultValue: "展开 AI 面板" });

  const pathTip = health?.workspaceRoot
    ? t("statusBar.workspacePath", { root: health.workspaceRoot })
    : t("statusBar.workspacePathLabel");

  return (
    <div
      className="v4-shell-chrome grid h-[var(--density-status-y,26px)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 border-t border-border-subtle-dim px-2.5 text-3xs text-text-quaternary select-none sm:gap-1.5 sm:px-3"
      role="contentinfo"
      aria-label={t("statusBar.ariaLabel")}
      data-status-bar
    >
      {/* Left: engine health · path · left plugin slots */}
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {!health ? (
          <span className="flex items-center gap-1">
            <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
            <span className="hidden sm:inline">{t("common:status.loading")}</span>
          </span>
        ) : health.ok ? (
          <Tooltip
            content={
              [
                health.workspaceRoot ? t("statusBar.workspacePath", { root: health.workspaceRoot }) : null,
                health.engineRoot ? t("statusBar.enginePath", { root: health.engineRoot }) : null,
              ]
                .filter(Boolean)
                .join("\n") || t("statusBar.workspaceOkTip")
            }
          >
            <span className="flex shrink-0 items-center gap-1 text-success/90">
              <CheckCircle2 size={ICON.micro} aria-hidden />
              <span className="hidden sm:inline">{t("statusBar.workspaceOk")}</span>
            </span>
          </Tooltip>
        ) : (
          <Tooltip content={t("statusBar.workspaceBadTip")}>
            <span className="flex shrink-0 items-center gap-1 text-error">
              <AlertCircle size={ICON.micro} aria-hidden />
              <span className="hidden sm:inline">{t("statusBar.workspaceBad")}</span>
            </span>
          </Tooltip>
        )}
        {leftSlots.map((slot) => (
          <span key={slot.id} className="min-w-0 shrink">
            {slot.render()}
          </span>
        ))}
        {health?.workspaceRoot ? (
          <>
            <StatusDivider />
            <Tooltip content={`${pathTip}\n${t("statusBar.revealWorkspaceTip", { defaultValue: "Click to reveal in Finder" })}`}>
              <button
                type="button"
                className={cn(
                  "hidden min-w-0 max-w-[12rem] truncate rounded-[var(--radius-sm)] px-1 text-left text-text-quaternary xl:inline",
                  "transition-colors hover:bg-surface-muted hover:text-text-secondary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                )}
                onClick={() => {
                  void api.sys.reveal(health.workspaceRoot!).catch(() => {
                    void api.sys.openPath(health.workspaceRoot!).catch(() => {/* ignore */});
                  });
                }}
              >
                {shortPath(health.workspaceRoot)}
              </button>
            </Tooltip>
          </>
        ) : null}
      </div>

      {/* Center: current selection (orientation anchor) — clickable */}
      <div className="flex min-w-0 max-w-[42vw] items-center justify-center px-1 sm:max-w-[36vw]">
        <SelectionHint selection={selection} />
      </div>

      {/* Right: plugin slots · AI · session — all interactive */}
      <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden sm:gap-1.5">
        {rightSlots.map((slot) => (
          <span key={slot.id} className="min-w-0 shrink">
            {slot.render()}
          </span>
        ))}
        {rightSlots.length > 0 ? <StatusDivider /> : null}

        {/* Named busy chips only — never dual with generic「AI 工作中」for todo/suggest-only */}
        {busy.showTaskChip ? (
          <Tooltip content={t("statusBar.taskRunningTip")}>
            <button
              type="button"
              onClick={() => emitLocal("task-panel:open")}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5",
                "bg-accent-bg-faint text-accent-color",
                "transition-colors hover:bg-accent-bg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
              )}
              aria-label={t("statusBar.taskRunning", { count: activeTasks.length })}
            >
              <ListTodo size={ICON.micro} className="animate-pulse-soft" aria-hidden />
              <span className="hidden tabular-nums sm:inline">
                {t("statusBar.taskRunning", { count: activeTasks.length })}
              </span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {busy.showTodoChip ? (
          <Tooltip content={t("statusBar.todoMaintainingTip")}>
            <span
              role="status"
              aria-live="polite"
              data-status-todo-busy
              className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 bg-accent-bg-faint text-accent-color"
            >
              <ListChecks size={ICON.micro} className="animate-pulse-soft" aria-hidden />
              <span className="hidden sm:inline">{t("statusBar.todoMaintaining")}</span>
            </span>
          </Tooltip>
        ) : null}
        {busy.showSuggestChip ? (
          <Tooltip content={t("statusBar.suggestLoadingTip")}>
            <button
              type="button"
              role="status"
              data-status-suggest-busy
              onClick={() => {
                void import("../../lib/suggest-surface").then(({ toggleSuggestSurface }) => {
                  toggleSuggestSurface({ refresh: true });
                });
              }}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 bg-accent-bg-faint text-accent-color hover:bg-accent-bg-subtle transition-colors",
                suggestPanelOpen && "ring-1 ring-inset ring-accent-border-subtle",
              )}
              aria-pressed={suggestPanelOpen}
            >
              <Lightbulb size={ICON.micro} className="animate-pulse-soft" aria-hidden />
              <span className="hidden sm:inline">{t("statusBar.suggestLoading")}</span>
            </button>
          </Tooltip>
        ) : null}
        {/* Suggestion count chip — toggle button: click opens, click again closes.
            Behavior parity with TitleBar Lightbulb and AI Todo trigger. */}
        {!busy.showSuggestChip && suggestCount > 0 ? (
          <Tooltip content={
            suggestPanelOpen
              ? t("statusBar.suggestHideTip", { defaultValue: "收起建议面板" })
              : suggestHasHigh
                ? t("statusBar.suggestHighTip", { count: suggestCount, defaultValue: "{{count}} 条建议待确认（含高优先级）· 点击查看" })
                : t("statusBar.suggestCountTip", { count: suggestCount, defaultValue: "{{count}} 条建议待确认 · 点击查看" })
          }>
            <button
              type="button"
              data-status-suggest-count
              onClick={() => {
                void import("../../lib/suggest-surface").then(({ toggleSuggestSurface }) => {
                  toggleSuggestSurface();
                });
              }}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                suggestHasHigh
                  ? "bg-warning/10 text-warning hover:bg-warning/15"
                  : "bg-skill-loop/10 text-skill-loop hover:bg-skill-loop/15",
                suggestPanelOpen && "ring-1 ring-inset ring-accent-border-subtle",
              )}
              aria-label={t("statusBar.suggestCountAria", { count: suggestCount, defaultValue: "{{count}} 条建议" })}
              aria-pressed={suggestPanelOpen}
            >
              {suggestHasHigh ? (
                <Lightbulb size={ICON.micro} className="animate-pulse-soft" aria-hidden />
              ) : (
                <Sparkles size={ICON.micro} aria-hidden />
              )}
              <span className="hidden tabular-nums sm:inline">
                {t("statusBar.suggestCount", { count: suggestCount, defaultValue: "{{count}} 建议" })}
              </span>
            </button>
          </Tooltip>
        ) : null}
        {busy.showInlineChip ? (
          <Tooltip content={t("statusBar.inlineAiWorkingTip")}>
            <span
              role="status"
              aria-live="polite"
              data-status-inline-busy
              className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 bg-accent-bg-faint text-accent-color"
            >
              <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
              <span className="hidden max-w-[7.5rem] truncate sm:inline">{inlineLabel}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </span>
          </Tooltip>
        ) : null}

        {busy.hasNamedBusyChip ? <StatusDivider /> : null}

        <Tooltip content={aiTip}>
          <button
            type="button"
            data-status-ai-pill
            data-status-ai-busy={busy.aiPillBusy || undefined}
            data-status-ai-panel={runtimeStatus?.ready ? (aiPanelOpen ? "open" : "closed") : "offline"}
            onClick={() => {
              if (!runtimeStatus?.ready) {
                useViewStore.getState().openOverlay("settings", { topicId: "ai" });
              } else {
                // Toggle fold/expand — primary ready control (no separate 会话 button)
                useViewStore.getState().toggleAiPanel();
              }
            }}
            aria-label={aiLabel}
            aria-pressed={runtimeStatus?.ready ? aiPanelOpen : undefined}
            role="status"
            aria-live="polite"
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
              !runtimeStatus?.ready
                ? "text-text-quaternary hover:bg-surface-muted hover:text-warning"
                : busy.aiPillBusy
                  ? "bg-accent-bg-faint text-accent-color hover:bg-accent-bg-subtle"
                  : aiPanelOpen
                    ? "text-success/90 hover:bg-success/10"
                    : "text-text-tertiary hover:bg-surface-muted hover:text-success/90",
            )}
          >
            {busy.aiPillBusy ? (
              <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
            ) : (
              <Bot size={ICON.micro} aria-hidden />
            )}
            <span className="hidden max-w-[9rem] truncate md:inline">{aiLabel}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/") || p;
  return `…/${parts.slice(-2).join("/")}`;
}

function SelectionHint({ selection }: { selection: Selection }) {
  const { t } = useTranslation(["shell", "common"]);
  const select = useViewStore((s) => s.select);
  const config = (() => {
    switch (selection.kind) {
      case "stream":
        return {
          icon: CalendarDays,
          label: t("statusBar.selectionStream"),
          tip: t("statusBar.selectionStreamTip"),
          onClick: () => select({ kind: "stream" }),
        };
      case "inbox":
        return {
          icon: Inbox,
          label: t("statusBar.selectionInbox"),
          tip: t("statusBar.selectionInboxTip"),
          onClick: () => select({ kind: "inbox" }),
        };
      case "category":
        return {
          icon: FolderOpen,
          label: selection.category,
          tip: selection.category,
          onClick: () => select({ kind: "category", category: selection.category }),
        };
      case "topic":
        return {
          icon: FolderOpen,
          label: selection.topicId.split("/").pop() ?? selection.topicId,
          tip: selection.topicId,
          onClick: () => select({ kind: "topic", topicId: selection.topicId }),
        };
      case "file":
        return {
          icon: FileText,
          label: selection.path.split("/").pop() ?? selection.path,
          tip: `${selection.path}\n${t("statusBar.revealFileTip", { defaultValue: "Click to reveal · double-intent: copy path via ⌘C in editor" })}`,
          onClick: () => {
            void api.ws.reveal(selection.path).catch(() => {
              select({ kind: "file", path: selection.path });
            });
          },
        };
      case "outputs":
        return {
          icon: Layers,
          label: t("statusBar.selectionOutputs"),
          tip: t("statusBar.selectionOutputsTip"),
          onClick: () => select({ kind: "outputs" }),
        };
      case "archive":
        return {
          icon: Archive,
          label: t("statusBar.selectionArchive"),
          tip: t("statusBar.selectionArchiveTip"),
          onClick: () => select({ kind: "archive" }),
        };
      case "connector":
        return {
          icon: selection.id === "weread" ? FileText : MessageSquare,
          label: selection.id === "weread" ? t("statusBar.selectionWeread") : selection.id === "x" ? "X" : selection.id,
          tip: t("statusBar.selectionConnectorTip"),
          onClick: () => select({ kind: "connector", id: selection.id }),
        };
      default:
        return { icon: FolderOpen, label: t("statusBar.unknown"), tip: "unknown", onClick: null as (() => void) | null };
    }
  })();
  const Icon = config.icon;
  const className =
    "flex max-w-full items-center gap-1 truncate rounded-[var(--radius-sm)] px-1.5 py-0.5 text-text-quaternary";
  return (
    <Tooltip content={config.tip}>
      {config.onClick ? (
        <button
          type="button"
          onClick={config.onClick}
          className={cn(
            className,
            "transition-colors hover:bg-surface-muted hover:text-text-secondary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          )}
        >
          <Icon size={ICON.micro} className="shrink-0" aria-hidden />
          <span className="truncate">{config.label}</span>
        </button>
      ) : (
        <span className={className}>
          <Icon size={ICON.micro} className="shrink-0" aria-hidden />
          <span className="truncate">{config.label}</span>
        </span>
      )}
    </Tooltip>
  );
}
