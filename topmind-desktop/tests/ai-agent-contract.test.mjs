/**
 * AI agent contract: tool names, system prompt alignment, process hygiene.
 * Does not import electron-bound modules (workspace-service).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "../electron/ai-prompts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const READ_TOOLS = [
  "list_skills",
  "load_skill",
  "load_skill_resource",
  "workspace_overview",
  "list_categories",
  "list_topics",
  "list_topic_files",
  "get_topic",
  "read_file",
  "search",
  "list_inbox",
  "list_outputs",
  "fetch_url",
  "workspace_health",
];
const WRITE_TOOLS = [
  "capture_to_inbox",
  "save_note",
  "save_file",
  "edit_file",
  "create_topic",
  "append_topic_memory",
  "append_core_memory",
  "reconcile_week",
  "move_to_topic",
  "publish_to_outputs",
  "delete_path",
  "rename_path",
];

test("system prompt injects pre-loaded workspace context when provided", () => {
  const prompt = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    toolNames: ["list_categories"],
    workspaceOverview: "20-研究 (deep-work) 3 专题\n10-动态 [flat-default]",
    memoryProfile: "偏好：简洁优先\n当前目标：完成 Q3 报告",
    topicContext: "# 2026-示例\n稳定结论：架构已定",
  });
  assert.match(prompt, /工作区上下文/);
  assert.match(prompt, /类别概览/);
  assert.match(prompt, /20-研究.*deep-work.*3 专题/);
  assert.match(prompt, /我的情况/);
  assert.match(prompt, /偏好：简洁优先/);
  assert.match(prompt, /当前专题/);
  assert.match(prompt, /架构已定/);
  // Should tell agent not to call list_categories
  assert.match(prompt, /无需再 list_categories/);
});

test("system prompt does not include context section when not provided", () => {
  const prompt = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    toolNames: ["list_categories"],
  });
  assert.doesNotMatch(prompt, /工作区上下文/);
  assert.match(prompt, /类别用 `list_categories`/);
});

test("system prompt lists actual snake_case tools, not UTR hyphen names", () => {
  const names = [...READ_TOOLS, ...WRITE_TOOLS];
  const prompt = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    topicId: "20-研究/2026-示例",
    mountedFiles: [],
    writebackMode: "auto",
    toolNames: names,
  });
  assert.match(prompt, /list_categories/);
  assert.match(prompt, /capture_to_inbox/);
  assert.match(prompt, /append_topic_memory/);
  assert.match(prompt, /publish_to_outputs/);
  assert.doesNotMatch(prompt, /`- list-categories`/);
  assert.doesNotMatch(prompt, /`- capture-note`/);
  assert.doesNotMatch(prompt, /normalize-topic/);
  assert.match(prompt, /skill-first|load_skill/i);
  assert.match(prompt, /不启动外部进程|不编造工具名|不启动外部/i);
  assert.match(prompt, /edit_file/i);
  assert.match(prompt, /Archive|不进/i);
  assert.match(prompt, /read_file|分页/i);
  assert.match(prompt, /search/i);
  assert.match(prompt, /质量|少问多做|结论/i);
  assert.match(prompt, /topic\.md/i);
  assert.match(prompt, /INDEX|留痕|append_topic_memory/i);
});

test("ai-tools.mjs defines full agent surface (source contract)", () => {
  const src = readFileSync(path.join(root, "electron/ai-tools.mjs"), "utf8");
  for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) {
    assert.match(src, new RegExp(`tools\\.${name}\\s*=`), `missing tool ${name}`);
  }
  assert.match(src, /export.*AI_TOOL_NAMES_READ/);
  assert.match(src, /export.*AI_TOOL_NAMES_WRITE/);
  assert.match(src, /readPathWindow|editPath/);
  assert.match(src, /grepWorkspace|normalizeWriteResult/);
  // No child_process / BrowserWindow in tool path
  assert.doesNotMatch(src, /child_process|BrowserWindow|spawn\(/);
});

test("ai-stream is multi-step agent with tool-call events and steer", () => {
  const src = readFileSync(path.join(root, "electron/ai-stream.mjs"), "utf8");
  assert.match(src, /DEFAULT_MAX_AGENT_STEPS|maxAgentSteps/);
  assert.match(src, /stepCountIs\(agentSteps\)|stepCountIs\(/);
  assert.match(src, /type: "tool-call"/);
  assert.match(src, /type: "tool-result"/);
  assert.match(src, /prepareStep/);
  assert.match(src, /drainSteers|steer\(/);
  assert.match(src, /followUp|drainFollowUps/);
  assert.match(src, /summarizeToolOutput/);
});

test("ai-service defaults useTools on and builds prompt with tool names", () => {
  const src = readFileSync(path.join(root, "electron/ai-service.mjs"), "utf8");
  assert.match(src, /useTools !== false/);
  assert.match(src, /toolNames/);
  assert.match(src, /buildSystemPrompt/);
  assert.match(src, /maxAgentSteps/);
  assert.match(src, /compactMessagesForModel/);
  assert.match(src, /steerStream|queueFollowUp/);
});

test("session compact keeps recent turns and summarizes middle", async () => {
  const { compactMessagesForModel, estimateTokens } = await import("../electron/lib/ai-session-compact.mjs");
  assert.ok(estimateTokens("你好世界") >= 2);
  assert.ok(estimateTokens("hello world") >= 2);

  const msgs = [];
  for (let i = 0; i < 40; i++) {
    msgs.push({ role: "user", content: `用户问题 ${i} 详细内容略` });
    msgs.push({
      role: "assistant",
      content: `助手回答 ${i} `.repeat(20),
      toolCalls: i % 5 === 0
        ? [{ name: "edit_file", summary: `edit · 20-研究/2026-示例/note.md`, status: "done" }]
        : undefined,
    });
  }
  const r = compactMessagesForModel(msgs, { maxMessages: 20, keepRecent: 8, maxChars: 20000 });
  assert.equal(r.compacted, true);
  assert.ok(r.messages.length < msgs.length);
  assert.ok(r.messages.length >= 8);
  assert.ok(typeof r.estimatedTokens === "number" && r.estimatedTokens > 0);
  // Last user turn preserved
  assert.match(r.messages[r.messages.length - 2]?.content || r.messages.at(-1)?.content || "", /用户问题|助手回答/);
  // Tool timeline flattened into assistant body when present on recent msgs
  const withTools = compactMessagesForModel([
    { role: "user", content: "改一下" },
    {
      role: "assistant",
      content: "完成",
      toolCalls: [{ name: "edit_file", summary: "20-研究/x.md", status: "done" }],
    },
  ], { maxMessages: 10, keepRecent: 4 });
  assert.match(withTools.messages.at(-1)?.content || "", /本轮工具|edit_file/);
});

test("ai-tool-evidence normalizes write receipts and summaries", async () => {
  const { normalizeWriteResult, summarizeToolOutput } = await import("../electron/lib/ai-tool-evidence.mjs");
  const n = normalizeWriteResult("edit_file", {
    operation: "edit",
    targetPath: "20-研究/2026-a/note.md",
    backupPath: "99-归档/backups/x",
    replacements: 1,
  });
  assert.equal(n.ok, true);
  assert.equal(n.tool, "edit_file");
  assert.ok(Array.isArray(n.affectedFiles));
  const s = summarizeToolOutput("edit_file", n);
  assert.match(s, /edit|note\.md|备份/u);
});

test("main process prevents dual BrowserWindow / dual dock identity", () => {
  const src = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
  assert.match(src, /setName\(["']topmind["']\)/);
  assert.match(src, /destroying non-main BrowserWindow|win\.destroy\(\)/);
  assert.match(src, /setWindowOpenHandler/);
  assert.match(src, /mainWindow\.focus\(\)/);
  // Ephemeral SPA render windows must be allowlisted (not dock icons)
  assert.match(src, /isEphemeralBrowserWindow|ephemeral/);
  // Cross-OS: chromium flags before ready; Linux safeStorage + desktop name
  assert.match(src, /applyChromiumCompatibilityFlags/);
  assert.match(src, /safeStorage\.isEncryptionAvailable/);
  assert.match(src, /setDesktopName|isLinux/);
  // Branding: Dock/taskbar via app-icon helper (not stock Electron identity)
  assert.match(src, /applyBrandingIcon|applyAppIcon|app-icon/);
  assert.match(src, /applyWindowIcon|setIcon/);
  assert.match(src, /com\.topmindspace\.topmind/);
});

test("enhanced URL render is isolated from main dock windows", () => {
  const render = readFileSync(path.join(root, "electron/lib/fetch-render.mjs"), "utf8");
  assert.match(render, /markEphemeralBrowserWindow/);
  assert.match(render, /skipTaskbar:\s*true/);
  assert.match(render, /offscreen:\s*true/);
  const ephemeral = readFileSync(path.join(root, "electron/lib/ephemeral-windows.mjs"), "utf8");
  assert.match(ephemeral, /WeakSet/);
});

test("AI UI surfaces tool timeline, skill slash, and mid-turn steer", () => {
  assert.ok(existsSync(path.join(root, "src/components/ai/ChatMessage.tsx")));
  const chat = readFileSync(path.join(root, "src/components/ai/ChatMessage.tsx"), "utf8");
  assert.match(chat, /ToolCallTimeline|toolCalls/);
  assert.match(chat, /edit_file|steering/);
  const input = readFileSync(path.join(root, "src/components/ai/ChatInput.tsx"), "utf8");
  assert.match(input, /\/capture/);
  assert.match(input, /sendOrSteer|followUp/);
  const store = readFileSync(path.join(root, "src/stores/ai-store.ts"), "utf8");
  assert.match(store, /streamToolCalls/);
  assert.match(store, /agentEnabled/);
  assert.match(store, /sendOrSteer/);
  assert.match(store, /lastSteerPreview|pendingFollowUpCount/);
});
