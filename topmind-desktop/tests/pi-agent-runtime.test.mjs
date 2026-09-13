/**
 * Pi agent-core loop — shipped runPiAgent + tool conversion + fence aliases.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { convertDesktopToolsToPi, beforePiToolCall } from "../electron/lib/pi-agent-tools.mjs";
import { runPiAgent, isPiRuntimeAvailable, maybeCompactPiMessages } from "../electron/ai-pi-runtime.mjs";
import { PI_READ_DEFAULT_LIMIT } from "../electron/lib/pi-fenced-fs.mjs";
import { piContextToSdkMessages } from "../electron/lib/pi-sdk-stream.mjs";
import { createStreamRegistry } from "../electron/ai-stream.mjs";
import { workspaceRootOf } from "../electron/lib/kernel-api.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function emptyUsage() {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function textStreamFn(reply) {
  return async function streamFn() {
    const stream = new AssistantMessageEventStream();
    queueMicrotask(() => {
      const msg = {
        role: "assistant",
        content: [{ type: "text", text: reply }],
        api: "openai-completions",
        provider: "openai",
        model: "stub",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: { ...msg, content: [{ type: "text", text: "" }] } });
      stream.push({ type: "text_start", contentIndex: 0, partial: msg });
      stream.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: msg });
      stream.push({ type: "text_end", contentIndex: 0, content: reply, partial: msg });
      stream.push({ type: "done", reason: "stop", message: msg });
    });
    return stream;
  };
}

describe("pi-agent-runtime", () => {
  it("is available once pi-agent-core is installed", () => {
    assert.equal(isPiRuntimeAvailable(), true);
  });

  it("convertDesktopToolsToPi wraps SDK tools and adds fenced read/write/edit aliases", async () => {
    let seen;
    const sdkTools = {
      read_file: {
        description: "read md",
        inputSchema: { type: "object", properties: { relativePath: { type: "string" } } },
        execute: async (args) => {
          seen = args;
          return { ok: true, content: "hello" };
        },
      },
      save_file: {
        description: "save md",
        inputSchema: { type: "object", properties: { relativePath: { type: "string" }, content: { type: "string" } } },
        execute: async () => ({ ok: true }),
      },
      edit_file: {
        description: "edit md",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ ok: true }),
      },
    };
    const ws = "/tmp/topmind-pi-ws";
    const tools = convertDesktopToolsToPi(sdkTools, { workspaceRoot: ws });
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("read_file"));
    assert.ok(names.includes("read"));
    assert.ok(names.includes("write"));
    assert.ok(names.includes("edit"));
    assert.equal(names.includes("bash"), false);
    assert.equal(names.includes("grep"), false, "grep alias only when search exists");

    const read = tools.find((t) => t.name === "read");
    const result = await read.execute("tc1", { path: "10-动态/note.md" });
    assert.match(result.content[0].text, /hello/);
    assert.equal(seen.relativePath, "10-动态/note.md");
    assert.equal(seen.limit, PI_READ_DEFAULT_LIMIT);

    await assert.rejects(
      () => read.execute("tc2", { path: "../secret.md" }),
      /outside workspace/,
    );
  });

  it("beforePiToolCall blocks bash", () => {
    const blocked = beforePiToolCall({ toolName: "bash" });
    assert.equal(blocked.block, true);
    assert.equal(beforePiToolCall({ toolName: "read" }), undefined);
  });

  it("runPiAgent with a mock streamFn emits text and reports pi-agent-core runtime", async () => {
    const events = [];
    const registry = createStreamRegistry();
    const result = await runPiAgent({
      model: {},
      modelId: "stub",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: null,
      emit: (e) => events.push(e.type),
      sessionId: "s1",
      streamFn: textStreamFn("hello-from-pi"),
    }, registry);
    assert.equal(result.error, null);
    assert.equal(result.runtime, "pi-agent-core");
    assert.match(result.text, /hello-from-pi/);
    assert.ok(events.includes("status"));
    assert.ok(events.includes("text") || events.some((t) => t === "status"));
  });

  it("runPiAgent twice with the same stub streamFn is consistent (text + runtime)", async () => {
    const run = (id) => runPiAgent({
      model: {},
      modelId: "stub",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: {
        read_file: {
          description: "read md",
          inputSchema: { type: "object", properties: { relativePath: { type: "string" } } },
          execute: async () => ({ ok: true, content: "ok" }),
        },
      },
      emit: () => {},
      sessionId: id,
      streamFn: textStreamFn("hello-from-pi"),
    }, createStreamRegistry());
    const a = await run("s-twice-a");
    const b = await run("s-twice-b");
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    assert.equal(a.text, b.text);
    assert.equal(a.runtime, "pi-agent-core");
    assert.equal(b.runtime, "pi-agent-core");
    assert.match(a.text, /hello-from-pi/);
  });

  it("piContextToSdkMessages round-trips user/assistant/toolResult", () => {
    const sdk = piContextToSdkMessages([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "yo" }, { type: "toolCall", id: "1", name: "read_file", arguments: { relativePath: "a.md" } }] },
      { role: "toolResult", toolCallId: "1", toolName: "read_file", content: [{ type: "text", text: "body" }] },
    ]);
    assert.equal(sdk[0].role, "user");
    assert.equal(sdk[0].content, "hi");
    assert.equal(sdk[1].role, "assistant");
    assert.equal(sdk[2].role, "tool");
    assert.equal(sdk[2].content[0].toolCallId, "1");
  });

  it("invoke path loads the Pi runtime (not analysis-only)", () => {
    const src = readFileSync(path.join(root, "electron/ai-service.mjs"), "utf8");
    assert.match(src, /runPiAgent/);
    assert.match(src, /ai-pi-runtime\.mjs/);
    assert.match(src, /falling back to AI SDK streamText/);
    assert.match(src, /module load failed/);
    assert.match(src, /noteAgentLoop/);
    assert.match(src, /workspaceRootOf\(c\.workspaceRoot\)/);
    assert.doesNotMatch(src, /workspaceRoot\?\.root \|\| c\.workspaceRoot\?\.path/);
  });

  it("workspaceRootOf on a live getContext object lets fenced aliases succeed", async () => {
    // getContext() sets workspaceRoot: currentCtx = { engineRoot, userWorkspaceRoot }.
    // Invoke must use this same helper — not .root / .path.
    const liveWorkspace = {
      engineRoot: path.join(root, ".."),
      userWorkspaceRoot: "/tmp/topmind-pi-ws",
    };
    const extracted = workspaceRootOf(liveWorkspace);
    assert.equal(extracted, liveWorkspace.userWorkspaceRoot);

    let seen;
    const tools = convertDesktopToolsToPi({
      read_file: {
        description: "read md",
        inputSchema: { type: "object", properties: { relativePath: { type: "string" } } },
        execute: async (args) => {
          seen = args;
          return { ok: true, content: "hello" };
        },
      },
    }, { workspaceRoot: extracted });
    const read = tools.find((t) => t.name === "read");
    const result = await read.execute("live1", { path: "10-动态/note.md" });
    assert.match(result.content[0].text, /hello/);
    assert.equal(seen.relativePath, "10-动态/note.md");
  });

  it("write alias denies empty path at the fenced entry", async () => {
    const tools = convertDesktopToolsToPi({
      save_file: {
        description: "save",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ ok: true }),
      },
    }, { workspaceRoot: "/tmp/topmind-pi-ws" });
    const write = tools.find((t) => t.name === "write");
    await assert.rejects(
      () => write.execute("w0", { content: "x" }),
      /empty-path|outside workspace/,
    );
  });

  it("grep alias maps to search without treating the query as a filesystem path", async () => {
    let seen;
    const tools = convertDesktopToolsToPi({
      search: {
        description: "search",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        execute: async (args) => {
          seen = args;
          return { hits: 1 };
        },
      },
    }, { workspaceRoot: "/tmp/topmind-pi-ws" });
    const grep = tools.find((t) => t.name === "grep");
    assert.ok(grep);
    const result = await grep.execute("g1", { pattern: "foo" });
    assert.match(result.content[0].text, /hits/);
    assert.equal(seen.query, "foo");
    assert.equal(seen.regex, true);

    await assert.rejects(
      () => grep.execute("g2", { pattern: "foo", path: "../secret" }),
      /outside workspace/,
    );
  });

  it("maybeCompactPiMessages leaves short transcripts alone and folds long ones", () => {
    const short = maybeCompactPiMessages([
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "yo" }], timestamp: 2 },
    ]);
    assert.equal(short.compacted, false);

    const long = [];
    for (let i = 0; i < 80; i++) {
      long.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `turn-${i} ${"x".repeat(200)}` }],
        timestamp: i,
      });
    }
    const folded = maybeCompactPiMessages(long);
    assert.equal(folded.compacted, true);
    assert.ok(folded.messages.length < long.length);
  });

  it("maybeCompactPiMessages does not fold a tool-result tail", () => {
    const msgs = [
      { role: "user", content: [{ type: "text", text: "edit" }], timestamp: 1 },
      { role: "toolResult", toolCallId: "1", toolName: "read", content: [{ type: "text", text: "body" }] },
    ];
    const out = maybeCompactPiMessages(msgs);
    assert.equal(out.compacted, false);
    assert.equal(out.messages.length, 2);
  });
});
