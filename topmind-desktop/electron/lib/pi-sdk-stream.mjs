/**
 * Pi StreamFn backed by the existing Vercel AI SDK model (keeps Desktop providers).
 * Tool *execution* stays in pi-agent-core; this adapter only lets the LLM emit calls.
 */
import { jsonSchema, stepCountIs, streamText, tool } from "ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";

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

function piToolsToSdkSchemas(piTools) {
  const out = {};
  for (const t of Array.isArray(piTools) ? piTools : []) {
    if (!t?.name) continue;
    const schema = t.parameters && typeof t.parameters === "object"
      ? t.parameters
      : { type: "object", properties: {} };
    out[t.name] = tool({
      description: t.description || t.name,
      inputSchema: jsonSchema(schema),
    });
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * AI SDK v7 fullStream parts: text-delta / reasoning-delta expose `.text`
 * (`TextStreamPart`). Older / UI-stream shapes used `.delta` or `.textDelta`.
 */
export function sdkChunkText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  return String(chunk.delta || chunk.textDelta || chunk.text || "");
}

function makeAssistant({ text, thinking, toolCalls, modelId, stopReason }) {
  const content = [];
  if (thinking) content.push({ type: "thinking", thinking });
  if (text) content.push({ type: "text", text });
  for (const c of toolCalls) {
    content.push({
      type: "toolCall",
      id: c.id,
      name: c.name,
      arguments: c.arguments || {},
    });
  }
  return {
    role: "assistant",
    content: content.length ? content : [{ type: "text", text: "" }],
    api: "openai-completions",
    provider: "openai",
    model: modelId || "desktop",
    usage: emptyUsage(),
    stopReason,
    timestamp: Date.now(),
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
      let partial = makeAssistant({ text: "", thinking: "", toolCalls: [], modelId, stopReason: "pending" });
      try {
        stream.push({ type: "start", partial });
        const sdkMessages = piContextToSdkMessages(context?.messages);
        const sdkTools = piToolsToSdkSchemas(context?.tools);
        const result = runStreamText({
          model: aiSdkModel,
          system: context?.systemPrompt || undefined,
          messages: sdkMessages,
          tools: sdkTools,
          abortSignal: signal,
          stopWhen: stepCountIs(1),
        });

        let text = "";
        let thinking = "";
        let textStarted = false;
        let thinkingStarted = false;
        const toolCalls = [];
        const iterable = result.fullStream || result.toUIMessageStream?.({ sendReasoning: true }) || [];

        for await (const chunk of iterable) {
          const type = chunk?.type;
          if (type === "text-delta" || type === "text_delta") {
            const delta = sdkChunkText(chunk);
            if (!delta) continue;
            if (!textStarted) {
              stream.push({ type: "text_start", contentIndex: 0, partial });
              textStarted = true;
            }
            text += delta;
            partial = makeAssistant({ text, thinking, toolCalls, modelId, stopReason: "pending" });
            stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
          } else if (type === "reasoning-delta" || type === "reasoning_delta") {
            const delta = sdkChunkText(chunk);
            if (!delta) continue;
            if (!thinkingStarted) {
              stream.push({ type: "thinking_start", contentIndex: 0, partial });
              thinkingStarted = true;
            }
            thinking += delta;
            partial = makeAssistant({ text, thinking, toolCalls, modelId, stopReason: "pending" });
            stream.push({ type: "thinking_delta", contentIndex: 0, delta, partial });
          } else if (type === "tool-call" || type === "tool-input-start") {
            const id = chunk.toolCallId || chunk.id || `tc_${toolCalls.length + 1}`;
            const name = chunk.toolName || chunk.tool || "";
            const args = chunk.input || chunk.args || chunk.arguments || {};
            if (type === "tool-call" || chunk.input) {
              const call = { id, name, arguments: args };
              toolCalls.push(call);
              partial = makeAssistant({ text, thinking, toolCalls, modelId, stopReason: "pending" });
              stream.push({ type: "toolcall_start", contentIndex: toolCalls.length - 1, partial });
              stream.push({ type: "toolcall_end", contentIndex: toolCalls.length - 1, toolCall: { type: "toolCall", ...call }, partial });
            }
          } else if (type === "error") {
            throw chunk.error || new Error("stream error");
          }
        }

        if (thinkingStarted) {
          stream.push({ type: "thinking_end", contentIndex: 0, content: thinking, partial });
        }
        if (textStarted) {
          stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
        }
        const stopReason = toolCalls.length ? "toolUse" : "stop";
        const message = makeAssistant({ text, thinking, toolCalls, modelId, stopReason });
        stream.push({ type: "done", reason: stopReason, message });
      } catch (err) {
        const aborted = Boolean(signal?.aborted) || err?.name === "AbortError";
        const errorMsg = makeAssistant({
          text: "",
          thinking: "",
          toolCalls: [],
          modelId,
          stopReason: aborted ? "aborted" : "error",
        });
        errorMsg.errorMessage = err?.message || String(err);
        stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: errorMsg });
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
