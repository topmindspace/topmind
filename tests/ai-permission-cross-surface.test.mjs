/**
 * AI write gate: auto persist / confirm pending / locked refuse.
 * Drives Desktop pathOps + Obsidian preciseEditWorkspace + Kernel executeWrite.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronLib = path.join(root, "topmind-desktop/electron/lib");
const pluginOps = path.join(root, "obsidian-plugin/src/services/kernel-workspace-ops.ts");

function seedWs(dir, mode) {
  fs.mkdirSync(path.join(dir, "20-专题", "2026-权限"), { recursive: true });
  fs.mkdirSync(path.join(dir, "99-归档", "backups"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "topmind.yaml"),
    `contract_version: 4\nwriteback:\n  mode: ${mode}\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n`,
    "utf8",
  );
}

describe("AI permission cross-surface", () => {
  let tmp;
  let autoWs;
  let confirmWs;
  let pathOps;
  let kernelApi;
  let preciseEditWorkspace;
  let kernel;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-ai-perm-"));
    autoWs = path.join(tmp, "auto");
    confirmWs = path.join(tmp, "confirm");
    seedWs(autoWs, "auto");
    seedWs(confirmWs, "confirm");

    const home = await import(pathToFileURL(path.join(electronLib, "workspace-home.mjs")).href);
    home.setEngineRoot(root);
    kernelApi = await import(pathToFileURL(path.join(electronLib, "kernel-api.mjs")).href);
    kernelApi.resetKernelApiCache();
    pathOps = (await import(pathToFileURL(path.join(electronLib, "workspace-path-ops.mjs")).href)).pathOps;
    kernel = await import(pathToFileURL(path.join(root, "lib/kernel-api.mjs")).href);
    preciseEditWorkspace = (await import(pathToFileURL(pluginOps).href)).preciseEditWorkspace;
  });

  after(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function desktopCtx(ws) {
    return {
      workspaceRoot: { engineRoot: root, userWorkspaceRoot: ws },
      engineRoot: root,
    };
  }

  it("AI auto persist writes the file", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "20-专题/2026-权限/auto.md";
    const ev = await pathOps.savePath(
      { relativePath: rel, content: "---\ntitle: a\n---\n\nhello\n", actor: "ai", confirmed: true },
      desktopCtx(autoWs),
    );
    assert.ok(!ev.pending, JSON.stringify(ev));
    assert.equal(fs.readFileSync(path.join(autoWs, rel), "utf8").includes("hello"), true);
  });

  it("AI confirm leaves file unchanged until accept", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "20-专题/2026-权限/pending.md";
    const ev = await pathOps.savePath(
      { relativePath: rel, content: "---\ntitle: p\n---\n\nsecret\n", actor: "ai", confirmed: false },
      desktopCtx(confirmWs),
    );
    assert.equal(ev.pending || ev.needsConfirm, true, JSON.stringify(ev));
    assert.ok(!fs.existsSync(path.join(confirmWs, rel)));
  });

  it("AI locked overwrite refuses and writes nothing (Desktop + Obsidian)", async () => {
    const rel = "20-专题/2026-权限/locked.md";
    const locked = "---\nprotection: locked\n---\n\nkeep-me\n";
    fs.writeFileSync(path.join(autoWs, rel), locked, "utf8");
    kernelApi.resetKernelApiCache();
    await assert.rejects(
      () => pathOps.savePath(
        { relativePath: rel, content: "---\nprotection: locked\n---\n\nhacked\n", actor: "ai", confirmed: true },
        desktopCtx(autoWs),
      ),
      /denied|locked|Write/i,
    );
    assert.match(fs.readFileSync(path.join(autoWs, rel), "utf8"), /keep-me/);

    fs.writeFileSync(path.join(autoWs, rel), locked, "utf8");
    const obs = preciseEditWorkspace(kernel, autoWs, {
      relativePath: rel,
      oldText: "keep-me",
      newText: "hacked",
      actor: "ai",
      confirmed: true,
      writebackMode: "auto",
    });
    assert.equal(obs.ok, false, JSON.stringify(obs));
    assert.match(fs.readFileSync(path.join(autoWs, rel), "utf8"), /keep-me/);
  });

  it("Obsidian confirm edit is pending and does not write", () => {
    const rel = "20-专题/2026-权限/obs-confirm.md";
    fs.writeFileSync(path.join(confirmWs, rel), "---\ntitle: c\n---\n\nold span here\n", "utf8");
    const ev = preciseEditWorkspace(kernel, confirmWs, {
      relativePath: rel,
      oldText: "old span here",
      newText: "new span here",
      actor: "ai",
      confirmed: false,
      writebackMode: "confirm",
    });
    assert.equal(ev.pending || ev.ok === false, true, JSON.stringify(ev));
    assert.match(fs.readFileSync(path.join(confirmWs, rel), "utf8"), /old span here/);
    assert.doesNotMatch(fs.readFileSync(path.join(confirmWs, rel), "utf8"), /new span here/);
  });
});
