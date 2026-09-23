import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compactMessagesForModel,
  ensureRoleAlternation,
} from "../electron/lib/ai-session-compact.mjs";

test("ensureRoleAlternation merges consecutive same-role messages", () => {
  const input = [
    { role: "user", content: "hello" },
    { role: "user", content: "world" },
    { role: "assistant", content: "how can I help?" },
    { role: "assistant", content: "ready to serve" },
    { role: "user", content: "test" },
  ];
  const out = ensureRoleAlternation(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].role, "user");
  assert.match(out[0].content, /hello\n\n---\n\nworld/);
  assert.equal(out[1].role, "assistant");
  assert.match(out[1].content, /how can I help\?\n\n---\n\nready to serve/);
  assert.equal(out[2].role, "user");
  assert.equal(out[2].content, "test");
});

test("compactMessagesForModel strictly enforces role alternation after compaction", () => {
  const msgs = [];
  for (let i = 0; i < 70; i++) {
    msgs.push({ role: "user", content: `User question ${i}` });
    msgs.push({ role: "assistant", content: `Assistant answer ${i}` });
  }

  const res = compactMessagesForModel(msgs, { maxMessages: 20, keepRecent: 6 });
  assert.ok(res.compacted);
  assert.ok(res.messages.length <= 20);

  // Check every pair in res.messages
  for (let i = 1; i < res.messages.length; i++) {
    const prev = res.messages[i - 1];
    const curr = res.messages[i];
    assert.notEqual(
      prev.role,
      curr.role,
      `Found consecutive messages with the same role '${curr.role}' at index ${i - 1} and ${i}`,
    );
  }
});
