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
  it("yaml confirm + appSettings auto + AI unconfirmed → pending, no disk write", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "10-动态/confirm-ai.md";
    const content = "---\ntitle: t\nprotection: open\n---\n\nhello\n";
    const ev = await pathOps.savePath(
      { relativePath: rel, content, actor: "ai", confirmed: false },
      ctx,
    );
    assert.equal(ev.pending || ev.needsConfirm, true, `expected pending, got ${JSON.stringify(ev)}`);
    assert.equal(ev.wroteFiles, false);
    assert.ok(!fs.existsSync(path.join(ws, rel)), "must not write when pending");
  });

  it("stash + confirmPendingWrite via savePath confirmed writes body", async () => {
    kernelApi.resetKernelApiCache();
    const rel = "10-动态/accept-me.md";
    const content = "---\ntitle: accept\n---\n\naccepted body\n";
    const stashed = pending.stashPendingWrite({
      relativePath: rel,
      content,
      toolName: "save_file",
    });
    const taken = pending.takePendingWrite(stashed.id);
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

  it("edit_file path with confirm leaves file unchanged until accept", async () => {
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
    assert.equal(ev.pending || ev.needsConfirm, true, JSON.stringify(ev));
    assert.match(fs.readFileSync(path.join(ws, rel), "utf8"), /old text here/);
    const next = "---\ntitle: e\n---\n\nnew text here\n";
    const done = await pathOps.savePath(
      { relativePath: rel, content: next, actor: "ai", confirmed: true },
      ctx,
    );
    assert.ok(!done.pending);
    assert.match(fs.readFileSync(path.join(ws, rel), "utf8"), /new text here/);
  });

  it("executeWrite with writebackModeOverride=confirm and yaml auto yields pending", async () => {
    // temp auto contract for override-only case
    const autoWs = path.join(tmp, "auto-ws");
    fs.mkdirSync(path.join(autoWs, "10-动态"), { recursive: true });
    fs.writeFileSync(
      path.join(autoWs, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    const { executeWrite } = await import(pathToFileURL(path.join(root, "lib/writeback-engine.mjs")).href);
    const target = path.join(autoWs, "10-动态/override.md");
    const pendingEv = executeWrite({
      targetPath: target,
      content: "---\ntitle: o\n---\n\nx\n",
      workspaceRoot: autoWs,
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
      skipShadow: true,
    });
    assert.equal(pendingEv.pending || pendingEv.needsConfirm, true);
    assert.ok(!fs.existsSync(target));
    assert.equal(typeof pendingEv.previewContent, "string");
    assert.match(pendingEv.previewContent, /title: o/);
  });

  it("previewContent survives toSurfaceEvidence and asDesktopEvidence for append-style pending", async () => {
    kernelApi.resetKernelApiCache();
    // appendCoreMemory builds full file body then gates — surface must keep previewContent
    const ev = await pathOps.appendCoreMemory(
      {
        entry: "prefer dark mode",
        section: "偏好",
        actor: "ai",
        confirmed: false,
      },
      ctx,
    );
    assert.equal(ev.pending || ev.needsConfirm, true, JSON.stringify(ev));
    assert.equal(typeof ev.previewContent, "string", "previewContent must survive surface evidence");
    assert.match(ev.previewContent, /prefer dark mode/);
    assert.ok(ev.targetPath || ev.target_path);

    // wrapWrite-equivalent stash using previewContent (no args.content)
    const rel = ev.targetPath || "memory/profile.md";
    const stashed = pending.stashPendingWrite({
      relativePath: rel,
      content: ev.previewContent,
      toolName: "append_core_memory",
    });
    assert.ok(stashed.id);
    const taken = pending.takePendingWrite(stashed.id);
    assert.match(taken.content, /prefer dark mode/);
    const done = await pathOps.savePath(
      { relativePath: taken.relativePath, content: taken.content, actor: "ai", confirmed: true },
      ctx,
    );
    assert.ok(!done.pending);
    assert.match(fs.readFileSync(path.join(ws, taken.relativePath), "utf8"), /prefer dark mode/);
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

  it("describeWritebackModeForPrompt(confirm) is Model B only", async () => {
    const { describeWritebackModeForPrompt, MODEL_A_FORBIDDEN_RE } = await import(
      pathToFileURL(path.join(electronLib, "writeback-mode-copy.mjs")).href
    );
    const line = describeWritebackModeForPrompt("confirm");
    assert.doesNotMatch(line, MODEL_A_FORBIDDEN_RE);
    assert.match(line, /待确认写入|保存前问我/);
    assert.match(line, /write 工具|save_file/);
  });

  it("toSurfaceEvidence keeps previewContent for pure Kernel pending", async () => {
    const { executeWrite, toSurfaceEvidence } = await import(
      pathToFileURL(path.join(root, "lib/writeback-engine.mjs")).href
    );
    const target = path.join(ws, "10-动态/preview-keep.md");
    const body = "---\ntitle: keep\n---\n\nfull body for stash\n";
    const pendingEv = executeWrite({
      targetPath: target,
      content: body,
      workspaceRoot: ws,
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
      skipShadow: true,
    });
    assert.match(pendingEv.previewContent || "", /full body for stash/);
    // double-normalize should still keep it
    const again = toSurfaceEvidence(
      {
        operation: "update",
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

  it("explicitWritebackMode session override can force confirm over yaml auto", async () => {
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
    assert.equal(ev.pending || ev.needsConfirm, true, JSON.stringify(ev));
    assert.ok(!fs.existsSync(path.join(autoWs, rel)));
  });
});
