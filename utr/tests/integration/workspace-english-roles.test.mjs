/**
 * UTR path helpers + capture-note must honor live English/renamed role dirs
 * (00-Inbox / 88-Outputs / 99-Archive) and still write through Kernel.
 * Open create must not invent 99-归档/receipts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { loadContractRegistry } from "../../core/contract-registry.mjs";
import { executeTool } from "../../core/tool-executor.mjs";
import {
  inboxRoot,
  archiveRoot,
  globalOutputsRoot,
} from "../../core/workspace-context.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function listFiles(root) {
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
      else out.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return out;
}

async function seedEnglishWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-en-"));
  const userWorkspaceRoot = path.join(base, "workspace");
  for (const d of ["00-Inbox", "20-Topics", "88-Outputs", "99-Archive"]) {
    await fs.mkdir(path.join(userWorkspaceRoot, d), { recursive: true });
  }
  await fs.writeFile(
    path.join(userWorkspaceRoot, "topmind.yaml"),
    [
      "contract_version: 4",
      "workspace:",
      "  template: stream",
      "  locale: en",
      "writeback:",
      "  mode: auto",
      "  backup_to: 99-Archive/backups",
      "  receipts: 99-Archive/receipts",
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

test("UTR inboxRoot/archiveRoot/outputsRoot resolve live English dirs", async () => {
  const ws = await seedEnglishWorkspace();
  try {
    const ctx = ws.pathContext;
    assert.equal(path.basename(inboxRoot(ctx)), "00-Inbox");
    assert.equal(path.basename(archiveRoot(ctx)), "99-Archive");
    assert.equal(path.basename(globalOutputsRoot(ctx)), "88-Outputs");
    assert.ok(!inboxRoot(ctx).includes("00-收件箱"));
    assert.ok(!archiveRoot(ctx).includes("99-归档"));
    assert.ok(!globalOutputsRoot(ctx).includes("88-输出"));
  } finally {
    await fs.rm(ws.base, { recursive: true, force: true });
  }
});

test("UTR capture-note inbox lands in 00-Inbox via Kernel; no invented 99-归档 receipts", async () => {
  const registry = await loadContractRegistry();
  const ws = await seedEnglishWorkspace();
  try {
    const result = await executeTool({
      registry,
      kind: "workspace-write",
      command: "capture-note",
      payload: {
        title: "English inbox note",
        content: "hello from english workspace",
        writebackMode: "auto",
        dryRun: false,
      },
      pathContext: ws.pathContext,
    });
    assert.equal(result.ok, true, result.stderr || result.stdout);
    const files = await listFiles(ws.userWorkspaceRoot);
    const inboxNotes = files.filter((f) => f.startsWith("00-Inbox/") && f.endsWith(".md"));
    assert.ok(inboxNotes.length >= 1, `expected note under 00-Inbox, got ${files.join(", ")}`);
    assert.ok(
      !files.some((f) => f.startsWith("00-收件箱/") || f.startsWith("99-归档/")),
      `must not invent Chinese dirs: ${files.join(", ")}`,
    );
    const receipts = files.filter((f) => /receipts\//.test(f) && f.endsWith(".yaml"));
    assert.equal(receipts.length, 0, `open create must not invent receipts: ${receipts.join(", ")}`);
  } finally {
    await fs.rm(ws.base, { recursive: true, force: true });
  }
});

test("UTR capture-note honors renamed 00-Capture buffer", async () => {
  const registry = await loadContractRegistry();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-cap-"));
  const userWorkspaceRoot = path.join(base, "workspace");
  try {
    for (const d of ["00-Capture", "88-Outputs", "99-Archive"]) {
      await fs.mkdir(path.join(userWorkspaceRoot, d), { recursive: true });
    }
    await fs.writeFile(
      path.join(userWorkspaceRoot, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n",
      "utf8",
    );
    const ctx = { engineRoot: repoRoot, userWorkspaceRoot };
    assert.equal(path.basename(inboxRoot(ctx)), "00-Capture");

    const result = await executeTool({
      registry,
      kind: "workspace-write",
      command: "capture-note",
      payload: {
        title: "Renamed buffer note",
        content: "into 00-Capture",
        writebackMode: "auto",
        dryRun: false,
      },
      pathContext: ctx,
    });
    assert.equal(result.ok, true, result.stderr || result.stdout);
    const files = await listFiles(userWorkspaceRoot);
    assert.ok(
      files.some((f) => f.startsWith("00-Capture/") && f.endsWith(".md")),
      `expected 00-Capture note, got ${files.join(", ")}`,
    );
    assert.ok(!files.some((f) => f.startsWith("00-Inbox/") || f.startsWith("00-收件箱/")));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("UTR save-output lands in 88-Outputs via Kernel; no 88-输出 invented", async () => {
  const registry = await loadContractRegistry();
  const ws = await seedEnglishWorkspace();
  try {
    const result = await executeTool({
      registry,
      kind: "workspace-write",
      command: "save-output",
      payload: {
        category: "20-Topics",
        topic: "2026-demo",
        title: "English delivery",
        content: "deliverable body",
        writebackMode: "auto",
        dryRun: false,
      },
      pathContext: ws.pathContext,
      reviewed: true,
    });
    assert.equal(result.ok, true, result.stderr || result.stdout);
    const files = await listFiles(ws.userWorkspaceRoot);
    assert.ok(
      files.some((f) => f.startsWith("88-Outputs/") && f.endsWith(".md")),
      `expected 88-Outputs note, got ${files.join(", ")}`,
    );
    assert.ok(!files.some((f) => f.startsWith("88-输出/") || f.startsWith("99-归档/")));
    const receipts = files.filter((f) => /receipts\//.test(f) && f.endsWith(".yaml"));
    assert.equal(receipts.length, 0, `open save-output must not invent receipts: ${receipts.join(", ")}`);
  } finally {
    await fs.rm(ws.base, { recursive: true, force: true });
  }
});
