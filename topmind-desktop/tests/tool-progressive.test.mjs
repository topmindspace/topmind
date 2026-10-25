/**
 * Progressive tool exposure — turn-kind gated tool surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterToolsForTurn,
  advertisedToolNames,
  resolveTurnKind,
  prepareTurnResources,
} from "../electron/lib/tool-progressive.mjs";
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "../electron/lib/ai-tool-names.mjs";

const all = {};
for (const n of [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE]) all[n] = { execute: () => ({}) };

test("light turns expose no domain tools", () => {
  assert.equal(resolveTurnKind("hi"), "light");
  const f = filterToolsForTurn(all, "light");
  assert.equal(Object.keys(f).length, 0);
  assert.deepEqual(advertisedToolNames("light"), []);
});

test("query turns expose read tools only — never writes", () => {
  assert.equal(resolveTurnKind("我最近的任务"), "query");
  const f = filterToolsForTurn(all, "query");
  const names = Object.keys(f);
  assert.ok(names.includes("list_todos"));
  assert.ok(names.includes("list_recent_memories"));
  assert.ok(names.includes("web_search"));
  for (const w of AI_TOOL_NAMES_WRITE) {
    assert.ok(!names.includes(w), `query must not expose write tool ${w}`);
  }
  assert.deepEqual(advertisedToolNames("query").sort(), [...AI_TOOL_NAMES_READ].sort());
});

test("task turns expose the full surface", () => {
  assert.equal(resolveTurnKind("把这篇润色并保存"), "task");
  const f = filterToolsForTurn(all, "task");
  assert.equal(Object.keys(f).length, AI_TOOL_NAMES_READ.length + AI_TOOL_NAMES_WRITE.length);
  assert.ok(f.save_file);
  assert.ok(f.list_todos);
});

test("light preparation does not construct tools or read files and profile", async () => {
  const unused = () => assert.fail("greetings must not prefetch workspace resources");
  for (const userText of ["hello", "你好", "谢谢"]) {
    const result = await prepareTurnResources({ userText, enableTools: true, loadFiles: unused, buildTools: unused, loadContext: unused });
    assert.deepEqual(result, { turnKind: "light", files: [], tools: null, context: { overview: "", profile: "", topicContext: "" } });
  }
});

test("task resource preparation starts independent reads concurrently", async () => {
  const started = [];
  let resolveFiles, resolveTools, resolveContext;
  const pending = prepareTurnResources({
    userText: "把这篇文章润色并保存",
    enableTools: true,
    loadFiles: () => { started.push("files"); return new Promise((resolve) => { resolveFiles = resolve; }); },
    buildTools: () => { started.push("tools"); return new Promise((resolve) => { resolveTools = resolve; }); },
    loadContext: () => { started.push("context"); return new Promise((resolve) => { resolveContext = resolve; }); },
  });
  assert.deepEqual(started, ["files", "tools", "context"]);
  const files = [{ name: "note.md", content: "source" }];
  const context = { overview: "categories", profile: "preferences", topicContext: "topic" };
  resolveFiles(files);
  resolveTools(all);
  resolveContext(context);
  const result = await pending;
  assert.equal(result.turnKind, "task");
  assert.equal(result.files, files);
  assert.equal(result.tools, all);
  assert.equal(result.context, context);
});

test("query preparation preserves workspace grounding resources", async () => {
  let reads = 0;
  const result = await prepareTurnResources({ userText: "我最近的任务", enableTools: true,
    loadFiles: async () => { reads++; return []; },
    buildTools: async () => { reads++; return all; },
    loadContext: async () => { reads++; return { overview: "grounded categories", profile: "", topicContext: "" }; },
  });
  assert.equal(result.turnKind, "query");
  assert.equal(result.context.overview, "grounded categories");
  assert.equal(reads, 3);
});

test("explicit no-tools tasks retain mounted files without constructing tools or profile", async () => {
  const files = [{ name: "source.md", content: "source" }];
  const unused = () => assert.fail("disabled tools must not load agent context");
  const result = await prepareTurnResources({ userText: "请总结这篇文章", enableTools: false,
    loadFiles: async () => files, buildTools: unused, loadContext: unused,
  });
  assert.equal(result.files, files);
  assert.equal(result.tools, null);
  assert.equal(result.context.profile, "");
});
