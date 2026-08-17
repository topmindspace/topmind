/**
 * Kernel API surface loads and re-exports writeback / suggest / derived / ai-ops.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as kernel from "../lib/kernel-api.mjs";

describe("kernel-api", () => {
  it("exports version and write gate", () => {
    assert.equal(kernel.KERNEL_API_VERSION, 1);
    assert.equal(typeof kernel.executeWrite, "function");
    assert.equal(typeof kernel.evaluateWritePermission, "function");
    assert.equal(typeof kernel.generateSuggestions, "function");
    assert.equal(typeof kernel.applySuggestion, "function");
    assert.equal(typeof kernel.loadContract, "function");
    assert.equal(typeof kernel.scanLifecycle, "function");
    assert.equal(typeof kernel.applyUniqueSpan, "function");
    assert.equal(typeof kernel.splitAssistantVisible, "function");
    assert.equal(typeof kernel.formatReadWindow, "function");
    assert.equal(typeof kernel.resolveOutputLanguage, "function");
    assert.equal(typeof kernel.resolveAiLocale, "function");
    assert.equal(typeof kernel.resolveAgentOutputLanguage, "function");
    assert.equal(typeof kernel.pickDocumentSourceForOutputLanguage, "function");
    assert.equal(typeof kernel.resolveProductAiLanguage, "function");
  });

  it("exports derived-builder AI provider interface", () => {
    assert.equal(typeof kernel.setAiProvider, "function");
    assert.equal(typeof kernel.getAiProvider, "function");
    assert.equal(typeof kernel.rebuildAllDerived, "function");
  });

  it("exports todo-engine functions", () => {
    assert.equal(typeof kernel.ensureTodoFile, "function");
    assert.equal(typeof kernel.readTodoList, "function");
    assert.equal(typeof kernel.maintainTodos, "function");
    assert.equal(typeof kernel.extractTodosFromStream, "function");
    assert.equal(typeof kernel.getTodoHealth, "function");
  });

  it("exports ai-operation-engine functions", () => {
    assert.equal(typeof kernel.registerOperationType, "function");
    assert.equal(typeof kernel.listOperationTypes, "function");
    assert.equal(typeof kernel.getOperationType, "function");
    assert.equal(typeof kernel.runOperation, "function");
    assert.equal(typeof kernel.getOperationState, "function");
    assert.equal(typeof kernel.clearOperationState, "function");
  });

  it("createKernelContext binds workspace + per-call AI provider", async () => {
    assert.equal(typeof kernel.createKernelContext, "function");
    assert.throws(() => kernel.createKernelContext({}), /workspaceRoot/);

    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-ctx-"));
    try {
      for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      fs.mkdirSync(path.join(ws, "20-专题", "2026-上下文测试"), { recursive: true });
      fs.writeFileSync(path.join(ws, "20-专题", "2026-上下文测试", "note.md"), "# 笔记\n\n一些内容。\n", "utf8");

      const calls = [];
      const ctx = kernel.createKernelContext({
        workspaceRoot: ws,
        aiProvider: {
          generate: async (prompt) => {
            calls.push(prompt);
            return "这是一份由上下文注入 provider 生成的摘要，包含要点若干。";
          },
        },
      });
      assert.equal(ctx.workspaceRoot, ws);
      assert.ok(ctx.contract);

      const generated = await ctx.buildTopicDerived({
        topicPath: path.join(ws, "20-专题", "2026-上下文测试"),
      });
      assert.ok(generated.summary);
      assert.equal(calls.length, 1);
      const summary = fs.readFileSync(generated.summary, "utf8");
      assert.match(summary, /上下文注入 provider 生成/);
      // Module-level singleton untouched
      assert.equal(kernel.getAiProvider().generate.length, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
