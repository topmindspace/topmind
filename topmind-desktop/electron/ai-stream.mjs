/**
 * AI Stream — streaming agent loop (Vercel AI SDK v7).
 *
 * Emits structured events so the renderer can show:
 * - text / reasoning deltas
 * - tool-call start / tool-result (path receipts)
 * - status changes (preparing → thinking → calling-tool → writing → steering → done)
 * - steer applied mid-turn (prepareStep injects user instructions between steps)
 */
import { streamText, stepCountIs } from "ai";
import { logError, logInfo } from "./lib/writeback.mjs";
import { summarizeToolOutput } from "./lib/ai-tool-evidence.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { createDeltaCoalescer } from "./lib/stream-delta-coalesce.mjs";
import {
  AGENT_STEPS_DEFAULT,
  clampMaxAgentSteps,
} from "./lib/settings-core.mjs";

/** ~1 frame — bounds high-frequency token IPC to the renderer. */
const DELTA_COALESCE_MS = 16;

const TIMEOUT_MS = 240_000;       // 4 min hard cap (multi-step agent)
const IDLE_TIMEOUT_MS = 120_000;  // 120s idle — tool chains (fetch + multi-write)
const IDLE_CHECK_INTERVAL = 10_000;

/** Same triple as settings-core / Settings UI (do not fork). */
export const DEFAULT_MAX_AGENT_STEPS = AGENT_STEPS_DEFAULT;

function clampAgentSteps(value) {
  return clampMaxAgentSteps(value);
}

/**
 * Per-session stream handle: abort + mid-turn steer / post-turn follow-up queues.
 * @returns {{
 *   cancel: (sid: string) => boolean,
 *   register: (sid: string, controller: AbortController) => void,
 *   unregister: (sid: string, controller: AbortController) => void,
 *   steer: (sid: string, text: string) => boolean,
 *   followUp: (sid: string, text: string) => boolean,
 *   drainSteers: (sid: string) => string[],
 *   drainFollowUps: (sid: string) => string[],
 *   hasActive: (sid: string) => boolean,
 * }}
 */
export function createStreamRegistry() {
  /** @type {Map<string, { controller: AbortController, steers: string[], followUps: string[] }>} */
  const streams = new Map();
  return {
    cancel(sid) {
      const e = streams.get(sid);
      if (e) {
        e.controller.abort(new Error(ei18n("ai.cancelled")));
        streams.delete(sid);
        return true;
      }
      return false;
    },
    register(sid, controller) {
      const prev = streams.get(sid);
      if (prev) prev.controller.abort();
      streams.set(sid, { controller, steers: [], followUps: [] });
    },
    unregister(sid, controller) {
      const e = streams.get(sid);
      if (e && e.controller === controller) streams.delete(sid);
    },
    steer(sid, text) {
      const e = streams.get(sid);
      const t = String(text || "").trim();
      if (!e || !t) return false;
      e.steers.push(t);
      return true;
    },
    followUp(sid, text) {
      const e = streams.get(sid);
      const t = String(text || "").trim();
      if (!e || !t) return false;
      e.followUps.push(t);
      return true;
    },
    drainSteers(sid) {
      const e = streams.get(sid);
      if (!e || e.steers.length === 0) return [];
      return e.steers.splice(0, e.steers.length);
    },
    drainFollowUps(sid) {
      const e = streams.get(sid);
      if (!e || e.followUps.length === 0) return [];
      return e.followUps.splice(0, e.followUps.length);
    },
    hasActive(sid) {
      return streams.has(sid);
    },
  };
}

/**
 * Unapplied steers become follow-ups so user text is never dropped
 * (e.g. single-step reply finished before prepareStep could inject).
 */
function drainPendingUserMessages(registry, sessionId) {
  const leftoverSteers = registry?.drainSteers?.(sessionId) || [];
  const followUps = registry?.drainFollowUps?.(sessionId) || [];
  return [...leftoverSteers, ...followUps];
}

export async function runStream({ model, system, messages, tools, emit, sessionId, maxAgentSteps }, registry) {
  const controller = new AbortController();
  registry?.register(sessionId, controller);
  let collected = "";
  let visibleAcc = { raw: "", body: "", reasoning: "" };
  /** @type {(raw: unknown) => { body: string, reasoning: string }} */
  let splitAssistantVisible = (raw) => ({ body: String(raw ?? ""), reasoning: "" });
  /** @type {(acc: object, delta: string) => object} */
  let ingestAssistantTextDelta = (acc, delta) => {
    const raw = String(acc?.raw || "") + String(delta ?? "");
    const split = splitAssistantVisible(raw);
    return { raw, ...split, bodyDelta: split.body, reasoningDelta: "", resetBody: false, resetReasoning: false };
  };
  try {
    const { loadKernelApi } = await import("./lib/kernel-api.mjs");
    const kernel = await loadKernelApi();
    if (typeof kernel.splitAssistantVisible === "function") {
      splitAssistantVisible = kernel.splitAssistantVisible;
    }
    if (typeof kernel.ingestAssistantTextDelta === "function") {
      ingestAssistantTextDelta = kernel.ingestAssistantTextDelta;
    }
  } catch {
    /* packaged/dev kernel missing — emit raw text (renderer still folds tagged think) */
  }
  let streamError = null;
  let timeout;
  let idle;
  let lastChunk = Date.now();
  let toolCallCount = 0;
  let steerApplyCount = 0;
  const agentSteps = clampAgentSteps(maxAgentSteps);

  // Coalesce high-frequency text/reasoning deltas (~1 frame) before IPC emit.
  const rawEmit = typeof emit === "function" ? emit : () => {};
  const deltaCoalescer = createDeltaCoalescer({
    intervalMs: DELTA_COALESCE_MS,
    emit: rawEmit,
  });
  /** @param {object} event */
  const emitOut = (event) => deltaCoalescer.pushEvent(event);

  try {
    timeout = setTimeout(() => controller.abort(new Error(ei18n("ai.timeout"))), TIMEOUT_MS);
    idle = setInterval(() => {
      if (Date.now() - lastChunk > IDLE_TIMEOUT_MS) {
        controller.abort(new Error(ei18n("ai.stalled")));
      }
    }, IDLE_CHECK_INTERVAL);

    emitOut({ type: "status", status: "preparing" });

    const result = streamText({
      model,
      system,
      messages,
      tools,
      stopWhen: tools ? stepCountIs(agentSteps) : stepCountIs(1),
      abortSignal: controller.signal,
      // Inject mid-turn steers; soft nudge near step budget (backend only, no UI).
      prepareStep: tools
        ? ({ messages: stepMessages, stepNumber }) => {
          const steers = registry?.drainSteers?.(sessionId) || [];
          const extras = [];
          if (steers.length > 0) {
            steerApplyCount += steers.length;
            lastChunk = Date.now();
            const body = steers.join("\n---\n");
            emitOut({
              type: "steer-applied",
              text: body.slice(0, 500),
              count: steers.length,
              stepNumber,
            });
            emitOut({ type: "status", status: "steering" });
            extras.push({
              role: "user",
              content: ei18n("ai.steer", { body }),
            });
          }
          // Near step cap (once): prefer finish with path receipt over more exploration
          if (stepNumber === Math.max(2, agentSteps - 2)) {
            extras.push({
              role: "user",
              content:
                ei18n("ai.stepLimit"),
            });
          }
          if (extras.length === 0) return {};
          return { messages: [...stepMessages, ...extras] };
        }
        : undefined,
      onError({ error }) {
        streamError = error;
        logError("ai-stream", "onError callback", {
          sessionId,
          error: error?.message || String(error),
        });
      },
    });

    for await (const chunk of result.toUIMessageStream({
      sendReasoning: true,
      sendStart: true,
      sendFinish: true,
    })) {
      lastChunk = Date.now();
      switch (chunk.type) {
        case "start":
          emitOut({ type: "status", status: "thinking" });
          break;
        case "reasoning-start":
          emitOut({ type: "status", status: "thinking" });
          break;
        case "reasoning-delta":
          deltaCoalescer.pushDelta("reasoning", chunk.delta);
          break;
        case "text-start":
          emitOut({ type: "status", status: "writing" });
          break;
        case "text-delta": {
          collected += chunk.delta;
          const next = ingestAssistantTextDelta(visibleAcc, chunk.delta);
          if (next.resetBody) {
            deltaCoalescer.flush();
            emitOut({ type: "text-reset", text: next.body });
          } else if (next.bodyDelta) {
            deltaCoalescer.pushDelta("text", next.bodyDelta);
          }
          if (next.resetReasoning) {
            deltaCoalescer.flush();
            emitOut({ type: "reasoning-reset", text: next.reasoning });
          } else if (next.reasoningDelta) {
            deltaCoalescer.pushDelta("reasoning", next.reasoningDelta);
          }
          visibleAcc = next;
          break;
        }
        case "tool-input-start":
          toolCallCount++;
          emitOut({
            type: "tool-call",
            tool: chunk.toolName,
            toolCallId: chunk.toolCallId || `tc_${toolCallCount}`,
            status: "running",
            count: toolCallCount,
            maxSteps: agentSteps,
          });
          emitOut({ type: "status", status: "calling-tool", tool: chunk.toolName, count: toolCallCount, maxSteps: agentSteps });
          break;
        case "tool-input-delta":
          break;
        case "tool-output-available": {
          const out = chunk.output;
          const summary = summarizeToolOutput(chunk.toolName, out);
          emitOut({
            type: "tool-result",
            tool: chunk.toolName,
            toolCallId: chunk.toolCallId,
            status: "done",
            output: out,
            summary,
          });
          emitOut({ type: "status", status: "writing" });
          break;
        }
        case "finish":
          // "done" status is emitted in finally block after cleanup — no duplicate here
          break;
        default:
          break;
      }
    }

    deltaCoalescer.flush();

    if (streamError && !collected) {
      return {
        text: "",
        usage: null,
        error: streamError,
        followUps: drainPendingUserMessages(registry, sessionId),
        steerApplyCount,
      };
    }

    const text = await result.text.catch(() => collected);
    const split = splitAssistantVisible(text || collected);
    const body = visibleAcc.body || split.body || "";
    const reasoning = [visibleAcc.reasoning, split.reasoning].filter(Boolean).join("\n\n") || split.reasoning;
    let usage = null;
    try {
      usage = await result.usage;
    } catch { /* ignore */ }
    logInfo("ai-stream", "completed", {
      sessionId,
      toolCalls: toolCallCount,
      steers: steerApplyCount,
      textLength: body.length,
      deltaFlushes: deltaCoalescer.stats().flushCount,
      deltaChunks: deltaCoalescer.stats().deltaCount,
    });
    return {
      text: body,
      reasoning,
      usage,
      error: null,
      followUps: drainPendingUserMessages(registry, sessionId),
      steerApplyCount,
    };
  } catch (err) {
    deltaCoalescer.flush();
    if (controller.signal.aborted && (visibleAcc.body || collected)) {
      const split = splitAssistantVisible(collected);
      return {
        text: visibleAcc.body || split.body || "",
        reasoning: visibleAcc.reasoning || split.reasoning || "",
        usage: null,
        error: null,
        followUps: drainPendingUserMessages(registry, sessionId),
        steerApplyCount,
      };
    }
    logError("ai-stream", "failed", { sessionId, error: err.message });
    return {
      text: "",
      usage: null,
      error: streamError || err,
      followUps: drainPendingUserMessages(registry, sessionId),
      steerApplyCount,
    };
  } finally {
    clearTimeout(timeout);
    clearInterval(idle);
    registry?.unregister(sessionId, controller);
    deltaCoalescer.flush();
    rawEmit({ type: "status", status: "done" });
  }
}
