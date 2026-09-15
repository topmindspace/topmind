/**
 * Desktop agent loop on `@earendil-works/pi-agent-core`.
 * Official embed: in-process `Agent` + host-injected tools (not pi-coding-agent).
 * Pin `@earendil-works/pi-agent-core` with `pi-ai` as a pair — bump independently
 * of Electron / React / Vite / AI SDK majors.
 * LLM bytes still come from the existing AI SDK model (providers unchanged).
 * Tool execution is the Pi Agent loop; FS aliases are fenced (no bash).
 */
import { Agent } from "@earendil-works/pi-agent-core";
import { logError, logInfo } from "./lib/writeback.mjs";
import { summarizeToolOutput } from "./lib/ai-tool-evidence.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { createDeltaCoalescer } from "./lib/stream-delta-coalesce.mjs";
import { AGENT_STEPS_DEFAULT, clampMaxAgentSteps } from "./lib/settings-core.mjs";
import { convertDesktopToolsToPi, beforePiToolCall } from "./lib/pi-agent-tools.mjs";
import { createAiSdkStreamFn, sdkMessagesToPi } from "./lib/pi-sdk-stream.mjs";
import { compactMessagesForModel, estimateTokens } from "./lib/ai-session-compact.mjs";
import { shouldCompact, DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-agent-core";

export function isPiRuntimeAvailable() {
  return true;
}

function stubModel(modelId, contextWindow) {
  const cw = Number(contextWindow) > 0 ? Number(contextWindow) : 128000;
  return {
    id: modelId || "desktop",
    name: modelId || "desktop",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: cw,
    maxTokens: 8192,
  };
}

function assistantText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.filter((p) => p.type === "text").map((p) => p.text || "").join("");
}

function assistantThinking(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.filter((p) => p.type === "thinking").map((p) => p.thinking || "").join("");
}

function flattenPiText(message) {
  if (message?.role === "user") {
    const blocks = Array.isArray(message.content) ? message.content : [];
    return blocks.filter((p) => p.type === "text").map((p) => p.text || "").join("");
  }
  if (message?.role === "assistant") return assistantText(message);
  return "";
}

/**
 * Fold a Pi Agent transcript when Pi's shouldCompact fires, using Desktop's
 * compactMessagesForModel (no second LLM call).
 * Recent toolCall/toolResult turns are kept as structured pairs so path
 * receipts and read windows survive compaction.
 * @param {object[]} messages
 * @param {{ contextWindow?: number, modelId?: string, keepRecentTools?: number }} [opts]
 */
export function maybeCompactPiMessages(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  if (last?.role === "toolResult") {
    return { messages: list, compacted: false, note: null };
  }
  // Keep the most recent tool conversation intact (pairs + surrounding turns).
  const keepRecentTools = Math.max(0, Number(opts.keepRecentTools ?? 6));
  let cut = list.length;
  if (keepRecentTools > 0) {
    let seen = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const role = list[i]?.role;
      if (role === "toolCall" || role === "toolResult") {
        seen += 1;
        if (seen > keepRecentTools) {
          cut = i;
          break;
        }
      }
    }
  }
  // Never cut in the middle of an open toolCall→toolResult pair.
  while (cut > 0 && list[cut - 1]?.role === "toolCall" && list[cut]?.role === "toolResult") {
    cut -= 1;
  }
  const older = list.slice(0, cut);
  const recentStructured = list.slice(cut);

  const flat = older
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: flattenPiText(m) }))
    .filter((m) => m.content.trim().length > 0 || m.role === "user");
  const tokens =
    flat.reduce((n, m) => n + estimateTokens(m.content), 0) +
    recentStructured.reduce((n, m) => {
      const blocks = Array.isArray(m?.content) ? m.content : [];
      const text = blocks.map((b) => b?.text || b?.thinking || "").join("");
      return n + estimateTokens(text);
    }, 0);
  const window = Number(opts.contextWindow) > 0 ? Number(opts.contextWindow) : 128000;
  const overWindow = shouldCompact(tokens, window, DEFAULT_COMPACTION_SETTINGS);
  const compact = compactMessagesForModel(flat);
  if (!overWindow && !compact.compacted) {
    return { messages: list, compacted: false, note: null, estimatedTokens: tokens };
  }
  const folded = sdkMessagesToPi(compact.messages, opts.modelId || "desktop");
  return {
    messages: [...folded, ...recentStructured],
    compacted: true,
    note: compact.note || (overWindow ? "pi-shouldCompact" : null),
    estimatedTokens: compact.estimatedTokens,
  };
}

/**
 * Run one user turn on the Pi agent loop. Emits the same renderer events as runStream.
 *
 * @param {{
 *   model: object,
 *   modelId?: string,
 *   system: string,
 *   messages: object[],
 *   tools: Record<string, object> | null,
 *   emit: Function,
 *   sessionId: string,
 *   maxAgentSteps?: number,
 *   workspaceRoot?: string,
 *   streamFn?: Function,
 * }} opts
 * @param {object} [registry] stream registry from ai-stream.mjs
 */
export async function runPiAgent(opts, registry) {
  const {
    model,
    modelId = "desktop",
    system,
    messages,
    tools,
    emit,
    sessionId,
    maxAgentSteps,
    workspaceRoot,
    streamFn: streamFnOverride,
    contextWindow,
  } = opts;

  const controller = new AbortController();
  const agentSteps = clampMaxAgentSteps(maxAgentSteps ?? AGENT_STEPS_DEFAULT);
  let collected = "";
  let reasoning = "";
  let toolCallCount = 0;
  let steerApplyCount = 0;
  let turns = 0;

  const rawEmit = typeof emit === "function" ? emit : () => {};
  const deltaCoalescer = createDeltaCoalescer({ intervalMs: 16, emit: rawEmit });
  const emitOut = (event) => deltaCoalescer.pushEvent(event);

  const piTools = tools ? convertDesktopToolsToPi(tools, { workspaceRoot }) : [];
  const history = sdkMessagesToPi(messages, modelId);
  const last = history[history.length - 1];
  const prior = last?.role === "user" ? history.slice(0, -1) : history;
  const promptInput = last?.role === "user" ? last : "Continue.";

  const streamFn = streamFnOverride || createAiSdkStreamFn(model, { modelId });

  const agent = new Agent({
    initialState: {
      systemPrompt: system || "",
      model: stubModel(modelId, contextWindow),
      tools: piTools,
      messages: prior,
    },
    streamFn,
    transformContext: async (msgs) => {
      const window = Number(contextWindow) > 0 ? Number(contextWindow) : 128000;
      const folded = maybeCompactPiMessages(msgs, { contextWindow: window, modelId });
      if (folded.compacted) {
        emitOut({ type: "status", status: "compacting" });
        logInfo("ai-pi", "context compacted", { sessionId, note: folded.note });
        return folded.messages;
      }
      return msgs;
    },
    beforeToolCall: async (ctx) => beforePiToolCall(ctx),
    shouldStopAfterTurn: () => {
      turns += 1;
      return turns >= agentSteps;
    },
    prepareNextTurn: () => {
      const steers = registry?.drainSteers?.(sessionId) || [];
      if (!steers.length) return undefined;
      steerApplyCount += steers.length;
      emitOut({ type: "steer-applied", text: steers.join("\n").slice(0, 500), count: steers.length });
      emitOut({ type: "status", status: "steering" });
      return {
        messages: steers.map((text) => ({
          role: "user",
          content: [{ type: "text", text: ei18n("ai.steer", { body: text }) }],
          timestamp: Date.now(),
        })),
      };
    },
  });

  registry?.register?.(sessionId, controller, { agent });
  const onAbort = () => {
    try { agent.abort(); } catch { /* ignore */ }
  };
  controller.signal.addEventListener("abort", onAbort);

  emitOut({ type: "status", status: "preparing" });

  const unsub = agent.subscribe((event) => {
    switch (event.type) {
      case "turn_start":
        emitOut({ type: "status", status: "thinking" });
        break;
      case "message_update": {
        const ev = event.assistantMessageEvent;
        if (ev?.type === "text_delta" && ev.delta) {
          collected += ev.delta;
          deltaCoalescer.pushDelta("text", ev.delta);
          emitOut({ type: "status", status: "writing" });
        } else if (ev?.type === "thinking_delta" && ev.delta) {
          reasoning += ev.delta;
          deltaCoalescer.pushDelta("reasoning", ev.delta);
          emitOut({ type: "status", status: "thinking" });
        }
        break;
      }
      case "tool_execution_start":
        toolCallCount += 1;
        emitOut({
          type: "tool-call",
          tool: event.toolName,
          toolCallId: event.toolCallId,
          status: "running",
          count: toolCallCount,
          maxSteps: agentSteps,
        });
        emitOut({ type: "status", status: "calling-tool", tool: event.toolName, count: toolCallCount, maxSteps: agentSteps });
        break;
      case "tool_execution_end": {
        const out = event.result?.details ?? event.result;
        emitOut({
          type: "tool-result",
          tool: event.toolName,
          toolCallId: event.toolCallId,
          status: event.isError ? "error" : "done",
          output: out,
          summary: summarizeToolOutput(event.toolName, out),
        });
        emitOut({ type: "status", status: "writing" });
        break;
      }
      case "agent_end": {
        const msgs = event.messages || [];
        const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
        if (lastAsst) {
          collected = assistantText(lastAsst) || collected;
          reasoning = assistantThinking(lastAsst) || reasoning;
        }
        break;
      }
      default:
        break;
    }
  });

  try {
    await agent.prompt(promptInput);
    deltaCoalescer.flush();
    logInfo("ai-pi", "completed", {
      sessionId,
      toolCalls: toolCallCount,
      steers: steerApplyCount,
      textLength: collected.length,
      runtime: "pi-agent-core",
    });
    const leftoverSteers = registry?.drainSteers?.(sessionId) || [];
    const followUps = registry?.drainFollowUps?.(sessionId) || [];
    return {
      text: collected,
      reasoning,
      usage: null,
      error: null,
      followUps: [...leftoverSteers, ...followUps],
      steerApplyCount,
      runtime: "pi-agent-core",
    };
  } catch (err) {
    deltaCoalescer.flush();
    const aborted = controller.signal.aborted || err?.name === "AbortError" || /aborted/i.test(err?.message || "");
    if (aborted) {
      return {
        text: collected,
        reasoning,
        usage: null,
        error: null,
        cancelled: true,
        followUps: [...(registry?.drainSteers?.(sessionId) || []), ...(registry?.drainFollowUps?.(sessionId) || [])],
        steerApplyCount,
        runtime: "pi-agent-core",
      };
    }
    logError("ai-pi", "failed", { sessionId, error: err?.message || String(err) });
    return {
      text: collected,
      usage: null,
      error: err,
      followUps: [...(registry?.drainSteers?.(sessionId) || []), ...(registry?.drainFollowUps?.(sessionId) || [])],
      steerApplyCount,
      runtime: "pi-agent-core",
    };
  } finally {
    try { unsub?.(); } catch { /* ignore */ }
    controller.signal.removeEventListener("abort", onAbort);
    registry?.unregister?.(sessionId, controller);
    deltaCoalescer.flush();
    rawEmit({ type: "status", status: "done" });
  }
}
