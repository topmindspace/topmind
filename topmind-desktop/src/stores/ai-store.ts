/**
 * AiStore — sessions, messages, streaming, tool timeline, context, runtime.
 */
import { create, type StoreApi } from "zustand";
import i18n from "../locales";
import { api } from "../services/api";
import { subscribe } from "../services/rpc";
import { useViewStore } from "./view-store";
import type {
  AiSession,
  AiMessage,
  AiRuntimeStatus,
  AiToolCall,
  ProviderInfo,
  BatchEvidenceSummary,
} from "../types";
import { pathsFromToolResult } from "../lib/note-meta";
import { toastBatchEvidence } from "../lib/writeback-toast";
import {
  PENDING_WRITES_CHANGED_EVENT,
  shouldInvalidatePendingWrites,
} from "../lib/ai-rail-events";
import { emitLocal } from "../plugins/host";

/** Live re-fetch only if cache older than this (discoverModels is always free). */
const MODEL_CATALOG_LIVE_TTL_MS = 5 * 60 * 1000;
/** models.dev community catalog cache TTL — 24 hours */
const MODELS_DEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Derive the topicId of the current selection so the AI gains ambient
 * awareness of which category/topic the user is working in. */
function currentTopicId(): string | undefined {
  const sel = useViewStore.getState().selection;
  if (sel.kind === "topic") return sel.topicId;
  if (sel.kind === "file") return sel.topicId ?? undefined;
  return undefined;
}

/** First-line auto title for new chats — short, calm, no skill jargon. */
function titleFromText(text: string): string {
  let t = text
    .replace(/^\/\S+\s*/u, "") // strip leading /slash command
    .replace(/\s+/gu, " ")
    .trim();
  if (!t) return i18n.t("ai:store.newSession");
  // Prefer first sentence
  const m = t.match(/^(.{6,28}?)[。！？.!?\n]/u);
  if (m) t = m[1].trim();
  if (t.length > 22) t = `${t.slice(0, 21).trim()}…`;
  return t;
}

interface AiState {
  runtimeStatus: AiRuntimeStatus | null;
  refreshRuntimeStatus: () => Promise<void>;

  sessions: AiSession[];
  activeSessionId: string | null;
  loadSessions: () => Promise<void>;
  createSession: () => Promise<string>;
  selectSession: (id: string) => Promise<void>;
  clearSession: (id: string) => Promise<void>;

  messages: AiMessage[];
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  /**
   * While streaming: steer (default) injects mid-turn; followUp queues after turn.
   * When not streaming: same as sendMessage.
   */
  sendOrSteer: (text: string, mode?: "steer" | "followUp") => Promise<void>;
  regenerate: () => Promise<void>;
  cancelStream: () => Promise<void>;

  streaming: boolean;
  streamDelta: string;
  streamStatus: string | null;
  streamToolName: string | null;
  /** Step count for current tool call (for progress display). */
  streamToolCount: number | null;
  /** Max agent steps for current turn (for progress display). */
  streamMaxSteps: number | null;
  /** Live tool timeline for the in-progress assistant message. */
  streamToolCalls: AiToolCall[];
  /** Last applied mid-turn steer preview (UI chip). */
  lastSteerPreview: string | null;
  /** Count of follow-ups still pending after current turn. */
  pendingFollowUpCount: number;

  /**
   * Last batch-mode multi-write receipt (session UI banner).
   * Cleared on dismiss / new session / clear.
   */
  lastBatchEvidence: BatchEvidenceSummary | null;
  clearLastBatchEvidence: () => void;

  mountedFiles: { path: string; name: string }[];
  mountFile: (f: { path: string; name: string }) => void;
  unmountFile: (path: string) => void;

  model: string | null;
  setModel: (m: string | null) => void;

  /** Agent tools on by default (full topmind agent). */
  agentEnabled: boolean;
  setAgentEnabled: (v: boolean) => void;

  /**
   * Forced skill for this session/turn (skill-first pin).
   * null = auto-route from catalog; string = load this skill first.
   */
  activeSkillId: string | null;
  setActiveSkillId: (id: string | null) => void;
  /** Skills activated via load_skill in the current turn (telemetry / UI). */
  sessionLoadedSkills: string[];
  clearSessionLoadedSkills: () => void;

  /**
   * Shared provider/model catalog (settings AI page + AI panel picker).
   * Cache-first; live refresh only when forced or TTL expired.
   */
  modelCatalog: ProviderInfo[];
  modelCatalogFetchedAt: string | null;
  modelCatalogLoading: boolean;
  modelCatalogError: string | null;
  /** models.dev community catalog (used as fallback/supplement) */
  modelsDevCatalog: ProviderInfo[];
  modelsDevCatalogFetchedAt: string | null;
  /**
   * @param forceLive — hit providers (fetchLiveModels); default uses disk cache then soft TTL
   * @param forceModelsDev — hit models.dev community catalog (bypass cache)
   * @param silent — no loading spinner (background refresh)
   */
  loadModelCatalog: (opts?: { forceLive?: boolean; forceModelsDev?: boolean; silent?: boolean }) => Promise<ProviderInfo[]>;
  invalidateModelCatalog: () => void;
  invalidateModelsDevCatalog: () => void;
}

function genSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Single-active-stream subscription handle.
 *
 * Design: only one AI stream can be active at a time — starting a new stream
 * automatically unsubscribes the previous one. This is intentional: the UI
 * only shows one streaming conversation, and concurrent streams would cause
 * delta interleaving and state corruption. If future concurrency is needed,
 * refactor to a Map<sessionId, unsub>.
 */
let streamUnsub: (() => void) | null = null;

function patchLastAssistant(
  messages: AiMessage[],
  patch: (last: AiMessage) => AiMessage,
): AiMessage[] {
  const updated = [...messages];
  const last = updated[updated.length - 1];
  if (last && last.role === "assistant") {
    updated[updated.length - 1] = patch(last);
  }
  return updated;
}

async function performInvocation(
  get: StoreApi<AiState>["getState"],
  set: StoreApi<AiState>["setState"],
  sessionId: string,
  apiMessages: AiMessage[],
): Promise<void> {
  set({
    streaming: true,
    streamDelta: "",
    streamStatus: "preparing",
    streamToolName: null,
    streamToolCalls: [],
    streamToolCount: null,
    streamMaxSteps: null,
  });

  if (streamUnsub) streamUnsub();
  streamUnsub = subscribe("ai:stream", (payload) => {
    const p = payload as {
      type: string;
      delta?: string;
      sessionId?: string;
      status?: string;
      tool?: string;
      toolCallId?: string;
      count?: number;
      maxSteps?: number;
      summary?: string;
      output?: unknown;
    };
    if (p.sessionId !== sessionId) return;

    if (p.type === "text" && p.delta) {
      set((s) => ({
        messages: patchLastAssistant(s.messages, (last) => ({
          ...last,
          content: last.content + p.delta,
        })),
        streamDelta: s.streamDelta + p.delta,
      }));
      return;
    }

    if (p.type === "reasoning" && p.delta) {
      // Keep full thinking trace for collapsible UI even after text starts.
      set((s) => ({
        messages: patchLastAssistant(s.messages, (last) => ({
          ...last,
          reasoning: (last.reasoning || "") + p.delta,
        })),
      }));
      return;
    }

    if (p.type === "tool-call") {
      const id = p.toolCallId || `tc_${p.count || Date.now()}`;
      const name = p.tool || "tool";
      const count = p.count ?? null;
      const maxSteps = p.maxSteps ?? null;
      set((s) => {
        const nextCalls = [...s.streamToolCalls];
        const existing = nextCalls.findIndex((t) => t.id === id);
        const entry: AiToolCall = { id, name, status: "running" };
        if (existing >= 0) nextCalls[existing] = entry;
        else nextCalls.push(entry);
        return {
          streamToolCalls: nextCalls,
          streamToolName: name,
          streamStatus: "calling-tool",
          streamToolCount: count,
          streamMaxSteps: maxSteps,
          messages: patchLastAssistant(s.messages, (last) => ({
            ...last,
            toolCalls: nextCalls,
          })),
        };
      });
      return;
    }

    if (p.type === "tool-result") {
      const id = p.toolCallId;
      const name = p.tool || "tool";
      const paths = pathsFromToolResult(p.output, p.summary);
      const output = (p.output && typeof p.output === "object") ? p.output as Record<string, unknown> : undefined;
      set((s) => {
        const nextCalls = s.streamToolCalls.map((t) => {
          if (id && t.id === id) {
            return { ...t, status: "done" as const, summary: p.summary, paths: paths.length ? paths : t.paths, output };
          }
          if (!id && t.name === name && t.status === "running") {
            return { ...t, status: "done" as const, summary: p.summary, paths: paths.length ? paths : t.paths, output };
          }
          return t;
        });
        if (id && !nextCalls.some((t) => t.id === id)) {
          nextCalls.push({
            id,
            name,
            status: "done",
            summary: p.summary,
            paths: paths.length ? paths : undefined,
            output,
          });
        }
        return {
          streamToolCalls: nextCalls,
          messages: patchLastAssistant(s.messages, (last) => ({
            ...last,
            toolCalls: nextCalls,
          })),
        };
      });
      // Confirm-mode / durable write results → refresh pending strip promptly
      if (shouldInvalidatePendingWrites(p.output) || shouldInvalidatePendingWrites(p)) {
        emitLocal(PENDING_WRITES_CHANGED_EVENT, { source: "tool-result", tool: name });
      }
      return;
    }

    if (p.type === "status") {
      set({
        streamStatus: p.status || null,
        streamToolName: p.tool || null,
        streamToolCount: p.count ?? null,
        streamMaxSteps: p.maxSteps ?? null,
      });
    }

    if (p.type === "steer-applied" && p.delta == null) {
      const preview = (payload as { text?: string }).text || "";
      set({
        streamStatus: "steering",
        lastSteerPreview: preview.slice(0, 120) || i18n.t("ai:store.steerInjected"),
      });
    }

    // Track skill activations for session UI
    if (p.type === "tool-result" && p.tool === "load_skill") {
      try {
        const out = p.output as { id?: string } | undefined;
        const sid = out?.id;
        if (sid) {
          set((s) => ({
            sessionLoadedSkills: s.sessionLoadedSkills.includes(sid)
              ? s.sessionLoadedSkills
              : [...s.sessionLoadedSkills, sid],
          }));
        }
      } catch { /* ignore */ }
    }
  });

  try {
    const mountedFiles = get().mountedFiles.map((f) => f.path);
    // Silent ambient focus: current open file is included this turn (no extra UI).
    const sel = useViewStore.getState().selection;
    const focusPath = sel.kind === "file" ? sel.path : undefined;
    const focusHint =
      sel.kind === "topic"
        ? i18n.t("ai:store.focusHintTopic", { topicId: sel.topicId })
        : sel.kind === "inbox"
          ? i18n.t("common:category.inbox")
          : sel.kind === "outputs"
            ? i18n.t("common:category.outputs")
            : sel.kind === "file"
              ? i18n.t("ai:store.focusHintFile", { name: sel.path.split("/").pop() })
              : undefined;
    const result = await api.ai.invoke({
      messages: apiMessages.map((m) => ({
        role: m.role,
        content: m.content,
        // Preserve tool timeline gist for server-side compaction
        ...(m.toolCalls?.length ? { toolCalls: m.toolCalls } : {}),
      })),
      sessionId,
      mountedFiles,
      topicId: currentTopicId(),
      focusPath,
      focusHint,
      model: get().model ?? undefined,
      useTools: get().agentEnabled,
      writebackMode: useViewStore.getState().writebackMode,
      activeSkillId: get().activeSkillId || undefined,
    });
    set((s) => {
      const updated = patchLastAssistant(s.messages, (last) => {
        const partial = last.content;
        let content: string;
        if (result.ok === false) {
          const errText = result.error?.trim() || i18n.t("ai:store.generationFailed");
          content = partial ? `${partial}\n\n⚠️ ${errText}` : `⚠️ ${errText}`;
        } else {
          content = result.text || partial;
        }
        return {
          ...last,
          content,
          toolCalls: last.toolCalls?.length ? last.toolCalls : s.streamToolCalls,
        };
      });
      return { messages: updated };
    });
    // Batch mode: surface multi-file write receipts after the turn (toast + sticky banner).
    if (result && typeof result === "object" && "batchEvidence" in result) {
      const be = (result as { batchEvidence?: BatchEvidenceSummary | null }).batchEvidence;
      if (be?.writeCount) {
        set({ lastBatchEvidence: be });
        try {
          toastBatchEvidence(be);
        } catch { /* toast is best-effort */ }
        emitLocal(PENDING_WRITES_CHANGED_EVENT, { source: "batch-evidence" });
      }
    }
    if (shouldInvalidatePendingWrites(result)) {
      emitLocal(PENDING_WRITES_CHANGED_EVENT, { source: "invoke-result" });
    }
    await api.ai.saveMsgs({ sessionId, messages: get().messages });

    // Auto-chain queued follow-ups after this turn (Pi-style follow-up queue).
    const followUps = Array.isArray(result.followUps) ? result.followUps.filter(Boolean) : [];
    if (followUps.length > 0 && result.ok !== false) {
      set({ pendingFollowUpCount: followUps.length });
      // Run after finally clears streaming so sendMessage can start a new turn.
      queueMicrotask(() => {
        const chain = async () => {
          for (let i = 0; i < followUps.length; i++) {
            set({ pendingFollowUpCount: followUps.length - i - 1 });
            await get().sendMessage(followUps[i]);
          }
          set({ pendingFollowUpCount: 0 });
        };
        void chain();
      });
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    set((s) => ({
      messages: patchLastAssistant(s.messages, (last) => ({
        ...last,
        content: last.content ? `${last.content}\n\n⚠️ ${errMsg}` : `⚠️ ${errMsg}`,
      })),
    }));
  } finally {
    set({
      streaming: false,
      streamDelta: "",
      streamStatus: null,
      streamToolName: null,
      streamToolCalls: [],
      streamToolCount: null,
      streamMaxSteps: null,
      lastSteerPreview: null,
    });
    if (streamUnsub) {
      streamUnsub();
      streamUnsub = null;
    }
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  runtimeStatus: null,
  async refreshRuntimeStatus() {
    try {
      const status = await api.ai.status();
      set({ runtimeStatus: status });
    } catch {
      set({ runtimeStatus: { ready: false, message: i18n.t("ai:store.runtimeUnavailable") } });
    }
  },

  sessions: [],
  activeSessionId: null,
  messages: [],
  streaming: false,
  streamDelta: "",
  streamStatus: null,
  streamToolName: null,
  streamToolCalls: [],
  streamToolCount: null,
  streamMaxSteps: null,
  lastSteerPreview: null,
  pendingFollowUpCount: 0,
  lastBatchEvidence: null,
  clearLastBatchEvidence: () => set({ lastBatchEvidence: null }),
  mountedFiles: [],
  model: null,
  agentEnabled: true,
  activeSkillId: null,
  setActiveSkillId: (id) => set({ activeSkillId: id }),
  sessionLoadedSkills: [],
  clearSessionLoadedSkills: () => set({ sessionLoadedSkills: [] }),

  async loadSessions() {
    try {
      const sessions = await api.ai.sessions();
      // Filter out empty sessions (default title — never had a real conversation)
      const defaultTitle = i18n.t("ai:store.newSession");
      const meaningful = sessions.filter((s) => s.title !== defaultTitle);
      // Best-effort cleanup of empty sessions from backend
      for (const s of sessions) {
        if (s.title === defaultTitle) {
          void api.ai.clear(s.id).catch(() => {});
        }
      }
      set({ sessions: meaningful });
      // Don't auto-create a session — the UI shows empty conversation
      // and creates one lazily when the user sends the first message.
    } catch {
      set({ sessions: [] });
    }
  },
  async createSession() {
    const id = genSessionId();
    const session: AiSession = { id, title: i18n.t("ai:store.newSession"), updatedAt: new Date().toISOString() };
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
      messages: [],
      lastBatchEvidence: null,
    }));
    // Don't persist to backend — only persist when the first message is sent.
    // This prevents empty sessions from cluttering history.
    return id;
  },
  async selectSession(id) {
    set({ activeSessionId: id, messages: [], lastBatchEvidence: null });
    await get().loadMessages(id);
  },
  async clearSession(id) {
    await api.ai.clear(id);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      messages: s.activeSessionId === id ? [] : s.messages,
      lastBatchEvidence: s.activeSessionId === id ? null : s.lastBatchEvidence,
    }));
  },

  async loadMessages(sessionId) {
    try {
      const msgs = await api.ai.loadMsgs(sessionId);
      set({ messages: msgs });
    } catch {
      set({ messages: [] });
    }
  },
  async sendMessage(text) {
    let sessionId = get().activeSessionId;
    if (!sessionId) sessionId = await get().createSession();

    // Auto-title first user turn
    const existing = get().messages;
    if (existing.filter((m) => m.role === "user").length === 0) {
      const title = titleFromText(text);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, title, updatedAt: new Date().toISOString() } : sess,
        ),
      }));
      void api.ai.updateSession({ sessionId, patch: { title, updatedAt: new Date().toISOString() } }).catch(() => {});
    } else {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, updatedAt: new Date().toISOString() } : sess,
        ),
      }));
    }

    const userMsg: AiMessage = { role: "user", content: text };
    const assistantPlaceholder: AiMessage = { role: "assistant", content: "", toolCalls: [] };
    const nextMessages = [...get().messages, userMsg, assistantPlaceholder];
    set({ messages: nextMessages });
    await performInvocation(get, set, sessionId, nextMessages.slice(0, -1));
  },
  async sendOrSteer(text, mode = "steer") {
    const trimmed = text.trim();
    if (!trimmed) return;
    const sessionId = get().activeSessionId;
    if (!get().streaming || !sessionId) {
      await get().sendMessage(trimmed);
      return;
    }
    if (mode === "followUp") {
      const r = await api.ai.followUp(sessionId, trimmed);
      if (r.ok) {
        set((s) => ({ pendingFollowUpCount: s.pendingFollowUpCount + 1 }));
      } else {
        // No active stream handle — fall back to normal send after current ends is impossible; send now
        await get().sendMessage(trimmed);
      }
      return;
    }
    const r = await api.ai.steer(sessionId, trimmed);
    if (r.ok) {
      set({
        lastSteerPreview: trimmed.slice(0, 120),
        streamStatus: "steering",
      });
    } else {
      await get().sendMessage(trimmed);
    }
  },
  async regenerate() {
    const sessionId = get().activeSessionId;
    if (!sessionId || get().streaming) return;
    const msgs = get().messages;
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const base = msgs.slice(0, lastUserIdx + 1);
    const assistantPlaceholder: AiMessage = { role: "assistant", content: "", toolCalls: [] };
    set({ messages: [...base, assistantPlaceholder] });
    await performInvocation(get, set, sessionId, base);
  },
  async cancelStream() {
    const sid = get().activeSessionId;
    if (sid) await api.ai.cancel(sid);
    set({
      streaming: false,
      streamDelta: "",
      streamStatus: null,
      streamToolName: null,
      streamToolCalls: [],
      streamToolCount: null,
      streamMaxSteps: null,
      lastSteerPreview: null,
      pendingFollowUpCount: 0,
    });
    if (streamUnsub) {
      streamUnsub();
      streamUnsub = null;
    }
  },

  mountFile(f) {
    set((s) => {
      if (s.mountedFiles.some((m) => m.path === f.path)) return s;
      return { mountedFiles: [...s.mountedFiles, f] };
    });
  },
  unmountFile(path) {
    set((s) => ({ mountedFiles: s.mountedFiles.filter((m) => m.path !== path) }));
  },

  setModel: (model) => set({ model }),
  setAgentEnabled: (agentEnabled) => set({ agentEnabled }),

  modelCatalog: [],
  modelCatalogFetchedAt: null,
  modelCatalogLoading: false,
  modelCatalogError: null,
  modelsDevCatalog: [],
  modelsDevCatalogFetchedAt: null,

  invalidateModelCatalog() {
    set({ modelCatalogFetchedAt: null });
  },

  invalidateModelsDevCatalog() {
    set({ modelsDevCatalogFetchedAt: null });
  },

  async loadModelCatalog(opts) {
    const forceLive = opts?.forceLive === true;
    const forceModelsDev = opts?.forceModelsDev === true;
    // Explicit refresh shows spinner; background/TTL refresh stays silent
    const silent = opts?.silent ?? !forceLive;
    const state = get();
    const ageMs = state.modelCatalogFetchedAt
      ? Date.now() - new Date(state.modelCatalogFetchedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const cacheFresh =
      state.modelCatalog.length > 0 &&
      Number.isFinite(ageMs) &&
      ageMs < MODEL_CATALOG_LIVE_TTL_MS;

    // Instant path: return in-memory catalog when fresh and not forced
    if (!forceLive && !forceModelsDev && cacheFresh) {
      return state.modelCatalog;
    }

    if (!silent) set({ modelCatalogLoading: true, modelCatalogError: null });
    else if (forceLive || forceModelsDev) set({ modelCatalogError: null });

    try {
      // Load models.dev community catalog first (24h TTL cache)
      if (
        forceModelsDev ||
        (!state.modelsDevCatalogFetchedAt ||
          Date.now() - new Date(state.modelsDevCatalogFetchedAt).getTime() > MODELS_DEV_CACHE_TTL_MS)
      ) {
        try {
          const mdCatalog = await api.sys.fetchModelsDevCatalog({ forceLive: forceModelsDev });
          const now = new Date().toISOString();
          set({
            modelsDevCatalog: mdCatalog,
            modelsDevCatalogFetchedAt: now,
          });
        } catch (e) {
          // models.dev fetch failed — not a blocker, log and continue
          console.error("models.dev fetch failed:", e);
        }
      }

      // Hydrate from disk cache first (fast IPC, no network)
      if (get().modelCatalog.length === 0) {
        try {
          const cached = (await api.sys.discoverModels()) as ProviderInfo[];
          if (cached.length > 0) {
            set({
              modelCatalog: cached,
              // Don't stamp as "live" yet — TTL gate still allows soft live pull
              modelCatalogFetchedAt: get().modelCatalogFetchedAt,
            });
          }
        } catch {
          /* empty catalog when unconfigured is fine */
        }
      }

      const shouldLive =
        forceLive ||
        !get().modelCatalogFetchedAt ||
        ageMs >= MODEL_CATALOG_LIVE_TTL_MS;

      if (shouldLive) {
        try {
          const live = (await api.sys.fetchLiveModels()) as ProviderInfo[];
          const now = new Date().toISOString();
          set({
            modelCatalog: live.length > 0 ? live : get().modelCatalog,
            modelCatalogFetchedAt: now,
            modelCatalogError: null,
          });
        } catch (e) {
          // Keep disk/in-memory cache; only surface on explicit refresh
          if (forceLive || !silent) {
            set({
              modelCatalogError: e instanceof Error ? e.message : String(e),
            });
          }
          // Soft-stamp so we don't hammer failed endpoints every open
          if (!get().modelCatalogFetchedAt && get().modelCatalog.length > 0) {
            set({ modelCatalogFetchedAt: new Date().toISOString() });
          }
        }
      }

      return get().modelCatalog;
    } finally {
      set({ modelCatalogLoading: false });
    }
  },
}));
