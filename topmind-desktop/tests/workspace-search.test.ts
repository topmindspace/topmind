import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SEARCH, groupSearchResults, searchBucket, startWorkspaceSearch, type WorkspaceSearchState } from "../src/lib/workspace-search";
import type { SearchResponse, SearchResult } from "../src/types";

const result = (relativePath: string) => ({ relativePath, preview: relativePath, nameMatch: false }) as SearchResult;
function deferred() {
  let resolve!: (value: SearchResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SearchResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test("grouped keyboard indexes follow visual order and stay contiguous after filtering", () => {
  const input = [result("88-outputs/final.md"), result("00-inbox/capture.md"), result("memory/profile.md"), result("custom/topic/note.md"), result("weekly/week.md")];
  const grouped = groupSearchResults(input, "all");
  assert.deepEqual(grouped.map((g) => g.bucket), ["stream", "memory", "inbox", "topic", "outputs"]);
  assert.deepEqual(grouped.flatMap((g) => g.items.map((i) => i.flatIdx)), [0, 1, 2, 3, 4]);
  assert.equal(grouped[0].items[0].r.relativePath, "weekly/week.md");
  const filtered = groupSearchResults(input, "outputs");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].items[0].flatIdx, 0);
  assert.equal(filtered[0].items[0].r, input[0]);
  assert.deepEqual(input.map((r) => r.relativePath), ["88-outputs/final.md", "00-inbox/capture.md", "memory/profile.md", "custom/topic/note.md", "weekly/week.md"]);
});

test("custom categories and Windows paths retain searchable presentation buckets", () => {
  assert.equal(searchBucket("custom\\2026-topic\\note.md"), "topic");
  assert.equal(searchBucket("memory\\profile.md"), "memory");
  assert.equal(searchBucket("note.md"), "other");
});

test("debounce sends only the last query and clears old results immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queries: string[] = [];
  const states: WorkspaceSearchState[] = [];
  const search = async (q: string) => { queries.push(q); return { results: [result(q)], count: 1 }; };
  const cancel = startWorkspaceSearch("old", search, (s) => states.push(s));
  cancel();
  startWorkspaceSearch("  new  ", search, (s) => states.push(s));
  assert.deepEqual(states.at(-1), { ...EMPTY_SEARCH, loading: true });
  t.mock.timers.tick(180);
  await tick();
  assert.deepEqual(queries, ["new"]);
  assert.equal(states.at(-1)?.results[0].relativePath, "new");
});

test("clearing the query invalidates a late result including truncation metadata", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred();
  let state = EMPTY_SEARCH;
  const publish = (s: WorkspaceSearchState) => { state = s; };
  const cancel = startWorkspaceSearch("old", () => pending.promise, publish);
  t.mock.timers.tick(180);
  cancel();
  startWorkspaceSearch("", () => pending.promise, publish);
  pending.resolve({ results: [result("old")], count: 1, truncated: true, note: "old note" });
  await tick();
  assert.deepEqual(state, EMPTY_SEARCH);
});

test("out-of-order requests and unmounted overlays cannot publish", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = deferred();
  const b = deferred();
  const states: WorkspaceSearchState[] = [];
  const publish = (s: WorkspaceSearchState) => states.push(s);
  const stopA = startWorkspaceSearch("a", () => a.promise, publish);
  t.mock.timers.tick(180);
  stopA();
  const stopB = startWorkspaceSearch("b", () => b.promise, publish);
  t.mock.timers.tick(180);
  b.resolve({ results: [result("b")], count: 1 });
  await tick();
  a.reject(new Error("old failure"));
  await tick();
  assert.equal(states.at(-1)?.results[0].relativePath, "b");
  stopB();
  const c = deferred();
  const stopC = startWorkspaceSearch("c", () => c.promise, publish);
  t.mock.timers.tick(180);
  const count = states.length;
  stopC();
  c.resolve({ results: [result("c")], count: 1 });
  await tick();
  assert.equal(states.length, count);
});

test("failures differ from an empty match and a retry can recover", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let state = EMPTY_SEARCH;
  const publish = (s: WorkspaceSearchState) => { state = s; };
  startWorkspaceSearch("query", async () => { throw new Error("unavailable"); }, publish);
  t.mock.timers.tick(180);
  await tick();
  assert.equal(state.error, true);
  assert.equal(state.loading, false);
  startWorkspaceSearch("query", async () => ({ results: [], count: 0 }), publish);
  t.mock.timers.tick(180);
  await tick();
  assert.deepEqual(state, EMPTY_SEARCH);
});

test("capped results preserve the honest partial-results notice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let state = EMPTY_SEARCH;
  startWorkspaceSearch("query", async () => ({ results: [result("a")], count: 1, truncated: true, note: "partial" }), (s) => { state = s; });
  t.mock.timers.tick(180);
  await tick();
  assert.equal(state.truncated, true);
  assert.equal(state.note, "partial");
});
