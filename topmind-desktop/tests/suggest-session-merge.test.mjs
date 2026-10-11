/**
 * Soft refresh must not wipe session suggestions when kernel returns empty.
 * Drives shipped mergeSuggestRefreshItems (real path ActionStore uses).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSuggestRefreshItems } from "../src/lib/suggest-session-merge.ts";

test("soft refresh with empty kernel keeps previous session suggestions", () => {
  const sessionCache = new Map();
  const opCache = new Map();
  const dismissed = new Set();
  const applied = new Set();

  // First paint: kernel returned one item
  const first = mergeSuggestRefreshItems({
    pending: [],
    kernelSuggestions: [
      {
        id: "promote-1",
        kind: "promote_memory",
        title: "写入我的情况",
        summary: "stable fact",
        impact: "high",
      },
    ],
    sessionCache,
    opCache,
    dismissed,
    applied,
    soft: true,
  });
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "promote-1");
  assert.ok(sessionCache.has("promote-1"));

  // Soft poll: kernel empty (fingerprint skip) — must not vanish
  const second = mergeSuggestRefreshItems({
    pending: [],
    kernelSuggestions: [],
    sessionCache,
    opCache,
    dismissed,
    applied,
    previousItems: first,
    soft: true,
  });
  assert.equal(second.length, 1, "soft empty regenerate must preserve session item");
  assert.equal(second[0].id, "promote-1");
});

test("force refresh does not revive from previous when caches cleared", () => {
  const sessionCache = new Map();
  const opCache = new Map();
  const dismissed = new Set();
  const applied = new Set();
  const prev = [
    {
      id: "old",
      source: "suggestion",
      title: "old",
      summary: "x",
      priority: "medium",
    },
  ];
  // soft=false + empty kernel + empty caches → empty list
  const out = mergeSuggestRefreshItems({
    pending: [],
    kernelSuggestions: [],
    sessionCache,
    opCache,
    dismissed,
    applied,
    previousItems: prev,
    soft: false,
  });
  assert.equal(out.length, 0);
});

test("dismissed and applied are excluded", () => {
  const sessionCache = new Map([
    [
      "a",
      { id: "a", title: "A", summary: "a", impact: "low" },
    ],
    [
      "b",
      { id: "b", title: "B", summary: "b", impact: "high" },
    ],
  ]);
  const dismissed = new Set(["a"]);
  const applied = new Set(["b"]);
  const out = mergeSuggestRefreshItems({
    pending: [],
    kernelSuggestions: [],
    sessionCache,
    opCache: new Map(),
    dismissed,
    applied,
    soft: true,
    previousItems: [
      { id: "a", source: "suggestion", title: "A", summary: "a" },
      { id: "b", source: "suggestion", title: "B", summary: "b" },
    ],
  });
  assert.equal(out.length, 0);
});

test("pending writes always included and rank high", () => {
  const out = mergeSuggestRefreshItems({
    pending: [{ id: "pw1", relativePath: "memory/profile.md" }],
    kernelSuggestions: [
      { id: "s1", title: "low", summary: "x", impact: "low" },
    ],
    sessionCache: new Map(),
    opCache: new Map(),
    dismissed: new Set(),
    applied: new Set(),
    soft: true,
  });
  assert.equal(out[0].source, "pending_write");
  assert.equal(out.length, 2);
});

test("op cache merges with session", () => {
  const opCache = new Map([
    [
      "topic-1",
      {
        id: "topic-1",
        kind: "create_topic",
        title: "专题",
        summary: "x",
        impact: "high",
      },
    ],
  ]);
  const out = mergeSuggestRefreshItems({
    pending: [],
    kernelSuggestions: [],
    sessionCache: new Map(),
    opCache,
    dismissed: new Set(),
    applied: new Set(),
    soft: true,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].suggestionKind, "create_topic");
});
