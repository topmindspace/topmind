/**
 * Shared task list body — used by floating TaskPanel and AI-rail TaskDock.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  X, RotateCcw, Loader2, CheckCircle2, XCircle, Clock, Wand2, Sparkles,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { useTaskStore, type Task } from "../../stores/task-store";

const STATUS_ICON: Record<Task["status"], ReactNode> = {
  queued: <Clock size={ICON.micro} className="text-text-quaternary" />,
  running: <Loader2 size={ICON.micro} className="animate-spin text-accent-color" />,
  completed: <CheckCircle2 size={ICON.micro} className="text-success" />,
  failed: <XCircle size={ICON.micro} className="text-error" />,
  cancelled: <XCircle size={ICON.micro} className="text-text-quaternary" />,
};

export function TaskListBody({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("shell");
  const tasks = useTaskStore((s) => s.tasks);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const retryTask = useTaskStore((s) => s.retryTask);
  const clearCompleted = useTaskStore((s) => s.clearCompleted);
  const createTask = useTaskStore((s) => s.createTask);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const hasCompleted = tasks.some((t) => t.status !== "running" && t.status !== "queued");
  const list = compact ? tasks.filter((t) => t.status === "running" || t.status === "queued").slice(0, 4) : tasks;

  if (tasks.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "py-2" : "py-6")}>
        {!compact ? (
          <div className="flex max-w-[16rem] flex-col gap-1">
            <span className="text-3xs text-text-tertiary">{t("taskPanel.empty")}</span>
            <span className="text-3xs text-text-quaternary leading-snug">{t("taskPanel.emptyHint")}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void createTask("reconcile")}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-accent-border-subtle bg-accent-bg-subtle px-2.5 py-1 text-3xs font-medium text-accent-color transition-colors hover:bg-accent-bg-subtle/80"
          >
            <Wand2 size={ICON.nano} />
            {t("taskPanel.taskTypeReconcile")}
          </button>
          <button
            type="button"
            onClick={() => void createTask("ai_digest")}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-accent-border-subtle bg-accent-bg-subtle px-2.5 py-1 text-3xs font-medium text-accent-color transition-colors hover:bg-accent-bg-subtle/80"
          >
            <Sparkles size={ICON.nano} />
            {t("taskPanel.triggerAiDigest")}
          </button>
          <button
            type="button"
            onClick={() => void createTask("memory_organize")}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-accent-border-subtle bg-accent-bg-subtle px-2.5 py-1 text-3xs font-medium text-accent-color transition-colors hover:bg-accent-bg-subtle/80"
          >
            <Sparkles size={ICON.nano} />
            {t("taskPanel.triggerMemoryOrganize")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {!compact && hasCompleted ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={clearCompleted}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-3xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary"
          >
            {t("taskPanel.clearCompleted")}
          </button>
        </div>
      ) : null}
      {list.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          compact={compact}
          expanded={!compact && expandedTaskId === task.id}
          onToggleExpand={() =>
            setExpandedTaskId((prev) => (prev === task.id ? null : task.id))
          }
          onCancel={() => cancelTask(task.id)}
          onRetry={() => void retryTask(task.id)}
        />
      ))}
      {compact && tasks.length > list.length ? (
        <div className="text-3xs text-text-quaternary tabular-nums">
          +{tasks.length - list.length}
        </div>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  compact,
  expanded,
  onToggleExpand,
  onCancel,
  onRetry,
}: {
  task: Task;
  compact?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("shell");

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border p-2 transition-colors",
        expanded
          ? "border-accent-border-subtle bg-accent-bg-faint"
          : "border-border-subtle-dim bg-surface/50",
        compact && "p-1.5",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{STATUS_ICON[task.status]}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-3xs font-medium text-text-primary">{task.title}</div>
          <div className="mt-0.5 text-3xs text-text-quaternary">
            {task.status === "queued" && t("taskPanel.status.queued")}
            {task.status === "running" && (task.currentStep || t("taskPanel.status.running"))}
            {task.status === "completed" && t("taskPanel.status.completed")}
            {task.status === "failed" && t("taskPanel.status.failed")}
            {task.status === "cancelled" && t("taskPanel.status.cancelled")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {task.status === "running" ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-error"
              aria-label={t("taskPanel.cancel")}
            >
              <X size={ICON.nano} />
            </button>
          ) : null}
          {task.status === "failed" ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-accent"
              aria-label={t("taskPanel.retry")}
            >
              <RotateCcw size={ICON.nano} />
            </button>
          ) : null}
        </div>
      </div>

      {(task.status === "running" || task.status === "queued") ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-normal",
              task.status === "queued" ? "bg-text-quaternary" : "bg-accent-color",
            )}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      ) : null}

      {!compact && (task.logs.length > 0 || task.result || task.error) && !expanded ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="mt-1 w-full text-3xs text-text-quaternary transition-colors hover:text-text-secondary"
        >
          {t("taskPanel.expand")}
        </button>
      ) : null}

      {!compact && expanded ? (
        <div className="mt-2 space-y-2 border-t border-border-subtle-dim pt-2">
          {task.logs.length > 0 ? (
            <div>
              <div className="mb-1 text-3xs font-medium text-text-quaternary">{t("taskPanel.logs")}</div>
              <div className="v4-sidebar-scroll max-h-28 overflow-y-auto rounded-[var(--radius-sm)] bg-surface-muted p-1.5">
                {task.logs.map((log, idx) => (
                  <div key={idx} className="text-3xs leading-relaxed text-text-secondary">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {task.status === "completed" && Boolean(task.result) ? (
            <div>
              <div className="mb-1 text-3xs font-medium text-text-quaternary">{t("taskPanel.result")}</div>
              <div className="rounded-[var(--radius-sm)] bg-surface-muted p-1.5 text-3xs text-text-secondary">
                <TaskResultView result={task.result} />
              </div>
            </div>
          ) : null}
          {task.status === "failed" && task.error ? (
            <div>
              <div className="mb-1 text-3xs font-medium text-error">{t("taskPanel.error")}</div>
              <div className="rounded-[var(--radius-sm)] bg-status-error-bg p-1.5 text-3xs text-error">
                {task.error}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-3xs text-text-quaternary transition-colors hover:text-text-secondary"
          >
            {t("taskPanel.collapse")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TaskResultView({ result }: { result: unknown }) {
  const { t } = useTranslation("shell");
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;

  const lines: string[] = [];
  if (typeof r.ok === "boolean") {
    lines.push(r.ok ? t("taskPanel.resultOk") : t("taskPanel.resultFail"));
  }
  if (typeof r.changed === "boolean") {
    lines.push(r.changed ? t("taskPanel.resultChanged") : t("taskPanel.resultNoChange"));
  }
  if (typeof r.path === "string" && r.path) {
    lines.push(t("taskPanel.resultPath", { path: r.path }));
  }
  if (typeof r.packing === "string" && r.packing) {
    lines.push(t("taskPanel.resultPacking", { packing: r.packing }));
  }
  if (Array.isArray(r.changes) && r.changes.length > 0) {
    lines.push(t("taskPanel.resultChanges", { count: r.changes.length }));
  }
  const candidates = r.candidates as { core?: unknown[]; topics?: unknown[] } | undefined;
  if (candidates?.core?.length) {
    lines.push(t("taskPanel.resultCoreCandidates", { count: candidates.core.length }));
  }
  if (candidates?.topics?.length) {
    lines.push(
      t("taskPanel.resultTopicCandidates", {
        topics: candidates.topics.slice(0, 6).join(", "),
      }),
    );
  }
  if (typeof r.suggestionCount === "number") {
    lines.push(t("taskPanel.aiDigestFound", { count: r.suggestionCount }));
  }
  if (typeof r.merged === "number") {
    lines.push(t("taskPanel.memoryOrganizeMerged", { count: r.merged }));
  }
  if (typeof r.summary === "string" && r.summary) {
    lines.push(r.summary);
  }
  if (lines.length === 0) {
    try {
      return <pre className="whitespace-pre-wrap">{JSON.stringify(r, null, 2).slice(0, 400)}</pre>;
    } catch {
      return null;
    }
  }
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
