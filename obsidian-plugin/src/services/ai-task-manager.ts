// ── AI Task Manager: multi-task queue, progress tracking, abort ──────────────
//
// Manages AI operations (todo_maintain, topic_classify, memory_organize,
// suggest) with:
// - Serial queue (one AI operation at a time, matches Desktop's background lane)
// - Progress tracking (pending → running → done/error/aborted)
// - Abort capability (cancel running operation via AbortSignal)
// - Event-based UI notification (observers get notified on state change)
// - Operation history (last 20 results)
//
// Design: This is a UI-layer service — it wraps KernelService.runOperation
// and generateSuggestions with queue/progress/abort semantics. It does NOT
// duplicate Kernel business logic.

import type { SuggestionCard } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "done" | "error" | "aborted";

export interface AiTask {
  id: string;
  operation: string;
  label: string;
  status: TaskStatus;
  startedAt?: number;
  finishedAt?: number;
  result?: { ok: boolean; summary: string; suggestions?: SuggestionCard[] };
  error?: string;
}

export interface TaskProgress {
  active: AiTask | null;
  queued: AiTask[];
  recent: AiTask[];
  multiActive: number;
}

type TaskListener = (progress: TaskProgress) => void;

type TaskExecutor = (signal: AbortSignal) => Promise<{ ok: boolean; summary: string; suggestions?: SuggestionCard[] }>;

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 20;

// ── Internal task with executor ──────────────────────────────────────────────

interface InternalTask extends AiTask {
  executor: TaskExecutor;
}

// ── AI Task Manager ──────────────────────────────────────────────────────────

let taskCounter = 0;

function nextId(): string {
  taskCounter += 1;
  return `task-${Date.now()}-${taskCounter}`;
}

/**
 * Singleton task manager for AI operations.
 *
 * Serial queue — one AI operation runs at a time (aligned with Desktop's
 * `ai-background-lane` serial strategy). This prevents concurrent AI API
 * calls from exhausting rate limits and keeps the UI responsive.
 */
class AiTaskManager {
  private queue: InternalTask[] = [];
  private active: InternalTask | null = null;
  private history: AiTask[] = [];
  private listeners: Set<TaskListener> = new Set();
  private abortController: AbortController | null = null;

  /** Subscribe to progress updates. Returns unsubscribe function. */
  subscribe(fn: TaskListener): () => void {
    this.listeners.add(fn);
    fn(this.getProgress());
    return () => { this.listeners.delete(fn); };
  }

  /** Get current progress snapshot (safe to render from this). */
  getProgress(): TaskProgress {
    return {
      active: this.active ? this.toPublicTask(this.active) : null,
      queued: this.queue.map((t) => this.toPublicTask(t)),
      recent: this.history.slice(-MAX_HISTORY).map((t) => ({ ...t })),
      multiActive: (this.active ? 1 : 0) + this.queue.length,
    };
  }

  /** Enqueue an AI operation. Returns the task object (without executor). */
  enqueue(operation: string, label: string, executor: TaskExecutor): AiTask {
    const task: InternalTask = {
      id: nextId(),
      operation,
      label,
      status: "pending",
      executor,
    };
    this.queue.push(task);
    this.notify();
    void this.runNext();
    return this.toPublicTask(task);
  }

  /** Abort the currently running task (if any). */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /** Check if a specific operation type is already queued or running. */
  isOperationActive(operation: string): boolean {
    return (
      (this.active?.operation === operation) ||
      this.queue.some((t) => t.operation === operation)
    );
  }

  /** Clear history. */
  clearHistory(): void {
    this.history = [];
    this.notify();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private toPublicTask(t: InternalTask): AiTask {
    // Strip executor from the public interface
    const { executor: _executor, ...publicTask } = t;
    return publicTask;
  }

  private async runNext(): Promise<void> {
    if (this.active) return; // Already running

    const task = this.queue.shift();
    if (!task) return;

    this.active = task;
    task.status = "running";
    task.startedAt = Date.now();
    this.abortController = new AbortController();
    this.notify();

    try {
      const result = await task.executor(this.abortController.signal);
      task.status = "done";
      task.result = result;
      task.finishedAt = Date.now();
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        task.status = "aborted";
      } else {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
      }
      task.finishedAt = Date.now();
    }

    // Move to history
    this.history.push(this.toPublicTask(task));
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }

    this.active = null;
    this.abortController = null;
    this.notify();

    // Run next queued task
    if (this.queue.length > 0) {
      void this.runNext();
    }
  }

  private notify(): void {
    const progress = this.getProgress();
    for (const fn of this.listeners) {
      try { fn(progress); } catch { /* listener error — ignore */ }
    }
  }
}

/** Singleton instance. */
export const aiTaskManager = new AiTaskManager();
