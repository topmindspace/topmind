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
import { ingestAssistantTextDelta, mergeReasoning, splitAssistantVisible } from "../lib/ai-chat-split";

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
  messagesError: string | null;
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  /**
   * While streaming: steer (default) injects mid-turn; followUp queues after turn.
   * When not streaming: same as sendMessage.
   */
  sendOrSteer: (text: string, mode?: "steer" | "followUp") => Promise<void>;
  regenerate: () => Promise<void>;
  /** Hard stop: mark cancelled, drop the live goal UI. */
  cancelStream: () => Promise<void>;
  /**
   * Pause (pattern 12 · interrupt): abort the model call but do NOT mark
   * cancelled. Goal ledger stays on the message; `paused` opens Resume.
   */
  pauseStream: () => Promise<void>;
  /**
   * Resume a paused turn. Optional `redirect` is folded into the continue
   * prompt ("怎么改?"). A bare resume continues the open criteria.
   */
  resumeStream: (redirect?: string) => Promise<void>;
  /** Abandon a paused turn (true cancel after pause). */
  abandonPaused: () => Promise<void>;
  /** True while a turn is paused and waiting for continue / redirect / abandon. */
  paused: boolean;

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
  /** Goal-protocol summary for the current/last run (plan / open criteria / incomplete). */
  streamGoal: {
    goal: string;
    plan: string[];
    criteria: string[];
    openCriteria: string[];
    pathReceipts: string[];
    status: string;
    blockReason?: string | null;
    autoContinues: number;
    /** Turn layer — "light" hides goal ceremony. */
    kind?: "light" | "query" | "task";
    sourceUrls?: string[];
    /** Plan snapshot at first sight (or at pause) for Run Card plan-diff chips. */
    planBaseline?: string[];
    /** Honesty footer: real check evidence. Never invent. */
    checksRun?: string[];
    /** Honesty footer: unverified premises. Never invent. */
    assumptions?: string[];
  } | null;
  /** Auto-continue counter for the current run (continuing ×N). */
  streamAutoContinues: number;

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
/**
 * Monotonic generation counter for the active stream. Each performInvocation
 * increments it; cancelStream bumps it so a cancelled invoke's `finally`
 * cannot clobber the next turn's state. Session switches also bump it so
 * a stale saveMsgs cannot write the new session's message array under the
 * old session id.
 */
let streamGeneration = 0;
/** Set on cancel — aborts the queued follow-up chain (sendMessage bumps gen). */
let followUpChainAborted = false;

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

/**
 * Coalesces high-frequency text and reasoning deltas into requestAnimationFrame ticks
 * (~16ms). Prevents 50-100 state updates per second from choking React render tree
 * and re-parsing markdown regexes repeatedly during token generation.
 */
class StreamDeltaBatcher {
  private pendingText = "";
  private pendingReasoning = "";
  private rafId: number | null = null;
  private set: StoreApi<AiState>["setState"];

  constructor(set: StoreApi<AiState>["setState"]) {
    this.set = set;
  }

  append(textDelta: string, reasoningDelta: string) {
    if (textDelta) this.pendingText += textDelta;
    if (reasoningDelta) this.pendingReasoning += reasoningDelta;
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.flush();
      });
    } else {
      this.flush();
    }
  }

  flush() {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    const textDelta = this.pendingText;
    const reasoningDelta = this.pendingReasoning;
    if (!textDelta && !reasoningDelta) return;
    this.pendingText = "";
    this.pendingReasoning = "";

    this.set((s) => ({
      messages: patchLastAssistant(s.messages, (last) => {
        let contentRaw = last.contentRaw ?? last.content;
        let content = last.content;
        let reasoning = last.reasoning || "";
        let reasoningProvider = last.reasoningProvider || "";

        if (textDelta) {
          const next = ingestAssistantTextDelta(
            { raw: contentRaw, body: content, reasoning },
            textDelta,
          );
          contentRaw = next.raw;
          content = next.body;
          reasoning = mergeReasoning(reasoningProvider, next.reasoning);
        }

        if (reasoningDelta) {
          reasoningProvider += reasoningDelta;
          reasoning = mergeReasoning(reasoningProvider, splitAssistantVisible(contentRaw).reasoning);
        }

        return {
          ...last,
          contentRaw,
          content,
          reasoning,
          reasoningProvider,
        };
      }),
      streamDelta: textDelta ? s.streamDelta + textDelta : s.streamDelta,
    }));
  }

  clear() {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingText = "";
    this.pendingReasoning = "";
  }
}

async function performInvocation(
  get: StoreApi<AiState>["getState"],
  set: StoreApi<AiState>["setState"],
  sessionId: string,
  apiMessages: AiMessage[],
): Promise<void> {
  const gen = ++streamGeneration;
  set({
    streaming: true,
    streamDelta: "",
    streamStatus: "preparing",
    streamToolName: null,
    streamToolCalls: [],
    streamGoal: null,
    streamAutoContinues: 0,
    streamToolCount: null,
    streamMaxSteps: null,
  });

  const deltaBatcher = new StreamDeltaBatcher(set);

  if (streamUnsub) streamUnsub();
  streamUnsub = subscribe("ai:stream", (payload) => {
    // Stale generation (cancel/supersede) must never write into the next turn.
    if (gen !== streamGeneration) return;
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
      deltaBatcher.append(p.delta, "");
      return;
    }

    if (p.type === "text-reset") {
      deltaBatcher.flush();
      const text = (payload as { text?: string }).text || "";
      const split = splitAssistantVisible(text);
      set((s) => ({
        messages: patchLastAssistant(s.messages, (last) => ({
          ...last,
          contentRaw: text,
          content: split.body,
          reasoning: mergeReasoning(last.reasoningProvider, split.reasoning),
        })),
        streamDelta: split.body,
      }));
      return;
    }

    if (p.type === "reasoning" && p.delta) {
      deltaBatcher.append("", p.delta);
      return;
    }

    if (p.type === "reasoning-reset") {
      deltaBatcher.flush();
      const text = (payload as { text?: string }).text || "";
      set((s) => ({
        messages: patchLastAssistant(s.messages, (last) => ({
          ...last,
          reasoningProvider: text,
          reasoning: mergeReasoning(text, splitAssistantVisible(last.contentRaw || "").reasoning),
        })),
      }));
      return;
    }

    // Structural events flush any buffered text first to maintain strict event sequencing
    deltaBatcher.flush();

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
      // Track skill activations for session UI (must run before this branch returns).
      if (name === "load_skill") {
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
      return;
    }

    if (p.type === "status") {
      const autoContinues = (payload as { autoContinues?: number }).autoContinues;
      set((s) => ({
        streamStatus: p.status || null,
        streamToolName: p.tool || null,
        streamToolCount: p.count ?? null,
        streamMaxSteps: p.maxSteps ?? null,
        streamAutoContinues:
          typeof autoContinues === "number" ? autoContinues : s.streamAutoContinues,
      }));
    }

    if (p.type === "goal-status") {
      const goal = (payload as {
        goal?: {
          goal?: string;
          plan?: string[];
          criteria?: string[];
          openCriteria?: string[];
          pathReceipts?: string[];
          status?: string;
          blockReason?: string | null;
          autoContinues?: number;
          kind?: "light" | "query" | "task";
          sourceUrls?: string[];
        };
      }).goal;
      if (goal) {
        const nextPlan = goal.plan || [];
        set((s) => {
          // Baseline = first plan we see for this run (or pause snapshot).
          // Later plan edits are the "after" side of the Run Card diff.
          const prev = s.streamGoal;
          const planBaseline =
            prev?.planBaseline && prev.planBaseline.length
              ? prev.planBaseline
              : prev?.plan?.length
                ? prev.plan
                : nextPlan.slice();
          return {
            streamGoal: {
              goal: goal.goal || "",
              plan: nextPlan,
              criteria: goal.criteria || [],
              openCriteria: goal.openCriteria || [],
              pathReceipts: goal.pathReceipts || [],
              status: goal.status || "idle",
              blockReason: goal.blockReason || null,
              autoContinues: goal.autoContinues ?? 0,
              kind: goal.kind,
              sourceUrls: goal.sourceUrls || [],
              planBaseline,
              checksRun: prev?.checksRun,
              assumptions: prev?.assumptions,
            },
            streamAutoContinues: goal.autoContinues ?? 0,
          };
        });
      }
    }

    if (p.type === "steer-applied" && p.delta == null) {
      const preview = (payload as { text?: string }).text || "";
      set({
        streamStatus: "steering",
        lastSteerPreview: preview.slice(0, 120) || i18n.t("ai:store.steerInjected"),
      });
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
      activeSkillId: get().activeSkillId || undefined,
    });
    // Stamp result onto the assistant row only when this invoke is still live.
    if (gen === streamGeneration) {
      set((s) => {
        const updated = patchLastAssistant(s.messages, (last) => {
          const partial = last.content;
          if (result.ok === false) {
            const errText = result.error?.trim() || i18n.t("ai:store.generationFailed");
            return {
              ...last,
              content: errText,
              isError: true,
              toolCalls: last.toolCalls?.length ? last.toolCalls : s.streamToolCalls,
              goal: s.streamGoal || last.goal || null,
            };
          }
          const incoming = result.text || partial;
          const split = splitAssistantVisible(incoming);
          const resultReasoning = (result as { reasoning?: string }).reasoning || "";
          const resultGoal = (result as {
            goal?: {
              goal: string;
              plan: string[];
              criteria: string[];
              openCriteria: string[];
              pathReceipts: string[];
              status: string;
              blockReason?: string | null;
              autoContinues: number;
            } | null;
          }).goal;
          return {
            ...last,
            content: split.body,
            contentRaw: incoming,
            reasoning: mergeReasoning(resultReasoning || last.reasoningProvider, split.reasoning || last.reasoning),
            isError: false,
            cancelled: Boolean((result as { cancelled?: boolean }).cancelled) || last.cancelled,
            stopReason: (result as { stopReason?: string | null }).stopReason ?? last.stopReason ?? null,
            usage: (result as { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }).usage,
            modelId: (result as { model?: { modelId?: string } }).model?.modelId,
            toolCalls: last.toolCalls?.length ? last.toolCalls : s.streamToolCalls,
            goal: resultGoal || s.streamGoal || null,
          };
        });
        return {
          messages: updated,
          // Stamp goal onto the message, then clear live stream state so older
          // history rows do not keep rendering the same chip.
          streamGoal: null,
          streamAutoContinues: 0,
        };
      });
    }
    // Batch mode: surface multi-file write receipts after the turn (toast + sticky banner).
    if (result && typeof result === "object" && "batchEvidence" in result) {
      const be = (result as { batchEvidence?: BatchEvidenceSummary | null }).batchEvidence;
      if (be?.writeCount) {
        try {
          toastBatchEvidence(be);
        } catch { /* toast is best-effort */ }
        emitLocal(PENDING_WRITES_CHANGED_EVENT, { source: "batch-evidence" });
      }
    }
    if (shouldInvalidatePendingWrites(result)) {
      emitLocal(PENDING_WRITES_CHANGED_EVENT, { source: "invoke-result" });
    }
    // Only persist if this invocation is still the active one for this session.
    // A session switch mid-stream replaces `messages` — saving then would write
    // the new session's array under the old session id (silent corruption).
    if (gen === streamGeneration && get().activeSessionId === sessionId) {
      await api.ai.saveMsgs({ sessionId, messages: get().messages });
    }

    // G11 memory distill closed loop: after a run that touched files, offer
    // confirm-shaped memory suggestions (never auto-write). Single-use hint
    // is consumed by memory_organize via workspace-service.
    const distill = (result as {
      memoryDistillHint?: { readFiles?: string[]; modifiedFiles?: string[] };
    }).memoryDistillHint;
    const touched = (distill?.modifiedFiles?.length || 0) + (distill?.readFiles?.length || 0);
    if (
      result.ok !== false &&
      touched >= 2 &&
      gen === streamGeneration &&
      !get().streaming
    ) {
      queueMicrotask(() => {
        void import("./action-store")
          .then((m) => m.useActionStore.getState().runActivityOps({ force: false }))
          .catch(() => {});
      });
    }

    // Auto-chain queued follow-ups after this turn (Pi-style follow-up queue).
    // Compare against the *chain* generation, not this invoke's gen — each
    // sendMessage bumps streamGeneration, so the original gen would abort on
    // iteration 2 and drop follow-ups 2..n.
    const followUps = Array.isArray(result.followUps) ? result.followUps.filter(Boolean) : [];
    if (followUps.length > 0 && result.ok !== false && gen === streamGeneration) {
      set({ pendingFollowUpCount: followUps.length });
      followUpChainAborted = false;
      // Run after finally clears streaming so sendMessage can start a new turn.
      queueMicrotask(() => {
        const chain = async () => {
          for (let i = 0; i < followUps.length; i++) {
            if (followUpChainAborted || get().activeSessionId !== sessionId) break;
            set({ pendingFollowUpCount: followUps.length - i - 1 });
            await get().sendMessage(followUps[i]);
          }
          if (!followUpChainAborted) set({ pendingFollowUpCount: 0 });
        };
        void chain();
      });
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (gen === streamGeneration) {
      set((s) => ({
        messages: patchLastAssistant(s.messages, (last) => ({
          ...last,
          content: errMsg,
          isError: true,
          goal: s.streamGoal || last.goal || null,
        })),
      }));
    }
  } finally {
    if (gen === streamGeneration) {
      deltaBatcher.flush();
      deltaBatcher.clear();
    } else {
      // Superseded — drop buffered deltas so they cannot land in the next turn.
      deltaBatcher.clear();
    }
    // Only clear stream state if this invocation is still the active one.
    // A cancelled or superseded invocation must not clobber the next turn.
    if (gen === streamGeneration) {
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
  messagesError: null,
  streaming: false,
  paused: false,
  streamDelta: "",
  streamStatus: null,
  streamToolName: null,
  streamToolCalls: [],
  streamToolCount: null,
  streamMaxSteps: null,
  lastSteerPreview: null,
  pendingFollowUpCount: 0,
  streamGoal: null,
  streamAutoContinues: 0,
  mountedFiles: [],
  model: null,
  agentEnabled: true,
  activeSkillId: null,
  setActiveSkillId: (id) => set({ activeSkillId: id }),
  sessionLoadedSkills: [],

  async loadSessions() {
    try {
      const sessions = await api.ai.sessions();
      // Filter out empty placeholder sessions (default title) from the UI list.
      // Do NOT auto-delete: title matching is locale-dependent and a user-titled
      // chat equal to the default string would be silently wiped.
      const defaultTitle = i18n.t("ai:store.newSession");
      const meaningful = sessions.filter((s) => s.title !== defaultTitle);
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
    }));
    // Don't persist to backend — only persist when the first message is sent.
    // This prevents empty sessions from cluttering history.
    return id;
  },
  async selectSession(id) {
    // Cancel any in-flight stream before switching — otherwise the old
    // invocation's saveMsgs would write this session's empty array under
    // the old session id.
    if (get().streaming) {
      await get().cancelStream();
    }
    set({ activeSessionId: id, messages: [] });
    await get().loadMessages(id);
  },
  async clearSession(id) {
    await api.ai.clear(id);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      messages: s.activeSessionId === id ? [] : s.messages,
    }));
  },

  async loadMessages(sessionId) {
    try {
      const msgs = await api.ai.loadMsgs(sessionId);
      set({ messages: msgs, messagesError: null });
    } catch (e) {
      // Distinguish ENOENT (true empty — new session) from parse/IO errors
      const msg = e instanceof Error ? e.message : String(e);
      const isMissing = /ENOENT|not found|no such file/i.test(msg);
      set({
        messages: [],
        messagesError: isMissing ? null : msg,
      });
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
    set({ messages: nextMessages, paused: false });
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
      } else if (!get().streaming) {
        // Safe to start a new invoke only when nothing is streaming.
        await get().sendMessage(trimmed);
      } else {
        // Stream still live — queue locally instead of racing two invokes.
        set((s) => ({ pendingFollowUpCount: s.pendingFollowUpCount + 1 }));
      }
      return;
    }
    const r = await api.ai.steer(sessionId, trimmed);
    if (r.ok) {
      set({
        lastSteerPreview: trimmed.slice(0, 120),
        streamStatus: "steering",
      });
    } else if (!get().streaming) {
      await get().sendMessage(trimmed);
    } else {
      // Do not double-invoke while the current stream owns the last assistant row.
      set((s) => ({ pendingFollowUpCount: s.pendingFollowUpCount + 1 }));
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
    // Bump generation so the cancelled invocation's finally/saveMsgs/follow-ups
    // are all inert — they check gen === streamGeneration before touching state.
    streamGeneration += 1;
    followUpChainAborted = true;
    const sid = get().activeSessionId;
    // Keep the incomplete goal + an honest cancelled marker on the last assistant.
    set((s) => {
      return {
        messages: patchLastAssistant(s.messages, (last) => ({
          ...last,
          cancelled: true,
          goal: s.streamGoal
            ? (last.goal || { ...s.streamGoal!, status: s.streamGoal!.status === "done" ? "done" : "incomplete" })
            : last.goal || null,
        })),
      };
    });
    try {
      if (sid) await api.ai.cancel(sid);
    } finally {
      // Always clear UI even if the IPC cancel rejects — otherwise a failed
      // cancel leaves a permanent spinner (old invoke's finally is gen-skipped).
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
        streamGoal: null,
        streamAutoContinues: 0,
      });
      if (streamUnsub) {
        streamUnsub();
        streamUnsub = null;
      }
    }
  },

  async pauseStream() {
    // Pause ≠ cancel: abort the model call, keep the goal ledger and finished
    // edits. stopReason="paused" so ChatMessage can offer Resume instead of
    // painting an abandoned run. Bump generation so the old invoke's finally
    // is inert (same as cancelStream).
    if (!get().streaming || get().paused) return;
    streamGeneration += 1;
    followUpChainAborted = true;
    const sid = get().activeSessionId;
    const goalSnapshot = get().streamGoal;
    set((s) => ({
      paused: true,
      messages: patchLastAssistant(s.messages, (last) => ({
        ...last,
        cancelled: false,
        stopReason: "paused",
        goal: goalSnapshot
          ? {
              ...goalSnapshot,
              status: goalSnapshot.status === "done" ? "done" : "incomplete",
            }
          : last.goal || null,
      })),
    }));
    try {
      if (sid) await api.ai.cancel(sid);
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
        pendingFollowUpCount: 0,
        // Keep streamGoal so Resume can rebuild the continue prompt.
        streamAutoContinues: 0,
      });
      if (streamUnsub) {
        streamUnsub();
        streamUnsub = null;
      }
    }
  },

  async resumeStream(redirect) {
    // Only resume a paused, idle turn — never race a live stream.
    if (!get().paused || get().streaming) return;
    const goal = get().streamGoal;
    set({ paused: false });
    const zh = !String(i18n.language || "").startsWith("en");
    const parts = [
      zh
        ? "[系统] 任务被用户暂停后恢复，可能尚未完成。请继续完成用户原始目标；若已完成则给出简短结论与路径回执。"
        : "[System] Task was paused and is now resumed; it may be incomplete. Continue toward the original goal; if finished, give a short conclusion with path receipts.",
    ];
    if (goal?.goal) {
      parts.push(zh ? `原目标：${goal.goal}` : `Original goal: ${goal.goal}`);
    }
    if (goal?.plan?.length) {
      parts.push(
        zh
          ? `计划：\n${goal.plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
          : `Plan:\n${goal.plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      );
    }
    if (goal?.openCriteria?.length) {
      parts.push(
        zh
          ? `未完成验收项：\n${goal.openCriteria.map((s) => `- ${s}`).join("\n")}`
          : `Open acceptance criteria:\n${goal.openCriteria.map((s) => `- ${s}`).join("\n")}`,
      );
    }
    const extra = String(redirect || "").trim();
    if (extra) {
      parts.push(zh ? `用户补充指示：${extra}` : `User redirect: ${extra}`);
    }
    parts.push(
      zh
        ? "先更新/执行剩余步骤，再收尾。收尾时输出结论 + 路径回执 + [DONE]；若无法完成则 [INCOMPLETE 原因]。"
        : "Continue remaining steps first, then close. Finish with conclusion + path receipts + [DONE]; if blocked use [INCOMPLETE reason].",
    );
    await get().sendMessage(parts.join("\n"));
  },

  async abandonPaused() {
    // True cancel after pause — honest abandoned marker, drop live goal UI.
    if (!get().paused) return;
    set({ paused: false, streamGoal: null });
    await get().cancelStream();
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
      // First paint: official disk + curated, no models.dev download.
      if (get().modelCatalog.length === 0) {
        try {
          const instant = (await api.sys.discoverModels({ skipCommunity: true })) as ProviderInfo[];
          if (instant.length > 0) {
            set({
              modelCatalog: instant,
              modelCatalogFetchedAt: get().modelCatalogFetchedAt,
            });
          }
        } catch {
          /* empty catalog when unconfigured is fine */
        }
      }

      // Community catalog (24h TTL). Force refresh bypasses TTL.
      if (
        forceModelsDev ||
        (!state.modelsDevCatalogFetchedAt ||
          Date.now() - new Date(state.modelsDevCatalogFetchedAt).getTime() > MODELS_DEV_CACHE_TTL_MS)
      ) {
        try {
          const mdCatalog = await api.sys.fetchModelsDevCatalog({ forceLive: forceModelsDev });
          if (Array.isArray(mdCatalog) && mdCatalog.length > 0) {
            set({
              modelsDevCatalog: mdCatalog,
              modelsDevCatalogFetchedAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.error("models.dev fetch failed:", e);
        }
      }

      const shouldLive =
        forceLive ||
        !get().modelCatalogFetchedAt ||
        ageMs >= MODEL_CATALOG_LIVE_TTL_MS;

      if (shouldLive) {
        try {
          await api.sys.fetchLiveModels();
        } catch (e) {
          if (forceLive || !silent) {
            set({
              modelCatalogError: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      // Always re-merge after official / community work so the picker is not
      // official-only (browse + Anthropic stay visible).
      try {
        const merged = (await api.sys.discoverModels({
          forceCommunity: forceModelsDev,
        })) as ProviderInfo[];
        const now = new Date().toISOString();
        if (merged.length > 0) {
          set({
            modelCatalog: merged,
            modelCatalogFetchedAt: shouldLive || forceModelsDev ? now : get().modelCatalogFetchedAt || now,
            modelCatalogError: shouldLive ? get().modelCatalogError : null,
          });
        } else if (forceLive || forceModelsDev) {
          // Failed refresh must not stamp fallback-as-live; keep prior list.
          if (!get().modelCatalogFetchedAt && get().modelCatalog.length > 0) {
            set({ modelCatalogFetchedAt: now });
          }
        }
      } catch (e) {
        if (forceLive || !silent) {
          set({
            modelCatalogError: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return get().modelCatalog;
    } finally {
      set({ modelCatalogLoading: false });
    }
  },
}));
