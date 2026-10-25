import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const handlers = new Map<string, (params: any) => any>();
const listeners = new Map<string, Set<(payload: any) => void>>();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const calls: Array<{ method: string; params: any }> = [];
Object.assign(globalThis, {
  window: { topmind: {
    async invoke(method: string, params: any) {
      calls.push({ method, params });
      return handlers.get(method)?.(params) ?? { ok: true };
    },
    subscribe(event: string, fn: (payload: any) => void) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(fn);
      return () => set.delete(fn);
    },
  } },
  requestAnimationFrame(fn: FrameRequestCallback) { frames.set(++frameId, fn); return frameId; },
  cancelAnimationFrame(id: number) { frames.delete(id); },
});
const { useAiStore, releaseAiWorkingSet } = await import("../src/stores/ai-store");
const initial = useAiStore.getInitialState();
const baselineStreamListeners = listeners.get("ai:stream")?.size ?? 0;
const state = () => useAiStore.getState();

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function emit(type: string, delta: string) {
  for (const fn of listeners.get("ai:stream") ?? []) fn({ sessionId: "a", type, delta });
}
beforeEach(async () => {
  handlers.clear();
  await state().cancelStream();
  frames.clear();
  calls.length = 0;
  useAiStore.setState({ ...initial, activeSessionId: "a", sessions: [{ id: "a", title: "A", updatedAt: "" }] }, true);
});

test("final response drains pending deltas before stamping and persisting the result", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("hello");
  emit("text", "final answer");
  response.resolve({ ok: true, text: "final answer" });
  await run;
  assert.equal(state().messages.at(-1)?.content, "final answer");
  assert.equal(calls.filter((c) => c.method === "ai.saveMessages").at(-1)?.params.messages.at(-1).content, "final answer");
  assert.equal(frames.size, 0, "settled turns release their animation frame");
});

test("empty final payload still persists the last buffered text", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("hello");
  emit("text", "buffered answer");
  response.resolve({ ok: true, text: "" });
  await run;
  assert.equal(state().messages.at(-1)?.content, "buffered answer");
  assert.equal(calls.filter((c) => c.method === "ai.saveMessages").at(-1)?.params.messages.at(-1).content, "buffered answer");
});

test("out-of-order session loads cannot overwrite the selected conversation", async () => {
  const a = deferred();
  const b = deferred();
  handlers.set("ai.loadMessages", ({ sessionId }) => sessionId === "a" ? a.promise : b.promise);
  const first = state().selectSession("a");
  const second = state().selectSession("b");
  b.resolve([{ role: "assistant", content: "B" }]);
  await second;
  a.resolve([{ role: "assistant", content: "A" }]);
  await first;
  assert.equal(state().activeSessionId, "b");
  assert.equal(state().messages[0]?.content, "B");
});

test("a stale session load failure cannot erase a newer conversation", async () => {
  const a = deferred();
  handlers.set("ai.loadMessages", ({ sessionId }) => sessionId === "a" ? a.promise : [{ role: "assistant", content: "B" }]);
  const first = state().selectSession("a");
  await state().selectSession("b");
  a.reject(new Error("bad JSON"));
  await first;
  assert.equal(state().messages[0]?.content, "B");
  assert.equal(state().messagesError, null);
});

test("new conversation cancels the old run and never receives its tail", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("hello");
  emit("text", "old tail");
  const id = await state().createSession();
  response.resolve({ ok: true, text: "old answer" });
  await run;
  assert.notEqual(id, "a");
  assert.equal(state().streaming, false);
  assert.deepEqual(state().messages, []);
  assert.ok(calls.some((c) => c.method === "ai.cancelStream" && c.params.sessionId === "a"));
  const snapshots = calls.filter((c) => c.method === "ai.saveMessages");
  assert.ok(snapshots.every((c) => c.params.sessionId === "a"));
  assert.equal(snapshots.at(-1)?.params.messages.at(-1).content, "old tail");
  assert.equal(snapshots.at(-1)?.params.messages.at(-1).cancelled, true);
  assert.equal(listeners.get("ai:stream")?.size, baselineStreamListeners);
  assert.equal(frames.size, 0);
});

test("pause flushes text and a delayed cancellation cannot reset a newer turn", async () => {
  const old = deferred();
  const cancel = deferred();
  handlers.set("ai.invoke", () => old.promise);
  const run = state().sendMessage("hello");
  emit("text", "partial");
  handlers.set("ai.cancelStream", () => cancel.promise);
  const pause = state().pauseStream();
  assert.equal(state().messages.at(-1)?.content, "partial");
  const next = deferred();
  handlers.set("ai.invoke", () => next.promise);
  const newer = state().sendMessage("next");
  cancel.resolve({ ok: true });
  await pause;
  assert.equal(state().streaming, true);
  emit("text", "new");
  next.resolve({ ok: true, text: "new" });
  await newer;
  old.resolve({ ok: true, text: "old" });
  await run;
  assert.equal(state().messages.at(-1)?.content, "new");
});

test("selecting a different conversation clears paused run state", async () => {
  useAiStore.setState({ paused: true, streamGoal: { goal: "old", plan: [], criteria: [], openCriteria: [], pathReceipts: [], status: "incomplete", autoContinues: 0 } });
  handlers.set("ai.loadMessages", () => []);
  await state().selectSession("b");
  assert.equal(state().paused, false);
  assert.equal(state().streamGoal, null);
});

test("clearing an active run cancels it before removing the session", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("hello");
  await state().clearSession("a");
  response.resolve({ ok: true, text: "late" });
  await run;
  assert.equal(state().activeSessionId, null);
  assert.deepEqual(state().messages, []);
  const cancelledAt = calls.findIndex((c) => c.method === "ai.cancelStream");
  assert.ok(cancelledAt >= 0 && cancelledAt < calls.findIndex((c) => c.method === "ai.clearSession"));
  assert.ok(calls.slice(calls.findIndex((c) => c.method === "ai.clearSession") + 1).every((c) => c.method !== "ai.saveMessages"));
});

test("history loading blocks sends and a failed load remains retryable", async () => {
  const load = deferred();
  handlers.set("ai.loadMessages", () => load.promise);
  const selected = state().selectSession("b");
  assert.equal(state().messagesLoading, true);
  await state().sendMessage("draft");
  assert.ok(!calls.some((c) => c.method === "ai.invoke"));
  load.reject(new Error("bad JSON"));
  await selected;
  assert.equal(state().messagesLoading, false);
  assert.equal(state().messagesError, "bad JSON");
  await state().sendMessage("draft");
  assert.ok(!calls.some((c) => c.method === "ai.invoke"));
  handlers.set("ai.loadMessages", () => [{ role: "assistant", content: "recovered" }]);
  await state().loadMessages("b");
  assert.equal(state().messagesError, null);
  assert.equal(state().messages[0].content, "recovered");
});

test("a burst of 100 deltas publishes once per frame and releases all work", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("hello");
  let updates = 0;
  const unsub = useAiStore.subscribe(() => updates++);
  for (let i = 0; i < 100; i++) emit("text", "x");
  assert.equal(updates, 0);
  assert.equal(frames.size, 1);
  const [id, frame] = [...frames.entries()][0];
  frames.delete(id);
  frame(0);
  assert.equal(updates, 1);
  assert.equal(state().messages.at(-1)?.content, "x".repeat(100));
  response.resolve({ ok: true, text: "x".repeat(100) });
  await run;
  unsub();
  assert.equal(frames.size, 0);
});

test("locally queued follow-ups retain their text and execute in order", async () => {
  const first = deferred();
  let runs = 0;
  handlers.set("ai.invoke", () => ++runs === 1 ? first.promise : { ok: true, text: "done" });
  handlers.set("ai.queueFollowUp", () => ({ ok: false }));
  const run = state().sendMessage("hello");
  await state().sendOrSteer("first queued", "followUp");
  await state().sendOrSteer("second queued", "followUp");
  assert.equal(state().pendingFollowUpCount, 2);
  first.resolve({ ok: true, text: "done" });
  await run;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state().messages.filter((m) => m.role === "user").map((m) => m.content), ["hello", "first queued", "second queued"]);
  assert.equal(runs, 3);
  assert.equal(state().pendingFollowUpCount, 0);
});

test("a late steer acknowledgement cannot send the old prompt into another session", async () => {
  const response = deferred();
  const steer = deferred();
  handlers.set("ai.invoke", () => response.promise);
  handlers.set("ai.steerStream", () => steer.promise);
  handlers.set("ai.loadMessages", () => []);
  const run = state().sendMessage("hello");
  await new Promise((resolve) => setImmediate(resolve));
  const command = state().sendOrSteer("private old prompt");
  await state().selectSession("b");
  steer.resolve({ ok: false });
  await command;
  response.resolve({ ok: true, text: "old" });
  await run;
  assert.deepEqual(state().messages, []);
  assert.equal(calls.filter((c) => c.method === "ai.invoke").length, 1);
});

test("an inactive history request cannot invalidate the active history load", async () => {
  const response = deferred();
  handlers.set("ai.loadMessages", () => response.promise);
  const loading = state().selectSession("b");
  await state().loadMessages("a");
  response.resolve([{ role: "assistant", content: "B" }]);
  await loading;
  assert.equal(state().messages[0]?.content, "B");
  assert.equal(state().messagesLoading, false);
});

test("late mid-turn acknowledgements cannot restart a cancelled conversation", async () => {
  const response = deferred();
  const steer = deferred();
  handlers.set("ai.invoke", () => response.promise);
  handlers.set("ai.steerStream", () => steer.promise);
  const run = state().sendMessage("hello");
  await new Promise((resolve) => setImmediate(resolve));
  const command = state().sendOrSteer("old instruction");
  await state().cancelStream();
  steer.resolve({ ok: false });
  await command;
  response.resolve({ ok: true, text: "late" });
  await run;
  assert.equal(state().streaming, false);
  assert.equal(calls.filter((c) => c.method === "ai.invoke").length, 1);
});

test("workspace release invalidates in-flight messages, sessions and stream completion", async () => {
  const listing = deferred();
  const loading = deferred();
  const response = deferred();
  handlers.set("ai.listSessions", () => listing.promise);
  handlers.set("ai.loadMessages", () => loading.promise);
  handlers.set("ai.invoke", () => response.promise);
  const list = state().loadSessions();
  const load = state().loadMessages("a");
  releaseAiWorkingSet();
  listing.resolve([{ id: "a", title: "old", updatedAt: "" }]);
  loading.resolve([{ role: "assistant", content: "old history" }]);
  await Promise.all([list, load]);
  assert.deepEqual(state().sessions, []);
  assert.deepEqual(state().messages, []);
  assert.equal(state().messagesLoading, false);
  useAiStore.setState({ activeSessionId: "a" });
  const run = state().sendMessage("hello");
  emit("text", "old tail");
  const savedBeforeRelease = calls.filter((c) => c.method === "ai.saveMessages").length;
  releaseAiWorkingSet();
  response.resolve({ ok: true, text: "old answer" });
  await run;
  assert.deepEqual(state().messages, []);
  assert.equal(calls.filter((c) => c.method === "ai.saveMessages").length, savedBeforeRelease);
  assert.equal(frames.size, 0);
});

test("concurrent model catalog refreshes share one network pass", async () => {
  const catalog = deferred();
  const providers = [{ id: "review", name: "Review provider", models: [] }];
  handlers.set("system.discoverModels", () => catalog.promise);
  handlers.set("system.fetchModelsDevCatalog", () => providers);
  handlers.set("system.fetchLiveModels", () => providers);
  const first = state().loadModelCatalog({ silent: true });
  const second = state().loadModelCatalog({ silent: true });
  catalog.resolve(providers);
  assert.deepEqual(await first, providers);
  assert.deepEqual(await second, providers);
  assert.equal(calls.filter((c) => c.method === "system.fetchLiveModels").length, 1);
  assert.equal(calls.filter((c) => c.method === "system.fetchModelsDevCatalog").length, 1);
  assert.equal(calls.filter((c) => c.method === "system.discoverModels").length, 2);
});

test("a stronger manual refresh still fetches the community catalog live", async () => {
  const catalog = deferred();
  const providers = [{ id: "review", name: "Review provider", models: [] }];
  handlers.set("system.discoverModels", () => catalog.promise);
  handlers.set("system.fetchModelsDevCatalog", () => providers);
  handlers.set("system.fetchLiveModels", () => providers);
  const soft = state().loadModelCatalog({ silent: true });
  const forced = state().loadModelCatalog({ forceModelsDev: true, silent: false });
  catalog.resolve(providers);
  await Promise.all([soft, forced]);
  assert.ok(calls.some((c) => c.method === "system.fetchModelsDevCatalog" && c.params.forceLive === true));
  assert.equal(state().modelCatalogLoading, false);
});

test("invalidating provider settings prevents old catalog responses from publishing", async () => {
  const old = deferred();
  const stale = [{ id: "old", name: "Old provider", models: [] }];
  const fresh = [{ id: "new", name: "New provider", models: [] }];
  handlers.set("system.discoverModels", () => old.promise);
  handlers.set("system.fetchModelsDevCatalog", () => []);
  handlers.set("system.fetchLiveModels", () => []);
  const first = state().loadModelCatalog();
  // Let the old pass enter its first request before settings are changed.
  await Promise.resolve();
  state().invalidateModelCatalog();
  handlers.set("system.discoverModels", () => fresh);
  await state().loadModelCatalog();
  old.resolve(stale);
  await first;
  assert.deepEqual(state().modelCatalog, fresh);
  assert.equal(state().modelCatalogLoading, false);
  assert.equal(calls.filter((c) => c.method === "system.fetchLiveModels").length, 1, "invalidated work stops before starting more network requests");
});

test("the user request is durable before invoking a model", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("keep this request");
  await new Promise((resolve) => setImmediate(resolve));
  const savedAt = calls.findIndex((c) => c.method === "ai.saveMessages");
  const invokedAt = calls.findIndex((c) => c.method === "ai.invoke");
  assert.ok(savedAt >= 0 && savedAt < invokedAt);
  assert.deepEqual(calls[savedAt].params.messages.map((m: any) => m.content), ["keep this request"]);
  response.resolve({ ok: true, text: "done" });
  await run;
});

test("paused text and goal survive reloading the conversation", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("work");
  const goal = { goal: "work", plan: ["finish"], criteria: ["saved"], openCriteria: ["saved"], pathReceipts: [], status: "running", autoContinues: 0 };
  useAiStore.setState({ streamGoal: goal });
  emit("text", "received partial");
  await state().pauseStream();
  const saved = calls.filter((c) => c.method === "ai.saveMessages").at(-1)?.params.messages;
  assert.equal(saved?.at(-1).stopReason, "paused");
  assert.equal(saved.at(-1).content, "received partial");
  handlers.set("ai.loadMessages", () => saved);
  await state().selectSession("a");
  assert.equal(state().paused, true);
  assert.equal(state().streamGoal?.goal, "work");
  response.resolve({ ok: true, text: "late" });
  await run;
});

test("a failed initial save keeps the request and prevents model work", async () => {
  handlers.set("ai.saveMessages", () => { throw new Error("disk unavailable"); });
  await state().sendMessage("keep this draft");
  assert.ok(!calls.some((c) => c.method === "ai.invoke"));
  assert.equal(state().messages[0].content, "keep this draft");
  assert.ok(state().messagesSaveError);
  assert.equal(state().streaming, false);
  handlers.set("ai.saveMessages", () => ({ ok: true }));
  await state().retrySaveMessages();
  assert.equal(state().messagesSaveError, null);
});

test("failed final persistence preserves the answer and blocks leaving until saved", async () => {
  let saves = 0;
  handlers.set("ai.saveMessages", () => { if (++saves > 1) throw new Error("disk unavailable"); return { ok: true }; });
  handlers.set("ai.invoke", () => ({ ok: true, text: "finished answer" }));
  await state().sendMessage("question");
  assert.equal(state().messages.at(-1)?.content, "finished answer");
  assert.equal(state().messages.at(-1)?.isError, false);
  await assert.rejects(state().createSession());
  assert.equal(state().activeSessionId, "a");
  assert.equal(state().messages.at(-1)?.content, "finished answer");
  handlers.set("ai.saveMessages", () => ({ ok: true }));
  await state().retrySaveMessages();
  assert.equal(state().messagesSaveError, null);
});

test("failed pause persistence releases streaming while retaining recoverable text", async () => {
  const response = deferred();
  handlers.set("ai.invoke", () => response.promise);
  const run = state().sendMessage("work");
  await new Promise((resolve) => setImmediate(resolve));
  emit("text", "keep partial");
  handlers.set("ai.saveMessages", () => { throw new Error("disk unavailable"); });
  await assert.rejects(state().pauseStream());
  assert.equal(state().streaming, false);
  assert.equal(state().paused, true);
  assert.equal(state().messages.at(-1)?.content, "keep partial");
  assert.ok(state().messagesSaveError);
  handlers.set("ai.saveMessages", () => ({ ok: true }));
  await state().retrySaveMessages();
  response.resolve({ ok: true, text: "late" });
  await run;
  assert.equal(state().messages.at(-1)?.content, "keep partial");
});
