import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWorkspaceContext } from "../electron/lib/path-model.mjs";
import { createInboxOps } from "../electron/lib/workspace-inbox-ops.mjs";
import { pathOps } from "../electron/lib/workspace-path-ops.mjs";

test("ai-tools writeback gate: in confirm mode, AI writes and moves must be pending and not destroy files", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-wb-gate-"));
  const engineRoot = path.resolve("..");
  try {
    // 1. Setup workspace structure
    await fs.mkdir(path.join(tmpDir, "00-收件箱"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "10-动态"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "20-专题", "2026-测试专题"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "88-输出"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "99-归档"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "memory"), { recursive: true });

    await fs.writeFile(
      path.join(tmpDir, "topmind.yaml"),
      "version: 4\nname: Test Workspace\nlocale: zh-CN\nwriteback:\n  mode: confirm\n",
    );

    const initialInboxFile = "00-收件箱/test-draft.md";
    await fs.writeFile(
      path.join(tmpDir, initialInboxFile),
      "---\ntitle: 测试草稿\n---\n这是一篇测试草稿。\n",
    );

    const wsContext = createWorkspaceContext({ engineRoot, userWorkspaceRoot: tmpDir });
    const ctx = {
      workspaceRoot: wsContext,
      engineRoot,
      appSettings: {
        workspace: {
          writebackMode: "confirm", // Ask before save
        },
      },
      explicitWritebackMode: "confirm",
    };

    const inboxOps = createInboxOps({});

    // 2. Test ingestInbox in confirm mode with actor: "ai", confirmed: false
    const capRes = await inboxOps.ingestInbox(
      {
        content: "新捕获的内容",
        dest: { mode: "inbox" },
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(capRes.ok, false);
    assert.equal(capRes.pending, true);
    assert.equal(capRes.needsConfirm, true);

    // 3. Test moveToTopic in confirm mode with actor: "ai", confirmed: false
    const moveRes = await inboxOps.moveToTopic(
      {
        relativePath: initialInboxFile,
        targetTopicId: "20-专题/2026-测试专题",
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(moveRes.ok, false);
    assert.equal(moveRes.pending, true);
    assert.equal(moveRes.needsConfirm, true);

    // CRITICAL SECURITY ASSERTION:
    // The source file MUST NOT be deleted (unlinked) while move is pending!
    const srcStillExists = await fs.readFile(path.join(tmpDir, initialInboxFile), "utf8").catch(() => null);
    assert.ok(srcStillExists, "Source file must not be deleted when moveToTopic is pending!");

    // 4. Test publishPath in confirm mode with actor: "ai", confirmed: false
    const pubRes = await pathOps.publishPath(
      {
        relativePath: initialInboxFile,
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(pubRes.ok, false);
    assert.equal(pubRes.pending, true);
    assert.equal(pubRes.needsConfirm, true);

    // 5. Test deletePath in confirm mode with actor: "ai", confirmed: false
    const delRes = await pathOps.deletePath(
      {
        relativePath: initialInboxFile,
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(delRes.ok, false);
    assert.equal(delRes.pending, true);
    assert.equal(delRes.needsConfirm, true);

    // The file must still exist on disk because delete was pending
    const stillHere = await fs.readFile(path.join(tmpDir, initialInboxFile), "utf8").catch(() => null);
    assert.ok(stillHere, "Source file must not be deleted when deletePath is pending!");

    // 6. Test renamePath in confirm mode with actor: "ai", confirmed: false
    const renRes = await pathOps.renamePath(
      {
        relativePath: initialInboxFile,
        newName: "renamed-draft.md",
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(renRes.ok, false);
    assert.equal(renRes.pending, true);
    assert.equal(renRes.needsConfirm, true);

    const oldStillThere = await fs.readFile(path.join(tmpDir, initialInboxFile), "utf8").catch(() => null);
    assert.ok(oldStillThere, "Old file must not be renamed when renamePath is pending!");

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
