/**
 * Pause ≠ Abandon contract (agent pattern 12).
 * Pause keeps edits + goal ledger and never paints cancelled; Resume rebuilds
 * a [系统] continue prompt; Abandon is the only path that marks cancelled.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useAiStore } from "../src/stores/ai-store.ts";
import { api } from "../src/services/api.ts";

function seedStreaming(goal = null) {
  useAiStore.setState({
    streaming: true,
    paused: false,
    activeSessionId: "sess-1",
    streamGoal: goal,
    streamDelta: "partial",
    streamStatus: "working",
    messages: [
      { role: "user", content: "整理收件箱" },
      {
        role: "assistant",
        content: "进行中…",
        toolCalls: [],
        goal: goal || null,
      },
    ],
  });
}

function reset() {
  useAiStore.setState({
    streaming: false,
    paused: false,
    activeSessionId: null,
    streamGoal: null,
    streamDelta: "",
    streamStatus: null,
    streamToolName: null,
    streamToolCalls: [],
    streamToolCount: null,
    streamMaxSteps: null,
    lastSteerPreview: null,
    pendingFollowUpCount: 0,
    streamAutoContinues: 0,
    messages: [],
    messagesError: null,
  });
}

/** Stub IPC cancel for the duration of `fn` (pause/abandon both abort). */
async function withCancelStub(fn) {
  const origCancel = api.ai.cancel;
  let cancelled = false;
  api.ai.cancel = async () => {
    cancelled = true;
    return { ok: true };
  };
  try {
    await fn();
  } finally {
    api.ai.cancel = origCancel;
  }
  return cancelled;
}

test("pauseStream keeps goal ledger and does not mark cancelled", async () => {
  reset();
  const goal = {
    goal: "整理收件箱",
    plan: ["扫描 Inbox", "归位条目"],
    criteria: ["Inbox 清空"],
    openCriteria: ["Inbox 清空"],
    pathReceipts: ["00-Inbox/a.md"],
    status: "working",
    blockReason: null,
    autoContinues: 1,
  };
  seedStreaming(goal);
  const cancelled = await withCancelStub(() => useAiStore.getState().pauseStream());
  const s = useAiStore.getState();
  assert.equal(cancelled, true, "pause must abort the live invoke");
  assert.equal(s.paused, true);
  assert.equal(s.streaming, false);
  assert.equal(s.streamGoal?.goal, "整理收件箱", "goal snapshot kept for resume");
  const last = s.messages[s.messages.length - 1];
  assert.equal(last.role, "assistant");
  assert.equal(last.cancelled, false, "pause is not a cancel");
  assert.equal(last.stopReason, "paused");
  assert.equal(last.goal?.status, "incomplete");
  assert.deepEqual(last.goal?.openCriteria, ["Inbox 清空"]);
});

test("pauseStream is a no-op when not streaming", async () => {
  reset();
  const cancelled = await withCancelStub(() => useAiStore.getState().pauseStream());
  assert.equal(cancelled, false);
  assert.equal(useAiStore.getState().paused, false);
});

test("resumeStream continues with [系统] prompt and plan/open criteria", async () => {
  reset();
  const goal = {
    goal: "整理收件箱",
    plan: ["扫描 Inbox", "归位条目"],
    criteria: ["Inbox 清空"],
    openCriteria: ["归位条目"],
    pathReceipts: [],
    status: "working",
    blockReason: null,
    autoContinues: 0,
  };
  seedStreaming(goal);
  await withCancelStub(() => useAiStore.getState().pauseStream());

  const origSend = useAiStore.getState().sendMessage;
  let sent = null;
  useAiStore.setState({
    sendMessage: async (text) => {
      sent = text;
    },
  });
  try {
    await useAiStore.getState().resumeStream("先处理今天的");
  } finally {
    useAiStore.setState({ sendMessage: origSend });
  }
  const s = useAiStore.getState();
  assert.equal(s.paused, false);
  assert.ok(sent, "resume must start a new turn");
  assert.match(sent, /^\[系统\]|^\[System\]/u, "continue prompt must not steal goal identity");
  assert.match(sent, /整理收件箱/);
  assert.match(sent, /扫描 Inbox/);
  assert.match(sent, /归位条目/);
  assert.match(sent, /先处理今天的/);
});

test("resumeStream refuses while already streaming or not paused", async () => {
  reset();
  const origSend = useAiStore.getState().sendMessage;
  let sent = 0;
  useAiStore.setState({
    sendMessage: async () => {
      sent += 1;
    },
  });
  try {
    // Not paused
    await useAiStore.getState().resumeStream();
    // Paused then start streaming
    useAiStore.setState({ paused: true, streaming: true });
    await useAiStore.getState().resumeStream();
  } finally {
    useAiStore.setState({ sendMessage: origSend });
  }
  assert.equal(sent, 0);
});

test("abandonPaused marks cancelled and clears the live goal", async () => {
  reset();
  seedStreaming({ goal: "整理收件箱", plan: [], criteria: [], openCriteria: [], pathReceipts: [], status: "working", blockReason: null, autoContinues: 0 });
  await withCancelStub(() => useAiStore.getState().pauseStream());
  await withCancelStub(() => useAiStore.getState().abandonPaused());
  const s = useAiStore.getState();
  assert.equal(s.paused, false);
  assert.equal(s.streamGoal, null);
  const last = s.messages[s.messages.length - 1];
  assert.equal(last.cancelled, true, "abandon is the honest cancel path");
});

test("abandonPaused is a no-op when not paused", async () => {
  reset();
  seedStreaming(null);
  const cancelled = await withCancelStub(() => useAiStore.getState().abandonPaused());
  assert.equal(cancelled, false);
  const last = useAiStore.getState().messages.at(-1);
  assert.notEqual(last?.cancelled, true);
});
