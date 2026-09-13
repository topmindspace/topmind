import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWorkspaceContext } from "../electron/lib/path-model.mjs";
import { pathOps } from "../electron/lib/workspace-path-ops.mjs";

async function createTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-test-ai-ops-"));
  await fs.writeFile(
    path.join(dir, "topmind.yaml"),
    "version: 4\nname: Test Workspace\nlocale: zh-CN\nwriteback:\n  mode: auto\n",
  );
  await fs.mkdir(path.join(dir, "memory"), { recursive: true });
  await fs.mkdir(path.join(dir, "10-动态"), { recursive: true });
  return dir;
}

test("workspace pathOps: memory lifecycle & todo operations", async () => {
  const wsRoot = await createTempWorkspace();
  const engineRoot = path.resolve("..");
  const ctx = {
    workspaceRoot: createWorkspaceContext({ engineRoot, userWorkspaceRoot: wsRoot }),
    engineRoot,
    explicitWritebackMode: "auto",
  };

  try {
    // 1. appendCoreMemory — Kernel ADD (dated （YYYY-MM-DD）, live-section dedupe)
    const appRes = await pathOps.appendCoreMemory(
      { entry: "喜欢在清晨阅读技术论文", section: "偏好", actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(appRes.ok, true);
    assert.equal(appRes.wroteFiles, true);

    const profPath = path.join(wsRoot, "memory", "profile.md");
    const profContent1 = await fs.readFile(profPath, "utf8");
    assert.match(profContent1, /（\d{4}-\d{2}-\d{2}）喜欢在清晨阅读技术论文/);
    assert.doesNotMatch(profContent1, /\[\d{4}-\d{2}-\d{2}\]/);

    const dupRes = await pathOps.appendCoreMemory(
      { entry: "喜欢在清晨阅读技术论文", section: "当前目标", actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(dupRes.wroteFiles, false);
    assert.equal(dupRes.reason, "duplicate-fact");
    const liveHits = (await fs.readFile(profPath, "utf8")).match(/喜欢在清晨阅读技术论文/g) || [];
    assert.equal(liveHits.length, 1);

    // 2. updateCoreMemory
    const upRes = await pathOps.updateCoreMemory(
      { match: "技术论文", content: "喜欢在清晨阅读深度技术论文与哲学书籍", actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(upRes.ok, true);
    assert.equal(upRes.wroteFiles, true);
    const profContent2 = await fs.readFile(profPath, "utf8");
    assert.match(profContent2, /喜欢在清晨阅读深度技术论文与哲学书籍/);

    // 3. retireCoreMemory
    const retRes = await pathOps.retireCoreMemory(
      { match: "哲学书籍", reason: "不再适用", actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(retRes.ok, true);
    assert.equal(retRes.wroteFiles, true);
    const profContent3 = await fs.readFile(profPath, "utf8");
    assert.match(profContent3, /历史记录/);
    assert.match(profContent3, /归档/);

    // 4. addTodos
    const addRes = await pathOps.addTodos(
      { items: ["完成系统重构 📅 2026-09-10", "编写自动化测试"], actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(addRes.ok, true);
    assert.equal(addRes.addedCount, 2);

    // 5. listTodos
    const listRes = await pathOps.listTodos({ completed: false }, ctx);
    assert.equal(listRes.totalCount, 2);
    assert.equal(listRes.activeCount, 2);
    assert.equal(listRes.items.length, 2);

    // 6. toggleTodo
    const togRes = await pathOps.toggleTodo(
      { idOrText: "系统重构", actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(togRes.ok, true);

    const listRes2 = await pathOps.listTodos({ completed: false }, ctx);
    assert.equal(listRes2.activeCount, 1);
    const listAll = await pathOps.listTodos({ completed: true }, ctx);
    assert.equal(listAll.completedCount, 1);

    // Confirm-mode AI ADD/UPDATE/RETIRE must pending, not write immediately.
    const gateRes = await pathOps.appendCoreMemory(
      { entry: "用于确认闸的活事实", section: "进行中的事", actor: "ai", confirmed: true },
      ctx,
    );
    assert.equal(gateRes.wroteFiles, true);
    const confirmCtx = { ...ctx, explicitWritebackMode: "confirm" };
    const beforeConfirm = await fs.readFile(profPath, "utf8");
    const pendingAdd = await pathOps.appendCoreMemory(
      { entry: "确认模式下不应落盘的新事实", section: "偏好", actor: "ai", confirmed: false },
      confirmCtx,
    );
    assert.equal(pendingAdd.pending || pendingAdd.needsConfirm, true);
    assert.equal(pendingAdd.wroteFiles, false);
    assert.doesNotMatch(await fs.readFile(profPath, "utf8"), /确认模式下不应落盘的新事实/);
    assert.match(String(pendingAdd.previewContent || ""), /确认模式下不应落盘的新事实/);

    const pendingUp = await pathOps.updateCoreMemory(
      { match: "用于确认闸的活事实", content: "确认更新不应落盘", actor: "ai", confirmed: false },
      confirmCtx,
    );
    assert.equal(pendingUp.pending || pendingUp.needsConfirm, true);
    assert.equal(pendingUp.wroteFiles, false);
    assert.equal(await fs.readFile(profPath, "utf8"), beforeConfirm);

    const pendingRet = await pathOps.retireCoreMemory(
      { match: "用于确认闸的活事实", actor: "ai", confirmed: false },
      confirmCtx,
    );
    assert.equal(pendingRet.pending || pendingRet.needsConfirm, true);
    assert.equal(pendingRet.wroteFiles, false);
    assert.equal(await fs.readFile(profPath, "utf8"), beforeConfirm);
  } finally {
    await fs.rm(wsRoot, { recursive: true, force: true }).catch(() => {});
  }
});
