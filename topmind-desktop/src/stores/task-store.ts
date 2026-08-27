// ── Task Store — AI 后台任务管理 ──────────────────────────────────────────
// 管理 AI 任务的创建、执行、取消、重试。
// 支持的 task type 通过 api.ws 调用真实引擎 API。
import { create } from "zustand";
import { api } from "../services/api";
import i18n from "../locales";
import { emitLocal } from "../plugins/host";
import { SUGGESTIONS_REFRESH_EVENT } from "../lib/ai-rail-events";
import { engineJobSuggestionFollowUp } from "../lib/engine-job-follow-up";

/**
 * Supported engine tasks.
 * - reconcile: deterministic period-note cleanup (dedup, completion detection)
 * - ai_digest: activity-window analysis → confirm-shaped suggestion cards (no silent write)
 * digest / promote / archive are **suggestion-strip** apply paths (confirm-first),
 * not fake background task buttons — keep TaskType honest.
 */
export type TaskType = "reconcile" | "ai_digest";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  progress: number;
  currentStep?: string;
  logs: string[];
  result?: unknown;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** Keep only in-flight work — clearCompleted must never drop queued. */
export function keepActiveTasks<T extends { status: TaskStatus }>(tasks: T[]): T[] {
  return tasks.filter((t) => t.status === "running" || t.status === "queued");
}

/** Pure drag math for floating TaskPanel (right/bottom coords). */
export function computeTaskPanelDragPosition(
  start: { mouseX: number; mouseY: number; posX: number; posY: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, start.posX + (clientX - start.mouseX)),
    y: Math.max(0, start.posY + (clientY - start.mouseY)),
  };
}

/** Get translated task label for a task type. */
function taskLabel(type: TaskType): string {
  const key = `shell:taskPanel.taskType${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  return i18n.t(key, { ns: "shell" }) || type;
}

interface TaskStore {
  tasks: Task[];
  maxConcurrent: number;

  createTask: (type: TaskType, title?: string) => Promise<string>;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => Promise<void>;
  getTask: (taskId: string) => Task | undefined;
  clearCompleted: () => void;

  _updateTask: (taskId: string, updates: Partial<Task>) => void;
  _appendLog: (taskId: string, log: string) => void;
  _executeTask: (taskId: string) => Promise<void>;
  _drainQueue: () => void;
}

function genId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  maxConcurrent: 3,

  createTask: async (type, title) => {
    const taskId = genId();
    const task: Task = {
      id: taskId,
      type,
      title: title || taskLabel(type),
      status: "running",
      progress: 0,
      logs: [],
      createdAt: Date.now(),
    };

    const runningCount = get().tasks.filter((t) => t.status === "running").length;
    if (runningCount >= get().maxConcurrent) {
      // Queue the task — will be started when a running task finishes
      task.status = "queued";
      set((state) => ({ tasks: [...state.tasks, task] }));
      return taskId;
    }

    set((state) => ({ tasks: [...state.tasks, task] }));
    void get()._executeTask(taskId);
    return taskId;
  },

  cancelTask: (taskId) => {
    get()._updateTask(taskId, {
      status: "cancelled",
      completedAt: Date.now(),
      currentStep: undefined,
    });
    // Drain queue after cancellation
    void get()._drainQueue?.();
  },

  retryTask: async (taskId) => {
    const task = get().getTask(taskId);
    if (!task) return;

    get()._updateTask(taskId, {
      status: "running",
      progress: 0,
      logs: [],
      error: undefined,
      completedAt: undefined,
    });

    void get()._executeTask(taskId);
  },

  getTask: (taskId) => get().tasks.find((t) => t.id === taskId),

  clearCompleted: () => {
    set((state) => ({
      tasks: keepActiveTasks(state.tasks),
    }));
  },

  _updateTask: (taskId, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
    }));
    // When a task transitions out of running, drain the queue
    if (updates.status && updates.status !== "running" && updates.status !== "queued") {
      void get()._drainQueue?.();
    }
  },

  _appendLog: (taskId, log) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, logs: [...t.logs, `[${new Date().toLocaleTimeString()}] ${log}`] } : t,
      ),
    }));
  },

  _executeTask: async (taskId) => {
    const task = get().getTask(taskId);
    if (!task || (task.status !== "running" && task.status !== "queued")) return;

    // Promote queued → running
    if (task.status === "queued") {
      get()._updateTask(taskId, { status: "running" });
    }

    const { _updateTask, _appendLog } = get();

    try {
      switch (task.type) {
        case "reconcile": {
          _appendLog(taskId, i18n.t("shell:taskPanel.reconcileStart", { ns: "shell" }));
          _updateTask(taskId, { progress: 10, currentStep: i18n.t("shell:taskPanel.reconcileStart", { ns: "shell" }) });

          _updateTask(taskId, { progress: 30, currentStep: i18n.t("shell:taskPanel.reconcileReadPeriod", { ns: "shell" }) });
          const result = await api.ws.reconcileStreamPeriod({ apply: true });
          if (get().getTask(taskId)?.status === "cancelled") return;

          _updateTask(taskId, { progress: 70, currentStep: i18n.t("shell:taskPanel.reconcileProcess", { ns: "shell" }) });
          _appendLog(taskId, result.changed ? i18n.t("shell:taskPanel.reconcileChanged", { ns: "shell" }) : i18n.t("shell:taskPanel.reconcileNoChange", { ns: "shell" }));
          if (result.changes?.length) {
            for (const change of result.changes) {
              _appendLog(taskId, `  • ${change}`);
            }
          }
          _updateTask(taskId, {
            status: "completed",
            progress: 100,
            completedAt: Date.now(),
            currentStep: undefined,
            result,
          });
          // Notify completion via toast so StatusBar doesn't need a persistent completion state
          emitLocal("toast:show", { text: i18n.t("shell:taskPanel.reconcileDone", { ns: "shell" }), kind: "success" });
          const cand = (result as { candidates?: { core?: unknown[]; topics?: unknown[] } })?.candidates;
          const hasCandidates =
            Boolean(cand?.core && cand.core.length > 0)
            || Boolean(cand?.topics && cand.topics.length > 0);
          const follow = engineJobSuggestionFollowUp({
            type: "reconcile",
            changed: Boolean(result.changed),
            hasCandidates,
          });
          if (follow.emitSuggestionsRefresh) {
            emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: "reconcile" });
          }
          if (follow.emitWorkspaceFileChanged) {
            emitLocal("workspace:file-changed");
          }
          if (follow.openSuggestSurface) {
            emitLocal("suggest-surface:open", { refresh: false });
          }
          break;
        }
        case "ai_digest": {
          _appendLog(taskId, i18n.t("shell:taskPanel.aiDigestStart", { ns: "shell" }));
          _updateTask(taskId, { progress: 15, currentStep: i18n.t("shell:taskPanel.aiDigestStart", { ns: "shell" }) });

          // Activity-window suggestions + confirm-shaped memory/topic ops
          _updateTask(taskId, { progress: 40, currentStep: i18n.t("shell:taskPanel.aiDigestAnalyzing", { ns: "shell" }) });
          const { useActionStore } = await import("./action-store");
          const opResult = await useActionStore.getState().runActivityOps({ force: false });
          if (get().getTask(taskId)?.status === "cancelled") return;

          const allItems = useActionStore.getState().items.filter((i) => i.source === "suggestion");
          const aiSuggestions = allItems.filter(
            (s) =>
              s.suggestionKind === "ai_summary" ||
              s.suggestionKind === "stream_digest" ||
              s.suggestionKind === "promote_memory" ||
              s.suggestionKind === "create_topic",
          );
          _appendLog(
            taskId,
            i18n.t("shell:taskPanel.aiDigestFound", { ns: "shell", count: aiSuggestions.length }),
          );
          if (opResult.summary) _appendLog(taskId, opResult.summary);

          _updateTask(taskId, { progress: 80, currentStep: i18n.t("shell:taskPanel.aiDigestDone", { ns: "shell" }) });
          _updateTask(taskId, {
            status: "completed",
            progress: 100,
            completedAt: Date.now(),
            currentStep: undefined,
            result: {
              suggestionCount: aiSuggestions.length,
              mergedOps: opResult.merged,
            },
          });

          emitLocal("toast:show", { text: i18n.t("shell:taskPanel.aiDigestDoneToast", { ns: "shell", count: aiSuggestions.length }), kind: "success" });
          const follow = engineJobSuggestionFollowUp({
            type: "ai_digest",
            merged: opResult.merged,
            suggestionCount: aiSuggestions.length,
          });
          if (follow.openSuggestSurface) {
            emitLocal("suggest-surface:open", { refresh: false });
          }
          break;
        }
      }
    } catch (err) {
      if (get().getTask(taskId)?.status === "cancelled") return;
      _updateTask(taskId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: Date.now(),
      });
      // Notify failure via toast
      const errMsg = err instanceof Error ? err.message : String(err);
      emitLocal("toast:show", { text: i18n.t("shell:taskPanel.taskFailed", { ns: "shell", error: errMsg }), kind: "error" });
    }
  },

  _drainQueue: () => {
    const { tasks, maxConcurrent } = get();
    const runningCount = tasks.filter((t) => t.status === "running").length;
    if (runningCount >= maxConcurrent) return;
    const nextQueued = tasks.find((t) => t.status === "queued");
    if (nextQueued) {
      void get()._executeTask(nextQueued.id);
    }
  },
}));
