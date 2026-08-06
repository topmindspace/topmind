import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadContractRegistry, listCommands } from "../../core/contract-registry.mjs";
import { executeTool, previewTool } from "../../core/tool-executor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

async function createCategoryFirstWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-workspace-read-"));
  const userWorkspaceRoot = path.join(base, "topmind-workspace");
  // v3.4: 10-60 + 88/99 numbering, notes at topic root, 88-输出 flat, 99-归档 numbered
  const topicRootPath = path.join(userWorkspaceRoot, "20 研究", "2026-示例专题");
  const localizedTopicRootPath = path.join(userWorkspaceRoot, "40 创作", "2026-示例创作");
  const inboxDir = path.join(userWorkspaceRoot, "00 收件箱");
  const archiveDir = path.join(userWorkspaceRoot, "99 归档");
  const outputsDir = path.join(userWorkspaceRoot, "88 输出");

  await fs.mkdir(topicRootPath, { recursive: true });
  await fs.mkdir(localizedTopicRootPath, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.mkdir(outputsDir, { recursive: true });

  const progressiveTopicRoot = path.join(userWorkspaceRoot, "10-动态", "2026-渐进式专题");
  await fs.mkdir(progressiveTopicRoot, { recursive: true });
  await fs.writeFile(path.join(progressiveTopicRoot, "draft.md"), "# Draft\n");

  await fs.writeFile(path.join(topicRootPath, "topic.md"), `---
title: 2026-示例专题
status: active
updated: 2026-05-10
---
# 2026-示例专题

Topic body.
`);
  await fs.writeFile(path.join(topicRootPath, "source.md"), "# Source\n");
  await fs.writeFile(path.join(topicRootPath, "20260614-topic-capture.md"), `---
title: Topic Capture
source_type: external-capture
captured_at: 2026-06-14T04:00:00+00:00
route_confidence: high
route_reason: explicit topic
---
# Topic Capture
`);
  // v3.4: outputs go to flat 88 输出/ with topic frontmatter
  await fs.writeFile(path.join(outputsDir, "2026-06-14-2026-示例专题-report.md"), `---
title: Report
category: 20 研究
topic: 2026-示例专题
source_type: ai-derived
---
# Report
`);
  await fs.writeFile(path.join(outputsDir, "2026-06-15-2026-示例专题-report - 修订版.md"), `---
title: Report Revision
category: 20 研究
topic: 2026-示例专题
source_type: ai-derived
---
# Report Revision
`);
  // Optional: keep some legacy sections/article/entities for migration test surface (still flagged as v3.4 should ignore)
  await fs.mkdir(path.join(topicRootPath, "sections"), { recursive: true });
  await fs.mkdir(path.join(topicRootPath, "articles"), { recursive: true });
  await fs.mkdir(path.join(topicRootPath, "entities", "people"), { recursive: true });
  await fs.writeFile(path.join(topicRootPath, "sections", "001.md"), "# Opening\n");
  await fs.writeFile(path.join(topicRootPath, "sections", "001-memo.md"), "# Memo\n");
  await fs.writeFile(path.join(topicRootPath, "articles", "001.md"), "# Article\n");
  await fs.writeFile(path.join(topicRootPath, "articles", "001-memo.md"), "# Article Memo\n");
  await fs.writeFile(path.join(topicRootPath, "entities", "people", "owner-a.md"), "# OwnerA\n");
  await fs.writeFile(path.join(topicRootPath, "entities", "people", "_template.md"), "# Template\n");
  await fs.writeFile(path.join(localizedTopicRootPath, "topic.md"), `---
title: 2026-示例创作
status: active
updated: 2026-05-13
---
# 2026-示例创作

Topic body.
`);
  await fs.writeFile(path.join(localizedTopicRootPath, "设定.md"), "# 设定\n");
  await fs.writeFile(path.join(inboxDir, "capture.md"), "# Capture\n");
  await fs.writeFile(path.join(inboxDir, "20260614-inbox-capture.md"), `---
title: Inbox Capture
source_type: user-original
captured_at: 2026-06-14T05:00:00+00:00
route_confidence: low
route_reason: unclear topic
---
# Inbox Capture
`);
  // v3.4: backups + legacy trash + Kernel trash under backups/trash
  await fs.mkdir(path.join(archiveDir, "backups", "20 研究", "2026-示例专题"), { recursive: true });
  await fs.mkdir(path.join(archiveDir, "trash", "20 研究", "2026-示例专题"), { recursive: true });
  await fs.mkdir(path.join(archiveDir, "backups", "trash", "10-动态"), { recursive: true });
  await fs.mkdir(path.join(archiveDir, "20 研究-2026-示例专题-20260614-060000"), { recursive: true });
  await fs.writeFile(path.join(archiveDir, "backups", "20 研究", "2026-示例专题", "20260614-055900-topic.md"), "# Old Topic\n");
  await fs.writeFile(path.join(archiveDir, "trash", "20 研究", "2026-示例专题", "old.md"), "# Old Note\n");
  await fs.writeFile(
    path.join(archiveDir, "backups", "trash", "10-动态", "20260725T120000000Z__kernel-note.md"),
    "# Kernel trash\n",
  );
  await fs.writeFile(path.join(archiveDir, "20 研究-2026-示例专题-20260614-060000", "topic.md"), "# Archived Topic\n");

  return {
    base,
    pathContext: {
      engineRoot: repoRoot,
      userWorkspaceRoot,
    },
  };
}

let registry;
let workspace;

test.before(async () => {
  registry = await loadContractRegistry();
  workspace = await createCategoryFirstWorkspace();
});

test.after(async () => {
  if (workspace) await fs.rm(workspace.base, { recursive: true, force: true });
});

test("workspace-read commands are exposed as category-first UTR tools", () => {
  const commands = listCommands(registry, { skill: "workspace-read" });
  assert.deepEqual(commands.map((command) => command.command).sort(), [
    "inspect-topic",
    "list-categories",
    "list-inbox",
    "list-recent-captures",
    "list-safety-receipts",
    "list-topic-files",
    "list-topics",
  ]);
  assert.ok(commands.every((command) => command.sourceEngineLabel === "大类与专题读取"));
  assert.ok(commands.every((command) => command.riskLevel === "low"));
});

test("workspace-read runs on the Node UTR runtime", () => {
  const tool = registry.byKind.get("workspace-read");
  assert.equal(tool.execution.runtime, "node");
  assert.equal(tool.execution.script, "utr/tools/workspace-read.mjs");
});

test("workspace-read list-categories discovers dynamic categories", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-categories",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, "workspace-read.list-categories");
  assert.ok(result.displayCommand.includes("node utr/tools/workspace-read.mjs"));
  assert.ok(Array.isArray(result.parsed.data.slots));
  // v3.4: dynamic discovery — fixture creates 00-收件箱 / 10-动态 / 20-研究 / 40-创作 / 88-输出 / 99-归档
  const directories = result.parsed.data.slots.map((s) => s.directory);
  assert.ok(directories.includes("20 研究"), "should discover 20 研究 from fixture");
  assert.ok(directories.includes("40 创作"), "should discover 40 创作 from fixture");
  assert.ok(directories.includes("10-动态"), "should discover 10-动态 from fixture");
  // v3.4 has no "reserved" slots — 06/07/08 reserved slots concept removed
  const reserved = result.parsed.data.slots.filter((s) => s.reserved);
  assert.equal(reserved.length, 0);
});

test("workspace-read list-topics reads {category}/{topic}/topic.md", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topics",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, "workspace-read.list-topics");
  const topics = result.parsed.data.topics;
  const demoTopic = topics.find((t) => t.topic === "2026-示例专题");
  assert.ok(demoTopic);
  assert.equal(demoTopic.category, "20 研究");
  assert.equal(demoTopic.title, "2026-示例专题");
  assert.ok(demoTopic.hasTopicFile);
});

test("workspace-read inspect-topic summarizes notes and outputs", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "inspect-topic",
    payload: { category: "20 研究", topic: "2026-示例专题" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.topic, "2026-示例专题");
  // v3.4: notes live at topic root (source.md + 20260614-topic-capture.md = 2)
  assert.equal(result.parsed.data.metrics.noteCount, 2);
  // outputs are in 88 输出/ (2 entries)
  assert.equal(result.parsed.data.metrics.outputCount, 2);
  // sections/articles/entities are optional, still counted if exist
  assert.equal(result.parsed.data.metrics.sectionCount, 1);
  assert.equal(result.parsed.data.metrics.articleCount, 1);
  assert.equal(result.parsed.data.metrics.memoCount, 2);
  assert.equal(result.parsed.data.metrics.entityCount, 1);
});

test("workspace-read lists topic files and inbox captures", async () => {
  const files = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topic-files",
    payload: { category: "20 研究", topic: "2026-示例专题", scope: "all" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(files.ok, true);
  const rels = files.parsed.data.files.map((file) => file.relativePath).sort();
  // v3.4: notes at topic root (no notes/ subdirectory)
  assert.ok(rels.includes("20 研究/2026-示例专题/source.md"), "source.md should be at topic root");
  assert.ok(rels.includes("20 研究/2026-示例专题/topic.md"));
  // v3.4: outputs at 88-输出/ (flat)
  assert.ok(rels.some((p) => p.startsWith("88 输出/")), "outputs should be in 88 输出/");
  // sections/articles/entities still enumerated if present (legacy fixture kept)
  assert.ok(rels.some((p) => p.endsWith("sections/001-memo.md")));
  assert.ok(rels.some((p) => p.endsWith("articles/001-memo.md")));

  const inbox = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-inbox",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(inbox.ok, true);
  assert.deepEqual(inbox.parsed.data.files.map((file) => file.relativePath).sort(), [
    "00 收件箱/20260614-inbox-capture.md",
    "00 收件箱/capture.md",
  ].sort());
});

test("workspace-read lists recent captures across topics and inbox", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-recent-captures",
    payload: { limit: 5 },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.limit, 5);
  const captures = result.parsed.data.captures;
  assert.ok(captures.find((c) => c.relativePath === "00 收件箱/20260614-inbox-capture.md"));
  // v3.4: notes at topic root
  assert.ok(captures.find((c) => c.relativePath === "20 研究/2026-示例专题/20260614-topic-capture.md"));
  const inbox = captures.find((c) => c.relativePath.startsWith("00 收件箱"));
  assert.equal(inbox.route.confidence, "low");
  const topic = captures.find((c) => c.relativePath.includes("20 研究"));
  assert.equal(topic.sourceType, "external-capture");
});

test("workspace-read lists reversible safety receipts from 99 归档 and revisions", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-safety-receipts",
    payload: { limit: 10 },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.limit, 10);
  const receipts = result.parsed.data.receipts;
  const byType = new Map(receipts.map((item) => [item.type, item]));
  assert.ok(byType.get("backup")?.relativePath.startsWith("99 归档/backups/20 研究/2026-示例专题/"));
  // Legacy trash still classified as trash
  assert.ok(
    receipts.some(
      (r) => r.type === "trash" && r.relativePath.startsWith("99 归档/trash/20 研究/2026-示例专题/"),
    ),
    "legacy top-level trash must be type=trash",
  );
  // Kernel backups/trash must be trash, never backup
  const kernelTrash = receipts.find((r) =>
    r.relativePath.includes("backups/trash/10-动态/"),
  );
  assert.ok(kernelTrash, "expected Kernel backups/trash receipt");
  assert.equal(kernelTrash.type, "trash");
  assert.equal(kernelTrash.category, "10-动态");
  assert.ok(byType.get("archived-topic")?.relativePath.startsWith("99 归档/20 研究-2026-示例专题-20260614-"));
  // revision entry is the output revision file under 88 输出
  assert.ok(byType.get("revision")?.relativePath.startsWith("88 输出/"));
  assert.ok(result.parsed.data.receipts.every((item) => item.recoverable === true));
  assert.ok(result.parsed.data.receipts.every((item) => item.reason));
});

test("workspace-read keeps memo sidecars out of section and article scopes", async () => {
  const sections = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topic-files",
    payload: { category: "20 研究", topic: "2026-示例专题", scope: "sections" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(sections.ok, true);
  assert.deepEqual(sections.parsed.data.files.map((file) => file.relativePath), [
    "20 研究/2026-示例专题/sections/001.md",
  ]);

  const articles = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topic-files",
    payload: { category: "20 研究", topic: "2026-示例专题", scope: "articles" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(articles.ok, true);
  assert.deepEqual(articles.parsed.data.files.map((file) => file.relativePath), [
    "20 研究/2026-示例专题/articles/001.md",
  ]);

  const memos = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topic-files",
    payload: { category: "20 研究", topic: "2026-示例专题", scope: "memos" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(memos.ok, true);
  assert.deepEqual(memos.parsed.data.files.map((file) => file.relativePath).sort(), [
    "20 研究/2026-示例专题/articles/001-memo.md",
    "20 研究/2026-示例专题/sections/001-memo.md",
  ].sort());
});

test("workspace-read accepts localized topic names from existing topic folders", async () => {
  const files = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topic-files",
    payload: { category: "40 创作", topic: "2026-示例创作", scope: "all" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(files.ok, true);
  const rels = files.parsed.data.files.map((file) => file.relativePath);
  // v3.4: notes at topic root
  assert.ok(rels.includes("40 创作/2026-示例创作/设定.md"));
  assert.ok(rels.includes("40 创作/2026-示例创作/topic.md"));
});

test("workspace-read preview uses category-first roots", () => {
  const preview = previewTool(
    registry,
    "workspace-read",
    "inspect-topic",
    { category: "20 研究", topic: "2026-示例专题" },
    workspace.pathContext,
  );

  assert.equal(preview.ready, true);
  assert.ok(preview.invocationPlan.args.includes("--categories-root"));
  assert.ok(preview.invocationPlan.args.includes(path.join(workspace.pathContext.userWorkspaceRoot)));
  assert.equal(preview.invocationPlan.cwd, repoRoot);
});

test("workspace-read inspect-topic accepts topics without topic.md (progressive topic)", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "inspect-topic",
    payload: { category: "10-动态", topic: "2026-渐进式专题" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.metrics.noteCount, 1);
});

test("workspace-read list-topics includes topics without topic.md", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-read",
    command: "list-topics",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  const topics = result.parsed.data.topics;
  const progressive = topics.find((t) => t.topic === "2026-渐进式专题");
  assert.ok(progressive);
  assert.equal(progressive.hasTopicFile, false);
});