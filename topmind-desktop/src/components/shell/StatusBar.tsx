import {
  AlertCircle, Loader2, FileText, Bot, ListTodo, Lightbulb,
  Download, Activity,
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
import {
  deriveStatusBarBusy,
  statusBarBusyKindLabelKeys,
} from "../../lib/status-bar-busy";
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
  surfaces: string[];
  desktop?: { latestVersion: string | null; releaseUrl: string | null };
  skills?: { latestVersion: string | null; releaseUrl: string | null };
  extension?: { latestVersion: string | null; releaseUrl: string | null };
  obsidian?: { latestVersion: string | null; releaseUrl: string | null };
  // Legacy fields for backward compat
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string | null;
  tagName?: string | null;
}

interface StatusBarProps {
  health: EngineHealth | null;
  taskPanelOpen: boolean;
  onToggleTaskPanel: () => void;
}

function StatusDivider() {
  return <span className="v4-chrome-sep h-2.5!" aria-hidden />;
}

/** Status-bar pill frame — shared layout + hover transition + unified focus ring.
 *  Chip-specific color/hover classes are passed via `className`. */
function StatusChip({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors v4-focus-ring",
        className,
      )}
      {...props}
    />
  );
}

/** Same frame as StatusChip for non-interactive (status-only) spans. */
const statusChipSpanClass =
  "flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5";

export function StatusBar({ health, taskPanelOpen, onToggleTaskPanel }: StatusBarProps) {
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
  const suggestCount = useActionStore((s) => s.items.length);
  const suggestHasHigh = useActionStore((s) => s.items.some((i) => i.priority === "high"));
  const [updateInfo, setUpdateInfo] = useState<UpdateBadgeInfo | null>(null);
  // Subscribe to background update:available events from main process
  useEffect(() => {
    const unsub = onLocal("update:available", (payload) => {
      if (payload && typeof payload === "object" && "surfaces" in payload) {
        const p = payload as UpdateBadgeInfo;
        if (Array.isArray(p.surfaces) && p.surfaces.length > 0) {
          setUpdateInfo(p);
        }
      } else if (payload && typeof payload === "object" && "latestVersion" in payload) {
        // Legacy single-surface event (backward compat)
        const legacy = payload as UpdateBadgeInfo;
        setUpdateInfo({ ...legacy, surfaces: legacy.surfaces || ["desktop"] });
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
    suggestCount,
    suggestHasHigh,
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
  const multiJobsLabel = busy.multiActive
    ? statusBarBusyKindLabelKeys(busy.activeKinds)
        .map((key) => t(key))
        .join(" · ")
    : "";
  const aiLabel =
    busy.aiLabelMode === "offline"
      ? t("statusBar.aiOffline")
      : busy.multiActive && busy.aiPillBusy
        ? t("statusBar.aiMultiWorking", { count: busy.concurrentCount })
      : busy.aiPillBusy
        ? t("statusBar.aiWorking")
        : streaming || messageCount > 0
          ? sessionLabel
          : t("statusBar.aiReady");
  const aiTip =
    !runtimeStatus?.ready
      ? t("statusBar.openSettingsTip")
      : busy.multiActive
        ? t("statusBar.aiMultiWorkingTip", { jobs: multiJobsLabel })
      : busy.aiPillBusy
        ? t("statusBar.aiWorkingTip")
        : aiPanelOpen
          ? t("statusBar.aiPanelHideTip")
          : t("statusBar.aiPanelShowTip");

  return (
    <div
      className="v4-shell-chrome grid h-(--density-status-y,24px) grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 border-t border-border-subtle-dim px-2.5 text-3xs text-text-quaternary select-none sm:gap-1.5 sm:px-3"
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
      <div className="flex min-w-0 max-w-[var(--status-chip-max,42vw)] items-center justify-center px-1">
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

        {/* Update available badge — click opens settings → manage tab */}
        {updateInfo ? (() => {
          const latestVersion = updateInfo.desktop?.latestVersion || updateInfo.latestVersion || "";
          const multi = updateInfo.surfaces.length > 1;
          const label = multi
            ? t("statusBar.updatesAvailableMulti", { count: updateInfo.surfaces.length })
            : t("statusBar.updateAvailable", { version: latestVersion });
          return (
            <Tooltip content={label}>
              <StatusChip
                data-status-update-badge
                onClick={() => {
                  useViewStore.getState().openOverlay("settings", { topicId: "manage" });
                }}
                className="bg-success/10 text-success hover:bg-success/20"
                aria-label={label}
              >
                <Download size={ICON.micro} aria-hidden />
                <span className="hidden tabular-nums sm:inline">
                  {multi ? t("statusBar.updatesBadgeCount", { count: updateInfo.surfaces.length }) : `v${latestVersion}`}
                </span>
              </StatusChip>
            </Tooltip>
          );
        })() : null}

        {/* Persistent task-panel toggle (2026-08-22): one statusbar control for engine
            tasks — quiet when idle, spinner+count when running, pressed state when open.
            Replaces the transient busy-only chip (open-only affordance, no close path). */}
        <Tooltip
          content={
            activeTasks.length > 0
              ? t("statusBar.taskRunningTip")
              : t("statusBar.taskPanelTip")
          }
        >
          <StatusChip
            data-task-panel-trigger
            data-status-task-toggle
            onClick={onToggleTaskPanel}
            aria-pressed={taskPanelOpen}
            aria-label={t("statusBar.taskPanelAria")}
            className={cn(
              activeTasks.length > 0
                ? "bg-accent-bg-faint text-accent-color hover:bg-accent-bg-subtle"
                : taskPanelOpen
                  ? "text-success/90 hover:bg-success/10"
                  : "text-text-quaternary hover:bg-surface-muted hover:text-text-secondary",
            )}
          >
            {/* Loader2 while running (engine tasks); Activity otherwise — never
                ListTodo (reserved for the personal todo list, DESIGN §0.0.2) */}
            {activeTasks.length > 0 ? (
              <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
            ) : (
              <Activity size={ICON.micro} aria-hidden />
            )}
            {activeTasks.length > 0 ? (
              <span className="v4-ai-busy-text hidden tabular-nums sm:inline">
                {t("statusBar.taskRunning", { count: activeTasks.length })}
              </span>
            ) : null}
            {activeTasks.length > 0 ? <span className="v4-ai-progress-dot" aria-hidden /> : null}
          </StatusChip>
        </Tooltip>
        {busy.showTodoChip ? (
          <Tooltip content={t("statusBar.todoMaintainingTip")}>
            <StatusChip
              role="status"
              aria-live="polite"
              data-status-todo-busy
              onClick={() => emitLocal("todo:open-popover")}
              className="bg-accent-bg-faint text-accent-color hover:bg-accent-bg-subtle"
              aria-label={t("statusBar.todoMaintaining")}
            >
              {/* ListTodo — personal list only (DESIGN §0.0.2) */}
              <ListTodo size={ICON.micro} className="v4-ai-busy-icon" aria-hidden />
              <span className="v4-ai-busy-text hidden sm:inline">{t("statusBar.todoMaintaining")}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </StatusChip>
          </Tooltip>
        ) : null}
        {busy.showSuggestChip ? (
          <Tooltip content={t("statusBar.suggestLoadingTip")}>
            <StatusChip
              role="status"
              data-status-suggest-busy
              onClick={() => {
                void import("../../lib/suggest-surface").then(({ toggleSuggestSurface }) => {
                  toggleSuggestSurface({ refresh: true });
                });
              }}
              className={cn(
                "bg-accent-bg-faint text-accent-color hover:bg-accent-bg-subtle",
                suggestPanelOpen && "ring-1 ring-inset ring-accent-border-subtle",
              )}
              aria-pressed={suggestPanelOpen}
            >
              <Lightbulb size={ICON.micro} className="v4-ai-busy-icon" aria-hidden />
              <span className="v4-ai-busy-text hidden sm:inline">{t("statusBar.suggestLoading")}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </StatusChip>
          </Tooltip>
        ) : null}
        {/* 建议计数常驻 chip：移除画布顶 SuggestEntryStrip 后，计数统一在状态栏体现。
            loading 时由 showSuggestChip 承担；非 loading 有条目时显示计数 chip。 */}
        {busy.showSuggestCountChip ? (
          <Tooltip content={t("statusBar.suggestCountTip", { count: busy.suggestCount })}>
            <StatusChip
              role="status"
              data-status-suggest-count
              onClick={() => {
                void import("../../lib/suggest-surface").then(({ toggleSuggestSurface }) => {
                  toggleSuggestSurface({ refresh: false });
                });
              }}
              className={cn(
                busy.suggestHasHigh
                  ? "bg-warning/10 text-warning hover:bg-warning/20"
                  : "bg-accent-bg-faint text-accent-color hover:bg-accent-bg-subtle",
                suggestPanelOpen && "ring-1 ring-inset ring-accent-border-subtle",
              )}
              aria-pressed={suggestPanelOpen}
              aria-label={t("statusBar.suggestCount", { count: busy.suggestCount })}
            >
              <Lightbulb size={ICON.micro} className={busy.suggestHasHigh ? "text-warning" : "text-accent-color"} aria-hidden />
              <span className="hidden tabular-nums sm:inline">
                {t("statusBar.suggestCount", { count: busy.suggestCount })}
              </span>
            </StatusChip>
          </Tooltip>
        ) : null}
        {busy.showInlineChip ? (
          <Tooltip content={t("statusBar.inlineAiWorkingTip")}>
            <span
              role="status"
              aria-live="polite"
              data-status-inline-busy
              className={cn(statusChipSpanClass, "bg-accent-bg-faint text-accent-color")}
            >
              <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
              <span className="v4-ai-busy-text hidden max-w-[var(--status-chip-max-inline,7.5rem)] truncate sm:inline">{inlineLabel}</span>
              <span className="v4-ai-progress-dot" aria-hidden />
            </span>
          </Tooltip>
        ) : null}

        {/* 2026-08-07: divider removed when no busy chips — cleaner right rail */}
        {busy.hasNamedBusyChip ? <StatusDivider /> : null}

        <Tooltip content={aiTip}>
          <StatusChip
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
            <span className={cn("hidden max-w-[var(--status-chip-max-ai,9rem)] truncate md:inline", busy.aiPillBusy && "v4-ai-busy-text")}>{aiLabel}</span>
            {busy.aiPillBusy ? <span className="v4-ai-progress-dot" aria-hidden /> : null}
          </StatusChip>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * Center orientation hint — **file selections only**.
 * Primary click focuses the file in the editor (the user's expectation for a
 * "current file" chip); reveal-in-Finder demotes to the context menu.
 * Non-file views are already identified by the canvas PageHeader + active PrimaryNav
 * pill, so repeating them here was pure noise (降噪 2026-08).
 */
function SelectionHint({ selection }: { selection: Selection }) {
  const { t } = useTranslation(["shell", "common"]);
  const select = useViewStore((s) => s.select);
  if (selection.kind !== "file") return null;
  const label = selection.path.split("/").pop() ?? selection.path;
  const tip = `${selection.path}\n${t("statusBar.fileChipTip")}`;
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={() => select({ kind: "file", path: selection.path })}
        onContextMenu={(e) => {
          e.preventDefault();
          void api.sys.reveal(selection.path).catch(() => {});
        }}
        className={cn(
          "flex max-w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-text-quaternary",
          "transition-colors hover:bg-surface-muted hover:text-text-secondary v4-focus-ring",
        )}
      >
        <FileText size={ICON.micro} className="shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  );
}
