/**
 * UTR workspace-write must not invent durable 99-归档 backup/receipt for open
 * creates/updates. High-impact (locked overwrite) goes only through Kernel writeback.
 * Drives shipped executeTool → utr/tools/workspace-write.mjs (no mocks of the gate).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { loadContractRegistry } from "../../core/contract-registry.mjs";
import { executeTool } from "../../core/tool-executor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function listFiles(root, pred = () => true) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (pred(p, e.name)) out.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return out;
}

async function seedWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-hi-"));
  const userWorkspaceRoot = path.join(base, "workspace");
  for (const d of ["00-收件箱", "20-专题", "88-输出", "99-归档"]) {
    await fs.mkdir(path.join(userWorkspaceRoot, d), { recursive: true });
  }
  await fs.writeFile(
    path.join(userWorkspaceRoot, "topmind.yaml"),
    [
      "contract_version: 4",
      "workspace:",
      "  template: stream",
      "writeback:",
      "  mode: auto",
      "  backup_to: 99-归档/backups",
      "  receipts: 99-归档/receipts",
      "protection:",
      "  defaults:",
      "    by_role:",
      "      deep-work: open",
      "      system: locked",
    ].join("\n") + "\n",
    "utf8",
  );
  return {
    base,
    userWorkspaceRoot,
    pathContext: { engineRoot: repoRoot, userWorkspaceRoot },
  };
}

test("create-topic open: no invent 99-归档/receipts create-topic-*.json", async () => {
  const registry = await loadContractRegistry();
  const ws = await seedWorkspace();
  try {
    const result = await executeTool({
      registry,
      kind: "workspace-write",
      command: "create-topic",
      payload: {
        category: "20-专题",
        topic: "2026-demo",
        title: "Demo",
        dryRun: false,
        writebackMode: "auto",
      },
      pathContext: ws.pathContext,
      reviewed: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 400));
    assert.equal(result.parsed.data.createdProject, true);
    assert.ok(
      result.parsed.data.receipt == null || result.parsed.data.receipt === "",
      "open create must not invent receipt path",
    );
    const noise = await listFiles(path.join(ws.userWorkspaceRoot, "99-归档"), (_p, n) =>
      n.includes("create-topic"),
    );
    assert.equal(noise.length, 0, `unexpected create-topic archive files: ${noise.join(", ")}`);
    const receipts = await listFiles(path.join(ws.userWorkspaceRoot, "99-归档", "receipts")).catch(() => []);
    assert.equal(receipts.length, 0, `open create must not write receipts: ${receipts.join(", ")}`);
  } finally {
    await fs.rm(ws.base, { recursive: true, force: true });
  }
});

test("update-topic open: no invent 99-归档/backups update-topic-*.json", async () => {
  const registry = await loadContractRegistry();
  const ws = await seedWorkspace();
  try {
    const topicDir = path.join(ws.userWorkspaceRoot, "20-专题", "2026-demo");
    await fs.mkdir(topicDir, { recursive: true });
    await fs.writeFile(
      path.join(topicDir, "topic.md"),
      "---\ntitle: Demo\ncategory: 20-专题\ntopic: 2026-demo\nprotection: open\n---\n\n# Demo\n",
      "utf8",
    );

    const result = await executeTool({
      registry,
      kind: "workspace-write",
      command: "update-topic",
      payload: {
        category: "20-专题",
        topic: "2026-demo",
        content: "# New Body\n\nReplaced.\n",
        replaceReason: "Restructure",
        dryRun: false,
        writebackMode: "auto",
      },
      pathContext: ws.pathContext,
      reviewed: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
    const data = result.parsed.data;
    assert.ok(!data.snapshot, "open update must not invent snapshot");
    assert.ok(!data.backup_path && !data.backupPath, "open update must not invent backup_path");
    const body = await fs.readFile(path.join(topicDir, "topic.md"), "utf8");
    assert.match(body, /Replaced/);
    const noise = await listFiles(path.join(ws.userWorkspaceRoot, "99-归档"), (_p, n) =>
      n.includes("update-topic") || n.endsWith(".json"),
    );
    assert.equal(noise.length, 0, `unexpected update-topic archive files: ${noise.join(", ")}`);
  } finally {
    await fs.rm(ws.base, { recursive: true, force: true });
  }
});

test("update-topic locked: Kernel writeback backup + receipt only", async () => {
  const registry = await loadContractRegistry();
  const ws = await seedWorkspace();
  try {
    const topicDir = path.join(ws.userWorkspaceRoot, "20-专题", "2026-locked");
    await fs.mkdir(topicDir, { recursive: true });
    const original =
      "---\ntitle: Locked\ncategory: 20-专题\ntopic: 2026-locked\nprotection: locked\n---\n\n# Locked\n";
    await fs.writeFile(path.join(topicDir, "topic.md"), original, "utf8");

    const result = await executeTool({
      registry,
      kind: "workspace-write",
      command: "update-topic",
      payload: {
        category: "20-专题",
        topic: "2026-locked",
        content: "# Locked New\n",
        replaceReason: "User restructure locked home",
        dryRun: false,
        writebackMode: "auto",
      },
      pathContext: ws.pathContext,
      reviewed: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
    const data = result.parsed.data;
    const backup =
      data.snapshot ||
      data.backup_path ||
      data.backupPath ||
      data.writebackEvidence?.backupPath ||
      data.writebackEvidence?.backup_path;
    assert.ok(backup, "locked update must expose Kernel backup path");
    // Must be Kernel-style stamp__basename under backups/, not update-topic-*.json
    const backupRel = String(backup).replace(/\\/g, "/");
    assert.ok(
      !backupRel.includes("update-topic-"),
      "must not use parallel UTR update-topic JSON snapshot",
    );
    const backups = await listFiles(path.join(ws.userWorkspaceRoot, "99-归档", "backups"));
    assert.ok(backups.length >= 1, "expected Kernel backup on disk");
    assert.ok(
      backups.some((b) => b.includes("topic.md") || b.includes("__")),
      `expected Kernel backup naming, got: ${backups.join(", ")}`,
    );
  } finally {
    await fs.rm(ws.base, { recursive: true, force: true });
  }
});
