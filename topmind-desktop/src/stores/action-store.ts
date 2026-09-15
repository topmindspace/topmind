/**
 * ActionStore — 统一行动数据源（AI 轨「建议 / 待确认写入」）。
 *
 * 用户视角三层（勿与个人清单混称「待办」）：
 * - 对话 → AiStore（messages / streaming）
 * - 建议 → ActionStore（Kernel suggestions + confirm pending writes）
 * - 个人清单 → TodoStore / AI 工作区 清单 pane（memory/todo.md）
 * - 后台 → TaskStore（reconcile / ai_digest）
 */
import { create } from 'zustand';
import { api } from '../services/api';
import { subscribe as subscribeRpcEvent } from '../services/rpc';
import { emitLocal, onLocal } from '../plugins/host';
import { PENDING_WRITES_CHANGED_EVENT, SUGGESTIONS_REFRESH_EVENT } from '../lib/ai-rail-events';
import { toastWriteback, toastWritebackError } from '../lib/writeback-toast';
import { mergeSuggestRefreshItems } from '../lib/suggest-session-merge';
import { decideSuggestRefresh } from '../lib/suggest-boot-policy';
import {
  isTerminalApplyFailure,
  suggestionNavPathAfterApply,
  suggestionOpenPath,
} from '../lib/suggest-apply-label';
import { useViewStore } from './view-store';
import i18n from '../locales';

export interface ActionItem {
  id: string;
  /** 'suggestion' 来自 Kernel 建议引擎，'pending_write' 来自 confirm 模式挂起的写入 */
  source: 'suggestion' | 'pending_write';
  priority: 'low' | 'medium' | 'high';
  title: string;
  summary: string;
  targetPath?: string;
  /** suggestion 特有 */
  suggestionKind?: string;
  suggestionPayload?: Record<string, unknown>;
  /** pending_write 特有 */
  writeContent?: string;
  toolName?: string;
  createdAt: string;
}

/** Session-scoped dismissed suggestion IDs — hides re-surfacing within the session.
 *  Backed by a durable dismissal file (see persistDismissals) so a rejection also
 *  survives a restart and a manual force refresh. */
const dismissedIds = new Set<string>();
/** Applied suggestion IDs — suppress re-suggesting immediately after action. */
const appliedIds = new Set<string>();

/**
 * Write rejections to `.topmind/suggest-dismissed.json` via the Kernel.
 * Fire-and-forget on purpose: the card is already gone from the UI, so a failed
 * write must not surface an error or block the interaction. Session memory
 * (dismissedIds) still holds for the rest of this run.
 */
function persistDismissals(ids: string[]): void {
  const clean = ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (clean.length === 0) return;
  void api.ws.dismissSuggestions(clean).catch(() => {
    /* durable memory is best-effort; session memory already applied */
  });
}
/**
 * Session cache of suggestions from activity AI ops (memory_organize / topic_classify).
 * Survives ActionStore.refresh() so organize path does not wipe confirm cards.
 */
const opSuggestionCache = new Map<
  string,
  {
    id: string;
    kind?: string;
    title: string;
    summary: string;
    targetPath?: string;
    impact?: "low" | "medium" | "high";
    payload?: Record<string, unknown>;
  }
>();

/**
 * Session cache of ALL kernel suggestions shown this session.
 * Soft refresh / poll re-merge from here when generateSuggestions returns empty
 * (fingerprint skip) so items do not appear-then-vanish.
 */
const sessionSuggestionCache = new Map<
  string,
  {
    id: string;
    kind?: string;
    title: string;
    summary: string;
    targetPath?: string;
    impact?: "low" | "medium" | "high";
    payload?: Record<string, unknown>;
  }
>();

/**
 * Human label for a failed apply — reason code first (localized in the UI
 * language), the kernel's note as fallback. The engine's notes are written in
 * the workspace locale, so without this an English-UI user with a Chinese
 * workspace would read Chinese failure copy.
 */
function applyFailureLabel(res: { reason?: string; note?: string }): string {
  const key = res.reason ? `editor:ai.applyFail.${res.reason}` : "";
  if (key && i18n.exists(key)) return i18n.t(key);
  return res.note || res.reason || "";
}

/** Kernel suggestion object for an item, with the archive-kind payload override. */
function buildApplyPayload(item: ActionItem): Record<string, unknown> {
  const suggestionObj = {
    id: item.id,
    kind: item.suggestionKind,
    title: item.title,
    summary: item.summary,
    targetPath: item.targetPath,
    impact: item.priority,
    payload: item.suggestionPayload,
  };
  // stale_topic / catch_all: force archive action on payload.
  // inbox_review / inbox_organize keep their own payload (move / create / batch hint) —
  // aged Inbox notes are placement candidates, not archive-by-default.
  const isArchiveKind =
    item.suggestionKind === 'stale_topic'
    || item.suggestionKind === 'catch_all';
  return isArchiveKind
    ? {
        ...suggestionObj,
        payload: {
          ...(suggestionObj.payload || {}),
          action: 'archive',
          path: item.targetPath || item.suggestionPayload?.path,
        },
      }
    : suggestionObj;
}

interface ActionStore {
  items: ActionItem[];
  loading: boolean;
  expanded: boolean;  // SuggestPopover 展开
  /** Global SuggestPopover open (header-centric confirm surface) */
  panelOpen: boolean;
  busyId: string | null;  // 正在处理的项 ID
  message: string | null;  // 操作反馈消息
  autoPrepare: boolean;  // 是否自动准备建议（从 settings 读取）
  everLoaded: boolean;  // 是否曾加载过（用于空态判断）
  /** Timestamp of last refresh — throttles rapid re-fetches from events */
  lastRefreshAt: number;
  /** Bulk accept progress — null when idle. Surfaces an honest in-progress state. */
  applying: { current: number; total: number; title: string } | null;

  // 数据加载
  /** Soft refresh by default (preserve session suggestions). force=true replaces.
   * pollOnly=true: safety-poll tick — only refresh pending writes, skip kernel suggest. */
  refresh: (opts?: { force?: boolean; pollOnly?: boolean }) => Promise<void>;
  /**
   * Run activity-window AI ops (memory_organize + topic_classify) and merge
   * confirm-shaped suggestions into the SuggestPopover list. Does not auto-apply.
   */
  runActivityOps: (opts?: { force?: boolean }) => Promise<{ merged: number; summary: string }>;
  /** Merge raw Kernel suggestion-shaped objects into items (dedupe by id). */
  mergeSuggestions: (suggestions: Array<{
    id: string;
    kind?: string;
    title: string;
    summary: string;
    targetPath?: string;
    impact?: "low" | "medium" | "high";
    payload?: Record<string, unknown>;
  }>) => number;

  // 操作
  /** Accept a suggestion or confirm a pending write.
   *  opts.skipNav suppresses navigation (used by acceptAll).
   *  opts.silent suppresses per-item toasts / refresh events (bulk).
   *  Returns whether the item was applied (false on skip, confirm-gate, or error). */
  acceptItem: (id: string, opts?: { skipNav?: boolean; silent?: boolean }) => Promise<boolean>;
  /** Open the existing associated note (周期本 / profile) without writing. */
  openItem: (id: string) => void;
  rejectItem: (id: string) => Promise<void>;  // 忽略建议或拒绝写入
  dismissItem: (id: string) => void;  // 仅从 UI 隐藏（不调后端），并记住 dismiss 以避免重复
  clearDismissed: () => Promise<void>;  // 清除 dismiss 记忆（含磁盘）；手动刷新前 await
  /** Accept all actionable items sequentially.
   *  Suggestions go in ONE batch IPC (main applies sequentially, pushes progress);
   *  pending writes confirm individually. Terminal failures (source file gone…)
   *  auto-cancel the card — counted as `cancelled`, not `failed`. */
  acceptAll: () => Promise<{ accepted: number; failed: number; cancelled: number; summary: string }>;
  /** Dismiss all suggestion items (not pending writes). */
  dismissAll: () => void;

  // UI 状态
  setExpanded: (v: boolean) => void;
  setPanelOpen: (v: boolean) => void;
  clearMessage: () => void;
  /** Toggle auto-prepare suggestions and persist to settings */
  toggleAutoPrepare: () => Promise<void>;
  setAutoPrepare: (next: boolean, opts?: { persist?: boolean }) => Promise<void>;
}

// ── Single refresh queue ────────────────────────────────────────────────
// All triggers (events / safety poll / manual / boot) funnel through one
// serialized queue: concurrent callers coalesce (force wins), never run two
// kernel suggest passes in parallel (wasted AI tokens + flicker).
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;
let refreshQueuedForce = false;

function enqueueSuggestRefresh(
  run: (force: boolean) => Promise<void>,
  force: boolean,
): Promise<void> {
  refreshQueued = true;
  refreshQueuedForce = refreshQueuedForce || force;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      while (refreshQueued) {
        const effectiveForce = refreshQueuedForce;
        refreshQueued = false;
        refreshQueuedForce = false;
        await run(effectiveForce);
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Let React paint bulk-apply progress between sequential writes. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export const useActionStore = create<ActionStore>((set, get) => ({
  items: [],
  loading: false,
  expanded: false,
  panelOpen: false,
  busyId: null,
  message: null,
  autoPrepare: true,
  everLoaded: false,
  lastRefreshAt: 0,
  applying: null,

  refresh: (opts = {}) => {
    const requestedForce = opts.force === true;
    return enqueueSuggestRefresh(async (force) => {
    const now = Date.now();
    // Lazy import to avoid circular store deps at module load
    let agentStreaming = false;
    try {
      const { useAiStore } = await import("./ai-store");
      agentStreaming = useAiStore.getState().streaming === true;
    } catch {
      agentStreaming = false;
    }
    const decision = decideSuggestRefresh({
      autoPrepare: get().autoPrepare,
      force,
      lastRefreshAt: get().lastRefreshAt,
      now,
      everLoaded: get().everLoaded,
      itemCount: get().items.length,
      agentStreaming,
      pollOnly: opts?.pollOnly,
    });

    // Soft throttle: skip entirely (no pending / no kernel)
    if (decision.reason === "soft_throttled") {
      return;
    }

    const hadItems = get().items.length > 0 || get().everLoaded;
    // Soft refresh: keep existing list visible — do not flash empty/loading chrome.
    // Force refresh: always show loading so user gets immediate feedback on click.
    // Cold start with autoPrepare: brief loading only when list empty.
    const showLoading =
      decision.runKernelSuggest &&
      (force || !hadItems || get().items.length === 0);
    set({
      loading: showLoading,
      message: null,
      lastRefreshAt: now,
    });

    if (force) {
      // Manual force: clear session seeds so regenerate is honest (keep op cache)
      sessionSuggestionCache.clear();
    }

    try {
      const { enqueueBackgroundAi } = await import("../lib/ai-background-lane");
      // Kernel suggest shares the background AI lane with todo maintain (serialize LLM).
      // Pending writes stay free of the lane (no LLM).
      type KernelSuggestionRow = {
        id: string;
        kind?: string;
        title: string;
        summary: string;
        targetPath?: string;
        impact?: "low" | "medium" | "high";
        payload?: Record<string, unknown>;
      };
      type SuggestApiResult = { suggestions?: KernelSuggestionRow[] };
      const suggestPromise: Promise<SuggestApiResult> = decision.runKernelSuggest
        ? enqueueBackgroundAi("suggest", () =>
            api.ws.generateSuggestions({ force: !decision.soft }),
          )
        : Promise.resolve({ suggestions: [] });
      const [sugRes, pwRes] = await Promise.allSettled([
        suggestPromise,
        decision.runPendingWrites
          ? api.ws.listPendingWrites()
          : Promise.resolve({ pending: [] }),
      ]);

      if (sugRes.status === 'rejected' && !hadItems) {
        set({
          loading: false,
          everLoaded: true,
          message: i18n.t("editor:ai.suggestLoadFailed"),
        });
        return;
      }

      const kernelSuggestions =
        sugRes.status === 'fulfilled' && Array.isArray(sugRes.value.suggestions)
          ? sugRes.value.suggestions.map((s) => ({
              id: s.id,
              kind: s.kind,
              title: s.title,
              summary: s.summary,
              targetPath: s.targetPath,
              impact: s.impact,
              payload: s.payload,
            }))
          : [];

      const pending =
        pwRes.status === 'fulfilled' && Array.isArray(pwRes.value.pending)
          ? pwRes.value.pending.map((p: {
              id: string;
              relativePath: string;
              content?: string;
              toolName?: string;
            }) => ({
              id: p.id,
              relativePath: p.relativePath,
              content: p.content,
              toolName: p.toolName,
            }))
          : [];

      const limited = mergeSuggestRefreshItems({
        pending,
        kernelSuggestions,
        sessionCache: sessionSuggestionCache,
        opCache: opSuggestionCache,
        dismissed: dismissedIds,
        applied: appliedIds,
        previousItems: get().items,
        soft: decision.soft,
        pendingTitle: i18n.t('editor:ai.pendingTitle'),
        nowIso: new Date().toISOString(),
        limit: 12,
      }) as ActionItem[];

      const prevIds = get().items.map((i) => i.id).join("\0");
      const nextIds = limited.map((i) => i.id).join("\0");
      const sameSet = prevIds === nextIds && limited.length > 0;

      const hasHigh = limited.some((i) => i.priority === 'high');
      const prevExpanded = get().expanded;
      // Track if new items appeared that weren't in the previous list
      const prevIdSet = new Set(get().items.map((i) => i.id));
      const hasNewItems = limited.some((i) => !prevIdSet.has(i.id));
      set({
        items: limited,
        loading: false,
        everLoaded: true,
        expanded: sameSet
          ? prevExpanded
          : hasHigh
            ? true
            : limited.length > 0
              ? prevExpanded
              : false,
      });
      // Auto-open the 建议 confirm surface when background prep produces NEW
      // high-priority suggestions and the panel is not already open.
      if (hasNewItems && hasHigh && !get().panelOpen) {
        set({ panelOpen: true });
      }
    } catch (e) {
      // Keep prior items on soft failure — never wipe to empty mid-session
      const keep = get().items;
      set({
        message: e instanceof Error ? e.message : String(e),
        items: keep,
        loading: false,
        everLoaded: true,
      });
    }
    }, requestedForce);
  },

  acceptItem: async (id: string, opts?: { skipNav?: boolean; silent?: boolean }) => {
    const item = get().items.find(x => x.id === id);
    if (!item) return false;
    const skipNav = opts?.skipNav === true;
    const silent = opts?.silent === true;
    const { t } = i18n;

    // Do NOT mark applied here. `appliedIds` is the session memory that keeps a
    // suggestion from coming back — it must only fire on success. Marking it
    // before the write made a retryable failure look applied: the card stayed
    // in `items` for another try, but the next soft refresh dropped it via
    // `applied.has(s.id)` and the caches were already cleared, so "keep for
    // retry" was a lie. Terminal failures mark `dismissedIds` below (same as
    // acceptAll). open_profile short-circuits and marks applied on its own path.

    // Immediate "still working" copy — do not wait for the write to finish.
    set({
      busyId: id,
      message: silent ? get().message : t('editor:ai.suggestApplying'),
    });

    try {
      if (item.source === 'suggestion') {
        const select = useViewStore.getState().select;

        // open_profile: 特殊处理
        if (item.suggestionKind === 'open_profile') {
          const path = item.targetPath || (item.suggestionPayload?.path as string | undefined);
          const ensured = await api.ws.ensureCoreProfile();
          if (!skipNav) {
            if (ensured.profileRelPath) select({ kind: 'file', path: ensured.profileRelPath });
            else if (path) select({ kind: 'file', path });
          }

          if (item.priority !== 'high') {
            appliedIds.add(id);
            opSuggestionCache.delete(id);
            sessionSuggestionCache.delete(id);
            set(s => ({ items: s.items.filter(x => x.id !== id) }));
            if (!silent) emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: 'apply' });
            return true;
          }
        }

        const suggestionObj = {
          id: item.id,
          kind: item.suggestionKind,
          title: item.title,
          summary: item.summary,
          targetPath: item.targetPath,
          impact: item.priority,
          payload: item.suggestionPayload
        };

        // stale_topic / catch_all: force archive action on payload.
        // inbox_review / inbox_organize keep their own payload (move / create / batch hint).
        const isArchiveKind =
          item.suggestionKind === 'stale_topic'
          || item.suggestionKind === 'catch_all';
        const suggestion = isArchiveKind
          ? {
              ...suggestionObj,
              payload: { ...(suggestionObj.payload || {}), action: 'archive', path: item.targetPath || item.suggestionPayload?.path },
            }
          : suggestionObj;

        const res = await api.ws.applySuggestion({
          suggestion: suggestion as unknown as Record<string, unknown>,
          confirmed: true,
        });

        if (res.needsConfirm) {
          set({ message: t('editor:ai.suggestNeedsConfirm') });
          emitLocal(PENDING_WRITES_CHANGED_EVENT, { source: 'suggestion' });
          return false;
        }

        const applied = res.ok !== false;
        // Navigation: skip during bulk acceptAll to prevent editor blanking.
        // Digest writes navigate via apply evidence (year subdirectory under memory/periodic).
        if (!skipNav && applied) {
          if (item.suggestionKind === 'stale_topic' || item.suggestionKind === 'catch_all') {
            select({ kind: 'stream' });
          } else if (item.suggestionKind === 'inbox_organize' && res.targetPath) {
            // After organizing inbox item → navigate to the moved file in its topic
            select({ kind: 'file', path: String(res.targetPath) });
          } else if (item.suggestionKind === 'create_topic' && res.targetPath) {
            // Content-category topic — open topic.md under the category (never memory/topics)
            select({ kind: 'file', path: String(res.targetPath) });
          } else {
            const nav = suggestionNavPathAfterApply(res, item);
            if (nav) select({ kind: 'file', path: nav });
          }
        }

        if (applied) {
          // Success only: mark applied so a refresh cannot re-serve this card.
          appliedIds.add(id);
          opSuggestionCache.delete(id);
          sessionSuggestionCache.delete(id);
          set(s => ({ items: s.items.filter(x => x.id !== id) }));
          const detail = res.targetPath ? String(res.targetPath) : res.note || '';
          if (!silent) {
            set({ message: detail ? t('editor:ai.suggestAppliedDetail', { detail }) : t('editor:ai.suggestApplied') });
          }
          if (res.wroteFiles !== false) {
            const target = res.targetPath ? String(res.targetPath) : '';
            if (!silent) {
              toastWriteback(res.note || t('editor:ai.suggestApplied'), {
                operation: 'update',
                savedAt: new Date().toISOString(),
                targetPath: target,
                wroteFiles: true,
                ok: true,
              });
              if (target) emitLocal('workspace:file-changed', { relativePath: target });
            }
          }
          if (!silent) emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: 'apply' });
          return true;
        }

        // Failed apply. Terminal failures (source file gone, malformed payload,
        // target conflict…) can never succeed on retry, so the failure is
        // equivalent to cancelling the suggestion: remove the card and remember
        // the dismissal so a refresh cannot revive it. Retryable ones stay —
        // and keep their session caches so the next soft refresh still has them.
        if (isTerminalApplyFailure(res.reason)) {
          dismissedIds.add(id);
          opSuggestionCache.delete(id);
          sessionSuggestionCache.delete(id);
          set(s => ({ items: s.items.filter(x => x.id !== id) }));
          // Same "no" as an explicit reject — make it survive the next pass.
          persistDismissals([id]);
          if (!silent) {
            set({ message: t('editor:ai.suggestFailedCancelled', { reason: applyFailureLabel(res) }) });
            emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: 'apply' });
          }
        } else if (!silent) {
          set({ message: t('editor:ai.suggestFailed', { reason: applyFailureLabel(res) }) });
          emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: 'apply' });
        }
        return false;

      } else if (item.source === 'pending_write') {
        const select = useViewStore.getState().select;
        const r = await api.ws.confirmPendingWrite(id);
        const p = item.targetPath || '';
        const m = t('editor:ai.pendingWrote', { path: r.targetPath || p });
        if (!silent) {
          set({ message: m });
          toastWriteback(m, r);
        }
        if (!skipNav) {
          select({ kind: 'file', path: r.targetPath || p });
        }
        set(s => ({ items: s.items.filter(x => x.id !== id) }));
        if (!silent) {
          emitLocal('workspace:file-changed', { relativePath: r.targetPath || p });
          emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: 'apply' });
          void get().refresh();
        }
        return true;
      }
      return false;
    } catch (e) {
      set({ message: e instanceof Error ? e.message : String(e) });
      if (!silent) {
        if (item.source === 'suggestion') {
          toastWritebackError(t('editor:ai.suggestTitle'), e);
        } else {
          toastWritebackError(t('editor:ai.pendingTitle'), e);
        }
      }
      return false;
    } finally {
      set({ busyId: null });
    }
  },

  openItem: (id: string) => {
    const item = get().items.find((x) => x.id === id);
    if (!item) return;
    const path = suggestionOpenPath(item);
    if (!path) return;
    useViewStore.getState().select({ kind: "file", path });
  },

  rejectItem: async (id: string) => {
    const item = get().items.find(x => x.id === id);
    if (!item) return;

    set({ busyId: id, message: null });
    try {
      if (item.source === 'suggestion') {
        // Explicit reject — remember it so a soft refresh AND the next launch /
        // force refresh cannot revive the card (see persistDismissals).
        dismissedIds.add(id);
        opSuggestionCache.delete(id);
        sessionSuggestionCache.delete(id);
        set(s => ({ items: s.items.filter(x => x.id !== id) }));
        persistDismissals([id]);
      } else if (item.source === 'pending_write') {
        await api.ws.rejectPendingWrite(id);
        set(s => ({ items: s.items.filter(x => x.id !== id) }));
        void get().refresh();
      }
    } catch (e) {
      set({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busyId: null });
    }
  },

  dismissItem: (id: string) => {
    dismissedIds.add(id);
    opSuggestionCache.delete(id);
    sessionSuggestionCache.delete(id);
    set(s => ({ items: s.items.filter(x => x.id !== id) }));
    // Durable memory for the "no": without it the card returns on the next
    // analysis pass / next launch. Fire-and-forget — the UI must not wait.
    persistDismissals([id]);
  },

  clearDismissed: async () => {
    dismissedIds.clear();
    // Manual Refresh is an explicit "start over": drop the durable rejections
    // too, otherwise the button appears inert for every card the user dismissed.
    // Automatic passes and restarts keep respecting them (see persistDismissals).
    // Awaited by the caller so the reset lands before the re-analysis reads it.
    await api.ws.clearDismissedSuggestions().catch(() => { /* best-effort */ });
    // Do NOT clear appliedIds — accepted suggestions should never reappear
    // in the same session even after manual refresh.
  },

  acceptAll: async () => {
    const allItems = get().items;
    let accepted = 0;
    let failed = 0;
    let cancelled = 0;
    const summaryParts: string[] = [];
    /** Ids auto-cancelled because their apply failed terminally — persisted once. */
    const cancelledIds: string[] = [];
    const changedPaths = new Set<string>();
    let lastTargetPath = '';
    let lastTargetKind = '';
    const { t } = i18n;
    // Process sequentially to avoid write conflicts and maintain order.
    // Accept suggestions first (sorted by priority), then pending writes.
    const ordered = [...allItems].sort((a, b) => {
      const pMap = { high: 3, medium: 2, low: 1 };
      const pDiff = pMap[b.priority] - pMap[a.priority];
      if (pDiff !== 0) return pDiff;
      // pending_write after suggestion
      if (a.source === 'pending_write' && b.source !== 'pending_write') return 1;
      if (a.source !== 'pending_write' && b.source === 'pending_write') return -1;
      return 0;
    });
    const suggestionItems = ordered.filter((x) => x.source === 'suggestion');
    const pendingItems = ordered.filter((x) => x.source !== 'suggestion');
    const total = ordered.length;
    set({
      applying: {
        current: 0,
        total,
        title: ordered[0]?.title || '',
      },
      message: t('editor:ai.bulkAcceptProgress', {
        current: 0,
        total,
        title: ordered[0]?.title || '',
      }),
    });
    try {
      // ── Suggestions: ONE IPC round-trip for the whole batch ──
      // Main loads settings + builds the AI provider once and applies
      // sequentially, pushing `suggestion:bulk-progress` per item (workspace-
      // service.mjs applySuggestions). Per-item applySuggestion calls paid the
      // settings load N times for N cards.
      if (suggestionItems.length > 0) {
        const offProgress = subscribeRpcEvent('suggestion:bulk-progress', (payload) => {
          const p = payload as { current?: number; total?: number } | null;
          if (typeof p?.current !== 'number') return;
          const idx = Math.max(0, Math.min(suggestionItems.length - 1, p.current - 1));
          const title = suggestionItems[idx]?.title || '';
          set({
            applying: { current: p.current, total: p.total || suggestionItems.length, title },
            message: t('editor:ai.bulkAcceptProgress', {
              current: p.current,
              total: p.total || suggestionItems.length,
              title,
            }),
          });
        });
        let results: Array<{
          ok?: boolean;
          needsConfirm?: boolean;
          wroteFiles?: boolean;
          reason?: string;
          targetPath?: string;
          note?: string;
        }> = [];
        try {
          const res = await api.ws.applySuggestions(
            suggestionItems.map((item) => ({ suggestion: buildApplyPayload(item), confirmed: true })),
          );
          results = Array.isArray(res?.results) ? res.results : [];
        } finally {
          offProgress();
        }
        for (let i = 0; i < suggestionItems.length; i++) {
          const item = suggestionItems[i];
          const res = results[i] || { ok: false, reason: 'no-result' };
          // needsConfirm: stays for the explicit confirm flow (never happens in
          // bulk — confirmed:true — but the gate is a safety net, not a shortcut).
          if (res.needsConfirm) {
            failed++;
            continue;
          }
          if (res.ok !== false) {
            accepted++;
            summaryParts.push(item.title || item.suggestionKind || item.source);
            appliedIds.add(item.id);
            opSuggestionCache.delete(item.id);
            sessionSuggestionCache.delete(item.id);
            set(s => ({ items: s.items.filter(x => x.id !== item.id) }));
            const nav = suggestionNavPathAfterApply(res, item);
            const target = nav
              || (typeof res.targetPath === 'string' && res.targetPath ? res.targetPath : item.targetPath || '');
            if (target) {
              lastTargetPath = target;
              lastTargetKind = item.suggestionKind || '';
              changedPaths.add(target);
            }
            if (item.targetPath) changedPaths.add(item.targetPath);
          } else if (isTerminalApplyFailure(res.reason)) {
            // Dead card (source file gone…): retrying can never succeed, so the
            // failure IS the cancellation — remove it and remember the dismissal.
            cancelled++;
            dismissedIds.add(item.id);
            cancelledIds.push(item.id);
            opSuggestionCache.delete(item.id);
            sessionSuggestionCache.delete(item.id);
            set(s => ({ items: s.items.filter(x => x.id !== item.id) }));
          } else {
            // Retryable / unknown failure — keep the card for another attempt.
            failed++;
          }
        }
      }
      // ── Pending writes: per-item confirmations stay individual ──
      for (const item of pendingItems) {
        await yieldToUi();
        // Skip if item was already removed by a prior accept (e.g. refresh after apply)
        if (!get().items.some((x) => x.id === item.id)) continue;
        set({
          applying: {
            current: suggestionItems.length + (pendingItems.indexOf(item) + 1),
            total,
            title: item.title || '',
          },
          message: t('editor:ai.bulkAcceptProgress', {
            current: suggestionItems.length + (pendingItems.indexOf(item) + 1),
            total,
            title: item.title || '',
          }),
        });
        const ok = await get().acceptItem(item.id, { skipNav: true, silent: true });
        if (ok) {
          accepted++;
          const label = item.title || item.suggestionKind || item.source;
          summaryParts.push(label);
          if (item.targetPath) {
            lastTargetPath = item.targetPath;
            lastTargetKind = item.suggestionKind || '';
            changedPaths.add(item.targetPath);
          }
        } else {
          failed++;
        }
      }
    } finally {
      set({ applying: null });
    }
    // One batch write for every auto-cancelled card — not one IPC per failure.
    persistDismissals(cancelledIds);
    // After all items: navigate once to the most relevant target
    if (accepted > 0 && lastTargetPath) {
      const select = useViewStore.getState().select;
      if (lastTargetKind === 'stale_topic' || lastTargetKind === 'catch_all') {
        select({ kind: 'stream' });
      } else {
        select({ kind: 'file', path: lastTargetPath });
      }
    } else if (accepted > 0) {
      const select = useViewStore.getState().select;
      select({ kind: 'stream' });
    }
    if (accepted > 0) {
      toastWriteback(t('editor:ai.bulkAcceptDone', { count: accepted }), {
        operation: 'update',
        savedAt: new Date().toISOString(),
        targetPath: lastTargetPath,
        wroteFiles: true,
        ok: true,
      });
      for (const p of changedPaths) {
        emitLocal('workspace:file-changed', { relativePath: p });
      }
      if (changedPaths.size === 0) emitLocal('workspace:file-changed');
      emitLocal(SUGGESTIONS_REFRESH_EVENT, { reason: 'apply' });
    }
    const summary = summaryParts.slice(0, 5).join(' · ') + (summaryParts.length > 5 ? ` +${summaryParts.length - 5}` : '');
    return { accepted, failed, cancelled, summary };
  },

  dismissAll: () => {
    const suggestionItems = get().items.filter((i) => i.source === 'suggestion');
    const ids = suggestionItems.map((i) => i.id);
    for (const item of suggestionItems) {
      dismissedIds.add(item.id);
      opSuggestionCache.delete(item.id);
      sessionSuggestionCache.delete(item.id);
    }
    set((s) => ({ items: s.items.filter((i) => i.source !== 'suggestion') }));
    persistDismissals(ids);
  },

  mergeSuggestions: (suggestions) => {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return 0;
    let added = 0;
    for (const s of suggestions) {
      if (!s?.id || dismissedIds.has(s.id) || appliedIds.has(s.id)) continue;
      const seed = {
        id: s.id,
        kind: s.kind,
        title: s.title || s.kind || "suggestion",
        summary: s.summary || "",
        targetPath: s.targetPath,
        impact: s.impact,
        payload: s.payload,
      };
      opSuggestionCache.set(s.id, seed);
      sessionSuggestionCache.set(s.id, seed);
      added += 1;
    }
    if (added === 0) return 0;
    // Rebuild list including caches (shared path with refresh)
    const limited = mergeSuggestRefreshItems({
      pending: get().items
        .filter((i) => i.source === "pending_write")
        .map((i) => ({
          id: i.id,
          relativePath: i.targetPath || i.summary,
          content: i.writeContent,
          toolName: i.toolName,
        })),
      kernelSuggestions: [],
      sessionCache: sessionSuggestionCache,
      opCache: opSuggestionCache,
      dismissed: dismissedIds,
      applied: appliedIds,
      previousItems: get().items,
      soft: true,
      pendingTitle: i18n.t("editor:ai.pendingTitle"),
      nowIso: new Date().toISOString(),
      limit: 12,
    }) as ActionItem[];
    const hasHigh = limited.some((i) => i.priority === "high");
    set({
      items: limited,
      expanded: hasHigh ? true : get().expanded,
      everLoaded: true,
      panelOpen: hasHigh ? true : get().panelOpen,
    });
    return added;
  },

  runActivityOps: async (opts = {}) => {
    const force = opts.force === true;
    let merged = 0;
    const parts: string[] = [];
    // Rule + activity-window suggest path (does not clear dismiss memory)
    await get().refresh();
    try {
      const types = await api.aiOps.list();
      const ids = (types || [])
        .map((t) => t.id)
        .filter((id) => id === "memory_organize" || id === "topic_classify");
      for (const id of ids) {
        try {
          const res = await api.aiOps.run(id, { force });
          const suggestions = (res.suggestions || []) as Array<{
            id: string;
            kind?: string;
            title: string;
            summary: string;
            targetPath?: string;
            impact?: "low" | "medium" | "high";
            payload?: Record<string, unknown>;
          }>;
          if (suggestions.length) {
            merged += get().mergeSuggestions(suggestions);
          }
          if (res.summary) parts.push(res.summary);
        } catch {
          /* single op failure must not block others */
        }
      }
    } catch {
      /* list/run unavailable when AI/kernel offline */
    }
    if (merged > 0) {
      set({ expanded: true });
    }
    return {
      merged,
      summary: parts.filter(Boolean).join(" · ") || (merged > 0 ? `+${merged}` : ""),
    };
  },

  setExpanded: (v: boolean) => set({ expanded: v }),
  setPanelOpen: (v: boolean) => set({ panelOpen: v, expanded: v ? true : get().expanded }),
  clearMessage: () => set({ message: null }),

  toggleAutoPrepare: async () => {
    const next = !get().autoPrepare;
    await get().setAutoPrepare(next, { persist: true });
  },

  /**
   * Absolute set for Settings panel (avoids flip race with debounced settings save).
   * @param persist when true (default), also write settings.ai.autoPrepareSuggestions
   */
  setAutoPrepare: async (next: boolean, opts: { persist?: boolean } = {}) => {
    const prev = get().autoPrepare;
    set({ autoPrepare: next });
    if (opts.persist !== false && prev !== next) {
      try {
        // Partial patch only: spreading the full ai block would race the
        // debounced SettingsDialog batches and could write a stale modelCache
        // over one fetchLiveModels just persisted.
        await api.sys.update({ ai: { autoPrepareSuggestions: next } });
      } catch {
        /* ignore persistence errors */
      }
    }
    if (next) {
      if (prev !== next) void get().refresh({ force: true });
    } else if (prev !== next || get().items.some((i) => i.source === "suggestion")) {
      sessionSuggestionCache.clear();
      set((s) => ({ items: s.items.filter((i) => i.source === "pending_write") }));
    }
  },
}));

// 监听事件自动刷新
onLocal(SUGGESTIONS_REFRESH_EVENT, () => {
  void useActionStore.getState().refresh();
});
onLocal(PENDING_WRITES_CHANGED_EVENT, () => {
  void useActionStore.getState().refresh();
});

// 安全网轮询：每 30s 只刷新 pending writes（不触发 kernel suggest）
// 事件驱动为主，轮询为辅；pollOnly 确保不浪费 IPC 往返
let safetyPoll: ReturnType<typeof setInterval> | null = null;
function ensureSafetyPoll() {
  if (safetyPoll) return;
safetyPoll = setInterval(() => {
const st = useActionStore.getState();
// Skip poll entirely when autoPrepare is off and no pending writes exist
// — nothing to discover, and kernel suggest is disabled in this mode
if (!st.autoPrepare && !st.items.some((i) => i.source === "pending_write")) return;
void st.refresh({ pollOnly: true });
}, 30000);
// Note: Node.js Timer.unref() is not available in Electron renderer process.
// The interval is cleaned up when the renderer is destroyed (window close).
}
ensureSafetyPoll();

// 初始化时从 settings 读取 autoPrepareSuggestions
void api.sys.settings().then((s) => {
  const on = s.ai?.autoPrepareSuggestions !== false;
  useActionStore.setState({ autoPrepare: on });
  if (on) void useActionStore.getState().refresh();
}).catch(() => {
  void useActionStore.getState().refresh();
});
