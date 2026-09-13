/**
 * Desktop chat ingest/render split — drives shipped src/lib/ai-chat-split.ts
 * (the function ChatMessage + ai-store import).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  splitAssistantVisible,
  ingestAssistantTextDelta,
  visibleAssistantMessage,
} from "../src/lib/ai-chat-split.ts";
import { splitAssistantVisible as kernelSplit } from "../../lib/ai-content-sanitize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("tagged think + answer: body is the answer, thinking is folded out", () => {
  const split = splitAssistantVisible(
    `<think>I should inspect the file first and plan a patch.</think>\n\n## 结论\n改中间那段即可。`,
  );
  assert.doesNotMatch(split.body, /inspect the file|<think>/i);
  assert.match(split.body, /结论|改中间/);
  assert.match(split.reasoning, /inspect the file/);
});

test("fenced thinking is not the visible body", () => {
  const split = splitAssistantVisible("```reasoning\nstepwise dump\n```\n\nHere is the fix.");
  assert.doesNotMatch(split.body, /stepwise dump|```reasoning/i);
  assert.match(split.body, /Here is the fix/);
  assert.match(split.reasoning, /stepwise dump/);
});

test("untagged CoT prefix + real answer", () => {
  const split = splitAssistantVisible(
    "Let me think about how to edit the middle paragraph.\nI will search then patch.\n\n## Answer\nReplaced the unique span.",
  );
  assert.doesNotMatch(split.body, /Let me think/i);
  assert.match(split.body, /Replaced the unique span/);
  assert.match(split.reasoning, /Let me think/i);
});

test("reasoning-delta payload style (plain thinking, no answer yet) stays out of body", () => {
  const split = splitAssistantVisible("Thinking: the user asked to rewrite one paragraph in a long note.");
  assert.equal(split.body, "");
  assert.match(split.reasoning, /rewrite one paragraph/);
});

test("ingestAssistantTextDelta used by ai-store keeps body clean during stream", () => {
  let acc = ingestAssistantTextDelta(null, "<think>partial");
  assert.equal(acc.body, "");
  acc = ingestAssistantTextDelta(acc, " plan</think>\n\nVisible.");
  assert.match(acc.body, /Visible/);
  assert.doesNotMatch(acc.body, /partial plan|<think>/);
});

test("unclosed thinking fence stays empty-body until close, then only the answer", () => {
  let acc = ingestAssistantTextDelta(null, "```thinking\nlong dump");
  assert.equal(acc.body, "");
  assert.match(acc.reasoning, /long dump/);
  acc = ingestAssistantTextDelta(acc, " still thinking");
  assert.equal(acc.body, "");
  acc = ingestAssistantTextDelta(acc, "\n```\n\nHere is the fix.");
  assert.match(acc.body, /Here is the fix/);
  assert.doesNotMatch(acc.body, /long dump|```thinking/);
  assert.match(acc.reasoning, /long dump/);
});

test("clean answer starting with Analysis is not swallowed as thinking", () => {
  const sentence = "Analysis of the market shows we should keep the weekly stream.";
  const split = splitAssistantVisible(sentence);
  assert.equal(split.body, sentence);
  assert.equal(split.reasoning, "");
  const shown = visibleAssistantMessage(sentence);
  assert.equal(shown.body, sentence);
});

test("thinking-only payload does not become the visible reply", () => {
  const shown = visibleAssistantMessage("<think>only dump</think>");
  assert.equal(shown.body, "");
  assert.match(shown.reasoning, /only dump/);
  const fenced = visibleAssistantMessage("```thinking\nonly dump");
  assert.equal(fenced.body, "");
  assert.match(fenced.reasoning, /only dump/);
});

test("renderer split matches Kernel splitAssistantVisible on representative inputs", () => {
  const samples = [
    `<think>secret</think>\n\n## 结论\n- 真答案`,
    "```thinking\nscratch\n```\n\nDone.",
    "Let me think about this file.\n\n## Answer\nShip it.",
    "Thinking: only dump",
    "already clean answer",
    "```thinking\nlong dump",
    "<think>only dump</think>",
    "Analysis of the market shows we should keep the weekly stream.",
  ];
  for (const s of samples) {
    assert.deepEqual(splitAssistantVisible(s), kernelSplit(s), s.slice(0, 40));
  }
});

test("ai-store and ChatMessage import the shipped split", () => {
  const store = readFileSync(path.join(root, "src/stores/ai-store.ts"), "utf8");
  const chat = readFileSync(path.join(root, "src/components/ai/ChatMessage.tsx"), "utf8");
  const stream = readFileSync(path.join(root, "electron/ai-stream.mjs"), "utf8");
  assert.match(store, /splitAssistantVisible|ingestAssistantTextDelta/);
  assert.match(chat, /visibleAssistantMessage/);
  assert.doesNotMatch(chat, /split\.body\s*\|\|/);
  assert.doesNotMatch(store, /split\.body\s*\|\|/);
  assert.match(stream, /ingestAssistantTextDelta|splitAssistantVisible/);
});

test("expanded reasoning trace keeps overflow-auto (collapsed clip does not beat the scroll body)", () => {
  const css = readFileSync(path.join(root, "src/styles/v4.css"), "utf8");
  const chat = readFileSync(path.join(root, "src/components/ai/ChatMessage.tsx"), "utf8");
  assert.match(chat, /data-reasoning-scroll/);
  assert.match(chat, /max-h-40 overflow-auto/);
  assert.match(css, /\.v4-reasoning-expand:not\(\[data-open=["']true["']\]\)\s*>\s*div/);
  const expandStart = css.indexOf(".v4-reasoning-expand");
  assert.ok(expandStart >= 0);
  const block = css.slice(expandStart, css.indexOf("/* ── Auto-save", expandStart));
  assert.match(block, /overflow:\s*hidden/);
  assert.doesNotMatch(
    block.replace(/\.v4-reasoning-expand:not\(\[data-open=["']true["']\]\)\s*>\s*div\s*\{[^}]+\}/u, ""),
    /\.v4-reasoning-expand\s*>\s*div\s*\{[^}]*overflow:\s*hidden/u,
  );
});

test("ChatMessage presents folded reasoning, in-turn tools/status, never thinking as body", () => {
  const chat = readFileSync(path.join(root, "src/components/ai/ChatMessage.tsx"), "utf8");
  assert.match(chat, /function ReasoningBlock/);
  assert.match(chat, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(chat, /data-reasoning-block/);
  assert.match(chat, /data-reasoning-open=\{open \? "true" : "false"\}/);
  assert.match(chat, /data-tool-timeline/);
  assert.match(chat, /function ToolCallTimeline/);
  assert.match(chat, /function StreamStatusIndicator/);
  assert.match(chat, /data-stream-status=\{status\}/);
  assert.match(chat, /visibleAssistantMessage\(message\.content, message\.reasoning\)/);
  assert.doesNotMatch(chat, /visibleBody\s*=\s*visible\.body\s*\|\|/);
  assert.doesNotMatch(chat, /message\.content\s*\|\|\s*visible/);
  const input = readFileSync(path.join(root, "src/components/ai/ChatInput.tsx"), "utf8");
  assert.match(input, /cancelStream/);
});
