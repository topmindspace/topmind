import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadContractRegistry, getCommand, listCommands } from "../../core/contract-registry.mjs";
import { executeTool, previewTool } from "../../core/tool-executor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const execFileAsync = promisify(execFile);

function parseToolData(stdout) {
  const match = stdout.trim().match(/```topmind-result\s*\n([\s\S]*?)\n```/u);
  assert.ok(match, "expected fenced topmind-result output");
  return JSON.parse(match[1]).data;
}

async function createCategoryFirstWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-tool-"));
  const userWorkspaceRoot = path.join(base, "workspace");
  // v3.2: category-first 物理结构
  const categoryDir = path.join(userWorkspaceRoot, "20 研究");
  const topicDir = path.join(categoryDir, "2026-示例专题");
  await fs.mkdir(topicDir, { recursive: true });
  await fs.mkdir(path.join(topicDir, "sections"), { recursive: true });
  await fs.mkdir(path.join(topicDir, "entities", "people"), { recursive: true });
  await fs.mkdir(path.join(userWorkspaceRoot, "00 Inbox"), { recursive: true });
  await fs.mkdir(path.join(userWorkspaceRoot, "99 Archive"), { recursive: true });
  await fs.mkdir(path.join(userWorkspaceRoot, "88 Outputs"), { recursive: true });

  await fs.writeFile(path.join(topicDir, "topic.md"), [
    "---",
    "title: 2026-示例专题",
    "category: 20 研究",
    "topic: 2026-示例专题",
    "status: active",
    "---",
    "# 2026-示例专题",
    "",
    "## Stable Memory",
    "",
    "- Existing memory stays.",
    "",
    "## Next",
    "",
    "- Keep going.",
    "",
  ].join("\n"));

  await fs.writeFile(path.join(topicDir, "sections", "001.md"), [
    "---",
    "title: Opening",
    "status: draft",
    "summary: First scene",
    "---",
    "",
    "# Opening",
    "",
    "Body text.",
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(topicDir, "entities", "people", "owner-a.md"), [
    "# OwnerA",
    "",
    "- 类型：人员",
    "- 状态：draft",
    "",
    "## 备注",
    "",
    "A test entity.",
    "",
  ].join("\n"), "utf8");

  return {
    base,
    userWorkspaceRoot,
    categoryDir,
    topicDir,
    category: "20 研究",
    topic: "2026-示例专题",
    pathContext: { engineRoot: repoRoot, userWorkspaceRoot },
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

test("contract registry loads the eight category-first tool domains", () => {
  assert.equal(registry.toolCount, 8);
  assert.ok(registry.byKind.has("workspace-read"));
  assert.ok(registry.byKind.has("workspace-write"));
  assert.ok(registry.byKind.has("workspace-transform"));
  assert.ok(registry.byKind.has("workspace-maintain"));
  assert.ok(registry.byKind.has("contract"));
  assert.ok(registry.byKind.has("memory"));
  assert.ok(registry.byKind.has("lifecycle"));
  assert.ok(registry.byKind.has("derived"));
  assert.equal(registry.commandCount, 25);
});

test("executeTool blocks workspace-write capture-note without manual review in confirm mode", async () => {
  const tool = registry.byKind.get("workspace-write");
  assert.equal(tool.execution.runtime, "node");
  assert.equal(tool.execution.script, "utr/tools/workspace-write.mjs");

  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Capture", content: "Body", writebackMode: "confirm" },
    pathContext: workspace.pathContext,
    reviewed: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.command, "workspace-write.capture-note");
  assert.equal(result.requiresReview, true);
  assert.equal("requiresApproval" in result, false);
  assert.equal(result.reviewPolicy.policyId, "preview_or_auto");
});

test("executeTool defaults omitted writebackMode to auto and applies omitted dryRun", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Default Auto Capture", content: "Default auto body" },
    pathContext: workspace.pathContext,
    reviewed: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.requiresReview, undefined);
  assert.match(result.displayCommand, /--mode (apply|auto)/u);
  assert.equal(result.parsed.data.created, true);
  assert.ok(result.parsed.data.targetFile.startsWith("20 研究/2026-示例专题/"));

  const saved = path.join(workspace.userWorkspaceRoot, result.parsed.data.targetFile);
  const fileContent = await fs.readFile(saved, "utf8");
  assert.match(fileContent, /Default auto body/u);
});

test("executeTool uses caller writebackMode option when payload omits it", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Option Confirm", content: "Body" },
    pathContext: workspace.pathContext,
    reviewed: false,
    writebackMode: "confirm",
  });

  assert.equal(result.ok, false);
  assert.equal(result.requiresReview, true);
  assert.equal(result.reviewPolicy.policyId, "preview_or_auto");
});

test("executeTool rejects legacy writebackMode batch (no silent map to auto)", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: {
      routing: { category: "20 研究", topic: "2026-示例专题" },
      title: "Batch Reject",
      content: "Body",
      writebackMode: "batch",
    },
    pathContext: workspace.pathContext,
    reviewed: false,
  });

  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.validationErrors));
  assert.match(result.validationErrors.join("\n"), /batch/i);
  assert.match(String(result.stderr || ""), /batch|writebackMode|validation/i);
});

test("executeTool rejects option writebackMode batch", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: {
      routing: { category: "20 研究", topic: "2026-示例专题" },
      title: "Batch Option Reject",
      content: "Body",
    },
    pathContext: workspace.pathContext,
    reviewed: false,
    writebackMode: "batch",
  });

  assert.equal(result.ok, false);
  assert.match((result.validationErrors || []).join("\n"), /batch/i);
});

test("executeTool validates workspace-write required fields", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" } },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, false);
  assert.ok(result.validationErrors.some((error) => error.includes("标题")));
  assert.ok(result.validationErrors.some((error) => error.includes("内容")));
});

test("executeTool refuses to overwrite an existing topic on create-topic apply", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "create-topic",
    payload: { category: "20 研究", topic: "2026-示例专题", title: "2026-示例专题", dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, false);
  assert.match(result.stderr, /专题主页已存在，拒绝覆盖/u);
});

test("executeTool creates a new topic and appends memory to Stable Memory section", async () => {
  const category = "20 研究";
  const topic = "2026-test";

  const createResult = await executeTool({
    registry,
    kind: "workspace-write",
    command: "create-topic",
    payload: { category, topic, title: "测试专题", dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(createResult.ok, true);
  assert.equal(createResult.parsed.data.createdProject, true);
  assert.equal(createResult.parsed.data.topic, topic);

  const topicFile = path.join(workspace.userWorkspaceRoot, category, topic, "topic.md");
  const created = await fs.readFile(topicFile, "utf8");
  assert.match(created, /title: 测试专题/u);
  assert.match(created, /category: 20/u);
  assert.match(created, /## Stable Memory/u);

  const appendResult = await executeTool({
    registry,
    kind: "memory",
    command: "append-topic",
    payload: { slug: topic, content: "核心假设已明确" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(appendResult.ok, true);
  const memoryFile = path.join(workspace.userWorkspaceRoot, "memory", "topics", `${topic}.md`);
  const updated = await fs.readFile(memoryFile, "utf8");
  assert.match(updated, /核心假设已明确/u);
});

test("executeTool writes capture-note after review", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Capture", content: "Body", sourceType: "external-capture", source: "test", topic: "agent-framework", dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, "workspace-write.capture-note");
  const saved = path.join(workspace.userWorkspaceRoot, result.parsed.data.targetFile);
  const content = await fs.readFile(saved, "utf8");
  assert.match(content, /source_type: external-capture/u);
  assert.match(content, /source: test/u);
  assert.match(content, /topic: agent-framework/u);
});

test("capture-note defaults source_type to user-original", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Default Source", content: "Body", dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  const saved = path.join(workspace.userWorkspaceRoot, result.parsed.data.targetFile);
  const content = await fs.readFile(saved, "utf8");
  assert.match(content, /source_type: user-original/u);
});

test("capture-note stores routing metadata and returns category/topic", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Routing", content: "Body", routeConfidence: "high", routeReason: "explicit topic", dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.routing.category, "20 研究");
  assert.equal(result.parsed.data.routing.topic, "2026-示例专题");
  const saved = path.join(workspace.userWorkspaceRoot, result.parsed.data.targetFile);
  const content = await fs.readFile(saved, "utf8");
  assert.match(content, /route_confidence: high/u);
  assert.match(content, /route_reason: explicit topic/u);
});

test("executeTool keeps confirm-mode workspace-write calls in preview mode when dryRun is omitted", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "capture-note",
    payload: { routing: { category: "20 研究", topic: "2026-示例专题" }, title: "Confirm Preview", content: "Body", writebackMode: "confirm" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.created, false);
  assert.equal(result.parsed.data.mode, "preview");
});


test("workspace-transform normalize-note-metadata removes v2.x project_type field", async () => {
  const category = "20 研究";
  const topic = "2026-示例专题";
  // v3.4: notes live at topic root
  const noteFile = path.join(workspace.topicDir, "with-old-meta.md");
  await fs.writeFile(noteFile, [
    "---",
    "title: Old Meta",
    "project_type: 研究",
    "status: active",
    "---",
    "",
    "Old body.",
    "",
  ].join("\n"), "utf8");

  const result = await executeTool({
    registry,
    kind: "workspace-transform",
    command: "normalize-note-metadata",
    payload: { dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  const updated = await fs.readFile(noteFile, "utf8");
  assert.doesNotMatch(updated, /project_type/u);
  assert.match(updated, /title: Old Meta/u);
});

test("workspace-maintain doctor-workspace summarizes workspace hygiene diagnostics", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-maintain",
    command: "doctor-workspace",
    payload: {},
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.parsed.data.slots));
  // WorkspaceModel: slots = discovered FS categories (fixture ≥ buffer/delivery/system)
  assert.ok(result.parsed.data.slots.length >= 3);
});

test("executeTool saves output to a collision-safe path by default", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "save-output",
    payload: { category: "20 研究", topic: "2026-示例专题", title: "Report", content: "Report body", dryRun: false },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  const saved = path.join(workspace.userWorkspaceRoot, result.parsed.data.targetFile);
  const exists = await fs.stat(saved).then(() => true).catch(() => false);
  assert.equal(exists, true);
});

test("executeTool applies full topic replacement in auto mode with reason", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "update-topic",
    payload: {
      category: "20 研究",
      topic: "2026-示例专题",
      content: "# New Body\n\nReplaced content.\n",
      replaceReason: "Restructure body",
      dryRun: false,
      writebackMode: "auto",
    },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.notEqual(result.snapshot, null);
  const topicFile = path.join(workspace.userWorkspaceRoot, "20 研究", "2026-示例专题", "topic.md");
  const updated = await fs.readFile(topicFile, "utf8");
  assert.match(updated, /Replaced content/u);
});

test("executeTool appends stable memory without replacing topic.md", async () => {
  const slug = "2026-append-test";
  const memoryFile = path.join(workspace.userWorkspaceRoot, "memory", "topics", `${slug}.md`);
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, "# 2026-append-test\n\n- Existing memory stays.\n", "utf8");

  const result = await executeTool({
    registry,
    kind: "memory",
    command: "append-topic",
    payload: { slug, content: "新增记忆条目" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  const after = await fs.readFile(memoryFile, "utf8");
  assert.match(after, /新增记忆条目/u);
  assert.match(after, /Existing memory stays/u);
});

test("previewTool builds workspace-maintain high-risk invocation", () => {
  const preview = previewTool(
    registry,
    "workspace-maintain",
    "archive-topic",
    { category: "20 研究", topic: "2026-示例专题", reason: "test", dryRun: true },
    workspace.pathContext,
  );

  assert.equal(preview.ready, true);
  assert.ok(preview.invocationPlan.args.includes("--topic-root"));
  // Use path.join for cross-platform path separator compatibility
  const expectedTopicPath = path.join("20 研究", "2026-示例专题");
  assert.ok(
    preview.invocationPlan.args.some((a) => a.includes(expectedTopicPath) || a.includes("/20 研究/2026-示例专题")),
    `args should contain topic path, got: ${JSON.stringify(preview.invocationPlan.args)}`,
  );
});

test("executeTool applies high-risk archive-topic in auto mode without second review gate", async () => {
  const newCategory = "40 创作";
  const newTopic = "2026-archive-test";
  const newTopicDir = path.join(workspace.userWorkspaceRoot, newCategory, newTopic);
  await fs.mkdir(newTopicDir, { recursive: true });
  await fs.writeFile(path.join(newTopicDir, "topic.md"), "# test\n");

  const result = await executeTool({
    registry,
    kind: "workspace-maintain",
    command: "archive-topic",
    payload: { category: newCategory, topic: newTopic, reason: "archive test", dryRun: false, writebackMode: "auto" },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  // topic should be moved out of category dir
  const exists = await fs.stat(newTopicDir).then(() => true).catch(() => false);
  assert.equal(exists, false);
  // Archive root may be fixture "99 Archive" or role-resolved "99-归档" after prior
  // writeback tests ensure a system-role archive dir — prefer tool-reported target.
  const archiveTarget =
    result.parsed?.data?.archiveTarget
    || result.data?.archiveTarget
    || "";
  assert.match(String(archiveTarget), new RegExp(`${newCategory}-${newTopic}-`));
  const archiveTop = String(archiveTarget).split(/[\\/]/u)[0];
  assert.ok(archiveTop, "archive top-level dir required");
  const archiveContents = await fs.readdir(path.join(workspace.userWorkspaceRoot, archiveTop));
  assert.ok(
    archiveContents.some((entry) => entry.startsWith(`${newCategory}-${newTopic}-`)),
    `expected archived folder under ${archiveTop}, got ${JSON.stringify(archiveContents)}`,
  );
});

test("workspace-maintain restore-safety-receipt previews and restores trash without overwriting", async () => {
  // Legacy top-level trash under 99 Archive/trash/…
  const trashDir = path.join(workspace.userWorkspaceRoot, "99 Archive", "trash", "20 研究", "2026-示例专题");
  await fs.mkdir(trashDir, { recursive: true });
  const trashedFile = path.join(trashDir, "recoverable.md");
  await fs.writeFile(trashedFile, "# Recovered\n");

  const preview = await executeTool({
    registry,
    kind: "workspace-maintain",
    command: "restore-safety-receipt",
    payload: {
      receiptPath: "99 Archive/trash/20 研究/2026-示例专题/recoverable.md",
      reason: "test restore",
      dryRun: true,
    },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.parsed.data.applied, false);
  assert.equal(preview.parsed.data.restorePlan.length, 1);
  // Real destination must be original content path — not archive root as category
  assert.equal(
    preview.parsed.data.restorePlan[0].to,
    "20 研究/2026-示例专题/recoverable.md",
  );
  assert.equal(preview.parsed.data.restorePlan[0].kind, "trash");

  // Kernel layout: 99-归档/backups/trash/…
  const kernelTrashDir = path.join(
    workspace.userWorkspaceRoot,
    "99-归档",
    "backups",
    "trash",
    "10-动态",
  );
  await fs.mkdir(kernelTrashDir, { recursive: true });
  await fs.writeFile(
    path.join(kernelTrashDir, "20260725T120000000Z__stream-note.md"),
    "# stream note\n",
  );
  // Ensure archive root resolves (workspace may already have 99 Archive)
  await fs.mkdir(path.join(workspace.userWorkspaceRoot, "99-归档"), { recursive: true });

  const kernelPreview = await executeTool({
    registry,
    kind: "workspace-maintain",
    command: "restore-safety-receipt",
    payload: {
      receiptPath: "99-归档/backups/trash/10-动态/20260725T120000000Z__stream-note.md",
      reason: "kernel trash restore",
      dryRun: true,
    },
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(kernelPreview.ok, true);
  assert.equal(kernelPreview.parsed.data.restorePlan[0].to, "10-动态/stream-note.md");
  assert.equal(kernelPreview.parsed.data.restorePlan[0].kind, "trash");

  // Auto mode: write restored copy without overwriting an existing file
  const topicDir = path.join(workspace.userWorkspaceRoot, "20 研究", "2026-示例专题");
  await fs.mkdir(topicDir, { recursive: true });
  await fs.writeFile(path.join(topicDir, "recoverable.md"), "# already exists\n");

  const applied = await executeTool({
    registry,
    kind: "workspace-maintain",
    command: "restore-safety-receipt",
    payload: {
      receiptPath: "99 Archive/trash/20 研究/2026-示例专题/recoverable.md",
      reason: "apply restore",
      dryRun: false,
      writebackMode: "auto",
    },
    pathContext: workspace.pathContext,
    reviewed: true,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.parsed.data.applied, true);
  const appliedTo = applied.parsed.data.restorePlan[0].to;
  assert.match(appliedTo, /recoverable-restored-/u);
  assert.equal(
    await fs.readFile(path.join(workspace.userWorkspaceRoot, "20 研究", "2026-示例专题", "recoverable.md"), "utf8"),
    "# already exists\n",
  );
  const restoredBody = await fs.readFile(
    path.join(workspace.userWorkspaceRoot, appliedTo),
    "utf8",
  );
  assert.equal(restoredBody, "# Recovered\n");
});

test("listCommands filters by tool domain", () => {
  const commands = listCommands(registry, { skill: "workspace-read" });
  assert.ok(commands.length >= 7);
  assert.ok(commands.every((c) => c.skill === "workspace-read"));
});

test("workspace-transform plan-inbox-routing returns route suggestions for inbox files", async () => {
  const inboxFile = path.join(workspace.userWorkspaceRoot, "00 Inbox", "inbox-idea.md");
  await fs.writeFile(inboxFile, "# 关于研究的思考\n\n这是一个研究主题。\n");

  const result = await executeTool({
    registry,
    kind: "workspace-transform",
    command: "plan-inbox-routing",
    payload: { limit: 10 },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.ok(result.parsed.data.planCount >= 1);
  const plan = result.parsed.data.plan.find((p) => p.file.endsWith("inbox-idea.md"));
  assert.ok(plan);
  // Should suggest a category based on keyword hints
  assert.ok(plan.suggestedCategory);
});

test("executeTool reports preview-or-auto policy for capture-note", () => {
  const entry = getCommand(registry, "workspace-write", "capture-note");
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.risk_level, "low");
  assert.equal(entry.command.requires_topic, false);
});

test("executeTool reports requires_topic for topic-scoped commands", () => {
  const update = getCommand(registry, "workspace-write", "update-topic");
  assert.equal(update.command.requires_topic, true);
  const archive = getCommand(registry, "workspace-maintain", "archive-topic");
  assert.equal(archive.command.requires_topic, true);
});

test("executeTool outputs workspace-context-driven args for save-output", async () => {
  const result = await executeTool({
    registry,
    kind: "workspace-write",
    command: "save-output",
    payload: { category: "20 研究", topic: "2026-示例专题", title: "Output", content: "Body", dryRun: true },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.ok(result.displayCommand.includes("--topic-root"));
  assert.ok(result.displayCommand.includes("20 研究") && result.displayCommand.includes("2026-示例专题"));
  assert.equal(result.parsed.data.applied || result.parsed.data.created === false, true);
});

test("executeTool preview for migrate-v4 reports v2.x projects/ root detection", async () => {
  const v2Root = path.join(workspace.userWorkspaceRoot, "projects");
  await fs.mkdir(path.join(v2Root, "2026-个人成长-示例项目", "notes"), { recursive: true });
  await fs.writeFile(path.join(v2Root, "2026-个人成长-示例项目", "topic.md"), "# old\n");

  const result = await executeTool({
    registry,
    kind: "workspace-transform",
    command: "migrate-v4",
    payload: { dryRun: true },
    pathContext: workspace.pathContext,
    reviewed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.parsed.data.projectsRootExisted, true);
  assert.ok(result.parsed.data.plan.length >= 1);
  const aiPlan = result.parsed.data.plan.find((p) => p.oldName === "2026-个人成长-示例项目");
  assert.ok(aiPlan);
  // Hyphen-first recommended defaults (WorkspaceModel); space form still accepted on disk
  assert.match(aiPlan.category, /^10[- ]动态$/u);
  assert.match(aiPlan.topic, /^2026-/);
});