/**
 * AI stream delta coalescer — pure unit tests (no Electron / AI SDK).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeltaCoalescer } from "../electron/lib/stream-delta-coalesce.mjs";

/**
 * Manual clock + schedule for deterministic flush tests.
 */
function makeHarness(intervalMs = 16) {
  /** @type {object[]} */
  const events = [];
  let t = 0;
  /** @type {{ at: number, fn: () => void }[]} */
  const timers = [];
  const coalescer = createDeltaCoalescer({
    intervalMs,
    emit: (e) => events.push(e),
    now: () => t,
    schedule: (fn, ms) => {
      const handle = { at: t + ms, fn };
      timers.push(handle);
      return handle;
    },
    clearSchedule: (id) => {
      const i = timers.indexOf(/** @type {{ at: number, fn: () => void }} */ (id));
      if (i >= 0) timers.splice(i, 1);
    },
  });
  function advance(ms) {
    t += ms;
    const due = timers.filter((x) => x.at <= t);
    for (const d of due) {
      const i = timers.indexOf(d);
      if (i >= 0) timers.splice(i, 1);
      d.fn();
    }
  }
  return { events, coalescer, advance, get t() { return t; } };
}

test("burst of text deltas flushes fewer times than raw deltas", () => {
  const { events, coalescer, advance } = makeHarness(16);
  const parts = ["Hel", "lo", ", ", "world", "!", " ", "more", " tokens"];
  for (const p of parts) coalescer.pushDelta("text", p);
  // Still pending before interval
  assert.equal(events.length, 0);
  advance(16);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "text");
  assert.equal(events[0].delta, parts.join(""));
  const s = coalescer.stats();
  assert.equal(s.deltaCount, parts.length);
  assert.equal(s.flushCount, 1);
  assert.ok(s.flushCount < s.deltaCount);
});

test("final concatenated text equals full input sequence across multiple flushes", () => {
  const { events, coalescer, advance } = makeHarness(10);
  coalescer.pushDelta("text", "a");
  coalescer.pushDelta("text", "b");
  advance(10);
  coalescer.pushDelta("text", "c");
  coalescer.pushDelta("text", "d");
  advance(10);
  coalescer.flush(); // no-op if already flushed
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  assert.equal(text, "abcd");
  assert.ok(events.filter((e) => e.type === "text").length <= 2);
});

test("reasoning and text buffers stay independent", () => {
  const { events, coalescer, advance } = makeHarness(16);
  coalescer.pushDelta("reasoning", "think-1");
  coalescer.pushDelta("text", "say-1");
  coalescer.pushDelta("reasoning", "think-2");
  advance(16);
  const reasoning = events.filter((e) => e.type === "reasoning").map((e) => e.delta).join("");
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  assert.equal(reasoning, "think-1think-2");
  assert.equal(text, "say-1");
});

test("non-delta event flushes pending deltas first", () => {
  const { events, coalescer } = makeHarness(1000);
  coalescer.pushDelta("text", "partial");
  coalescer.pushEvent({ type: "status", status: "calling-tool" });
  assert.equal(events[0].type, "text");
  assert.equal(events[0].delta, "partial");
  assert.equal(events[1].type, "status");
  assert.equal(events[1].status, "calling-tool");
});

test("flush on stream end emits remaining buffer", () => {
  const { events, coalescer } = makeHarness(9999);
  coalescer.pushDelta("text", "tail");
  assert.equal(events.length, 0);
  coalescer.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].delta, "tail");
});

test("empty deltas are ignored", () => {
  const { events, coalescer, advance } = makeHarness(16);
  coalescer.pushDelta("text", "");
  coalescer.pushDelta("text", null);
  advance(16);
  coalescer.flush();
  assert.equal(events.length, 0);
  assert.equal(coalescer.stats().deltaCount, 0);
});

test("intervalMs 0 flushes immediately per push", () => {
  const { events, coalescer } = makeHarness(0);
  coalescer.pushDelta("text", "x");
  coalescer.pushDelta("text", "y");
  assert.equal(events.length, 2);
  assert.equal(events.map((e) => e.delta).join(""), "xy");
});
