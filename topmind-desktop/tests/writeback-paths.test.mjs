/**
 * Unit tests for Desktop writeback path receipts.
 * Ensures backup relative paths use the real archive directory basename
 * (99-归档 or 99 Archive), not a synthetic "archive/..." prefix.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const electronLib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron/lib");

let tmpRoot;
let workspace;
let writeback;

before(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-wb-"));
  workspace = {
    engineRoot: path.join(tmpRoot, "engine"),
    userWorkspaceRoot: path.join(tmpRoot, "ws"),
  };
  mkdirSync(path.join(workspace.userWorkspaceRoot, "99-归档"), { recursive: true });
  mkdirSync(path.join(workspace.userWorkspaceRoot, "20-研究"), { recursive: true });
  mkdirSync(workspace.engineRoot, { recursive: true });

  writeback = await import(pathToFileURL(path.join(electronLib, "writeback.mjs")).href);
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test("writePathCheckpoint returns 99-归档/backups/... relative path", async () => {
  const relativePath = "20-研究/note.md";
  const content = "# old\n";
  const backup = await writeback.writePathCheckpoint(workspace, {
    savedAt: new Date().toISOString(),
    content,
    relativePath,
    keep: 3,
  });
  assert.ok(backup, "should return backup path");
  assert.match(backup, /^99-归档\/backups\/20-研究\/.+__note\.md$/u);
  assert.ok(!backup.startsWith("archive/"), "must not use synthetic archive/ prefix");
  const abs = path.join(workspace.userWorkspaceRoot, backup);
  assert.ok(existsSync(abs), `backup file should exist at ${abs}`);
  assert.equal(readFileSync(abs, "utf8"), content);
});

test("writeArchiveBackup returns 99-归档/backups/... relative path", async () => {
  const backup = await writeback.writeArchiveBackup(workspace, {
    savedAt: new Date().toISOString(),
    content: "trashed",
    pathParts: ["trash", "note.md"],
  });
  assert.ok(backup);
  assert.match(backup, /^99-归档\/backups\/trash\/note\.md$/u);
  assert.ok(existsSync(path.join(workspace.userWorkspaceRoot, backup)));
});

test("buildWritebackEvidence includes backup in affectedFiles", () => {
  const evidence = writeback.buildWritebackEvidence({
    operation: "update",
    targetPath: "20-研究/note.md",
    savedAt: new Date().toISOString(),
    backupPath: "99-归档/backups/20-研究/x__note.md",
  });
  assert.equal(evidence.targetPath, "20-研究/note.md");
  assert.ok(evidence.affectedFiles.includes("99-归档/backups/20-研究/x__note.md"));
  assert.equal(evidence.backupPath, "99-归档/backups/20-研究/x__note.md");
});

test("space-separator archive root still produces correct basename", async () => {
  const spaceWs = {
    engineRoot: workspace.engineRoot,
    userWorkspaceRoot: path.join(tmpRoot, "ws-space"),
  };
  mkdirSync(path.join(spaceWs.userWorkspaceRoot, "99 归档"), { recursive: true });
  const backup = await writeback.writePathCheckpoint(spaceWs, {
    savedAt: new Date().toISOString(),
    content: "v1",
    relativePath: "loose.md",
    keep: 2,
  });
  assert.ok(backup);
  assert.match(backup, /^99 归档\/backups\/.+__loose\.md$/u);
  assert.ok(existsSync(path.join(spaceWs.userWorkspaceRoot, backup)));
});

test("mutating workspace ops return WritebackEvidence (source contract)", () => {
  const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron");
  const pathOps = readFileSync(path.join(electronDir, "lib/workspace-path-ops.mjs"), "utf8");
  const inboxOps = readFileSync(path.join(electronDir, "lib/workspace-inbox-ops.mjs"), "utf8");
  const archiveOps = readFileSync(path.join(electronDir, "lib/workspace-archive-ops.mjs"), "utf8");
  const scanOps = readFileSync(path.join(electronDir, "lib/workspace-scan-ops.mjs"), "utf8");
  const all = pathOps + inboxOps + archiveOps;

  // saveNote durable body must go through Kernel write gate (not raw writeText)
  assert.match(pathOps, /async saveNote[\s\S]{0,1800}?kernelDurableWrite/u);
  assert.match(pathOps, /from "\.\/kernel-api\.mjs"/u);
  // Destructive / move / publish ops must build evidence (and md writes via gate)
  for (const method of [
    "deletePath",
    "renamePath",
    "publishPath",
    "deleteTopic",
  ]) {
    assert.match(
      pathOps,
      new RegExp(`async ${method}[\\s\\S]{0,8000}?buildWritebackEvidence`, "u"),
      `${method} must return buildWritebackEvidence`,
    );
  }
  assert.match(pathOps, /async publishPath[\s\S]{0,3500}?kernelDurableWrite/u);
  assert.match(pathOps, /async renamePath[\s\S]{0,4500}?kernelDurableWrite/u);
  // renameTopic: dir rename is FS; durable .md frontmatter must use kernel gate
  // (mirror renameCategory → executeWrite), never raw fs.writeFile on .md bodies.
  {
    const rtIdx = pathOps.indexOf("async renameTopic");
    assert.ok(rtIdx >= 0, "renameTopic must exist");
    const nextMethod = pathOps.indexOf("\n  async ", rtIdx + 10);
    const rtBody = pathOps.slice(rtIdx, nextMethod > rtIdx ? nextMethod : rtIdx + 4500);
    assert.match(rtBody, /kernelDurableWrite\s*\(/u, "renameTopic frontmatter must use kernelDurableWrite");
    assert.doesNotMatch(
      rtBody,
      /fs\.writeFile\s*\(/u,
      "renameTopic must not raw-write .md via fs.writeFile",
    );
    assert.match(rtBody, /buildWritebackEvidence/u);
  }
  assert.match(archiveOps, /kernelDurableWrite/u);
  assert.match(inboxOps, /async ingestInbox[\s\S]{0,8000}?buildWritebackEvidence/u);
  assert.match(inboxOps, /async moveToTopic[\s\S]{0,5000}?buildWritebackEvidence/u);
  assert.match(inboxOps, /kernelDurableWrite/u);
  assert.match(archiveOps, /async restoreTopicReceipt[\s\S]{0,2500}?buildWritebackEvidence/u);
  assert.match(archiveOps, /kernelDurableWrite/u);
  // Unified trash under backups/trash
  assert.match(pathOps, /trashAbsolute|backups.*trash/u);
  assert.match(all, /backups.*trash|trashAbsolute/u);

  // workspaceHealth resolves template roles once (hoisted above category loop)
  const healthIdx = scanOps.indexOf("async workspaceHealth");
  assert.ok(healthIdx >= 0, "workspaceHealth must exist");
  const healthSlice = scanOps.slice(healthIdx, healthIdx + 2500);
  assert.match(healthSlice, /const roleMap = await resolveCategoryRoles/u);
  assert.match(healthSlice, /const roleMap = await resolveCategoryRoles[\s\S]+for \(const e of entries\)/u);
  assert.doesNotMatch(
    healthSlice,
    /for \(const e of entries\) \{[\s\S]{0,500}?await resolveCategoryRoles/u,
  );
});

test("renameTopic updates frontmatter via Kernel write gate (behavioral)", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { setEngineRoot, getEngineRoot } = await import(
    pathToFileURL(path.join(electronLib, "workspace-home.mjs")).href
  );
  const { resetKernelApiCache } = await import(
    pathToFileURL(path.join(electronLib, "kernel-api.mjs")).href
  );
  const { pathOps } = await import(
    pathToFileURL(path.join(electronLib, "workspace-path-ops.mjs")).href
  );

  const prevEngine = getEngineRoot();
  setEngineRoot(repoRoot);
  resetKernelApiCache();

  const userRoot = path.join(tmpRoot, "rename-topic-ws");
  const workspaceCtx = {
    engineRoot: repoRoot,
    userWorkspaceRoot: userRoot,
  };
  const topicDir = path.join(userRoot, "20-研究", "2026-旧专题");
  mkdirSync(topicDir, { recursive: true });
  mkdirSync(path.join(userRoot, "99-归档", "backups"), { recursive: true });
  writeFileSync(
    path.join(topicDir, "topic.md"),
    "---\ntitle: 2026-旧专题\ntopic: 2026-旧专题\ncategory: 20-研究\n---\n\n# 2026-旧专题\n\nbody\n",
    "utf8",
  );
  writeFileSync(
    path.join(topicDir, "note.md"),
    "---\ntopic: 2026-旧专题\ncategory: 20-研究\n---\n\nnote body\n",
    "utf8",
  );

  try {
    const result = await pathOps.renameTopic(
      { topicId: "20-研究/2026-旧专题", newName: "2026-新专题" },
      { workspaceRoot: workspaceCtx },
    );
    assert.equal(result.ok, true);
    assert.equal(result.topicId, "20-研究/2026-新专题");
    assert.ok(!existsSync(topicDir), "old topic dir must be gone");
    const newTopicMd = path.join(userRoot, "20-研究", "2026-新专题", "topic.md");
    const newNoteMd = path.join(userRoot, "20-研究", "2026-新专题", "note.md");
    assert.ok(existsSync(newTopicMd), "topic.md must exist under new name");
    assert.ok(existsSync(newNoteMd), "note.md must exist under new name");
    const topicBody = readFileSync(newTopicMd, "utf8");
    const noteBody = readFileSync(newNoteMd, "utf8");
    assert.match(topicBody, /^---\n/u, "topic.md must keep YAML fence");
    assert.match(topicBody, /topic:\s*"?2026-新专题"?/u);
    assert.match(topicBody, /title:\s*"?2026-新专题"?/u);
    assert.match(topicBody, /# 2026-新专题/u);
    assert.doesNotMatch(topicBody, /2026-旧专题/u);
    assert.match(noteBody, /^---\n/u, "note.md must keep YAML fence");
    assert.match(noteBody, /topic:\s*"?2026-新专题"?/u);
    assert.doesNotMatch(noteBody, /topic:\s*"?2026-旧专题"?/u);
  } finally {
    setEngineRoot(prevEngine);
    resetKernelApiCache();
  }
});
