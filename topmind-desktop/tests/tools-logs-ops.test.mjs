import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  attachOpsJournal,
  appendOpsEntry,
  recordWritebackEvidence,
  readOpsJournal,
  clearOpsJournal,
} from "../electron/lib/ops-journal.mjs";
import { collectWorkspaceStats } from "../electron/lib/workspace-stats.mjs";
import { findDuplicateFiles } from "../electron/lib/workspace-duplicates.mjs";
import { scanCleanupCandidates } from "../electron/lib/workspace-cleanup.mjs";
import { buildWritebackEvidence } from "../electron/lib/writeback.mjs";

async function tmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("ops journal records evidence and filters", async () => {
  const dir = await tmpDir("ops-j-");
  const file = path.join(dir, "ops.jsonl");
  attachOpsJournal(file);
  appendOpsEntry({ op: "create", actor: "user", rel: "10-动态/a.md", ok: true });
  recordWritebackEvidence({
    operation: "update",
    targetPath: "10-动态/b.md",
    backupPath: null,
    receiptPath: null,
    wroteFiles: true,
    ok: true,
  }, { actor: "ai" });

  const all = await readOpsJournal({ limit: 50 });
  assert.equal(all.entries.length, 2);
  const ai = await readOpsJournal({ actor: "ai" });
  assert.equal(ai.entries.length, 1);
  assert.equal(ai.entries[0].op, "update");

  const cleared = await clearOpsJournal();
  assert.equal(cleared.ok, true);
  const after = await readOpsJournal({});
  assert.equal(after.entries.length, 0);
});

test("receiptPath is never a silent backupPath alias", () => {
  const withBackup = buildWritebackEvidence({
    operation: "update",
    targetPath: "a.md",
    savedAt: new Date().toISOString(),
    backupPath: "99-归档/backups/a.md",
    receiptPath: undefined,
  });
  assert.equal(withBackup.backupPath, "99-归档/backups/a.md");
  assert.equal(withBackup.receiptPath, null);

  const withReceipt = buildWritebackEvidence({
    operation: "update",
    targetPath: "a.md",
    savedAt: new Date().toISOString(),
    backupPath: "99-归档/backups/a.md",
    receiptPath: "99-归档/receipts/x.yaml",
  });
  assert.equal(withReceipt.receiptPath, "99-归档/receipts/x.yaml");
});

test("workspace stats aggregates size and top-level", async () => {
  const ws = await tmpDir("ws-stats-");
  await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
  await fs.mkdir(path.join(ws, "88-交付"), { recursive: true });
  await fs.writeFile(path.join(ws, "10-动态", "a.md"), "hello world ".repeat(100));
  await fs.writeFile(path.join(ws, "88-交付", "2026-01-01-r.md"), "x".repeat(2000));
  await fs.writeFile(path.join(ws, "topmind.yaml"), "contract_version: 4\n");

  const stats = await collectWorkspaceStats(ws);
  assert.ok(stats.totalFiles >= 2);
  assert.ok(stats.totalBytes > 0);
  assert.ok(stats.byTopLevel.some((t) => t.name === "10-动态"));
  assert.ok(stats.delivery.count >= 1);
});

test("duplicate detection finds identical files by size+hash", async () => {
  const ws = await tmpDir("ws-dup-");
  await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
  await fs.mkdir(path.join(ws, "20-专题"), { recursive: true });
  const body = "same content ".repeat(80);
  await fs.writeFile(path.join(ws, "10-动态", "one.md"), body);
  await fs.writeFile(path.join(ws, "20-专题", "two.md"), body);
  await fs.writeFile(path.join(ws, "10-动态", "uniq.md"), "different".repeat(200));

  const dups = await findDuplicateFiles(ws, { minSize: 16 });
  assert.ok(dups.groupCount >= 1);
  const group = dups.groups[0];
  assert.equal(group.paths.length, 2);
  assert.equal(typeof group.suggestedKeepIndex, "number");
  assert.ok(group.suggestedKeepIndex >= 0 && group.suggestedKeepIndex < group.paths.length);
  assert.ok(dups.wastedBytes > 0);
});

test("duplicate walk skips __ backup sidecars", async () => {
  const ws = await tmpDir("ws-dup-bak-");
  await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
  const body = "backup twin content ".repeat(40);
  await fs.writeFile(path.join(ws, "10-动态", "note.md"), body);
  await fs.writeFile(path.join(ws, "10-动态", "20260101T120000__note.md"), body);

  const dups = await findDuplicateFiles(ws, { minSize: 16 });
  assert.equal(dups.groupCount, 0, "writeback stamp backup must not form a duplicate group");
});

test("suggestKeepIndex prefers non-backup, year-dir, newer mtime", async () => {
  const { suggestKeepIndex } = await import("../electron/lib/workspace-duplicates.mjs");
  assert.equal(
    suggestKeepIndex({
      full: true,
      paths: ["10-动态/2026-W30.md", "10-动态/2026/2026-W30.md"],
      mtimes: ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"],
    }),
    1,
    "year-dir twin preferred",
  );
  assert.equal(
    suggestKeepIndex({
      full: true,
      paths: ["10-动态/20260101T120000__note.md", "10-动态/note.md"],
      mtimes: ["2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    }),
    1,
    "stamp backup loses even when newer",
  );
  assert.equal(
    suggestKeepIndex({
      full: false,
      paths: ["a/big.bin", "b/big.bin"],
      mtimes: ["2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"],
    }),
    0,
    "partial-only never auto-picks a winner",
  );
});

test("stats/duplicates/cleanup accept workspace context object (RPC shape)", async () => {
  const ws = await tmpDir("ws-ctx-");
  await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
  await fs.writeFile(path.join(ws, "10-动态", "a.md"), "hello ".repeat(50));
  await fs.writeFile(path.join(ws, ".DS_Store"), "junk");

  // Simulate Desktop RPC ctx.workspaceRoot = { engineRoot, userWorkspaceRoot }
  const ctxRoot = { engineRoot: "/tmp/engine", userWorkspaceRoot: ws };
  const stats = await collectWorkspaceStats(ctxRoot);
  assert.ok(stats.totalFiles >= 1);

  const dups = await findDuplicateFiles(ctxRoot, { minSize: 8 });
  assert.ok(Array.isArray(dups.groups));

  const care = await scanCleanupCandidates(ctxRoot);
  assert.ok(care.junk.includes(".DS_Store"));
});

test("cleanup preview lists junk and convention outsiders", async () => {
  const ws = await tmpDir("ws-care-");
  await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
  await fs.writeFile(path.join(ws, ".DS_Store"), "junk");
  await fs.writeFile(path.join(ws, "random.txt"), "x");
  await fs.writeFile(path.join(ws, "topmind.yaml"), "contract_version: 4\n");

  const c = await scanCleanupCandidates(ws);
  assert.ok(c.junk.includes(".DS_Store"));
  assert.ok(c.outOfConvention.some((x) => x.path === "random.txt"));
});
