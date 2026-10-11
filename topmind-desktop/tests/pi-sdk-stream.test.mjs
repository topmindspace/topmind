/**
 * Pi StreamFn adapter — drives shipped createAiSdkStreamFn on AI SDK v7 chunk shapes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiSdkStreamFn, readPiTranscript, sdkChunkText } from "../electron/lib/pi-sdk-stream.mjs";

function streamTextFromChunks(chunks) {
  return () => ({
    fullStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
  });
}

async function collect(stream) {
  const events = [];
  for await (const ev of stream) events.push(ev);
  return events;
}

test("createAiSdkStreamFn reads the Pi 1.0 transcript (system message holds prompt and tools)", async () => {
  let seen;
  const streamFn = createAiSdkStreamFn(
    { id: "stub" },
    {
      modelId: "stub",
      streamText: (args) => {
        seen = args;
        return {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "ok" };
          })(),
        };
      },
    },
  );
  const context = {
    messages: [
      {
        role: "system",
        content: "Be brief",
        toolsAdded: [{
          name: "read_file",
          description: "read a note",
          parameters: { type: "object", properties: { relativePath: { type: "string" } } },
        }],
        timestamp: 0,
      },
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ],
  };
  const stream = await streamFn(null, context, {});
  await collect(stream);
  assert.equal(seen.system, "Be brief");
  assert.equal(seen.messages.length, 1);
  assert.equal(seen.messages[0].role, "user");
  assert.equal(seen.messages[0].content, "hi");
  assert.ok(seen.tools.read_file);
  const read = readPiTranscript(context);
  assert.equal(read.system, "Be brief");
  assert.equal(read.tools[0].name, "read_file");
  assert.equal(read.messages[0].role, "user");
});

test("sdkChunkText reads AI SDK v7 .text as well as .delta / .textDelta", () => {
  assert.equal(sdkChunkText({ text: "plan" }), "plan");
  assert.equal(sdkChunkText({ delta: "a", text: "b" }), "a");
  assert.equal(sdkChunkText({ textDelta: "td" }), "td");
  assert.equal(sdkChunkText({}), "");
});

test("createAiSdkStreamFn maps reasoning-delta.text + text-delta.text (AI SDK 7 fullStream)", async () => {
  const streamFn = createAiSdkStreamFn(
    { id: "stub" },
    {
      modelId: "stub",
      streamText: streamTextFromChunks([
        { type: "reasoning-delta", text: "secret plan" },
        { type: "text-delta", text: "Visible answer." },
      ]),
    },
  );
  const stream = await streamFn(null, { messages: [{ role: "user", content: "hi" }] }, {});
  const events = await collect(stream);
  const thinking = events.filter((e) => e.type === "thinking_delta").map((e) => e.delta).join("");
  const text = events.filter((e) => e.type === "text_delta").map((e) => e.delta).join("");
  assert.equal(thinking, "secret plan");
  assert.equal(text, "Visible answer.");
  const done = events.find((e) => e.type === "done");
  assert.ok(done?.message);
  const blocks = done.message.content;
  assert.ok(blocks.some((p) => p.type === "thinking" && p.thinking.includes("secret plan")));
  assert.ok(blocks.some((p) => p.type === "text" && p.text.includes("Visible answer.")));
  assert.equal(events.some((e) => e.type === "thinking_start"), true);
});
