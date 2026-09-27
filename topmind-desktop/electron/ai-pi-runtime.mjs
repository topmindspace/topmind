/**
 * Desktop agent loop on `@earendil-works/pi-agent-core`.
 * Official embed: in-process `Agent` + host-injected tools (not pi-coding-agent).
 * Pin `@earendil-works/pi-agent-core` with `pi-ai` as a pair — bump independently
 * of Electron / React / Vite / AI SDK majors.
 * LLM bytes still come from the existing AI SDK model (providers unchanged).
 * Tool execution is the Pi Agent loop; FS aliases are fenced (no bash).
 *
 * Also owns Pi-native compaction + goal follow-up helpers (merged from
 * pi-native-compact.mjs to keep the electron footprint bounded — prefer merge
 * over raising the soft ceiling).
 */
import {
  Agent,
  DEFAULT_COMPACTION_SETTINGS,
  shouldCompact,
  estimateContextTokens,
  prepareCompaction,
  compact,
} from "@earendil-works/pi-agent-core";
import { logError, logInfo, logWarn } from "./lib/writeback.mjs";
import { summarizeToolOutput } from "./lib/ai-tool-evidence.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { createDeltaCoalescer } from "./lib/stream-delta-coalesce.mjs";
import { AGENT_STEPS_DEFAULT, clampMaxAgentSteps } from "./lib/settings-core.mjs";
import { reasoningProviderOptions } from "./ai-provider-adapter.mjs";
import { convertDesktopToolsToPi, beforePiToolCall } from "./lib/pi-agent-tools.mjs";
import { createAiSdkStreamFn, sdkMessagesToPi } from "./lib/pi-sdk-stream.mjs";
import { compactMessagesForModel, estimateTokens } from "./lib/ai-session-compact.mjs";
import {
  applyGoalUpdate,
  assessGoalCompletion,
  buildContinuePrompt,
  buildTaskLedger,
  createGoalState,
  harvestPathReceipts,
  isTaskLedgerText,
  isMetaInstructionText,
} from "./lib/agent-goal-protocol.mjs";

// ── Pi-native compaction + goal hooks (root exports only; no deep imports) ──

function summaryContext(signal) {
  return { abortSignal: signal };
}

function flattenPiMsg(m) {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  const blocks = Array.isArray(m.content) ? m.content : [];
  return blocks.map((b) => b?.text || b?.thinking || "").join("");
}

/**
 * Models adapter over the Desktop AI SDK — only `completeSimple` is required
 * by Pi `compact`.
 */
export function createSummaryModels(aiSdkModel, opts = {}) {
  return {
    async completeSimple(_model, aiContext, options) {
      const generate =
        typeof opts.generateText === "function"
          ? opts.generateText
          : (await import("ai")).generateText;
      const system = aiContext?.systemPrompt || "";
      const userText = (aiContext?.messages || [])
        .map((m) => {
          if (typeof m?.content === "string") return m.content;
          const blocks = Array.isArray(m?.content) ? m.content : [];
          return blocks.map((b) => b?.text || "").join("");
        })
        .join("\n");
      const result = await generate({
        model: aiSdkModel,
        system: system || undefined,
        messages: [{ role: "user", content: userText }],
        maxOutputTokens: opts.maxOutputTokens || Math.min(8192, options?.maxTokens || 8192),
        temperature: opts.temperature ?? 0.2,
        abortSignal: options?.signal,
      });
      const text = result?.text || "";
      return {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason: result?.finishReason === "length" ? "length" : "stop",
        usage: {
          input: result?.usage?.promptTokens || result?.usage?.inputTokens || 0,
          output: result?.usage?.completionTokens || result?.usage?.outputTokens || 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens:
            result?.usage?.totalTokens ||
            (result?.usage?.promptTokens || 0) + (result?.usage?.completionTokens || 0),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      };
    },
  };
}

/** Keep goal / plan / receipts / open criteria through LLM summary. */
export const GOAL_SUMMARY_FOCUS = [
  "Preserve exactly: original user goal, [PLAN] steps, done-when acceptance criteria,",
  "which criteria are still open, and every workspace path receipt (file paths).",
  "Drop tool chatter and reasoning. Never invent paths or mark open criteria done.",
].join(" ");

function stubModelForSummary(modelId, contextWindow) {
  return {
    id: modelId || "desktop-summary",
    name: modelId || "desktop-summary",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(contextWindow) > 0 ? Number(contextWindow) : 128000,
    maxTokens: 8192,
  };
}

/**
 * LLM-backed compact of a Pi AgentMessage[]. Returns null when unavailable
 * so the caller can fall back to deterministic fold.
 */
export async function compactPiMessagesLlm(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  if (!opts.model) return null;
  const window = Number(opts.contextWindow) > 0 ? Number(opts.contextWindow) : 128000;
  const piMsgs = sdkMessagesToPi(list, opts.modelId || "desktop");
  const estimate = estimateContextTokens(piMsgs);
  const tokens = Number(estimate?.tokens) || 0;
  if (!shouldCompact(tokens, window, DEFAULT_COMPACTION_SETTINGS)) return null;

  const ledgerMsgs = list.filter((m) => {
    const t = flattenPiMsg(m);
    return m?.role === "user" && isTaskLedgerText(t);
  }).slice(-1);

  try {
    const now = Date.now();
    const entries = list.map((m, i) => ({
      type: "message",
      id: `m${i}`,
      parentId: i === 0 ? null : `m${i - 1}`,
      seq: i,
      timestamp: now + i,
      message: m,
    }));
    const prepared = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);
    if (!prepared?.ok || !prepared.value) return null;
    const models = createSummaryModels(opts.model, {
      generateText: opts.generateText,
    });
    const compactResult = await compact(
      prepared.value,
      models,
      stubModelForSummary(opts.modelId, window),
      GOAL_SUMMARY_FOCUS,
      "off",
      undefined,
      undefined,
      summaryContext(opts.signal),
    );
    if (!compactResult?.ok || !compactResult.value?.summary) return null;
    const summary = compactResult.value.summary;
    const tail = compactResult.value.retainedTail || [];
    const details = compactResult.value.details || {};
    const folded = sdkMessagesToPi(
      [
        {
          role: "user",
          content: opts.goalLedgerText
            ? `${opts.goalLedgerText}\n\n---\n\n${summary}`
            : summary,
        },
        {
          role: "assistant",
          content:
            "Acknowledged the compacted history summary; continuing from recent turns and tool results.",
        },
      ],
      opts.modelId || "desktop",
    );
    const recent = sdkMessagesToPi(tail, opts.modelId || "desktop");
    const ledger = ledgerMsgs.map((m) => ({
      role: "user",
      content: [{ type: "text", text: flattenPiMsg(m) }],
      timestamp: Date.now(),
    }));
    logInfo("ai-pi", "llm summary compact", {
      tokensBefore: compactResult.value.tokensBefore || tokens,
      tail: tail.length,
      readFiles: details.readFiles?.length || 0,
      modifiedFiles: details.modifiedFiles?.length || 0,
    });
    return {
      messages: [...ledger, ...folded, ...recent],
      compacted: true,
      note: "pi-llm-summary",
      estimatedTokens:
        estimateContextTokens(
          sdkMessagesToPi([...ledger, ...folded, ...recent], opts.modelId || "desktop"),
        )?.tokens || tokens,
      llmSummary: true,
      fileOps: {
        readFiles: Array.isArray(details.readFiles) ? details.readFiles : [],
        modifiedFiles: Array.isArray(details.modifiedFiles) ? details.modifiedFiles : [],
      },
    };
  } catch (err) {
    logWarn("ai-pi", "llm summary failed — caller falls back to char fold", {
      error: err?.message || String(err),
    });
    return null;
  }
}

/**
 * In-run goal follow-up: keep an incomplete goal moving inside the same Agent run.
 * pi-agent-core Agent ignores a constructor `getFollowUpMessages` option (it only
 * drains the internal followUpQueue). Call the returned helper from `finishTurn`
 * and inject via `prepareNextTurn`, or push via `agent.followUp()`.
 */
export function createGoalFollowUps(opts = {}) {
  let used = 0;
  const max = Math.max(0, Number(opts.max ?? 1));
  return function maybeGoalFollowUp() {
    if (used >= max) return null;
    const state = typeof opts.goalState === "function" ? opts.goalState() : null;
    if (!state || !state.doneCriteria?.length) return null;
    if (state.status === "done" || state.status === "blocked" || state.status === "incomplete") return null;
    used += 1;
    return buildContinuePrompt(opts.locale || "zh-CN", state, {
      extra: (opts.locale || "zh-CN").startsWith("en")
        ? "(in-run follow-up: finish remaining criteria)"
        : "（同轮续跑：先完成未完成验收项）",
    });
  };
}

/**
 * prepareRequest: re-assert sticky task ledger if compaction dropped it.
 */
export function createLedgerPrepareRequest(opts = {}) {
  return async function prepareRequest(request) {
    try {
      const state = typeof opts.goalState === "function" ? opts.goalState() : null;
      if (!state?.goal) return undefined;
      const msgs = request?.context?.messages || [];
      const hasLedger = msgs.some((m) => isTaskLedgerText(flattenPiMsg(m)));
      if (hasLedger) return undefined;
      const ledger = buildTaskLedger(state, opts.locale || "zh-CN");
      return {
        context: {
          ...request.context,
          messages: [
            ...msgs,
            { role: "user", content: [{ type: "text", text: ledger }], timestamp: Date.now() },
          ],
        },
      };
    } catch {
      return undefined;
    }
  };
}

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
 * @param {{ contextWindow?: number, modelId?: string, keepRecentTools?: number, locale?: string }} [opts]
 */
export function maybeCompactPiMessages(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  if (last?.role === "toolResult") {
    return { messages: list, compacted: false, note: null };
  }
  // Sticky task ledger must never be folded away — goal/plan/receipts survive.
  const ledger = list.filter((m) => {
    const text = flattenPiText(m) || "";
    return m?.role === "user" && isTaskLedgerText(text);
  }).slice(-1);
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
  const foldResult = compactMessagesForModel(flat, { locale: opts.locale });
  if (!overWindow && !foldResult.compacted) {
    return { messages: list, compacted: false, note: null, estimatedTokens: tokens };
  }
  const folded = sdkMessagesToPi(foldResult.messages, opts.modelId || "desktop");
  // Re-inject sticky ledger first so goal/plan/receipts cannot vanish mid-task.
  const ledgerMsgs = ledger.map((m) => ({
    role: "user",
    content: [{ type: "text", text: flattenPiText(m) }],
    timestamp: Date.now(),
  }));
  return {
    messages: [...ledgerMsgs, ...folded, ...recentStructured],
    compacted: true,
    note: foldResult.note || (overWindow ? "pi-shouldCompact" : null),
    estimatedTokens: foldResult.estimatedTokens,
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
  // Wall-clock + idle guards (G4): Pi path previously had none — a hung tool or
  // network call could spin until the user noticed. Match ai-stream defaults.
  const PI_TIMEOUT_MS = 15 * 60 * 1000;
  const PI_IDLE_MS = 180 * 1000;
  let idleTimer = setTimeout(() => {
    try {
      controller.abort(new Error("ai stalled: no progress"));
    } catch { /* ignore */ }
  }, PI_IDLE_MS);
  const wallTimer = setTimeout(() => {
    try {
      controller.abort(new Error("ai timeout: wall-clock limit"));
    } catch { /* ignore */ }
  }, PI_TIMEOUT_MS);
  const bumpIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      try {
        controller.abort(new Error("ai stalled: no progress"));
      } catch { /* ignore */ }
    }, PI_IDLE_MS);
  };
  const agentSteps = clampMaxAgentSteps(maxAgentSteps ?? AGENT_STEPS_DEFAULT);
  let collected = "";
  let reasoning = "";
  let toolCallCount = 0;
  let steerApplyCount = 0;
  let turns = 0;
  let stepLimitHit = false;
  /** @type {string|null} */
  let pendingGoalFollowUp = null;
  const maybeGoalFollowUp = createGoalFollowUps({
    goalState: () => goalState,
    locale: opts.locale || "zh-CN",
    max: 1,
  });
  let goalState = createGoalState(
    (() => {
      // Latest non-ledger user task wins (multi-turn: "继续" / new goal).
      let last = "";
      for (const m of messages || []) {
        if (m?.role === "user") {
          const c = typeof m.content === "string" ? m.content : "";
          if (c && !isTaskLedgerText(c) && !/^\[系统\]|^\[System\]/u.test(c)) last = c;
        }
      }
      return last;
    })(),
  );
  /** Pi CompactionDetails file ops (for post-run memory distill). */
  let compactFileOps = { readFiles: [], modifiedFiles: [] };
  // Fold historical assistant text so [PLAN]/done-when from earlier turns survive
  // into this run (auto-continue / session resume). Skip meta-instruction text
  // so quoted `[DONE]` in continue prompts never marks the goal done.
  for (const m of messages || []) {
    if (m?.role !== "assistant" && m?.role !== "user") continue;
    const blocks = Array.isArray(m?.content) ? m.content : [];
    const text = typeof m?.content === "string" ? m.content : blocks.map((b) => b?.text || "").join(" ");
    if (!text || isTaskLedgerText(text) || isMetaInstructionText(text)) continue;
    goalState = applyGoalUpdate(goalState, { text });
    harvestPathReceipts(text, goalState.pathReceipts);
  }

  const rawEmit = typeof emit === "function" ? emit : () => {};
  const deltaCoalescer = createDeltaCoalescer({ intervalMs: 16, emit: rawEmit });
  const emitOut = (event) => deltaCoalescer.pushEvent(event);

  const piTools = tools ? convertDesktopToolsToPi(tools, { workspaceRoot }) : [];
  const history = sdkMessagesToPi(messages, modelId);
  const last = history[history.length - 1];
  const prior = last?.role === "user" ? history.slice(0, -1) : history;
  // When the transcript ends on assistant (follow-up / auto-continue), a bare
  // "Continue." is too weak — models often treat it as "nothing to do".
  // Anchor the continuation on the original goal + latest tool results.
  const promptInput = last?.role === "user"
    ? last
    : {
        role: "user",
        content: [{ type: "text", text: buildContinuePrompt(opts.locale || "zh-CN", goalState) }],
        timestamp: Date.now(),
      };

  const streamFn = streamFnOverride || createAiSdkStreamFn(model, {
    modelId,
    reasoningProviderOptions: reasoningProviderOptions(modelId, "agent"),
  });

  const agent = new Agent({
    initialState: {
      systemPrompt: system || "",
      model: stubModel(modelId, contextWindow),
      tools: piTools,
      messages: prior,
    },
    streamFn,
    transformContext: async (msgs) => {
      bumpIdle();
      const window = Number(contextWindow) > 0 ? Number(contextWindow) : 128000;
      // Prefer Pi-native LLM summary (structured, keeps file ops + goal focus);
      // fall back to deterministic char fold when summarize is unavailable.
      const llmFolded = await compactPiMessagesLlm(msgs, {
        model,
        contextWindow: window,
        modelId,
        goalLedgerText: buildTaskLedger(goalState, opts.locale || "zh-CN"),
        signal: controller.signal,
      });
      if (llmFolded?.compacted) {
        emitOut({ type: "status", status: "compacting" });
        logInfo("ai-pi", "context compacted", { sessionId, note: llmFolded.note });
        if (llmFolded.fileOps) {
          for (const p of llmFolded.fileOps.readFiles || []) {
            if (p && !compactFileOps.readFiles.includes(p)) compactFileOps.readFiles.push(p);
          }
          for (const p of llmFolded.fileOps.modifiedFiles || []) {
            if (p && !compactFileOps.modifiedFiles.includes(p)) compactFileOps.modifiedFiles.push(p);
          }
        }
        return llmFolded.messages;
      }
      const folded = maybeCompactPiMessages(msgs, { contextWindow: window, modelId });
      if (folded.compacted) {
        emitOut({ type: "status", status: "compacting" });
        logInfo("ai-pi", "context compacted", { sessionId, note: folded.note });
        return folded.messages;
      }
      return msgs;
    },
    beforeToolCall: async (ctx) => beforePiToolCall(ctx),
    // pi-agent-core 0.87+ dropped shouldStopAfterTurn — finishTurn is the only
    // turn-budget hook. Returning { action: "end" } stops the run cleanly and
    // lets ai-service auto-continue with a fresh step budget + task ledger.
    finishTurn: (turn) => {
      const lastAsst = turn?.message;
      const stopReason = lastAsst?.stopReason;
      // Per Pi README: never score goals on error/aborted turns.
      if (stopReason === "error" || stopReason === "aborted") return { action: "end" };
      turns += 1;
      const asstText = assistantText(lastAsst) || "";
      if (asstText) {
        goalState = applyGoalUpdate(goalState, { text: asstText });
        harvestPathReceipts(asstText, goalState.pathReceipts);
      }
      for (const tr of turn?.toolResults || []) {
        const blocks = Array.isArray(tr?.content) ? tr.content : [];
        const t = blocks.map((b) => b?.text || "").join(" ") || (typeof tr?.content === "string" ? tr.content : "");
        if (t) harvestPathReceipts(t, goalState.pathReceipts);
      }
      // Verification-before-done: if tools ran and the model claims done without
      // any path receipt, treat as incomplete (industry practice: receipts prove work).
      if (
        asstText &&
        goalState.status === "done" &&
        toolCallCount > 0 &&
        goalState.pathReceipts.length === 0 &&
        !/路径回执|path receipt|affected files|受影响文件/iu.test(asstText)
      ) {
        goalState = { ...goalState, status: "incomplete", blockReason: "missing-path-receipts" };
      }
      if (turns >= agentSteps) {
        stepLimitHit = true;
        const assessment = assessGoalCompletion({
          state: goalState,
          lastBody: asstText,
          stepLimitHit: true,
          toolCallCount,
        });
        goalState = assessment.finished
          ? { ...goalState, status: "done" }
          : { ...goalState, status: goalState.status === "done" ? "done" : "incomplete" };
        return { action: "end" };
      }
      // In-run goal follow-up (native finishTurn continue — Agent ignores a
      // constructor getFollowUpMessages). One extra request with a continue
      // prompt when acceptance criteria are still open.
      const followUpText = maybeGoalFollowUp();
      if (followUpText) {
        pendingGoalFollowUp = followUpText;
        return { action: "continue" };
      }
      return undefined;
    },
    prepareNextTurn: () => {
      const messages = [];
      const steers = registry?.drainSteers?.(sessionId) || [];
      if (steers.length) {
        steerApplyCount += steers.length;
        emitOut({ type: "steer-applied", text: steers.join("\n").slice(0, 500), count: steers.length });
        emitOut({ type: "status", status: "steering" });
        for (const text of steers) {
          messages.push({
            role: "user",
            content: [{ type: "text", text: ei18n("ai.steer", { body: text }) }],
            timestamp: Date.now(),
          });
        }
      }
      if (pendingGoalFollowUp) {
        const text = pendingGoalFollowUp;
        pendingGoalFollowUp = null;
        emitOut({ type: "status", status: "continuing" });
        messages.push({
          role: "user",
          content: [{ type: "text", text }],
          timestamp: Date.now(),
        });
      }
      return messages.length ? { messages } : undefined;
    },
    // Re-assert sticky task ledger if compaction dropped it.
    prepareRequest: createLedgerPrepareRequest({
      goalState: () => goalState,
      locale: opts.locale || "zh-CN",
    }),
  });

  registry?.register?.(sessionId, controller, { agent });
  const onAbort = () => {
    try { agent.abort(); } catch { /* ignore */ }
  };
  controller.signal.addEventListener("abort", onAbort);

  emitOut({ type: "status", status: "preparing" });

  const unsub = agent.subscribe((event) => {
    bumpIdle();
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
          goalState = applyGoalUpdate(goalState, { text: collected });
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
      stepLimitHit,
      toolCallCount,
      goalState,
      taskLedger: buildTaskLedger(goalState, opts.locale || "zh-CN"),
      fileOps: compactFileOps,
      followUps: [...leftoverSteers, ...followUps],
      steerApplyCount,
      runtime: "pi-agent-core",
    };
  } catch (err) {
    deltaCoalescer.flush();
    const aborted = controller.signal.aborted || err?.name === "AbortError" || /aborted/i.test(err?.message || "");
    if (aborted) {
      const msg = String(err?.message || "");
      const stopReason = /timeout/i.test(msg)
        ? "timeout"
        : /stall/i.test(msg)
          ? "stalled"
          : "cancelled";
      return {
        text: collected,
        reasoning,
        usage: null,
        error: null,
        cancelled: true,
        stopReason,
        goalState,
        taskLedger: buildTaskLedger(goalState, opts.locale || "zh-CN"),
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
      goalState,
      taskLedger: buildTaskLedger(goalState, opts.locale || "zh-CN"),
      followUps: [...(registry?.drainSteers?.(sessionId) || []), ...(registry?.drainFollowUps?.(sessionId) || [])],
      steerApplyCount,
      runtime: "pi-agent-core",
    };
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(wallTimer);
    try { unsub?.(); } catch { /* ignore */ }
    controller.signal.removeEventListener("abort", onAbort);
    registry?.unregister?.(sessionId, controller);
    deltaCoalescer.flush();
    rawEmit({ type: "status", status: "done" });
  }
}
