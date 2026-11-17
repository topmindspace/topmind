/**
 * Pi StreamFn backed by the existing Vercel AI SDK model (keeps Desktop providers).
 * Tool *execution* stays in pi-agent-core; this adapter only lets the LLM emit calls.
 */
import { estimateTokens, resolveContextBudget, fitSdkContext } from "./agent-context-policy.mjs";
import { jsonSchema, stepCountIs, streamText, tool } from "ai";
import {
  AssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function partsToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((p) => {
      if (typeof p === "string") return p;
      if (p?.type === "text") return p.text || "";
      return "";
    })
    .join("");
}

/** @param {object[]} messages Pi LLM Context.messages */
export function piContextToSdkMessages(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role === "user") {
      out.push({ role: "user", content: partsToText(m.content) });
      continue;
    }
    if (m.role === "assistant") {
      const blocks = Array.isArray(m.content) ? m.content : [];
      const text = blocks.filter((p) => p.type === "text").map((p) => p.text || "").join("");
      const calls = blocks.filter((p) => p.type === "toolCall");
      if (calls.length === 0) {
        out.push({ role: "assistant", content: text });
      } else {
        out.push({
          role: "assistant",
          content: [
            ...(text ? [{ type: "text", text }] : []),
            ...calls.map((c) => ({
              type: "tool-call",
              toolCallId: c.id,
              toolName: c.name,
              input: c.arguments || {},
            })),
          ],
        });
      }
      continue;
    }
    if (m.role === "toolResult") {
      out.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: m.toolCallId,
          toolName: m.toolName,
          output: { type: "text", value: partsToText(m.content) },
        }],
      });
    }
  }
  return out;
}

function asJsonSchema(parameters) {
  if (!parameters || typeof parameters !== "object") {
    return { type: "object", properties: {} };
  }
  try {
    const plain = JSON.parse(JSON.stringify(parameters));
    if (plain && typeof plain === "object" && (plain.type || plain.properties)) return plain;
  } catch {
    /* TypeBox symbols or cycles — fall through to an empty object schema. */
  }
  return { type: "object", properties: {} };
}

function piToolsToSdkSchemas(piTools) {
  const out = {};
  for (const t of Array.isArray(piTools) ? piTools : []) {
    if (!t?.name) continue;
    out[t.name] = tool({
      description: t.description || t.name,
      inputSchema: jsonSchema(asJsonSchema(t.parameters)),
    });
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Pi 1.0 `StreamFn` receives a transcript: the system prompt and tool
 * declarations live on system messages, not on `context.systemPrompt` /
 * `context.tools`. Older callers may still pass those fields.
 * @param {object} context
 */
export function readPiTranscript(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const fromTranscript = getCurrentSystemPrompt(messages);
  const system = fromTranscript || (typeof context?.systemPrompt === "string" ? context.systemPrompt : "");
  const declared = getCurrentTools(messages);
  const tools = declared.length
    ? declared
    : (Array.isArray(context?.tools) ? context.tools : []);
  return {
    system,
    tools,
    messages: messages.filter((m) => m?.role !== "system"),
  };
}

/**
 * AI SDK v7 fullStream parts: text-delta / reasoning-delta expose `.text`
 * (`TextStreamPart`). Older / UI-stream shapes used `.delta` or `.textDelta`.
 */
export function sdkChunkText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  return String(chunk.delta || chunk.textDelta || chunk.text || "");
}

function makeAssistant({ content, modelId, stopReason, timestamp, usage = emptyUsage() }) {
  return {
    role: "assistant",
    content: content.length ? content : [{ type: "text", text: "" }],
    api: "openai-completions",
    provider: "openai",
    model: modelId || "desktop",
    usage,
    stopReason,
    timestamp,
  };
}

/**
 * @param {object} aiSdkModel Vercel AI SDK LanguageModel from resolveModel
 * @param {{ modelId?: string }} [meta]
 */
export function createAiSdkStreamFn(aiSdkModel, meta = {}) {
  const modelId = meta.modelId || "desktop";
  const runStreamText = typeof meta.streamText === "function" ? meta.streamText : streamText;
  return async function streamFn(_piModel, context, options) {
    const stream = new AssistantMessageEventStream();
    const signal = options?.signal;
    (async () => {
      const content = [];
      const timestamp = Date.now();
      let usage = emptyUsage();
      const message = (stopReason = "pending") => makeAssistant({
        content: content.slice(), modelId, stopReason, timestamp, usage,
      });
      try {
        stream.push({ type: "start", partial: message() });
        signal?.throwIfAborted();
        const request = readPiTranscript(context);
        let sdkMessages = piContextToSdkMessages(request.messages);
        const sdkTools = piToolsToSdkSchemas(request.tools);
        if (meta.taskGuard) request.system += `\nHost execution checkpoint: ${meta.taskGuard.calls} tool calls consumed; ${meta.taskGuard.writes} successful writes. This budget is cumulative. Do not repeat completed writes; read the current source before editing omitted windows.`;
        const budget = resolveContextBudget(meta.contextWindow, { fixedTokens: estimateTokens(request.system) + estimateTokens(JSON.stringify(request.tools || [])), responseTokens: meta.maxOutputTokens });
        const fitted = fitSdkContext(sdkMessages, budget.maxTokens);
        if (fitted.overflow && meta.taskGuard) { meta.taskGuard.stop("context-budget"); throw new Error("task-execution-stopped"); }
        sdkMessages = fitted.messages;
        const result = runStreamText({
          model: aiSdkModel,
          system: request.system || undefined,
          messages: sdkMessages,
          tools: sdkTools,
          maxOutputTokens: meta.maxOutputTokens || budget.responseTokens,
          abortSignal: signal,
          stopWhen: stepCountIs(1),
          providerOptions: meta.reasoningProviderOptions || {},
        });

        const deltaIndexes = new Map();
        const toolIds = new Set();
        let finishReason;
        const iterable = result.fullStream || result.toUIMessageStream?.({ sendReasoning: true }) || [];

        for await (const chunk of iterable) {
          const type = chunk?.type;
          const kind = type === "text-delta" || type === "text_delta" ? "text"
            : type === "reasoning-delta" || type === "reasoning_delta" ? "thinking" : null;
          if (kind) {
            const delta = sdkChunkText(chunk);
            if (!delta) continue;
            let index = deltaIndexes.get(kind);
            if (index === undefined) {
              index = content.length;
              deltaIndexes.set(kind, index);
              content.push({ type: kind, [kind]: "" });
              stream.push({ type: `${kind}_start`, contentIndex: index, partial: message() });
            }
            content[index] = { type: kind, [kind]: content[index][kind] + delta };
            stream.push({ type: `${kind}_delta`, contentIndex: index, delta, partial: message() });
          } else if (type === "tool-call") {
            const id = chunk.toolCallId || chunk.id || `tc_${content.length + 1}`;
            if (toolIds.has(id)) continue;
            toolIds.add(id);
            const name = chunk.toolName || chunk.tool || "";
            const args = chunk.input || chunk.args || chunk.arguments || {};
            const toolCall = { type: "toolCall", id, name, arguments: args };
            const index = content.push(toolCall) - 1;
            const partial = message();
            stream.push({ type: "toolcall_start", contentIndex: index, partial });
            stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial });
          } else if (type === "finish" || type === "finish-step") {
            finishReason = chunk.finishReason ?? finishReason;
            const reported = chunk.totalUsage ?? chunk.usage;
            if (reported) {
              const cacheRead = reported.inputTokenDetails?.cacheReadTokens ?? 0;
              const cacheWrite = reported.inputTokenDetails?.cacheWriteTokens ?? 0;
              usage = {
                ...usage,
                input: reported.inputTokenDetails?.noCacheTokens
                  ?? Math.max(0, (reported.inputTokens ?? 0) - cacheRead - cacheWrite),
                output: reported.outputTokens ?? 0,
                cacheRead,
                cacheWrite,
                totalTokens: reported.totalTokens ?? (reported.inputTokens ?? 0) + (reported.outputTokens ?? 0),
              };
            }
          } else if (type === "abort") {
            throw Object.assign(new Error(chunk.reason || "Stream aborted"), { name: "AbortError" });
          } else if (type === "error") {
            throw chunk.error || new Error("stream error");
          }
        }

        signal?.throwIfAborted();
        if (finishReason === "error" || finishReason === "content-filter") {
          throw new Error(finishReason === "content-filter" ? "model-content-filtered" : "Provider ended the stream with an error");
        }
        for (const [kind, index] of deltaIndexes) {
          stream.push({ type: `${kind}_end`, contentIndex: index, content: content[index][kind], partial: message() });
        }
        const stopReason = finishReason === "length" ? "length" : toolIds.size ? "toolUse" : "stop";
        stream.push({ type: "done", reason: stopReason, message: message(stopReason) });
      } catch (err) {
        const reason = signal?.aborted || err?.name === "AbortError" ? "aborted" : "error";
        stream.push({ type: "error", reason, error: { ...message(reason), errorMessage: err?.message || String(err) } });
      }
    })();
    return stream;
  };
}

export function sdkMessagesToPi(messages, modelId = "desktop") {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const text = partsToText(m.content);
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: [{ type: "text", text }],
        api: "openai-completions",
        provider: "openai",
        model: modelId,
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    }
  }
  return out;
}
