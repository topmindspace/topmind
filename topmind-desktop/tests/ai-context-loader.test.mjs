/**
 * AI Context Loader tests — graceful degradation and topic context loading.
 *
 * Tests verify:
 * - loadTopicContext with valid topic.md (truncation, frontmatter stripping)
 * - loadTopicContext with invalid/missing topicId (empty string)
 * - loadAiContext graceful degradation on invalid workspace (all empty strings)
 * - loadAiContext returns object with overview/profile/topicContext keys
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const electronLib = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../electron/lib",
);

let tmpRoot;
let workspace;
let ctx;
let aiContextLoader;

before(async () => {
  aiContextLoader = await import(
    pathToFileURL(path.join(electronLib, "ai-context-loader.mjs")).href
  );
});

beforeEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-ctx-"));
  workspace = {
    engineRoot: path.join(tmpRoot, "engine"),
    userWorkspaceRoot: path.join(tmpRoot, "ws"),
  };
  // Context loader accesses ctx.workspaceRoot (RPC context shape)
  ctx = { workspaceRoot: workspace };
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test("loadTopicContext returns empty string for invalid topicId", async () => {
  assert.equal(await aiContextLoader.loadTopicContext(ctx, ""), "");
  assert.equal(await aiContextLoader.loadTopicContext(ctx, null), "");
  assert.equal(await aiContextLoader.loadTopicContext(ctx, "no-slash"), "");
  assert.equal(await aiContextLoader.loadTopicContext(ctx, "/"), "");
});

test("loadTopicContext returns empty string for missing topic.md", async () => {
  mkdirSync(path.join(workspace.userWorkspaceRoot, "20-研究", "2026-测试"), {
    recursive: true,
  });
  const result = await aiContextLoader.loadTopicContext(ctx, "20-研究/2026-测试");
  assert.equal(result, "");
});

test("loadTopicContext returns content from topic.md", async () => {
  const topicDir = path.join(workspace.userWorkspaceRoot, "20-研究", "2026-测试");
  mkdirSync(topicDir, { recursive: true });
  writeFileSync(
    path.join(topicDir, "topic.md"),
    "---\ntitle: 测试专题\nprotection: open\n---\n# 测试专题\n\n这是专题内容。\n",
  );
  const result = await aiContextLoader.loadTopicContext(ctx, "20-研究/2026-测试");
  assert.ok(result.length > 0);
  assert.ok(result.includes("测试专题"));
  // Frontmatter should be stripped
  assert.ok(!result.includes("protection"));
  assert.ok(!result.startsWith("---"));
});

test("loadTopicContext truncates long content", async () => {
  const topicDir = path.join(workspace.userWorkspaceRoot, "20-研究", "2026-长文");
  mkdirSync(topicDir, { recursive: true });
  const longBody = "A".repeat(5000);
  writeFileSync(path.join(topicDir, "topic.md"), `---\ntitle: 长文\n---\n${longBody}\n`);
  const result = await aiContextLoader.loadTopicContext(ctx, "20-研究/2026-长文");
  assert.ok(result.length < 5000);
  assert.ok(result.includes("…(截断)"));
});

test("loadAiContext returns object with expected keys", async () => {
  const result = await aiContextLoader.loadAiContext(ctx, null);
  assert.equal(typeof result, "object");
  assert.ok("overview" in result);
  assert.ok("profile" in result);
  assert.ok("topicContext" in result);
  // All should be strings (empty on invalid workspace)
  assert.equal(typeof result.overview, "string");
  assert.equal(typeof result.profile, "string");
  assert.equal(typeof result.topicContext, "string");
});

test("loadAiContext graceful degradation on invalid workspace", async () => {
  const badCtx = { workspaceRoot: "/nonexistent/path/that/does/not/exist" };
  const result = await aiContextLoader.loadAiContext(badCtx, null);
  assert.equal(result.overview, "");
  assert.equal(result.profile, "");
  assert.equal(result.topicContext, "");
});

test("loadAiContext loads topic context when topicId is valid", async () => {
  const topicDir = path.join(workspace.userWorkspaceRoot, "20-研究", "2026-上下文");
  mkdirSync(topicDir, { recursive: true });
  writeFileSync(
    path.join(topicDir, "topic.md"),
    "---\ntitle: 上下文测试\n---\n# 上下文测试\n\n有内容。\n",
  );
  const result = await aiContextLoader.loadAiContext(ctx, "20-研究/2026-上下文");
  assert.ok(result.topicContext.length > 0);
  assert.ok(result.topicContext.includes("上下文测试"));
});
