/**
 * ai-operation-engine — registration / state / run / disabled filtering
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const engineRoot = path.resolve(__dirname, "..");
const modPath = path.join(engineRoot, "lib", "ai-operation-engine.mjs");
const mod = await import(pathToFileURL(modPath).href);

const {
  registerOperationType,
  listOperationTypes,
  getOperationType,
  runOperation,
  getOperationState,
  clearOperationState,
  getOpState,
  setOpState,
  clearOpState,
  contentHash,
} = mod;

let tmpDir;

function setupWorkspace() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-aiops-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "topmind.yaml"),
    `version: "4"\nworkspace:\n  template: stream\n`,
    "utf8",
  );
  return tmpDir;
}

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("ai-operation-engine", () => {
  beforeEach(() => {
    setupWorkspace();
  });

  afterEach(() => {
    cleanup();
  });

  describe("registration", () => {
    it("listOperationTypes returns registered types (excludes disabled)", () => {
      const types = listOperationTypes();
      const ids = types.map((t) => t.id);
      // Built-in ops enabled: todo + memory (profile/periodic) + topic (content categories)
      assert.ok(ids.includes("todo_maintain"), "todo_maintain should be listed");
      assert.ok(ids.includes("memory_organize"), "memory_organize should be listed");
      assert.ok(ids.includes("topic_classify"), "topic_classify should be listed");
    });

    it("getOperationType returns definition by id", () => {
      const def = getOperationType("todo_maintain");
      assert.ok(def);
      assert.equal(def.id, "todo_maintain");
      assert.equal(def.domain, "todo");
    });

    it("getOperationType returns undefined for unknown id", () => {
      const def = getOperationType("nonexistent_op");
      assert.equal(def, undefined);
    });

    it("registerOperationType adds new type", () => {
      registerOperationType({
        id: "test_custom_op",
        label: "Test Op",
        domain: "test",
        description: "A test operation",
        requiresConfirm: false,
        async run() {
          return { ok: true, changes: [], summary: "test done" };
        },
      });

      const types = listOperationTypes();
      const ids = types.map((t) => t.id);
      assert.ok(ids.includes("test_custom_op"));
    });

    it("registerOperationType requires id", () => {
      assert.throws(() => {
        registerOperationType({ label: "No ID" });
      }, /requires id/);
    });

    it("disabled type is hidden from listOperationTypes but getOperationType works", () => {
      registerOperationType({
        id: "test_disabled_op",
        label: "Disabled Op",
        domain: "test",
        description: "A disabled operation",
        requiresConfirm: false,
        disabled: true,
        async run() {
          return { ok: true, changes: [], summary: "should not run" };
        },
      });

      const types = listOperationTypes();
      const ids = types.map((t) => t.id);
      assert.ok(!ids.includes("test_disabled_op"));

      const def = getOperationType("test_disabled_op");
      assert.ok(def);
      assert.equal(def.disabled, true);
    });
  });

  describe("runOperation", () => {
    it("returns error for unknown operation", async () => {
      const result = await runOperation({
        id: "nonexistent_op",
        workspaceRoot: tmpDir,
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "unknown-operation");
    });

    it("runs registered operation", async () => {
      registerOperationType({
        id: "test_run_op",
        label: "Run Test",
        domain: "test",
        description: "Test run",
        requiresConfirm: false,
        async run(ctx) {
          return {
            ok: true,
            changes: [{ type: "test", data: ctx.workspaceRoot }],
            summary: "ran successfully",
          };
        },
      });

      const result = await runOperation({
        id: "test_run_op",
        workspaceRoot: tmpDir,
      });
      assert.equal(result.ok, true);
      assert.equal(result.summary, "ran successfully");
      assert.equal(result.changes.length, 1);
    });

    it("catches errors from operation run", async () => {
      registerOperationType({
        id: "test_error_op",
        label: "Error Test",
        domain: "test",
        description: "Test error",
        requiresConfirm: false,
        async run() {
          throw new Error("deliberate failure");
        },
      });

      const result = await runOperation({
        id: "test_error_op",
        workspaceRoot: tmpDir,
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "failed");
      assert.ok(result.summary.includes("deliberate failure"));
    });

    it("memory_organize returns confirm-shaped profile+periodic suggestions (not topics)", async () => {
      fs.mkdirSync(path.join(tmpDir, "10-动态"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "20-专题"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "topmind.yaml"),
        `schema_version: 4
categories:
  - directory: 10-动态
    role: loose-stream
  - directory: 20-专题
    role: deep-work
stream:
  packing: weekly
`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "10-动态", "2026-W31.md"),
        `# 2026-W31\n\n## 记录\n\n- 我偏好用简洁文案写笔记，本周推进了活动窗口设计。\n`.repeat(2),
        "utf8",
      );
      const aiProvider = {
        async generate() {
          return JSON.stringify({
            profile: ["偏好简洁文案"],
            periodic: "本周推进了活动窗口与整理范围合闸。",
          });
        },
      };
      const result = await runOperation({
        id: "memory_organize",
        workspaceRoot: tmpDir,
        engineRoot,
        aiProvider,
        options: { force: true },
      });
      assert.equal(result.ok, true);
      assert.ok(Array.isArray(result.suggestions));
      assert.ok(result.suggestions.length >= 1, "should yield confirm suggestions");
      for (const s of result.suggestions) {
        assert.ok(s.kind === "promote_memory" || s.kind === "ai_summary");
        assert.notEqual(s.kind, "create_topic");
        if (s.kind === "promote_memory") {
          assert.equal(s.payload?.action, "append_profile");
        }
        if (s.kind === "ai_summary") {
          assert.match(String(s.payload?.analysis || s.summary || ""), /活动窗口|本周/u);
        }
      }
      // Must not deposit into memory/topics
      assert.ok(!JSON.stringify(result).includes("memory/topics"));
    });

    it("topic_classify returns create_topic under content category (not memory)", async () => {
      fs.mkdirSync(path.join(tmpDir, "10-动态"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "20-专题"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "topmind.yaml"),
        `schema_version: 4
categories:
  - directory: 10-动态
    role: loose-stream
  - directory: 20-专题
    role: deep-work
stream:
  packing: weekly
`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "10-动态", "2026-W31.md"),
        `# 2026-W31\n\n- 深入研究知识管理活动窗口，准备开一个长期专题。\n`.repeat(3),
        "utf8",
      );
      const year = new Date().getFullYear();
      const aiProvider = {
        async generate() {
          return JSON.stringify([
            {
              category: "20-专题",
              name: `${year}-知识活动窗口`,
              title: "知识活动窗口",
              reason: "反复出现的主题",
            },
          ]);
        },
      };
      const result = await runOperation({
        id: "topic_classify",
        workspaceRoot: tmpDir,
        engineRoot,
        aiProvider,
        options: { force: true },
      });
      assert.equal(result.ok, true);
      assert.ok(result.suggestions?.length >= 1);
      const s = result.suggestions[0];
      assert.equal(s.kind, "create_topic");
      assert.equal(s.payload?.category, "20-专题");
      assert.match(String(s.payload?.name || ""), /^\d{4}-/u);
      assert.ok(!String(s.targetPath || "").startsWith("memory/"));
    });

    it("force option calls clearState before run", async () => {
      let stateCleared = false;
      registerOperationType({
        id: "test_force_op",
        label: "Force Test",
        domain: "test",
        description: "Test force",
        requiresConfirm: false,
        async run() {
          return { ok: true, changes: [], summary: "ran" };
        },
        clearState() {
          stateCleared = true;
        },
      });

      await runOperation({
        id: "test_force_op",
        workspaceRoot: tmpDir,
        options: { force: true },
      });
      assert.equal(stateCleared, true);
    });
  });

  describe("unified state store", () => {
    it("state is stored in .topmind/ (system plane, not memory/)", () => {
      setOpState(tmpDir, "test_state_op", { foo: "bar" });

      const statePath = path.join(tmpDir, ".topmind", "ai-ops.json");
      assert.ok(fs.existsSync(statePath), "state file should be in .topmind/");

      const memPath = path.join(tmpDir, "memory", ".ai-ops.json");
      assert.ok(!fs.existsSync(memPath), "state file should NOT be in memory/");
    });

    it("setOpState / getOpState round-trip", () => {
      setOpState(tmpDir, "test_state_op", { foo: "bar" });
      const state = getOpState(tmpDir, "test_state_op");
      assert.equal(state.foo, "bar");
      assert.ok(state.lastRun);
    });

    it("clearOpState removes all state for an op", () => {
      setOpState(tmpDir, "test_state_op", { foo: "bar" });
      clearOpState(tmpDir, "test_state_op");
      const state = getOpState(tmpDir, "test_state_op");
      assert.deepEqual(state, {});
    });

    it("clearOpState with scope removes specific periods", () => {
      setOpState(tmpDir, "test_state_op", {
        processedPeriods: ["2026-W30", "2026-W29", "2026-W28"],
        contentHashes: { "path/a": "abc123" },
      });
      clearOpState(tmpDir, "test_state_op", { periods: ["2026-W30"] });
      const state = getOpState(tmpDir, "test_state_op");
      assert.ok(!state.processedPeriods.includes("2026-W30"));
      assert.ok(state.processedPeriods.includes("2026-W29"));
    });

    it("clearOpState with scope removes specific paths", () => {
      setOpState(tmpDir, "test_state_op", {
        contentHashes: { "path/a": "abc123", "path/b": "def456" },
      });
      clearOpState(tmpDir, "test_state_op", { paths: ["path/a"] });
      const state = getOpState(tmpDir, "test_state_op");
      assert.equal(state.contentHashes["path/a"], undefined);
      assert.equal(state.contentHashes["path/b"], "def456");
    });
  });

  describe("content hash helpers", () => {
    it("contentHash produces consistent hash", () => {
      const h1 = contentHash("hello world");
      const h2 = contentHash("hello world");
      const h3 = contentHash("hello world!");
      assert.equal(h1, h2);
      assert.notEqual(h1, h3);
    });

  });

  describe("getOperationState / clearOperationState", () => {
    it("getOperationState returns empty for unknown op", () => {
      const state = getOperationState(tmpDir, "nonexistent_op");
      assert.deepEqual(state, {});
    });

    it("getOperationState uses type-specific getState when available", () => {
      // todo_maintain has a getState that reads from todo.md
      // Without todo.md, it should return empty/default state
      const state = getOperationState(tmpDir, "todo_maintain");
      assert.ok(typeof state === "object");
    });

    it("clearOperationState calls type-specific clearState when available", () => {
      // todo_maintain has clearState that modifies todo.md
      // Without todo.md, it should not throw
      assert.doesNotThrow(() => {
        clearOperationState(tmpDir, "todo_maintain");
      });
    });

    it("clearOperationState is safe for unknown op", () => {
      assert.doesNotThrow(() => {
        clearOperationState(tmpDir, "nonexistent_op");
      });
    });
  });
});
