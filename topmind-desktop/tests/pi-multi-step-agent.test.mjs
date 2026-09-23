/**
 * Pi multi-step agent drill — one realistic workspace task through fenced
 * aliases + real pathOps/scanOps (not stubs). Proves the loosened tool surface
 * can complete: discover → create → write → read → edit → search → copy → stat.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { convertDesktopToolsToPi, beforePiToolCall } from "../electron/lib/pi-agent-tools.mjs";
import { pathOps } from "../electron/lib/workspace-path-ops.mjs";
import { scanOps } from "../electron/lib/workspace-scan-ops.mjs";

function realSdkTools(ctx) {
  const wrap = (fn) => async (args) => fn(args, ctx);
  return {
    read_file: {
      description: "read",
      inputSchema: { type: "object", properties: {} },
      execute: wrap(async (args, c) => {
        const r = await pathOps.readPathWindow({ relativePath: args.relativePath, limit: args.limit }, c);
        return r;
      }),
    },
    save_file: {
      description: "write",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => pathOps.savePath({ relativePath: args.relativePath, content: args.content, actor: "ai", confirmed: true }, c)),
    },
    edit_file: {
      description: "edit",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => pathOps.editPath({
        relativePath: args.relativePath,
        oldText: args.oldText,
        newText: args.newText,
        actor: "ai",
        confirmed: true,
      }, c)),
    },
    search: {
      description: "search",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => scanOps.grepWorkspace({ pattern: args.query, scope: args.scope, includeArchive: args.includeArchive }, c)),
    },
    list_files: {
      description: "ls",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => scanOps.listFiles({ relativePath: args.relativePath || "", includeSystem: args.includeSystem }, c)),
    },
    glob_files: {
      description: "glob",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => scanOps.globFiles({ pattern: args.pattern, scope: args.scope, includeArchive: args.includeArchive }, c)),
    },
    stat_path: {
      description: "stat",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => scanOps.statPath({ relativePath: args.relativePath }, c)),
    },
    create_dir: {
      description: "mkdir",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => pathOps.createDir({ relativePath: args.relativePath, actor: "ai", confirmed: true }, c)),
    },
    copy_file: {
      description: "cp",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => pathOps.copyFileTo({
        relativePath: args.relativePath,
        destRelativePath: args.destRelativePath,
        overwrite: args.overwrite,
        actor: "ai",
        confirmed: true,
      }, c)),
    },
    rename_path: {
      description: "mv",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => pathOps.renamePath({
        relativePath: args.relativePath,
        newName: args.newName || args.dest,
        actor: "ai",
        confirmed: true,
      }, c)),
    },
    delete_path: {
      description: "rm",
      inputSchema: { type: "object", properties: {} },
      execute: wrap((args, c) => pathOps.deletePath({
        relativePath: args.relativePath,
        actor: "ai",
        confirmed: true,
        permanent: false,
      }, c)),
    },
  };
}

describe("pi multi-step agent drill", () => {
  /** @type {string} */
  let ws;
  /** @type {object} */
  let ctx;
  /** @type {object[]} */
  let tools;

  before(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-pi-multi-"));
    await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
    await fs.mkdir(path.join(ws, "20-专题"), { recursive: true });
    await fs.mkdir(path.join(ws, "99-归档", "backups"), { recursive: true });
    await fs.writeFile(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    // ctx.workspaceRoot must be a WorkspaceContext object (engineRoot +
    // userWorkspaceRoot) so resolveDataRoot / sp() fence to the real root —
    // a bare string path walks to a sibling topmind-workspace and fails closed.
    const { createWorkspaceContext } = await import("../electron/lib/path-model.mjs");
    const engineRoot = path.resolve("..");
    ctx = {
      workspaceRoot: createWorkspaceContext({ engineRoot, userWorkspaceRoot: ws }),
      userWorkspaceRoot: ws,
      categoriesRoot: ws,
      inboxRootPath: path.join(ws, "00-收件箱"),
      archiveRootPath: path.join(ws, "99-归档"),
      engineRoot,
      writeActor: "ai",
      explicitWritebackMode: "auto",
    };
    tools = convertDesktopToolsToPi(realSdkTools(ctx), { workspaceRoot: ws });
  });

  after(async () => {
    await fs.rm(ws, { recursive: true, force: true });
  });

  async function call(name, args) {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, `tool ${name}`);
    const out = await t.execute("tc", args, undefined, () => {});
    // Pi AgentTool execute wraps domain results as { content, details }.
    return out && typeof out === "object" && "details" in out ? out.details : out;
  }

  it("completes discover → create → write → read → edit → search → copy → stat", async () => {
    // 1) Discover the workspace root (empty path = root).
    const listed = await call("list", {});
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "20-专题"));

    // 2) Create a topic dir via fenced mkdir.
    const mkdir = await call("mkdir", { path: "20-专题/2026-agent-drill" });
    assert.equal(mkdir.ok, true);

    // 3) Write a note via fenced write → Kernel writeback.
    const wrote = await call("write", {
      path: "20-专题/2026-agent-drill/note.md",
      content: "---\ntitle: Agent Drill\n---\n\n# Agent Drill\n\n初稿：记录一次多步工具编排。\n",
    });
    assert.equal(wrote.ok, true);

    // 4) Read it back through the fence.
    const read = await call("read", { path: "20-专题/2026-agent-drill/note.md", limit: 50 });
    assert.ok(JSON.stringify(read).includes("Agent Drill"));

    // 5) Surgical edit via fenced edit (unique span).
    const edited = await call("edit", {
      path: "20-专题/2026-agent-drill/note.md",
      oldText: "初稿：记录一次多步工具编排。",
      newText: "定稿：多步工具编排完成（list→mkdir→write→read→edit→search→copy→stat）。",
    });
    assert.equal(edited.ok, true);

    // 6) Search finds the edited marker (default skips Archive).
    const hits = await call("grep", { pattern: "多步工具编排完成" });
    assert.ok(hits.ok !== false);
    const hitText = JSON.stringify(hits);
    assert.match(hitText, /多步工具编排完成/);
    assert.doesNotMatch(hitText, /99-归档/);

    // 7) Copy the note inside the fence (dest must not exist).
    const copied = await call("cp", {
      path: "20-专题/2026-agent-drill/note.md",
      dest: "20-专题/2026-agent-drill/note-copy.md",
    });
    assert.equal(copied.ok, true);

    // 8) Stat the copy — text note, non-binary hint.
    const st = await call("stat", { path: "20-专题/2026-agent-drill/note-copy.md" });
    assert.equal(st.ok, true);
    assert.equal(st.type, "file");
    assert.equal(st.ext, ".md");
    assert.equal(st.isBinaryExt, false);

    // Shell names stay blocked mid-drill.
    assert.equal(beforePiToolCall({ toolName: "bash" })?.block, true);
  });

  it("refuses path escapes mid-drill and keeps bash blocked", async () => {
    await assert.rejects(() => call("write", { path: "../escape.md", content: "x" }), /outside|fence|denied|boundary/i);
    await assert.rejects(() => call("list", { path: "../../etc" }));
    assert.equal(beforePiToolCall({ toolName: "run_in_workspace" })?.block, true);
    assert.equal(beforePiToolCall({ toolName: "eval" })?.block, true);
  });
});
