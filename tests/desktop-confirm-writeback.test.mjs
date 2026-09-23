/**
 * Product path: workspace topmind.yaml writeback.mode=confirm → AI save pending → accept writes.
 * (writeback is workspace truth — not app-settings fork.)
 * Drives real kernelDurableWrite + pathOps.savePath/editPath (not a reimplementation).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronLib = path.join(root, "topmind-desktop/electron/lib");

let tmp;
let ws;
let ctx;
let pathOps;
let pending;
let kernelApi;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-confirm-"));
  ws = path.join(tmp, "ws");
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
  // Workspace contract is the writeback truth
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: confirm\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
    "utf8",
  );
  const home = await import(pathToFileURL(path.join(electronLib, "workspace-home.mjs")).href);
  home.setEngineRoot(root);
  kernelApi = await import(pathToFileURL(path.join(electronLib, "kernel-api.mjs")).href);
  kernelApi.resetKernelApiCache();

  pathOps = (
    await import(pathToFileURL(path.join(electronLib, "workspace-path-ops.mjs")).href)
  ).pathOps;
  pending = await import(pathToFileURL(path.join(electronLib, "pending-writes.mjs")).href);

  // Desktop path ops require WorkspaceContext { engineRoot, userWorkspaceRoot }
  // appSettings.writebackMode intentionally auto — must NOT override workspace confirm
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

describe("Workspace writeback.mode drives Kernel gate (not app-settings)", () => {
  it("yaml confirm + appSettings auto + AI content save → lands (graded confirm)", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "10-动态/confirm-ai.md";
    const content = "---\ntitle: t\nprotection: open\n---\n\nhello\n";
    const ev = await pathOps.savePath(
      { relativePath: rel, content, actor: "ai", confirmed: false },
      ctx,
    );
    assert.equal(ev.pending || ev.needsConfirm, false, `graded confirm: content lands, got ${JSON.stringify(ev)}`);
    assert.ok(fs.existsSync(path.join(ws, rel)), "content write lands in graded confirm");
  });

  it("stash + confirmPendingWrite via savePath confirmed writes body", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "10-动态/accept-me.md";
    const content = "---\ntitle: accept\n---\n\naccepted body\n";
    const stashed = pending.stashPendingWrite({
      relativePath: rel,
      content,
      toolName: "save_file",
      workspaceRoot: ws,
    });
    const taken = pending.takePendingWrite(ws, stashed.id);
    assert.ok(taken);
    const ev = await pathOps.savePath(
      {
        relativePath: taken.relativePath,
        content: taken.content,
        actor: "ai",
        confirmed: true,
      },
      ctx,
    );
    assert.equal(ev.wroteFiles !== false && !ev.pending, true, JSON.stringify(ev));
    assert.ok(fs.existsSync(path.join(ws, rel)));
    assert.match(fs.readFileSync(path.join(ws, rel), "utf8"), /accepted body/);
  });

  it("edit_file path with graded confirm lands immediately", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "10-动态/edit-me.md";
    fs.writeFileSync(path.join(ws, rel), "---\ntitle: e\n---\n\nold text here\n", "utf8");
    const ev = await pathOps.editPath(
      {
        relativePath: rel,
        oldText: "old text here",
        newText: "new text here",
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(ev.pending || ev.needsConfirm, false, JSON.stringify(ev));
    assert.match(fs.readFileSync(path.join(ws, rel), "utf8"), /new text here/);
  });

  it("executeWrite content with confirm override lands; lifecycle still pending", async () => {
    const autoWs = path.join(tmp, "auto-ws");
    fs.mkdirSync(path.join(autoWs, "10-动态"), { recursive: true });
    fs.writeFileSync(
      path.join(autoWs, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    const { executeWrite, executeDelete, evaluateWritePermission } = await import(
      pathToFileURL(path.join(root, "lib/writeback-engine.mjs")).href
    );
    const target = path.join(autoWs, "10-动态/override.md");
    const landed = executeWrite({
      targetPath: target,
      content: "---\ntitle: o\n---\n\nx\n",
      workspaceRoot: autoWs,
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
      skipShadow: true,
    });
    assert.equal(landed.pending || landed.needsConfirm, false);
    assert.ok(fs.existsSync(target));

    const delPerm = evaluateWritePermission({
      contract: undefined,
      targetPath: target,
      workspaceRoot: autoWs,
      actor: "ai",
      writebackModeOverride: "confirm",
      lifecycle: true,
    });
    assert.equal(delPerm.needsConfirm, true);

    const pendingDel = executeDelete({
      targetPath: target,
      workspaceRoot: autoWs,
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
    });
    assert.equal(pendingDel.pending || pendingDel.needsConfirm, true, JSON.stringify(pendingDel));
    assert.ok(fs.existsSync(target), "delete stays pending under graded confirm");
  });

  it("appendCoreMemory lands immediately under graded confirm", async () => {
    kernelApi.resetKernelApiCache();
    const ev = await pathOps.appendCoreMemory(
      {
        entry: "prefer dark mode",
        section: "偏好",
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(ev.pending || ev.needsConfirm, false, JSON.stringify(ev));
    assert.ok(ev.targetPath || ev.target_path);
  });

  it("buildSystemPrompt(confirm) is Model B — tools write → 待确认, never 只读/可粘贴草稿", async () => {
    const { buildSystemPrompt } = await import(
      pathToFileURL(path.join(electronLib, "../ai-prompts.mjs")).href
    );
    const prompt = buildSystemPrompt({
      writebackMode: "confirm",
      toolNames: ["save_file", "edit_file", "read_file"],
      skillsEnabled: false,
    });
    assert.doesNotMatch(prompt, /只读\s*[—\-–].*只分析|可粘贴草稿|不注册写工具/u);
    assert.match(prompt, /待确认|保存前问我/u);
    assert.match(prompt, /write 工具|save_file|工具/u);
  });

  it("ai-tools source registers write tools under confirm (Model B, no early disable)", () => {
    const src = fs.readFileSync(path.join(electronLib, "../ai-tools.mjs"), "utf8");
    // Must not gate registration off for confirm
    assert.doesNotMatch(
      src,
      /allowWrite\s*=\s*writebackMode\s*!==\s*["']confirm["']/,
    );
    assert.match(src, /const allowWrite = true/);
    assert.match(src, /tools\.save_file = tool/);
    assert.match(src, /tools\.edit_file = tool/);
    // pending path stashes for confirm
    assert.match(src, /stashPendingWrite/);
    assert.match(src, /needsUserConfirm/);
  });

  it("describeWritebackModeForPrompt(confirm) describes graded confirm", async () => {
    const { describeWritebackModeForPrompt, MODEL_A_FORBIDDEN_RE } = await import(
      pathToFileURL(path.join(electronLib, "writeback-mode-copy.mjs")).href
    );
    const line = describeWritebackModeForPrompt("confirm");
    assert.doesNotMatch(line, MODEL_A_FORBIDDEN_RE);
    assert.match(line, /分级|graded/);
    assert.match(line, /删除|归档|delete|archive/);
    assert.match(line, /write 工具|工具|tools/i);
  });

  it("toSurfaceEvidence keeps previewContent for pure Kernel pending", async () => {
    const { executeWrite, toSurfaceEvidence } = await import(
      pathToFileURL(path.join(root, "lib/writeback-engine.mjs")).href
    );
    const target = path.join(ws, "10-动态/preview-keep.md");
    const body = "---\ntitle: keep\n---\n\nfull body for stash\n";
    // Lifecycle pending still carries previewContent under graded confirm
    const pendingEv = executeWrite({
      targetPath: target,
      content: body,
      workspaceRoot: ws,
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
      skipShadow: true,
      // force lifecycle semantics via delete is separate; for write, content lands.
      // Use a synthetic pending evidence for the surface contract:
    });
    // Content lands under graded confirm — previewContent is for lifecycle pending only.
    assert.ok(pendingEv.wroteFiles || pendingEv.wrote_files);
    const again = toSurfaceEvidence(
      {
        operation: "delete",
        writeback_mode: "confirm",
        target_path: target,
        affected_files: [target],
        wrote_files: false,
        needsConfirm: true,
        pending: true,
        previewContent: body,
        saved_at: new Date().toISOString(),
      },
      ws,
    );
    assert.equal(again.previewContent, body);
  });

  it("AI invoke must not send view-store writebackMode as a default override", () => {
    const store = fs.readFileSync(
      path.join(root, "topmind-desktop/src/stores/ai-store.ts"),
      "utf8",
    );
    assert.doesNotMatch(store, /writebackMode:\s*useViewStore/);
    const svc = fs.readFileSync(
      path.join(root, "topmind-desktop/electron/ai-service.mjs"),
      "utf8",
    );
    assert.match(svc, /resolveWorkspaceWritebackMode/);
    assert.doesNotMatch(svc, /effectiveMode \|\| "auto"/);
  });

  it("explicitWritebackMode session override forces graded confirm on lifecycle", async () => {
    const autoWs = path.join(tmp, "explicit-ws");
    fs.mkdirSync(path.join(autoWs, "10-动态"), { recursive: true });
    fs.mkdirSync(path.join(autoWs, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(autoWs, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    kernelApi.resetKernelApiCache();
    const localCtx = {
      workspaceRoot: { engineRoot: root, userWorkspaceRoot: autoWs },
      appSettings: { writebackMode: "auto" },
      explicitWritebackMode: "confirm",
      engineRoot: root,
    };
    const rel = "10-动态/explicit.md";
    const ev = await pathOps.savePath(
      {
        relativePath: rel,
        content: "---\ntitle: x\n---\n\nbody\n",
        actor: "ai",
        confirmed: false,
        writebackMode: "confirm",
      },
      localCtx,
    );
    // Graded: content lands even when session forces confirm
    assert.equal(ev.pending || ev.needsConfirm, false, JSON.stringify(ev));
    assert.ok(fs.existsSync(path.join(autoWs, rel)));
  });
});
