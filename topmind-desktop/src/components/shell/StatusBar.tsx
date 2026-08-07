import {
  AlertCircle, Loader2, FileText, Bot, ListTodo, Lightbulb, ListChecks,
  Download,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
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
import { emitLocal, onLocal } from "../../plugins/host";

interface EngineHealth {
  ok: boolean;
  engineRoot: string | null;
  workspaceRoot: string | null;
}

interface UpdateBadgeInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string | null;
  tagName: string | null;
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
  const suggestPanelOpen = useActionStore((s) => s.panelOpen);
  const [updateInfo, setUpdateInfo] = useState<UpdateBadgeInfo | null>(null);

  // Subscribe to background update:available events from main process
  useEffect(() => {
    const unsub = onLocal("update:available", (payload) => {
      if (payload && typeof payload === "object" && "latestVersion" in payload) {
        setUpdateInfo(payload as UpdateBadgeInfo);
      }
    });
    return () => { unsub(); };
  }, []);
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

  return (
    <div
      className="v4-shell-chrome grid h-[var(--density-status-y,24px)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 border-t border-border-subtle-dim px-2.5 text-3xs text-text-quaternary select-none sm:gap-1.5 sm:px-3"
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
          /* Healthy = silent (2026-08): a quiet dot, details in tooltip. Text only on error. */
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
            <span
              className="flex shrink-0 items-center px-0.5"
              role="status"
              aria-label={t("statusBar.workspaceOk")}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success/80" aria-hidden />
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
        {/* 2026-08-07: path button removed — workspace switcher tooltip already
            shows the full path; this was redundant chrome noise. */}
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

        {/* Update available badge — silent green dot, click opens release page */}
        {updateInfo ? (
          <Tooltip content={t("statusBar.updateAvailable", { version: updateInfo.latestVersion, defaultValue: `v${updateInfo.latestVersion} available` })}>
            <button
              type="button"
              data-status-update-badge
              onClick={() => {
                if (updateInfo.releaseUrl) {
                  void api.sys.openUrl(updateInfo.releaseUrl);
                }
              }}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5",
                "bg-success/10 text-success",
                "transition-colors hover:bg-success/20",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
              )}
              aria-label={t("statusBar.updateAvailable", { version: updateInfo.latestVersion, defaultValue: `v${updateInfo.latestVersion} available` })}
            >
              <Download size={ICON.micro} aria-hidden />
              <span className="hidden tabular-nums sm:inline">
                v{updateInfo.latestVersion}
              </span>
            </button>
          </Tooltip>
        ) : null}

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
              <ListTodo size={ICON.micro} className="v4-ai-busy-icon" aria-hidden />
              <span className="v4-ai-busy-text hidden tabular-nums sm:inline">
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
              <ListChecks size={ICON.micro} className="v4-ai-busy-icon" aria-hidden />
              <span className="v4-ai-busy-text hidden sm:inline">{t("statusBar.todoMaintaining")}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
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
              <Lightbulb size={ICON.micro} className="v4-ai-busy-icon" aria-hidden />
              <span className="v4-ai-busy-text hidden sm:inline">{t("statusBar.suggestLoading")}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {/* 建议计数常驻 chip 已移除（降噪 2026-08）：计数由标题栏 💡 badge + 画布顶 strip 承担，
            状态栏只保留「生成中」busy 态 —— DESIGN「禁止三处等权」。 */}
        {busy.showInlineChip ? (
          <Tooltip content={t("statusBar.inlineAiWorkingTip")}>
            <span
              role="status"
              aria-live="polite"
              data-status-inline-busy
              className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 bg-accent-bg-faint text-accent-color"
            >
              <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
              <span className="v4-ai-busy-text hidden max-w-[7.5rem] truncate sm:inline">{inlineLabel}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </span>
          </Tooltip>
        ) : null}

        {/* 2026-08-07: divider removed when no busy chips — cleaner right rail */}
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
            <span className={cn("hidden max-w-[9rem] truncate md:inline", busy.aiPillBusy && "v4-ai-busy-text")}>{aiLabel}</span>
            {busy.aiPillBusy ? <span className="v4-ai-progress-dot" aria-hidden /> : null}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * Center orientation hint — **file selections only** (click = reveal in OS file manager).
 * Non-file views are already identified by the canvas PageHeader + active PrimaryNav
 * pill, so repeating them here was pure noise (降噪 2026-08).
 */
function SelectionHint({ selection }: { selection: Selection }) {
  const { t } = useTranslation(["shell", "common"]);
  const select = useViewStore((s) => s.select);
  if (selection.kind !== "file") return null;
  const label = selection.path.split("/").pop() ?? selection.path;
  const tip = `${selection.path}\n${t("statusBar.revealFileTip", { defaultValue: "Click to reveal · double-intent: copy path via ⌘C in editor" })}`;
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={() => {
          void api.ws.reveal(selection.path).catch(() => {
            select({ kind: "file", path: selection.path });
          });
        }}
        className={cn(
          "flex max-w-full items-center gap-1 truncate rounded-[var(--radius-sm)] px-1.5 py-0.5 text-text-quaternary",
          "transition-colors hover:bg-surface-muted hover:text-text-secondary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
        )}
      >
        <FileText size={ICON.micro} className="shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  );
}
