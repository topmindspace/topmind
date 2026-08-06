import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  clearTransactionalBackups,
  nextAvailablePath,
  restoreAffectedFiles,
  snapshotAffectedFiles,
} from "../../core/writeback-safety.mjs";

test("nextAvailablePath picks the first collision-free markdown path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-writeback-safety-"));
  try {
    const target = path.join(tempDir, "Output.md");
    await fs.writeFile(target, "one", "utf8");
    await fs.writeFile(path.join(tempDir, "Output-2.md"), "two", "utf8");

    assert.equal(nextAvailablePath(target), path.join(tempDir, "Output-3.md"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("transactional snapshots restore affected files after a failed write", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-writeback-safety-"));
  try {
    const target = path.join(tempDir, "topic.md");
    await fs.writeFile(target, "original", "utf8");

    const backedUp = await snapshotAffectedFiles([target]);
    await fs.writeFile(target, "mutated", "utf8");

    assert.deepEqual(backedUp, [target]);
    assert.deepEqual(await restoreAffectedFiles(backedUp), {
      restored: [target],
      failed: [],
    });
    assert.equal(await fs.readFile(target, "utf8"), "original");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("transactional snapshots are cleared after a successful write", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-writeback-safety-"));
  try {
    const target = path.join(tempDir, "topic.md");
    await fs.writeFile(target, "original", "utf8");

    const backedUp = await snapshotAffectedFiles([target]);
    await clearTransactionalBackups(backedUp);

    await assert.rejects(
      () => fs.access(`${target}.mh-safe-bak`),
      { code: "ENOENT" },
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
