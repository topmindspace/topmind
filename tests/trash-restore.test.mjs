/**
 * Trash list + restore (Tools & Logs Care tab backend).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronLib = path.join(root, "topmind-desktop/electron/lib");

let tmp;
let ws;
let ctx;
let archiveOps;
let kernelApi;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-trash-"));
  ws = path.join(tmp, "ws");
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
    "utf8",
  );
  const home = await import(pathToFileURL(path.join(electronLib, "workspace-home.mjs")).href);
  home.setEngineRoot(root);
  kernelApi = await import(pathToFileURL(path.join(electronLib, "kernel-api.mjs")).href);
  kernelApi.resetKernelApiCache();
  archiveOps = (
    await import(pathToFileURL(path.join(electronLib, "workspace-archive-ops.mjs")).href)
  ).archiveOps;
  ctx = {
    workspaceRoot: { engineRoot: root, userWorkspaceRoot: ws },
    appSettings: { writebackMode: "auto" },
    engineRoot: root,
  };
});

after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("trash restore", () => {
  it("lists locked delete trash and restores to original path", async () => {
    // Seed a locked note, delete recoverably via kernel
    const rel = "10-动态/locked-trash.md";
    const abs = path.join(ws, rel);
    fs.writeFileSync(abs, "---\nprotection: locked\n---\n\nkeep-me\n", "utf8");
    const del = kernelApi
      ? (await import(pathToFileURL(path.join(electronLib, "kernel-api.mjs")).href))
      : null;
    const kernel = await kernelApi.loadKernelApi();
    const ev = kernel.executeDelete({
      targetPath: abs,
      workspaceRoot: ws,
      actor: "ai",
      confirmed: true,
    });
    assert.ok(ev.backupPath || ev.backup_path, "locked delete → trash");
    assert.ok(!fs.existsSync(abs));

    const list = await archiveOps.listTrashItems({ limit: 20 }, ctx);
    assert.ok(list.items.length >= 1, JSON.stringify(list));
    const item = list.items.find((x) => x.name === "locked-trash.md");
    assert.ok(item, JSON.stringify(list.items));
    assert.equal(item.originalRelativePath, rel);

    const restored = await archiveOps.restoreTrashItem(
      { trashRelativePath: item.trashRelativePath },
      ctx,
    );
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.ok(fs.existsSync(abs), "restored file exists");
    assert.match(fs.readFileSync(abs, "utf8"), /keep-me/);
    void del;
  });
});
