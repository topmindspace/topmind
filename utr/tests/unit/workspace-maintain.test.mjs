import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { executeTool } from "../../core/tool-executor.mjs";
import { loadContractRegistry } from "../../core/contract-registry.mjs";

test("workspace-maintain cleanup-empty-dirs identifies nested empty dirs and protects root categories", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-maintain-test-"));
  try {
    const categoriesRoot = tempDir;
    const inboxRoot = path.join(tempDir, "00-收件箱");
    const streamDir = path.join(tempDir, "10-动态");
    const deepWorkDir = path.join(tempDir, "20-研究");
    const archiveDir = path.join(tempDir, "99-归档");

    await fs.mkdir(inboxRoot, { recursive: true });
    await fs.mkdir(streamDir, { recursive: true });
    await fs.mkdir(deepWorkDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    // In 20-研究: create a topic with a file, and an empty topic with a nested empty subfolder
    const topicWithFile = path.join(deepWorkDir, "2026-活跃专题");
    await fs.mkdir(topicWithFile, { recursive: true });
    await fs.writeFile(path.join(topicWithFile, "topic.md"), "# 活跃", "utf8");

    const emptyTopic = path.join(deepWorkDir, "2026-空专题");
    const nestedEmpty = path.join(emptyTopic, "nested-empty");
    await fs.mkdir(nestedEmpty, { recursive: true });

    const registry = await loadContractRegistry();

    // 1. Preview mode: should report empty directories without deleting
    const previewResult = await executeTool({
      registry,
      kind: "workspace-maintain",
      command: "cleanup-empty-dirs",
      payload: {},
      pathContext: {
        userWorkspaceRoot: tempDir,
        categoriesRoot,
        inboxRootPath: inboxRoot,
        archiveRootPath: archiveDir,
        engineRoot: process.cwd(),
      },
      writebackMode: "confirm",
      reviewed: true,
    });

    assert.equal(previewResult.ok, true);
    assert.equal(previewResult.data.applied, false);
    const reported = previewResult.data.emptyDirs;
    assert.ok(reported.includes("20-研究/2026-空专题/nested-empty"));
    assert.ok(reported.includes("20-研究/2026-空专题"));
    assert.ok(!reported.includes("00-收件箱"));
    assert.ok(!reported.includes("10-动态"));
    assert.ok(!reported.includes("20-研究"));
    assert.ok(!reported.includes("99-归档"));
    assert.ok(!reported.includes(""));

    const statBefore = await fs.stat(nestedEmpty);
    assert.ok(statBefore.isDirectory());

    // 2. Auto mode: execute deletion
    const autoResult = await executeTool({
      registry,
      kind: "workspace-maintain",
      command: "cleanup-empty-dirs",
      payload: {},
      pathContext: {
        userWorkspaceRoot: tempDir,
        categoriesRoot,
        inboxRootPath: inboxRoot,
        archiveRootPath: archiveDir,
        engineRoot: process.cwd(),
      },
      writebackMode: "auto",
    });

    assert.equal(autoResult.ok, true);
    assert.equal(autoResult.data.applied, true);

    await assert.rejects(() => fs.stat(emptyTopic), { code: "ENOENT" });
    const activeStat = await fs.stat(topicWithFile);
    assert.ok(activeStat.isDirectory());
    assert.ok((await fs.stat(inboxRoot)).isDirectory());
    assert.ok((await fs.stat(streamDir)).isDirectory());
    assert.ok((await fs.stat(deepWorkDir)).isDirectory());
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace-maintain archive-topic moves directory atomically and generates archive-receipt", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-archive-test-"));
  try {
    const categoriesRoot = tempDir;
    const inboxRoot = path.join(tempDir, "00-收件箱");
    const deepWorkDir = path.join(tempDir, "20-研究");
    const archiveDir = path.join(tempDir, "99-归档");

    await fs.mkdir(inboxRoot, { recursive: true });
    await fs.mkdir(deepWorkDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    // Create topic to archive
    const topicDir = path.join(deepWorkDir, "2026-待归档");
    await fs.mkdir(topicDir, { recursive: true });
    await fs.writeFile(path.join(topicDir, "topic.md"), "# 待归档内容", "utf8");
    await fs.writeFile(path.join(topicDir, "note1.md"), "笔记一", "utf8");

    const registry = await loadContractRegistry();

    const result = await executeTool({
      registry,
      kind: "workspace-maintain",
      command: "archive-topic",
      payload: {
        category: "20-研究",
        topic: "2026-待归档",
        reason: "任务完成，归档处理",
      },
      pathContext: {
        userWorkspaceRoot: tempDir,
        categoriesRoot,
        inboxRootPath: inboxRoot,
        archiveRootPath: archiveDir,
        engineRoot: process.cwd(),
      },
      writebackMode: "auto",
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.command, "archive-topic");
    assert.equal(result.data.mode, "auto");
    assert.ok(result.data.archiveTarget.startsWith("99-归档/20-研究-2026-待归档-"));

    // Source topic directory should be moved (no longer in 20-研究)
    await assert.rejects(() => fs.stat(topicDir), { code: "ENOENT" });

    // Destination in 99-归档 must contain the original files plus archive-receipt.json
    const archivedAbs = path.join(tempDir, result.data.archiveTarget);
    const filesInArchive = await fs.readdir(archivedAbs);
    assert.ok(filesInArchive.includes("topic.md"));
    assert.ok(filesInArchive.includes("note1.md"));
    assert.ok(filesInArchive.includes("archive-receipt.json"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
