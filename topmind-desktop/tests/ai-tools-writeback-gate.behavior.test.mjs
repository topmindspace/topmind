import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWorkspaceContext } from "../electron/lib/path-model.mjs";
import { createInboxOps } from "../electron/lib/workspace-inbox-ops.mjs";
import { pathOps } from "../electron/lib/workspace-path-ops.mjs";

test("ai-tools graded confirm: content lands; delete/archive pending and do not destroy files", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-wb-gate-"));
  const engineRoot = path.resolve("..");
  try {
    await fs.mkdir(path.join(tmpDir, "00-收件箱"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "10-动态"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "20-专题", "2026-测试专题"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "88-交付"), { recursive: true });
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
          writebackMode: "confirm",
        },
      },
      explicitWritebackMode: "confirm",
    };

    const inboxOps = createInboxOps({});

    // 1. Content create (capture) lands immediately under graded confirm.
    const capRes = await inboxOps.ingestInbox(
      {
        content: "新捕获的内容",
        dest: { mode: "inbox" },
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(capRes.ok, true, `capture should land: ${JSON.stringify(capRes)}`);
    assert.ok(!capRes.pending && !capRes.needsConfirm, `capture must not be pending: ${JSON.stringify(capRes)}`);
    assert.equal(capRes.wroteFiles, true);

    // 2. Delete is lifecycle → pending; source must remain on disk.
    // Media next to the note must also remain (gate first, media second).
    const mediaDir = path.join(tmpDir, "00-收件箱", "images", "test-draft");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, "pic.png"), "fake-png");
    const delRes = await pathOps.deletePath(
      {
        relativePath: initialInboxFile,
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(delRes.ok, false);
    assert.equal(delRes.pending || delRes.needsConfirm, true);
    const stillHere = await fs.readFile(path.join(tmpDir, initialInboxFile), "utf8").catch(() => null);
    assert.ok(stillHere, "Source file must not be deleted when deletePath is pending!");
    const mediaStill = await fs.readFile(path.join(mediaDir, "pic.png"), "utf8").catch(() => null);
    assert.ok(mediaStill, "Note media must not be trashed when deletePath is pending!");

    // 3. Confirmed delete proceeds.
    const delOk = await pathOps.deletePath(
      {
        relativePath: initialInboxFile,
        actor: "ai",
        confirmed: true,
      },
      ctx,
    );
    assert.equal(delOk.ok, true, JSON.stringify(delOk));
    const gone = await fs.readFile(path.join(tmpDir, initialInboxFile), "utf8").catch(() => null);
    assert.equal(gone, null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
