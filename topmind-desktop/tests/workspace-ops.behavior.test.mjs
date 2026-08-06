/**
 * Behavioral writeback tests against temp FS — no Electron required.
 * Exercises path/inbox/archive ops: save → overwrite backup → delete → restore.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const electronLib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron/lib");

let tmpRoot;
let workspace;
let pathOps;
let inboxOps;
let archiveOps;
let scanOps;
let notesIndex;
let batchEvidence;
let frontmatter;

function ctx() {
  return { workspaceRoot: workspace };
}

before(async () => {
  pathOps = (await import(pathToFileURL(path.join(electronLib, "workspace-path-ops.mjs")).href)).pathOps;
  const createInboxOps = (await import(pathToFileURL(path.join(electronLib, "workspace-inbox-ops.mjs")).href)).createInboxOps;
  archiveOps = (await import(pathToFileURL(path.join(electronLib, "workspace-archive-ops.mjs")).href)).archiveOps;
  scanOps = (await import(pathToFileURL(path.join(electronLib, "workspace-scan-ops.mjs")).href)).scanOps;
  notesIndex = await import(pathToFileURL(path.join(electronLib, "notes-index.mjs")).href);
  batchEvidence = await import(pathToFileURL(path.join(electronLib, "batch-evidence.mjs")).href);
  frontmatter = await import(pathToFileURL(path.join(electronLib, "frontmatter.mjs")).href);

  const self = {};
  Object.assign(self, createInboxOps(self));
  inboxOps = self;
});

beforeEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-ops-"));
  workspace = {
    engineRoot: path.join(tmpRoot, "engine"),
    userWorkspaceRoot: path.join(tmpRoot, "ws"),
  };
  for (const d of [
    "00-收件箱",
    "20-研究",
    "20-研究/2026-示例专题",
    "88-输出",
    "99-归档",
  ]) {
    mkdirSync(path.join(workspace.userWorkspaceRoot, d), { recursive: true });
  }
  mkdirSync(workspace.engineRoot, { recursive: true });
  notesIndex.invalidateNotesIndex();
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test("savePath user save skips backup; AI save creates rotating backup", async () => {
  const rel = "20-研究/2026-示例专题/note.md";
  const create = await pathOps.savePath({ relativePath: rel, content: "# v1\n" }, ctx());
  assert.equal(create.operation, "create");
  assert.equal(create.targetPath, rel);
  assert.ok(!create.backupPath);

  // User overwrite: skip backup (frequent, low-risk, atomic write is safe)
  const userUpdate = await pathOps.savePath({ relativePath: rel, content: "# v2\n" }, ctx());
  assert.equal(userUpdate.operation, "update");
  assert.ok(!userUpdate.backupPath, "user save skips backup");
  assert.equal(
    readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8"),
    "# v2\n",
  );

  // AI save: creates rotating backup
  const aiUpdate = await pathOps.savePath(
    { relativePath: rel, content: "# v3\n", actor: "ai", confirmed: true },
    ctx(),
  );
  assert.equal(aiUpdate.operation, "update");
  assert.ok(aiUpdate.backupPath, "AI save creates backup");
  assert.match(aiUpdate.backupPath, /^99-归档\/backups\//u);
  const absBackup = path.join(workspace.userWorkspaceRoot, aiUpdate.backupPath);
  assert.ok(existsSync(absBackup));
  assert.equal(readFileSync(absBackup, "utf8"), "# v2\n");
  assert.equal(
    readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8"),
    "# v3\n",
  );
});

test("editPath surgical replace without Archive; fails on non-unique oldText", async () => {
  const rel = "20-研究/2026-示例专题/edit-me.md";
  await pathOps.savePath({
    relativePath: rel,
    content: "# Title\n\nhello world\n\nhello again\n",
  }, ctx());

  await assert.rejects(
    () => pathOps.editPath({
      relativePath: rel,
      oldText: "hello",
      newText: "hi",
    }, ctx()),
    /匹配 2 处|replaceAll/u,
  );

  const once = await pathOps.editPath({
    relativePath: rel,
    oldText: "hello world",
    newText: "你好世界",
  }, ctx());
  assert.equal(once.operation, "edit");
  assert.equal(once.replacements, 1);
  assert.equal(once.archived, false);
  assert.ok(!once.backupPath, "local edit should not write Archive");
  assert.match(
    readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8"),
    /你好世界/,
  );

  const all = await pathOps.editPath({
    relativePath: rel,
    oldText: "hello",
    newText: "hi",
    replaceAll: true,
  }, ctx());
  assert.equal(all.replacements, 1); // only "hello again" left
  assert.match(
    readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8"),
    /hi again/,
  );
});

test("grepWorkspace finds line hits and scopes; skips archive by default", async () => {
  const rel = "20-研究/2026-示例专题/grep-me.md";
  await pathOps.savePath({
    relativePath: rel,
    content: "# alpha\n\nunique-token-xyz appears here\nmore text\n",
  }, ctx());
  // noise in archive should not match by default
  mkdirSync(path.join(workspace.userWorkspaceRoot, "99-归档", "backups"), { recursive: true });
  writeFileSync(
    path.join(workspace.userWorkspaceRoot, "99-归档", "backups", "noise.md"),
    "unique-token-xyz in archive\n",
  );

  const hit = await scanOps.grepWorkspace({ pattern: "unique-token-xyz" }, ctx());
  assert.ok(hit.count >= 1);
  assert.ok(hit.results.every((r) => !r.relativePath.startsWith("99-归档")));
  assert.ok(hit.results.some((r) => r.relativePath === rel && r.line >= 1));

  const scoped = await scanOps.grepWorkspace({
    pattern: "unique-token-xyz",
    scope: "20-研究/2026-示例专题",
  }, ctx());
  assert.equal(scoped.count, 1);
  assert.equal(scoped.results[0].relativePath, rel);
});

test("readPathWindow returns line slices and truncation note", async () => {
  const rel = "20-研究/2026-示例专题/long.md";
  const lines = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`);
  await pathOps.savePath({ relativePath: rel, content: lines.join("\n") }, ctx());

  const win = await pathOps.readPathWindow({
    relativePath: rel,
    offset: 10,
    limit: 5,
  }, ctx());
  assert.equal(win.startLine, 10);
  assert.equal(win.endLine, 14);
  assert.equal(win.totalLines, 50);
  assert.equal(win.truncated, true);
  assert.match(win.content, /^line-10\nline-11/u);
  assert.match(win.note, /继续读|共 50/u);
});

test("saveNote overwrite preserves captured_at and sets updated_at", async () => {
  const topicId = "20-研究/2026-示例专题";
  const first = await pathOps.saveNote({
    topicId,
    filename: "memo.md",
    content: "hello",
    sourceType: "user-original",
  }, ctx());
  assert.equal(first.operation, "create");
  const raw1 = readFileSync(
    path.join(workspace.userWorkspaceRoot, "20-研究/2026-示例专题/memo.md"),
    "utf8",
  );
  const fm1 = frontmatter.splitMarkdownFrontmatter(raw1).data;
  assert.ok(fm1.captured_at);

  // small delay so updated_at differs if clocks allow
  await new Promise((r) => setTimeout(r, 5));

  // User save: skip backup (frequent, low-risk)
  const second = await pathOps.saveNote({
    topicId,
    filename: "memo.md",
    content: "hello world",
  }, ctx());
  assert.equal(second.operation, "update");
  // User saves skip backup; verify no backup path
  assert.ok(!second.backupPath, "user saveNote skips backup");

  const raw2 = readFileSync(
    path.join(workspace.userWorkspaceRoot, "20-研究/2026-示例专题/memo.md"),
    "utf8",
  );
  const fm2 = frontmatter.splitMarkdownFrontmatter(raw2).data;
  assert.equal(fm2.captured_at, fm1.captured_at, "captured_at must be preserved");
  assert.ok(fm2.updated_at, "updated_at must be set on overwrite");
});

test("deletePath md returns trash backup under backups/trash and restore works", async () => {
  const rel = "20-研究/2026-示例专题/doomed.md";
  await pathOps.savePath({ relativePath: rel, content: "# keep me\n" }, ctx());
  const del = await pathOps.deletePath({ relativePath: rel }, ctx());
  assert.equal(del.operation, "delete");
  assert.ok(del.backupPath);
  assert.match(del.backupPath, /99-归档\/backups\/trash\//u);
  assert.ok(!existsSync(path.join(workspace.userWorkspaceRoot, rel)));

  const restoredRel = "20-研究/2026-示例专题/restored.md";
  const rest = await archiveOps.restoreTopicReceipt({
    archiveRelativePath: del.backupPath,
    targetRelativePath: restoredRel,
  }, ctx());
  assert.equal(rest.operation, "restore");
  assert.equal(
    readFileSync(path.join(workspace.userWorkspaceRoot, restoredRel), "utf8"),
    "# keep me\n",
  );
});

test("deleteTopic parks directory under backups/trash", async () => {
  const topicId = "20-研究/2026-示例专题";
  writeFileSync(
    path.join(workspace.userWorkspaceRoot, topicId, "a.md"),
    "# a\n",
  );
  const del = await pathOps.deleteTopic({ topicId }, ctx());
  assert.equal(del.operation, "delete-topic");
  assert.ok(del.backupPath);
  assert.match(del.backupPath, /99-归档\/backups\/trash\/20-研究\//u);
  assert.ok(existsSync(path.join(workspace.userWorkspaceRoot, del.backupPath)));
  assert.ok(!existsSync(path.join(workspace.userWorkspaceRoot, topicId)));
});

test("ingestInbox + moveToTopic returns evidence chain", async () => {
  const ing = await inboxOps.ingestInbox({
    content: "snippet",
    title: "cap-test",
    sourceType: "external-capture",
  }, ctx());
  assert.equal(ing.operation, "create");
  assert.ok(ing.path.startsWith("00-收件箱/"));

  const moved = await inboxOps.moveToTopic({
    inboxRelativePath: ing.path,
    targetTopicId: "20-研究/2026-示例专题",
  }, ctx());
  assert.equal(moved.operation, "move");
  // Move preserves content (no data loss risk) — no backup needed per optimized strategy
  assert.ok(moved.newPath.includes("2026-示例专题"));
  assert.ok(existsSync(path.join(workspace.userWorkspaceRoot, moved.newPath)));
  assert.ok(!existsSync(path.join(workspace.userWorkspaceRoot, ing.path)));
});

test("notes index caches and invalidates", async () => {
  await pathOps.savePath({
    relativePath: "20-研究/2026-示例专题/idx.md",
    content: "---\ntitle: \"Alpha\"\ntags: [t1]\n---\n\nbody\n",
  }, ctx());
  const first = await scanOps.listAllNotes({ limit: 50 }, ctx());
  assert.ok(first.notes.some((n) => n.path.endsWith("idx.md")));
  assert.equal(first.cached, false);

  const second = await scanOps.listAllNotes({ limit: 50 }, ctx());
  assert.equal(second.cached, true);

  await pathOps.savePath({
    relativePath: "20-研究/2026-示例专题/idx2.md",
    content: "---\ntitle: \"Beta\"\n---\n\nx\n",
  }, ctx());
  const third = await scanOps.listAllNotes({ limit: 50 }, ctx());
  assert.equal(third.cached, false, "mutation should invalidate cache");
  assert.ok(third.notes.some((n) => n.path.endsWith("idx2.md")));
});

test("batch collector aggregates multi-write receipts", () => {
  const auto = batchEvidence.createBatchCollector("auto");
  // auto: single path → no summary (avoid noise on routine one-file saves)
  auto.record("save_file", { targetPath: "a.md", backupPath: "b" });
  assert.equal(auto.summary(), null);
  // auto: multi-path → surface receipt (honest multi-write feedback)
  auto.record("edit_file", { targetPath: "b.md" });
  const autoSum = auto.summary();
  assert.ok(autoSum);
  assert.equal(autoSum.targetPaths.length, 2);
  assert.match(autoSum.message, /多文件写回/);

  // confirm: write tools still exist; multi-file batch summary unused (pending strip handles UX)
  const confirm = batchEvidence.createBatchCollector("confirm");
  assert.equal(confirm.active, true);
  confirm.record("save_file", { targetPath: "a.md" });
  assert.equal(confirm.summary(), null);
});

test("workspaceHealth reports categories without requiring UTR", async () => {
  const health = await scanOps.workspaceHealth({}, ctx());
  assert.equal(health.ok, true);
  assert.equal(health.source, "desktop-native");
  assert.ok(health.summary.categoryCount >= 3);
});
