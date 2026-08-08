/**
 * TodoStore — 个人待办事项状态管理。
 *
 * 概念对齐（用户视角）：
 * - 对话 → AiStore（messages / streaming）
 * - 待办（建议+挂起写入） → ActionStore（workspace management suggestions）
 * - 后台任务 → TaskStore（reconcile / ai_digest）
 * - 我的待办清单 → TodoStore（personal action items）
 *
 * 数据真源：memory/todo.md（经 writeback-engine 写入）
 * AI 维护：从动态提取 + 检测完成 + 更新状态；用户可手动增删改查。
 *
 * UI 入口：
 * - TitleBar 图标 → TodoPopover（浮动面板 · pin/unpin · 可拖动）
 * - ⌘⇧T 快捷打开 TodoPopover
 */
import { create } from "zustand";
import { api } from "../services/api";
import { emitLocal, onLocal } from "../plugins/host";
import type { TodoItem, TodoHealth } from "../types";
import i18n from "../locales";

export type MaintainState = "idle" | "maintaining" | "done" | "error";

interface TodoStore {
  items: TodoItem[];
  loading: boolean;
  maintaining: MaintainState;
  maintainMessage: string | null;
  maintainReason: string | null;  // store the raw reason for better conditional logic
  health: TodoHealth | null;
  everLoaded: boolean;

  // Computed helpers
  activeItems: () => TodoItem[];
  completedItems: () => TodoItem[];
  overdueItems: () => TodoItem[];
  staleItems: () => TodoItem[];

  // Actions
  refresh: () => Promise<void>;
  add: (text: string) => Promise<boolean>;
  toggle: (id: string) => Promise<void>;
  update: (id: string, text: string, opts?: { dueDate?: string | null }) => Promise<void>;
  setDueDate: (id: string, dueDate: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  maintain: (opts?: { force?: boolean }) => Promise<void>;
  cleanupStale: () => Promise<void>;
  archiveStale: () => Promise<void>;
  refreshHealth: () => Promise<void>;

  // Internal
  _setItems: (items: TodoItem[]) => void;
  _initWatch: () => (() => void) | null;
}

// ── Singleton file watcher (reference-counted, shared by TodoPopover) ──
// Guards against redundant refresh loops:
// 1. After our own writes (add/toggle/update/remove/clearCompleted/maintain),
//    we emit "workspace:file-changed" to notify other views.
//    The watcher would then re-trigger refresh() — we skip one cycle with _skipNextWatch.
// 2. The watcher debounces 500ms and only fires when everLoaded = true.
let _watchDebounce: ReturnType<typeof setTimeout> | null = null;
let _watchRefCount = 0;
let _watchUnsub: (() => void) | null = null;
/** Skip the next file-changed watch trigger (set before emitting our own change). */
let _skipNextWatch = false;

function initWatch(): (() => void) | null {
  _watchRefCount++;
  if (_watchRefCount === 1) {
    _watchUnsub = onLocal("workspace:file-changed", (payload) => {
      // Skip if this event was caused by our own write
      if (_skipNextWatch) {
        _skipNextWatch = false;
        return;
      }
      // Only react to workspace-wide changes (no payload) or todo.md-related paths
      if (payload && typeof payload === "object" && "relativePath" in payload) {
        const p = (payload as { relativePath?: string }).relativePath || "";
        // Only refresh for todo.md or memory/ changes; ignore unrelated file changes
        if (!p.includes("todo.md") && !p.includes("memory/")) return;
      }
      if (_watchDebounce) clearTimeout(_watchDebounce);
      _watchDebounce = setTimeout(() => {
        if (useTodoStore.getState().everLoaded) {
          void useTodoStore.getState().refresh();
        }
      }, 500);
    });
  }
  return () => {
    _watchRefCount = Math.max(0, _watchRefCount - 1);
    if (_watchRefCount === 0 && _watchUnsub) {
      _watchUnsub();
      _watchUnsub = null;
      if (_watchDebounce) { clearTimeout(_watchDebounce); _watchDebounce = null; }
    }
  };
}

/** Emit file-changed but suppress the next watch-triggered refresh (our own write). */
function emitSelfFileChanged() {
  _skipNextWatch = true;
  emitLocal("workspace:file-changed");
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  items: [],
  loading: false,
  maintaining: "idle",
  maintainMessage: null,
  maintainReason: null,
  health: null,
  everLoaded: false,

  activeItems: () => get().items.filter((i) => !i.done),
  completedItems: () => get().items.filter((i) => i.done),
  overdueItems: () => {
    const today = new Date().toISOString().slice(0, 10);
    return get().items.filter((i) => !i.done && i.dueDate && i.dueDate < today);
  },
  staleItems: () => {
    const today = new Date().toISOString().slice(0, 10);
    return get().items.filter((i) => {
      if (!i.createdAt || i.done) return false;
      const days = Math.round((new Date(today).getTime() - new Date(i.createdAt).getTime()) / 86400000);
      return days > 30;
    });
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const result = await api.todo.list();
      set({
        items: result?.items || [],
        loading: false,
        everLoaded: true,
      });
    } catch {
      // Graceful degradation: keep existing items on transient errors
      set({ loading: false, everLoaded: true });
    }
  },

  add: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    try {
      const result = await api.todo.add(trimmed);
      if (result.ok && result.items) {
        set({ items: result.items });
        emitSelfFileChanged();
      } else if (result.reason === "duplicate") {
        set({ maintainMessage: i18n.t("shell:todo.duplicateItem"), maintaining: "error", maintainReason: null });
      }
      return result.ok;
    } catch {
      return false;
    }
  },

  toggle: async (id: string) => {
    const prev = get().items;
    const optimistic = prev.map((i) =>
      i.id === id ? { ...i, done: !i.done } : i,
    );
    set({ items: optimistic });
    try {
      const result = await api.todo.toggle(id);
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
    } catch {
      set({ items: prev });
    }
  },

  update: async (id: string, text: string, opts?: { dueDate?: string | null }) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const result = await api.todo.update(id, trimmed, opts);
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
    } catch {
      /* ignore */
    }
  },

  setDueDate: async (id: string, dueDate: string | null) => {
    try {
      const result = await api.todo.setDueDate(id, dueDate);
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
    } catch {
      /* ignore */
    }
  },

  remove: async (id: string) => {
    const prev = get().items;
    set({ items: prev.filter((i) => i.id !== id) });
    try {
      const result = await api.todo.delete(id);
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
    } catch {
      set({ items: prev });
    }
  },

  clearCompleted: async () => {
    try {
      const result = await api.todo.clearCompleted();
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
    } catch {
      /* ignore */
    }
  },

  maintain: async (opts?: { force?: boolean }) => {
    if (get().maintaining === "maintaining") return;
    // Mark busy immediately so StatusBar shows todo chip while waiting on background lane
    set({
      maintaining: "maintaining",
      maintainMessage: null,
      maintainReason: null,
    });
    try {
      // Serialize with suggest prepare (and other background AI) — not with agent stream
      const { enqueueBackgroundAi, getBackgroundAiSnapshot } = await import(
        "../lib/ai-background-lane"
      );
      const snap = getBackgroundAiSnapshot();
      if (snap.busy && snap.active && snap.active !== "todo") {
        set({ maintainMessage: i18n.t("shell:todo.maintainQueued") });
      }
      const result = await enqueueBackgroundAi("todo", async () => {
        // Lane slot acquired — drop "queued" banner so StatusBar/body show real maintain work
        if (get().maintainMessage) {
          set({ maintainMessage: null });
        }
        return api.todo.maintain(opts);
      });
      if (result.ok) {
        await get().refresh();
        const parts: string[] = [];
        if (result.added?.length > 0) parts.push(i18n.t("shell:todo.maintainAdded", { count: result.added.length }));
        if (result.completed?.length > 0) parts.push(i18n.t("shell:todo.maintainCompleted", { count: result.completed.length }));
        if (result.updated?.length > 0) parts.push(i18n.t("shell:todo.maintainUpdated", { count: result.updated.length }));

        let msg = "";
        let reason = result.reason || null;
        if (result.reason === "all-periods-processed") {
          msg = i18n.t("shell:todo.maintainAlreadyProcessed");
          reason = result.reason;
        } else if (result.reason === "no-changes") {
          msg = i18n.t("shell:todo.maintainNoChanges");
          reason = result.reason;
        } else {
          msg = parts.length > 0
            ? i18n.t("shell:todo.maintainDoneWithChanges", { parts: parts.join(" · "), period: result.period || i18n.t("shell:sidebar.streamDefault") })
            : i18n.t("shell:todo.maintainDone");
        }
        set({ maintaining: "done", maintainMessage: msg, maintainReason: reason });
        emitSelfFileChanged();
      } else {
        const reason = result.reason || "failed";
        const msg =
          reason === "no-ai-provider" ? i18n.t("shell:todo.maintainNoAiProvider")
          : reason === "no-period-note" ? i18n.t("shell:todo.maintainNoPeriodNote")
          : reason === "ai-failed" ? i18n.t("shell:todo.maintainAiFailed")
          : i18n.t("shell:todo.maintainFailed");
        set({ maintaining: "error", maintainMessage: msg, maintainReason: null });
      }
    } catch (e) {
      set({
        maintaining: "error",
        maintainMessage: e instanceof Error ? e.message : String(e),
        maintainReason: null,
      });
    }
  },

  cleanupStale: async () => {
    try {
      const result = await api.todo.cleanupStale();
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
      await get().refreshHealth();
    } catch {
      /* ignore */
    }
  },

  archiveStale: async () => {
    try {
      const result = await api.todo.archiveStale();
      if (result.items) set({ items: result.items });
      emitSelfFileChanged();
      await get().refreshHealth();
    } catch {
      /* ignore */
    }
  },

  refreshHealth: async () => {
    try {
      const h = await api.todo.getHealth();
      set({ health: h });
    } catch {
      /* ignore */
    }
  },

  _setItems: (items: TodoItem[]) => set({ items }),
  _initWatch: () => initWatch(),
}));
