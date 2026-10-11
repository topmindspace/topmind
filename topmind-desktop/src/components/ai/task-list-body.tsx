/**
 * Shared task list body — used by floating TaskPanel and AI-rail TaskDock.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RiArrowGoBackLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiCloseLine,
  RiLoader4Line,
  RiSortDesc,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { Button } from "../ui/Button";
import { StatusDot } from "../ui/StatusDot";
import { SuggestionCard } from "../ui/SuggestionCard";
import { useTaskStore, type Task } from "../../stores/task-store";

const STATUS_ICON: Record<Task["status"], ReactNode> = {
  queued: <RiTimeLine size={ICON.micro} className="text-text-quaternary" />,
  running: <RiLoader4Line size={ICON.micro} className="animate-spin text-accent-color" />,
  completed: <RiCheckboxCircleLine size={ICON.micro} className="text-success" />,
  failed: <RiCloseCircleLine size={ICON.micro} className="text-error" />,
  cancelled: <RiCloseCircleLine size={ICON.micro} className="text-text-quaternary" />,
};

const STATUS_TONE: Record<Task["status"], "neutral" | "running" | "success" | "error"> = {
  queued: "neutral",
  running: "running",
  completed: "success",
  failed: "error",
  cancelled: "neutral",
};

/** Engine jobs offered on the empty task list — one source, no duplicate CTA strings. */
const EMPTY_ENGINE_JOBS = [
  { job: "reconcile", icon: "sort" as const, labelKey: "taskPanel.taskTypeReconcile", actionKey: "taskPanel.triggerReconcile", descKey: "taskPanel.emptyHint" },
  { job: "ai_digest", icon: "spark" as const, labelKey: "taskPanel.taskTypeAi_digest", actionKey: "taskPanel.triggerAiDigest" },
  { job: "memory_organize", icon: "spark" as const, labelKey: "taskPanel.taskTypeMemory_organize", actionKey: "taskPanel.triggerMemoryOrganize" },
] as const;

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
      <div className={cn("flex flex-col items-stretch justify-center gap-2", compact ? "py-2" : "py-4")}>
        {!compact ? (
          <div className="mb-1 text-center">
            <div className="text-xs font-medium text-text-tertiary">{t("taskPanel.empty")}</div>
            <div className="mt-0.5 text-xs leading-snug text-text-quaternary">{t("taskPanel.emptyHint")}</div>
          </div>
        ) : null}
        {compact ? (
          <div className="flex items-center justify-center gap-1.5">
            {EMPTY_ENGINE_JOBS.filter((j) => j.job !== "memory_organize").map((j) => (
              <Button key={j.job} variant="ai" size="sm" onClick={() => void createTask(j.job)}>
                {j.icon === "sort" ? <RiSortDesc size={ICON.micro} /> : <RiSparklingLine size={ICON.micro} />}
                {t(j.actionKey)}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {EMPTY_ENGINE_JOBS.map((j) => (
              <SuggestionCard
                key={j.job}
                icon={
                  j.icon === "sort"
                    ? <RiSortDesc size={ICON.sm} className="text-accent-color" />
                    : <RiSparklingLine size={ICON.sm} className={j.job === "memory_organize" ? "text-warning" : "text-accent-color"} />
                }
                title={t(j.labelKey)}
                description={"descKey" in j && j.descKey ? t(j.descKey) : undefined}
                action={
                  <Button size="sm" variant="ghost" onClick={() => void createTask(j.job)}>
                    {t(j.actionKey)}
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {!compact && hasCompleted ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearCompleted}
            className="h-auto px-1.5 py-0.5 text-3xs text-text-quaternary"
          >
            {t("taskPanel.clearCompleted")}
          </Button>
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
          <div className="flex items-center gap-1.5">
            <StatusDot tone={STATUS_TONE[task.status]} />
            <div className="truncate text-xs font-medium text-text-primary">{task.title}</div>
          </div>
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
              className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-text-tertiary transition-colors hover:bg-state-hover hover:text-error"
              aria-label={t("taskPanel.cancel")}
            >
              <RiCloseLine size={ICON.micro} />
            </button>
          ) : null}
          {task.status === "failed" ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-text-tertiary transition-colors hover:bg-state-hover hover:text-accent-color"
              aria-label={t("taskPanel.retry")}
            >
              <RiArrowGoBackLine size={ICON.micro} />
            </button>
          ) : null}
        </div>
      </div>

      {(task.status === "running" || task.status === "queued") ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-wash-30">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-normal",
              task.status === "queued" ? "bg-status-neutral" : "bg-accent-color",
            )}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      ) : null}

      {!compact && (task.logs.length > 0 || task.result || task.error) && !expanded ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="mt-1 w-full text-xs text-text-quaternary transition-colors hover:text-text-secondary"
        >
          {t("taskPanel.expand")}
        </button>
      ) : null}

      {!compact && expanded ? (
        <div className="mt-2 space-y-2 border-t border-border-subtle-dim pt-2">
          {task.logs.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-text-quaternary">{t("taskPanel.logs")}</div>
              <div className="v4-focus-ring v4-sidebar-scroll max-h-28 overflow-y-auto rounded-[var(--radius-sm)] bg-surface-wash-30 p-1.5">
                {task.logs.map((log, idx) => (
                  <div key={idx} className="text-xs leading-relaxed text-text-secondary">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {task.status === "completed" && Boolean(task.result) ? (
            <div>
              <div className="mb-1 text-xs font-medium text-text-quaternary">{t("taskPanel.result")}</div>
              <div className="v4-focus-ring rounded-[var(--radius-sm)] bg-surface-wash-30 p-1.5 text-xs text-text-secondary">
                <TaskResultView result={task.result} />
              </div>
            </div>
          ) : null}
          {task.status === "failed" && task.error ? (
            <div>
              <div className="mb-1 text-xs font-medium text-error">{t("taskPanel.error")}</div>
              <div className="v4-focus-ring rounded-[var(--radius-sm)] bg-status-error-bg p-1.5 text-xs text-error">
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
