/**
 * Workspace-fence capability loosening: structured aliases, path fence,
 * shell policy, and write-body sanitize.
 * Drives shipped pi-fenced-fs / pi-agent-tools / ai-content-sanitize.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { convertDesktopToolsToPi, beforePiToolCall } from "../electron/lib/pi-agent-tools.mjs";
import {
  mapPiToolNameToDesktop,
  resolvePiToolPath,
  isBlockedShellToolName,
  allowsJsonWriteBody,
} from "../electron/lib/pi-fenced-fs.mjs";
import { sanitizeAiWriteBody, looksLikeJsonDump, looksLikeThinkingDump } from "../../lib/ai-content-sanitize.mjs";

function stubSdkTools(seen) {
  const record = (name) => async (args) => {
    seen[name] = args;
    return { ok: true, tool: name, args };
  };
  return {
    read_file: { description: "r", inputSchema: { type: "object", properties: {} }, execute: record("read_file") },
    save_file: { description: "w", inputSchema: { type: "object", properties: {} }, execute: record("save_file") },
    edit_file: { description: "e", inputSchema: { type: "object", properties: {} }, execute: record("edit_file") },
    search: { description: "s", inputSchema: { type: "object", properties: {} }, execute: record("search") },
    list_files: { description: "ls", inputSchema: { type: "object", properties: {} }, execute: record("list_files") },
    glob_files: { description: "g", inputSchema: { type: "object", properties: {} }, execute: record("glob_files") },
    stat_path: { description: "st", inputSchema: { type: "object", properties: {} }, execute: record("stat_path") },
    create_dir: { description: "md", inputSchema: { type: "object", properties: {} }, execute: record("create_dir") },
    copy_file: { description: "cp", inputSchema: { type: "object", properties: {} }, execute: record("copy_file") },
    rename_path: { description: "mv", inputSchema: { type: "object", properties: {} }, execute: record("rename_path") },
    delete_path: { description: "rm", inputSchema: { type: "object", properties: {} }, execute: record("delete_path") },
  };
}

describe("pi capability loosening", () => {
  it("maps every fenced alias onto a Desktop domain tool", () => {
    const expect = {
      list: "list_files", ls: "list_files", list_dir: "list_files",
      glob: "glob_files", find: "glob_files",
      stat: "stat_path",
      mkdir: "create_dir",
      mv: "rename_path", move: "rename_path",
      cp: "copy_file", copy: "copy_file",
      rm: "delete_path", delete: "delete_path",
      read: "read_file", write: "save_file", edit: "edit_file", grep: "search",
    };
    for (const [from, to] of Object.entries(expect)) {
      assert.equal(mapPiToolNameToDesktop(from), to, from);
    }
  });

  it("registers all structured aliases and never shell names", async () => {
    const seen = {};
    const tools = convertDesktopToolsToPi(stubSdkTools(seen), { workspaceRoot: "/tmp/topmind-pi-loosen-ws" });
    const names = tools.map((t) => t.name);
    for (const n of ["list", "ls", "list_dir", "glob", "find", "stat", "mkdir", "mv", "move", "cp", "copy", "rm", "delete"]) {
      assert.ok(names.includes(n), `missing alias ${n}`);
    }
    for (const n of ["bash", "shell", "exec", "run_in_workspace", "command", "eval", "subprocess"]) {
      assert.equal(names.includes(n), false, `must not register ${n}`);
    }
  });

  it("fences list/glob/mkdir/cp/mv/rm paths and allows listing the root", async () => {
    const seen = {};
    const ws = "/tmp/topmind-pi-loosen-ws";
    const tools = convertDesktopToolsToPi(stubSdkTools(seen), { workspaceRoot: ws });
    const call = async (name, args) => {
      const t = tools.find((x) => x.name === name);
      assert.ok(t, name);
      return t.execute("tc", args);
    };

    // list root (empty path) is allowed
    await call("list", {});
    assert.equal(seen.list_files.relativePath, "");

    await call("list", { path: "memory" });
    assert.equal(seen.list_files.relativePath, "memory");

    await call("glob", { pattern: "**/*.md", scope: "20-专题" });
    assert.equal(seen.glob_files.pattern, "**/*.md");
    assert.equal(seen.glob_files.scope, "20-专题");

    await call("mkdir", { path: "20-专题/2026-demo" });
    assert.equal(seen.create_dir.relativePath, "20-专题/2026-demo");

    await call("cp", { path: "a.md", dest: "b.md" });
    assert.equal(seen.copy_file.relativePath, "a.md");
    assert.equal(seen.copy_file.destRelativePath, "b.md");

    await call("mv", { path: "a.md", dest: "c.md" });
    assert.equal(seen.rename_path.relativePath, "a.md");
    assert.equal(seen.rename_path.newName, "c.md");

    await call("rm", { path: "old.md" });
    assert.equal(seen.delete_path.relativePath, "old.md");

    // escapes denied
    await assert.rejects(() => call("list", { path: "../secret" }), /outside workspace/);
    await assert.rejects(() => call("glob", { pattern: "*", scope: "../secret" }), /outside workspace/);
    await assert.rejects(() => call("mkdir", { path: "../evil" }), /outside workspace/);
    await assert.rejects(() => call("cp", { path: "a.md", dest: "../leak.md" }), /outside workspace/);
    await assert.rejects(() => call("rm", { path: "/etc/passwd" }), /outside workspace/);
    await assert.rejects(() => call("mkdir", {}), /empty-path|outside workspace/);
  });

  it("beforePiToolCall hard-blocks shell-shaped names including run_in_workspace", () => {
    for (const name of ["bash", "shell", "exec", "run_in_workspace", "command", "eval", "subprocess"]) {
      assert.equal(isBlockedShellToolName(name), true, name);
      assert.equal(beforePiToolCall({ toolName: name }).block, true, name);
    }
    assert.equal(beforePiToolCall({ toolName: "list" }), undefined);
  });
});

describe("sanitizeAiWriteBody", () => {
  it("blocks thinking dumps and JSON dumps", () => {
    assert.equal(looksLikeJsonDump('{"profile": []}'), true);
    assert.equal(looksLikeThinkingDump("Thinking: I should…"), true);
    const j = sanitizeAiWriteBody('{"profile": [], "periodic": []}');
    assert.equal(j.ok, false);
    assert.equal(j.reason, "json-dump");
    const t = sanitizeAiWriteBody("思考过程：先想想\n没有结构");
    assert.equal(t.ok, false);
  });

  it("strips thinking tags but keeps real body", () => {
    const r = sanitizeAiWriteBody("<thinking>secret chain</thinking>\n\n## Title\n\nReal body here.");
    assert.equal(r.ok, true);
    assert.match(r.text, /## Title/);
    assert.match(r.text, /Real body here/);
    assert.doesNotMatch(r.text, /secret chain/);
  });

  it("allows intentional JSON when allowJson (config files)", () => {
    const r = sanitizeAiWriteBody('{"a": 1}', { allowJson: true });
    assert.equal(r.ok, true);
    assert.match(r.text, /"a"/);
    // Still blocks thinking-only payloads
    const t = sanitizeAiWriteBody("Thinking: just thinking", { allowJson: true });
    assert.equal(t.ok, false);
  });

  it("resolvePiToolPath allowRoot covers list/glob root", () => {
    const denied = resolvePiToolPath("/tmp/ws", "");
    assert.equal(denied.ok, false);
    const rootOk = resolvePiToolPath("/tmp/ws", ".", { allowRoot: true });
    assert.equal(rootOk.ok, true);
    assert.equal(rootOk.relativePath, "");
    assert.equal(allowsJsonWriteBody("cfg.json"), true);
    assert.equal(allowsJsonWriteBody("note.md"), false);
  });
});

describe("pi domain ops (live fs)", () => {
  /** @type {string} */
  let ws;
  /** @type {string} */
  let engineRoot;
  /** @type {object} */
  let ctxObj;

  before(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-pi-ops-"));
    engineRoot = path.resolve("..");
    const { createWorkspaceContext } = await import("../electron/lib/path-model.mjs");
    ctxObj = {
      workspaceRoot: createWorkspaceContext({ engineRoot, userWorkspaceRoot: ws }),
      engineRoot,
      writeActor: "ai",
    };
    await fs.mkdir(path.join(ws, "memory"), { recursive: true });
    await fs.mkdir(path.join(ws, "10-动态"), { recursive: true });
    await fs.mkdir(path.join(ws, "99-归档"), { recursive: true });
    await fs.writeFile(path.join(ws, "10-动态/a.md"), "# A\n\nhello\n");
    await fs.writeFile(path.join(ws, "memory/todo.md"), "- task\n");
    await fs.writeFile(path.join(ws, "99-归档/old.md"), "archived\n");
    await fs.writeFile(path.join(ws, "topmind.yaml"), "contract_version: 4\n");
  });

  after(async () => {
    if (ws) await fs.rm(ws, { recursive: true, force: true });
  });

  function ctx() {
    return ctxObj;
  }

  it("listFiles / globFiles / statPath cover all planes and skip Archive by default", async () => {
    const { scanOps } = await import("../electron/lib/workspace-scan-ops.mjs");
    const c = ctx();
    const listed = await scanOps.listFiles({ relativePath: "" }, c);
    assert.equal(listed.ok, true);
    const names = listed.entries.map((e) => e.name);
    assert.ok(names.includes("memory"));
    assert.ok(names.includes("10-动态"));
    assert.ok(names.includes("topmind.yaml"));

    const mem = await scanOps.listFiles({ relativePath: "memory" }, c);
    assert.ok(mem.entries.some((e) => e.name === "todo.md" && e.type === "file"));

    const globs = await scanOps.globFiles({ pattern: "**/*.md" }, c);
    assert.equal(globs.ok, true);
    const paths = globs.matches.map((m) => m.relativePath);
    assert.ok(paths.includes("10-动态/a.md"));
    assert.ok(paths.includes("memory/todo.md"));
    assert.ok(!paths.some((p) => p.startsWith("99-归档")), "default skips archive");

    const withArch = await scanOps.globFiles({ pattern: "**/*.md", includeArchive: true }, c);
    assert.ok(withArch.matches.some((m) => m.relativePath.startsWith("99-归档")));

    const st = await scanOps.statPath({ relativePath: "10-动态/a.md" }, c);
    assert.equal(st.ok, true);
    assert.equal(st.type, "file");
    assert.ok(st.size > 0);
    assert.equal(st.ext, ".md");
    assert.equal(st.isBinaryExt, false);

    // Binary hint: media extension flagged so agents do not try to read it as text.
    await fs.writeFile(path.join(ws, "10-动态", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const png = await scanOps.statPath({ relativePath: "10-动态/shot.png" }, c);
    assert.equal(png.isBinaryExt, true);
    assert.equal(png.ext, ".png");
  });

  it("createDir refuses out-of-fence paths and occupied targets", async () => {
    const { pathOps } = await import("../electron/lib/workspace-path-ops.mjs");
    const c = ctx();
    // Path fence: escape must be denied before mkdir.
    await assert.rejects(
      () => pathOps.createDir({ relativePath: "../escape-dir", actor: "ai", confirmed: true }, c),
      /outside|fence|denied|invalid|escape|path/i,
    );
    // Occupied target (topmind.yaml file) cannot become a directory.
    await assert.rejects(
      () => pathOps.createDir({ relativePath: "topmind.yaml", actor: "ai", confirmed: true }, c),
      /目标已存在|targetExists|已存在/i,
    );
  });

  it("createDir + copyFileTo go through the write gate", async () => {
    const { pathOps } = await import("../electron/lib/workspace-path-ops.mjs");
    const c = ctx();
    const mkdir = await pathOps.createDir({ relativePath: "20-专题/2026-demo", actor: "ai", confirmed: true }, c);
    assert.equal(mkdir.ok, true);
    const st = await fs.stat(path.join(ws, "20-专题/2026-demo"));
    assert.equal(st.isDirectory(), true);
    // idempotent
    const again = await pathOps.createDir({ relativePath: "20-专题/2026-demo", actor: "ai", confirmed: true }, c);
    assert.equal(again.ok, true);
    assert.equal(again.existed, true);

    const copy = await pathOps.copyFileTo({
      relativePath: "10-动态/a.md",
      destRelativePath: "20-专题/2026-demo/a-copy.md",
      actor: "ai",
      confirmed: true,
    }, c);
    assert.equal(copy.ok, true);
    const body = await fs.readFile(path.join(ws, "20-专题/2026-demo/a-copy.md"), "utf8");
    assert.match(body, /hello/);

    await assert.rejects(
      () => pathOps.copyFileTo({
        relativePath: "10-动态/a.md",
        destRelativePath: "20-专题/2026-demo/a-copy.md",
        actor: "ai",
        confirmed: true,
      }, c),
      /exists|已存在/i,
    );

    const over = await pathOps.copyFileTo({
      relativePath: "10-动态/a.md",
      destRelativePath: "20-专题/2026-demo/a-copy.md",
      overwrite: true,
      actor: "ai",
      confirmed: true,
    }, c);
    assert.equal(over.ok, true);
  });

  it("readPathWindow reports truncation and accepts encoding", async () => {
    const { pathOps } = await import("../electron/lib/workspace-path-ops.mjs");
    const c = ctx();
    const long = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join("\n");
    await fs.writeFile(path.join(ws, "10-动态/long.md"), long);
    const win = await pathOps.readPathWindow({
      relativePath: "10-动态/long.md",
      offset: 1,
      limit: 10,
    }, c);
    assert.equal(win.truncated, true);
    assert.match(win.note || "", /10|1–10|lines/i);

    // binary without encoding → refuse
    await fs.writeFile(path.join(ws, "10-动态/bin.dat"), Buffer.from([0x00, 0x01, 0x41, 0x00]));
    const bin = await pathOps.readPathWindow({ relativePath: "10-动态/bin.dat" }, c);
    assert.equal(bin.ok, false);
    assert.equal(bin.error, "binary-file");

    // encoding= force-decodes
    const forced = await pathOps.readPathWindow({
      relativePath: "10-动态/bin.dat",
      encoding: "utf8",
    }, c);
    assert.notEqual(forced.error, "binary-file");
  });
});
