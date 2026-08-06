/**
 * Integration tests for MCP server (v3.4).
 *
 * Tests the stdio JSON-RPC transport: initialize, tools/list, tools/call,
 * and the two-phase confirm-mode review flow within a single server process.
 *
 * v3.4 contract: 5 domains × 22 commands (workspace-read / -write / -check / -transform / -maintain).
 * No v2.x commands (create-project / list-projects / archive-project / append-project-memory) — those are removed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverPath = path.join(repoRoot, "utr", "server", "topmind-mcp.mjs");

// ── MCP client helpers ────────────────────────────────────────────────────

let nextId = 0;

function startServer(extraEnv = {}) {
  const serverProc = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });

  const rl = createInterface({ input: serverProc.stdout });
  const requestMap = new Map();

  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      const resolver = requestMap.get(msg.id);
      if (resolver) {
        requestMap.delete(msg.id);
        resolver(msg);
      }
    } catch { /* skip non-JSON lines */ }
  });

  // Collect stderr for debugging
  let stderr = "";
  serverProc.stderr.on("data", (data) => { stderr += data.toString(); });

  return {
    request(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        requestMap.set(id, resolve);
        const req = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
        serverProc.stdin.write(req);

        // Timeout after 10 seconds
        setTimeout(() => {
          if (requestMap.has(id)) {
            requestMap.delete(id);
            reject(new Error(`MCP request ${method} timed out`));
          }
        }, 10000);
      });
    },
    stderr() { return stderr; },
    close() {
      requestMap.clear();
      rl.close();
      serverProc.kill();
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

let client;

test.before(() => {
  client = startServer();
});

test.after(() => {
  if (client) client.close();
});

test("initialize returns server capabilities", async () => {
  const response = await client.request("initialize");
  const result = response.result;

  assert.equal(result.protocolVersion, "2024-11-05");
  assert.ok(result.capabilities.tools);
  assert.equal(result.serverInfo.name, "topmind-mcp");
  assert.ok(result.capabilities.experimental?.reviewSession);
  assert.match(result.capabilities.experimental?.reviewPattern, /review_required/u);
});

test("tools/list returns current v3.4 tool commands", async () => {
  const response = await client.request("tools/list");

  assert.ok(Array.isArray(response.result.tools));
  // Default MCP surface: primary + danger only (17). Full 25 via topmind_MCP_ALL=1.
  const toolCount = response.result.tools.length;
  assert.equal(toolCount, 17, `expected 17 primary+danger MCP tools, got ${toolCount}`);
  assert.ok(!response.result.tools.some((t) => t.name.includes("migrate-categories")), "advanced migrate should be hidden by default");

  // Check MCP tool schema shape for representative v3.4 commands
  const createTopic = response.result.tools.find((t) => t.name === "workspace-write.create-topic");
  assert.ok(createTopic, "expected workspace-write.create-topic");
  assert.ok(createTopic.description.includes("创建专题"));
  assert.equal(createTopic.inputSchema.type, "object");
  assert.ok(createTopic.inputSchema.required.includes("category"));
  assert.ok(createTopic.inputSchema.required.includes("topic"));
  assert.equal(createTopic.inputSchema.properties.category.type, "string");
  assert.equal(createTopic.inputSchema.properties.topic.type, "string");
  assert.equal("default" in createTopic.inputSchema.properties.dryRun, false);
  assert.match(createTopic.inputSchema.properties.dryRun.description, /省略时按保存设置处理/u);

  const captureNote = response.result.tools.find((t) => t.name === "workspace-write.capture-note");
  assert.ok(captureNote, "expected workspace-write.capture-note command to be exposed");
  assert.equal("default" in captureNote.inputSchema.properties.dryRun, false);
  assert.equal(captureNote.inputSchema.properties.writebackMode.default, "auto");
  assert.deepEqual(captureNote.inputSchema.properties.writebackMode.enum, ["auto", "confirm"]);

  const saveOutput = response.result.tools.find((t) => t.name === "workspace-write.save-output");
  assert.ok(saveOutput, "expected workspace-write.save-output command to be exposed");
  assert.equal("default" in saveOutput.inputSchema.properties.dryRun, false);

  const listCategories = response.result.tools.find((t) => t.name === "workspace-read.list-categories");
  assert.ok(listCategories, "expected workspace-read.list-categories command to be exposed");

  const listTopics = response.result.tools.find((t) => t.name === "workspace-read.list-topics");
  assert.ok(listTopics, "expected workspace-read.list-topics command to be exposed");

  const listInbox = response.result.tools.find((t) => t.name === "workspace-read.list-inbox");
  assert.ok(listInbox, "expected workspace-read.list-inbox command to be exposed");
  assert.equal(listInbox.inputSchema.properties.limit.default, 100);

  // Advanced surface is hidden by default
  assert.equal(response.result.tools.find((t) => t.name === "workspace-read.list-recent-captures"), undefined);
  assert.equal(response.result.tools.find((t) => t.name === "workspace-read.list-safety-receipts"), undefined);
  assert.equal(response.result.tools.find((t) => t.name === "workspace-transform.migrate-v4"), undefined);

  const planInbox = response.result.tools.find((t) => t.name === "workspace-transform.plan-inbox-routing");
  assert.ok(planInbox, "expected plan-inbox-routing (primary) to be exposed");

  const restoreSafetyReceipt = response.result.tools.find((t) => t.name === "workspace-maintain.restore-safety-receipt");
  assert.ok(restoreSafetyReceipt, "expected restore-safety-receipt (danger) to be exposed");
  assert.ok(restoreSafetyReceipt.inputSchema.required.includes("receiptPath"));
  assert.equal("default" in restoreSafetyReceipt.inputSchema.properties.dryRun, false);

  const appendProfile = response.result.tools.find((t) => t.name === "memory.append-profile");
  assert.ok(appendProfile, "expected memory.append-profile command to be exposed");
  assert.equal(appendProfile.inputSchema.properties.content.type, "string");

  const appendTopic = response.result.tools.find((t) => t.name === "memory.append-topic");
  assert.ok(appendTopic, "expected memory.append-topic command to be exposed");
  assert.equal(appendTopic.inputSchema.properties.content.type, "string");

  // v2.x and deleted commands must not appear
  assert.equal(response.result.tools.find((t) => t.name === "workspace-write.create-project"), undefined);
  assert.equal(response.result.tools.find((t) => t.name === "workspace-transform.normalize-topic"), undefined);
  assert.equal(response.result.tools.find((t) => t.name === "workspace-maintain.repair-topic-index"), undefined);
  assert.equal(response.result.tools.find((t) => t.name === "workspace-write.append-topic-memory"), undefined);
  assert.equal(response.result.tools.find((t) => t.name === "workspace-write.append-core-memory"), undefined);
});

test("tools/list tools have correct naming convention", async () => {
  const response = await client.request("tools/list");

  for (const tool of response.result.tools) {
    const parts = tool.name.split(".");
    assert.equal(parts.length, 2, `Tool name should be kind.command: ${tool.name}`);
    assert.ok(parts[0].length > 0, `Kind must not be empty: ${tool.name}`);
    assert.ok(parts[1].length > 0, `Command must not be empty: ${tool.name}`);
    assert.ok(tool.inputSchema.type === "object");
  }
});

test("tools/call list-categories returns success", async () => {
  const response = await client.request("tools/call", {
    name: "workspace-read.list-categories",
    arguments: {},
  });

  const content = JSON.parse(response.result.content[0].text);
  assert.equal(content.status, "success");
  assert.equal(content.kind, "workspace-read");
  assert.ok(content.data);
});

test("tools/call with invalid tool returns error", async () => {
  const response = await client.request("tools/call", {
    name: "nonexistent.fake",
    arguments: {},
  });

  assert.ok(response.result.isError);
  const text = response.result.content[0].text;
  assert.match(text, /未知操作命令/u);
  assert.doesNotMatch(text, /未知工具命令/u);
});

test("tools/call with validation errors returns validation_error", async () => {
  const response = await client.request("tools/call", {
    name: "workspace-write.create-topic",
    arguments: {},
  });

  const content = JSON.parse(response.result.content[0].text);
  assert.equal(content.status, "validation_error");
  assert.ok(Array.isArray(content.validationErrors));
});

test("tools/call confirm-mode archive returns review plan without special danger policy", async () => {
  const response = await client.request("tools/call", {
    name: "workspace-maintain.archive-topic",
    arguments: {
      category: "20 研究",
      topic: "2026-demo",
      reason: "done",
      writebackMode: "confirm",
      dryRun: true,
    },
  });

  const content = JSON.parse(response.result.content[0].text);
  assert.equal(content.status, "review_required");
  assert.ok(content.sessionId);
  assert.ok(content.reviewPolicy);
  assert.equal(content.reviewPolicy.policyId, "preview_or_auto");
  assert.equal("hitlPolicy" in content, false);
  assert.ok(content.preview);
  assert.ok(content.preview.invocationPlan);
});

test("tools/call workspace-write auto mode bypasses review request", async () => {
  const response = await client.request("tools/call", {
    name: "workspace-write.capture-note",
    arguments: {
      routing: { category: "10-动态" },
      title: "MCP Auto Capture",
      content: "Auto mode should not ask for review.",
      writebackMode: "auto",
      dryRun: true,
    },
  });

  const content = JSON.parse(response.result.content[0].text);
  assert.notEqual(content.status, "review_required");
  assert.equal(content.status, "success");
});

test("tools/call omitted writebackMode uses auto by default", async () => {
  const response = await client.request("tools/call", {
    name: "workspace-write.capture-note",
    arguments: {
      routing: { category: "10-动态" },
      title: "MCP Default Auto Capture",
      content: "Default auto mode should not ask for review.",
      dryRun: true,
    },
  });

  const content = JSON.parse(response.result.content[0].text);
  assert.notEqual(content.status, "review_required");
  assert.equal(content.status, "success");
});

test("tools/call omitted writebackMode honors topmind_WRITEBACK_MODE", async () => {
  const confirmClient = startServer({ topmind_WRITEBACK_MODE: "confirm" });
  try {
    await confirmClient.request("initialize");
    const response = await confirmClient.request("tools/call", {
      name: "workspace-write.capture-note",
      arguments: {
        routing: { category: "10-动态" },
        title: "MCP Env Confirm",
        content: "Env confirm should request review.",
        dryRun: true,
      },
    });

    const content = JSON.parse(response.result.content[0].text);
    assert.equal(content.status, "review_required");
    assert.equal(content.reviewPolicy.policyId, "preview_or_auto");
  } finally {
    confirmClient.close();
  }
});

test("tools/call executes reviewed tool on second call with _reviewed and _sessionId", async () => {
  // First call: get review session.
  const firstResponse = await client.request("tools/call", {
    name: "workspace-maintain.archive-topic",
    arguments: {
      category: "20 研究",
      topic: "2026-demo",
      reason: "done",
      writebackMode: "confirm",
      dryRun: true,
    },
  });

  const reviewContent = JSON.parse(firstResponse.result.content[0].text);
  assert.equal(reviewContent.status, "review_required");
  const sessionId = reviewContent.sessionId;

  // Second call: execute after review
  const secondResponse = await client.request("tools/call", {
    name: "workspace-maintain.archive-topic",
    arguments: {
      category: "20 研究",
      topic: "2026-demo",
      reason: "done",
      writebackMode: "confirm",
      dryRun: true,
      _reviewed: true,
      _sessionId: sessionId,
    },
  });

  const executeContent = JSON.parse(secondResponse.result.content[0].text);
  // Should be either success or error (file doesn't exist is expected in test)
  assert.ok(
    executeContent.status === "success" || executeContent.status === "error"
  );
  // Should NOT be review_required.
  assert.notEqual(executeContent.status, "review_required");
});

test("tools/call with expired session returns error", async () => {
  const response = await client.request("tools/call", {
    name: "workspace-maintain.archive-topic",
    arguments: {
      category: "20 研究",
      topic: "2026-demo",
      reason: "done",
      writebackMode: "confirm",
      _reviewed: true,
      _sessionId: "00000000-0000-0000-0000-000000000000",
    },
  });

  const content = JSON.parse(response.result.content[0].text);
  assert.ok(response.result.isError || content.message?.includes("过期"));
});