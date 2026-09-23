/**
 * todo-engine — parse / write / add / toggle / delete / extract / cleanup / health
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

// Resolve engine lib from topmind root (topmind-desktop/tests/ → topmind/lib/)
const engineRoot = path.resolve(__dirname, "../..");
const todoEnginePath = path.join(engineRoot, "lib", "todo-engine.mjs");
const mod = await import(pathToFileURL(todoEnginePath).href);

const {
  ensureTodoFile,
  readTodoList,
  addTodoItem,
  toggleTodoItem,
  updateTodoItem,
  deleteTodoItem,
  clearCompleted,
  writeTodoList,
  setTodoDueDate,
  getTodoHealth,
  cleanupStaleTodos,
  archiveStaleTodos,
  snapshotTodoList,
  matchTodoMaintainText,
  maintainTodos,
  TODO_REL_PATH,
} = mod;

let tmpDir;

function setupWorkspace() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-todo-test-"));
  // Minimal contract file so loadContract doesn't fail
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

describe("todo-engine", () => {
  beforeEach(() => {
    setupWorkspace();
  });

  afterEach(() => {
    cleanup();
  });

  it("ensureTodoFile creates the file with seed content", () => {
    const result = ensureTodoFile(tmpDir);
    assert.equal(result.created, true);
    assert.ok(fs.existsSync(result.absPath));
    const content = fs.readFileSync(result.absPath, "utf8");
    assert.match(content, /title: 我的待办/);
    assert.match(content, /# 我的待办/);
    // Should have processed_periods and dismissed in frontmatter
    assert.match(content, /processed_periods:/);
    assert.match(content, /dismissed:/);
  });

  it("ensureTodoFile is idempotent", () => {
    ensureTodoFile(tmpDir);
    const result = ensureTodoFile(tmpDir);
    assert.equal(result.created, false);
  });

  it("readTodoList returns null when file doesn't exist", () => {
    const result = readTodoList(tmpDir);
    assert.equal(result, null);
  });

  it("addTodoItem adds a new item", () => {
    ensureTodoFile(tmpDir);
    const result = addTodoItem(tmpDir, "买牛奶");
    assert.equal(result.ok, true);
    assert.ok(result.item);
    assert.equal(result.item.text, "买牛奶");
    assert.equal(result.item.done, false);
    // Should have createdAt
    assert.ok(result.item.createdAt);

    const list = readTodoList(tmpDir);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].text, "买牛奶");
    assert.ok(list.items[0].createdAt);
  });

  it("addTodoItem deduplicates by text content", () => {
    ensureTodoFile(tmpDir);
    addTodoItem(tmpDir, "买牛奶");
    const result = addTodoItem(tmpDir, "买牛奶");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "duplicate");
  });

  it("addTodoItem with source metadata", () => {
    ensureTodoFile(tmpDir);
    const result = addTodoItem(tmpDir, "完成报告", {
      source: "ai",
      sourcePeriod: "2026-W30",
    });
    assert.equal(result.ok, true);
    assert.equal(result.item.source, "ai");
    assert.equal(result.item.sourcePeriod, "2026-W30");

    // Verify metadata is written as HTML comment
    const list = readTodoList(tmpDir);
    assert.equal(list.items[0].source, "ai");
    assert.equal(list.items[0].sourcePeriod, "2026-W30");
  });

  it("toggleTodoItem marks done and undoes", () => {
    ensureTodoFile(tmpDir);
    const added = addTodoItem(tmpDir, "写测试");
    assert.equal(added.item.done, false);

    const toggled = toggleTodoItem(tmpDir, added.item.id);
    const doneItem = toggled.items.find((i) => i.id === added.item.id);
    assert.equal(doneItem.done, true);
    // Should have completedAt when done
    assert.ok(doneItem.completedAt);

    const toggledBack = toggleTodoItem(tmpDir, added.item.id);
    const undoneItem = toggledBack.items.find((i) => i.id === added.item.id);
    assert.equal(undoneItem.done, false);
    // completedAt should be cleared when un-toggled
    assert.equal(undoneItem.completedAt, undefined);
  });

  it("updateTodoItem changes text", () => {
    ensureTodoFile(tmpDir);
    const added = addTodoItem(tmpDir, "旧文本");
    const result = updateTodoItem(tmpDir, added.item.id, "新文本");
    assert.equal(result.ok, true);
    const item = result.items.find((i) => i.text === "新文本");
    assert.ok(item);
  });

  it("setTodoDueDate sets and clears due date", () => {
    ensureTodoFile(tmpDir);
    const added = addTodoItem(tmpDir, "带截止日期的任务");
    assert.equal(added.item.dueDate, undefined);

    // Set due date
    const set1 = setTodoDueDate(tmpDir, added.item.id, "2026-12-31");
    const item1 = set1.items.find((i) => i.id === added.item.id);
    assert.equal(item1.dueDate, "2026-12-31");

    // Clear due date
    const set2 = setTodoDueDate(tmpDir, added.item.id, null);
    const item2 = set2.items.find((i) => i.id === added.item.id);
    assert.equal(item2.dueDate, undefined);
  });

  it("deleteTodoItem removes an item and adds to dismissed", () => {
    ensureTodoFile(tmpDir);
    const a = addTodoItem(tmpDir, "任务A");
    addTodoItem(tmpDir, "任务B");
    assert.equal(readTodoList(tmpDir).items.length, 2);

    const result = deleteTodoItem(tmpDir, a.item.id);
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].text, "任务B");

    // Check dismissed list contains the deleted item's ID
    const list = readTodoList(tmpDir);
    assert.ok(list.dismissed.includes(a.item.id));
  });

  it("addTodoItem respects dismissed list — won't re-add deleted items", () => {
    ensureTodoFile(tmpDir);
    const added = addTodoItem(tmpDir, "被删除的任务");
    deleteTodoItem(tmpDir, added.item.id);

    // Try to re-add the same text — should be blocked
    const reAdd = addTodoItem(tmpDir, "被删除的任务");
    assert.equal(reAdd.ok, false);
    assert.equal(reAdd.reason, "dismissed");
  });

  it("clearCompleted removes all done items", () => {
    ensureTodoFile(tmpDir);
    const a = addTodoItem(tmpDir, "任务A");
    const b = addTodoItem(tmpDir, "任务B");
    toggleTodoItem(tmpDir, a.item.id);
    toggleTodoItem(tmpDir, b.item.id);

    const result = clearCompleted(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.cleared, 2);
    assert.equal(result.items.length, 0);
  });

  it("writeTodoList preserves frontmatter and reorders active first", () => {
    ensureTodoFile(tmpDir);
    addTodoItem(tmpDir, "未完成");
    addTodoItem(tmpDir, "已完成");
    const items = readTodoList(tmpDir).items;
    const doneId = items.find((i) => i.text === "已完成").id;
    toggleTodoItem(tmpDir, doneId);

    const list = readTodoList(tmpDir);
    // Active should come first
    assert.equal(list.items[0].text, "未完成");
    assert.equal(list.items[0].done, false);
    assert.equal(list.items[1].text, "已完成");
    assert.equal(list.items[1].done, true);

    // Check raw content has "## 已完成" section
    assert.match(list.rawContent, /## 已完成/);
  });

  it("parses manually edited markdown checkboxes", () => {
    ensureTodoFile(tmpDir);
    const todoPath = path.join(tmpDir, TODO_REL_PATH);
    fs.writeFileSync(todoPath, `---
title: 我的待办
memory_layer: global
protection: open
processed_periods: []
dismissed: []
---

# 我的待办

- [ ] 手动任务1
- [x] 已完成的手动任务
- [ ] 手动任务2
`, "utf8");

    const list = readTodoList(tmpDir);
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0].text, "手动任务1");
    assert.equal(list.items[0].done, false);
    assert.equal(list.items[1].text, "已完成的手动任务");
    assert.equal(list.items[1].done, true);
    assert.equal(list.items[2].text, "手动任务2");
    assert.equal(list.items[2].done, false);
  });

  it("handles empty todo list", () => {
    ensureTodoFile(tmpDir);
    const list = readTodoList(tmpDir);
    assert.equal(list.items.length, 0);
  });

  it("readTodoList returns processedPeriods and dismissed from frontmatter", () => {
    ensureTodoFile(tmpDir);
    const todoPath = path.join(tmpDir, TODO_REL_PATH);
    fs.writeFileSync(todoPath, `---
title: 我的待办
memory_layer: global
protection: open
processed_periods: ["2026-W30", "2026-W29"]
dismissed: ["abc123", "def456"]
---

# 我的待办

- [ ] 任务A
`, "utf8");

    const list = readTodoList(tmpDir);
    assert.deepEqual(list.processedPeriods, ["2026-W30", "2026-W29"]);
    assert.deepEqual(list.dismissed, ["abc123", "def456"]);
  });

  it("getTodoHealth returns correct stats", () => {
    ensureTodoFile(tmpDir);
    const a = addTodoItem(tmpDir, "活跃任务");
    const b = addTodoItem(tmpDir, "过期任务 📅 2020-01-01");
    const c = addTodoItem(tmpDir, "已完成任务");
    toggleTodoItem(tmpDir, c.item.id);

    const health = getTodoHealth(tmpDir);
    assert.ok(health);
    assert.equal(health.total, 3);
    assert.equal(health.active, 2);
    assert.equal(health.completed, 1);
    assert.equal(health.overdue, 1); // "过期任务" has due date in 2020
  });

  it("cleanupStaleTodos removes old completed items", () => {
    ensureTodoFile(tmpDir);
    const a = addTodoItem(tmpDir, "活跃任务");
    const b = addTodoItem(tmpDir, "旧完成任务");
    toggleTodoItem(tmpDir, b.item.id);

    // Manually set completedAt to 10 days ago
    const list = readTodoList(tmpDir);
    const oldDate = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const items = list.items.map((i) =>
      i.id === b.item.id ? { ...i, completedAt: oldDate } : i,
    );
    writeTodoList(tmpDir, items, undefined, {
      prevContent: list.rawContent,
      actor: "user",
      processedPeriods: list.processedPeriods || [],
      dismissed: list.dismissed || [],
      dismissedAt: list.dismissedAt || {},
    });

    // Cleanup should remove the old completed item
    const result = cleanupStaleTodos(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.cleared, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].text, "活跃任务");
  });

  it("cleanupStaleTodos does nothing when no stale items", () => {
    ensureTodoFile(tmpDir);
    addTodoItem(tmpDir, "活跃任务");

    const result = cleanupStaleTodos(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.cleared, 0);
    assert.equal(result.items.length, 1);
  });

  it("extractTodosFromStream returns reason when no period note or no AI provider", async () => {
    ensureTodoFile(tmpDir);
    const result = await mod.extractTodosFromStream({
      workspaceRoot: tmpDir,
      engineRoot,
    });
    assert.equal(result.ok, false);
    // No stream period note in temp workspace → no-period-note
    // (or no-ai-provider if a period note somehow exists)
    assert.ok(
      result.reason === "no-period-note" || result.reason === "no-ai-provider",
      `expected no-period-note or no-ai-provider, got ${result.reason}`,
    );
  });

  it("extractTodosFromStream with force clears processed period", async () => {
    ensureTodoFile(tmpDir);

    // Set up a todo.md with processed_periods
    const todoPath = path.join(tmpDir, TODO_REL_PATH);
    fs.writeFileSync(todoPath, `---
title: 我的待办
memory_layer: global
protection: open
processed_periods: ["2026-W30"]
dismissed: []
---

# 我的待办

- [ ] 已有任务
`, "utf8");

    // Create a stream period note
    const streamDir = path.join(tmpDir, "10-动态");
    fs.mkdirSync(streamDir, { recursive: true });
    fs.writeFileSync(
      path.join(streamDir, "2026-W30.md"),
      `# 2026-W30\n\n## 记录\n\n- 需要完成项目报告\n- 联系客户确认需求\n`,
      "utf8",
    );

    // Mock AI provider
    const mockAi = {
      async generate() {
        return "- 需要完成项目报告\n- 联系客户确认需求\n";
      },
    };

    // Without force: should return already-processed
    const result1 = await mod.extractTodosFromStream({
      workspaceRoot: tmpDir,
      engineRoot,
      aiProvider: mockAi,
    });
    assert.equal(result1.reason, "already-processed");

    // With force: should re-process
    const result2 = await mod.extractTodosFromStream({
      workspaceRoot: tmpDir,
      engineRoot,
      aiProvider: mockAi,
      options: { force: true },
    });
    assert.equal(result2.ok, true);
    assert.ok(result2.added.length > 0 || result2.reason === "no-items-found" || result2.reason === "all-duplicates",
      `force should re-process, got reason: ${result2.reason}`);
  });

  it("maintainTodos with force clears processed periods", async () => {
    ensureTodoFile(tmpDir);

    // Set up a todo.md with processed_periods
    const todoPath = path.join(tmpDir, TODO_REL_PATH);
    fs.writeFileSync(todoPath, `---
title: 我的待办
memory_layer: global
protection: open
processed_periods: ["2026-W30"]
dismissed: []
---

# 我的待办

- [ ] 已有任务
`, "utf8");

    // Create a stream period note
    const streamDir = path.join(tmpDir, "10-动态");
    fs.mkdirSync(streamDir, { recursive: true });
    fs.writeFileSync(
      path.join(streamDir, "2026-W30.md"),
      `# 2026-W30\n\n## 记录\n\n- 需要完成项目报告并提交给客户审阅\n- 联系客户确认下一阶段需求\n`,
      "utf8",
    );

    // Mock AI provider
    const mockAi = {
      async generate() {
        return "- 需要完成项目报告\n";
      },
    };

    // Without force: should return all-periods-processed
    const result1 = await mod.maintainTodos({
      workspaceRoot: tmpDir,
      engineRoot,
      aiProvider: mockAi,
    });
    assert.equal(result1.reason, "all-periods-processed");

    // With force: should re-process
    const result2 = await mod.maintainTodos({
      workspaceRoot: tmpDir,
      engineRoot,
      aiProvider: mockAi,
      options: { force: true },
    });
    assert.equal(result2.ok, true);
  });

  it("archiveStaleTodos moves stale active items to history and removes from list", () => {
    ensureTodoFile(tmpDir);

    // Add items — one old (stale), one fresh
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
    const todoPath = path.join(tmpDir, TODO_REL_PATH);
    fs.writeFileSync(todoPath, `---
title: 我的待办
memory_layer: global
protection: open
processed_periods: []
dismissed: []
---

# 我的待办

<!-- created: ${oldDate} -->
- [ ] 旧任务很久没处理

<!-- created: ${new Date().toISOString().slice(0, 10)} -->
- [ ] 新任务今天创建
`, "utf8");

    const result = archiveStaleTodos(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.archived.length, 1);
    assert.equal(result.items.length, 1); // Only fresh item remains
    assert.equal(result.items[0].text, "新任务今天创建");

    // Archive file should exist
    const archiveDir = path.join(tmpDir, "memory", "periodic", "todo-history");
    const files = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [];
    assert.ok(files.some(f => f.endsWith("-archived.md")), "archive file should exist");
  });

  it("archiveStaleTodos does nothing when no stale items", () => {
    ensureTodoFile(tmpDir);

    // Only fresh items
    addTodoItem(tmpDir, "fresh task");

    const result = archiveStaleTodos(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.archived.length, 0);
    assert.equal(result.reason, "nothing-to-archive");
  });

  it("snapshotTodoList writes a snapshot for the period", () => {
    ensureTodoFile(tmpDir);
    addTodoItem(tmpDir, "task to snapshot");

    const items = readTodoList(tmpDir).items;
    snapshotTodoList(tmpDir, items, "2026-W32");

    const snapshotPath = path.join(tmpDir, "memory", "periodic", "todo-history", "2026-W32.md");
    assert.ok(fs.existsSync(snapshotPath), "snapshot file should exist");

    const content = fs.readFileSync(snapshotPath, "utf8");
    assert.match(content, /待办快照 2026-W32/);
    assert.match(content, /task to snapshot/);
  });

  it("matchTodoMaintainText rejects single-token Latin false positives", () => {
    // Policy used by maintainTodos complete/update paths
    assert.equal(matchTodoMaintainText("Buy milk", "Buy milk"), true);
    assert.equal(matchTodoMaintainText("Buy milk", "I will buy groceries later"), false);
    assert.equal(matchTodoMaintainText("写周报", "写周报"), true);
    assert.equal(matchTodoMaintainText("写周报并提交客户", "写周报并提交客户审阅"), true);
    assert.equal(matchTodoMaintainText("联系客户确认需求", "去超市买菜"), false);
  });

  it("maintainTodos complete path does not mark unrelated todos done", async () => {
    ensureTodoFile(tmpDir);
    addTodoItem(tmpDir, "Buy milk");
    addTodoItem(tmpDir, "Write weekly report");

    const streamDir = path.join(tmpDir, "10-动态");
    fs.mkdirSync(streamDir, { recursive: true });
    fs.writeFileSync(
      path.join(streamDir, "2026-W34.md"),
      `# 2026-W34\n\n## 记录\n\n- I will buy groceries later this week\n- finished writing the weekly report document\n`,
      "utf8",
    );

    const mockAi = {
      async generate() {
        // complete mentions "buy" but not the full todo — must NOT complete Buy milk
        return JSON.stringify({
          add: [],
          complete: ["I will buy groceries later", "Write weekly report"],
          update: [],
        });
      },
    };

    const result = await maintainTodos({
      workspaceRoot: tmpDir,
      engineRoot,
      aiProvider: mockAi,
      options: { force: true },
    });
    assert.equal(result.ok, true);
    const items = readTodoList(tmpDir).items;
    const milk = items.find((i) => i.text === "Buy milk");
    const report = items.find((i) => /weekly report/i.test(i.text));
    assert.ok(milk, "Buy milk still present");
    assert.equal(milk.done, false, "Buy milk must not complete on loose 'buy' overlap");
    assert.ok(report, "report todo present");
    assert.equal(report.done, true, "exact/high-sim complete should mark report done");
  });

  it("snapshotTodoList is idempotent — does not overwrite existing snapshot", () => {
    ensureTodoFile(tmpDir);
    addTodoItem(tmpDir, "first task");

    const items1 = readTodoList(tmpDir).items;
    snapshotTodoList(tmpDir, items1, "2026-W33");

    // Add another item and snapshot again
    addTodoItem(tmpDir, "second task");
    const items2 = readTodoList(tmpDir).items;
    snapshotTodoList(tmpDir, items2, "2026-W33");

    const content = fs.readFileSync(
      path.join(tmpDir, "memory", "periodic", "todo-history", "2026-W33.md"),
      "utf8",
    );
    // Should only contain first task (first snapshot wins)
    assert.match(content, /first task/);
    assert.doesNotMatch(content, /second task/);
  });
});
