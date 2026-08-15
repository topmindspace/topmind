/**
 * Delete copy must match Kernel isRecoverableLifecycle:
 * ordinary open notes have no trash; locked / memory / topic.md / 88-delivery do.
 * Drives shipped locale JSON + formatWritebackToast + the Kernel predicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isRecoverableLifecycle } from "../../lib/writeback-engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const ALWAYS_ARCHIVE_LIE =
  /删除前会自动备份|可从 99-Archive 恢复|可从 Archive 恢复|已移入归档备份|删除到 Archive|A backup will be saved to 99-Archive|restorable from Archive|Delete to Archive|backed up to 99-Archive/iu;

test("Kernel: ordinary open notes are not recoverable; locked/core are", () => {
  assert.equal(
    isRecoverableLifecycle({ protection: "open", relativePath: "20-专题/2026-x/scratch.md" }),
    false,
  );
  assert.equal(
    isRecoverableLifecycle({ protection: "open", relativePath: "00-收件箱/clip.md" }),
    false,
  );
  assert.equal(
    isRecoverableLifecycle({ protection: "locked", relativePath: "20-专题/2026-x/scratch.md" }),
    true,
  );
  assert.equal(
    isRecoverableLifecycle({ protection: "open", relativePath: "memory/profile.md" }),
    true,
  );
  assert.equal(
    isRecoverableLifecycle({ protection: "open", relativePath: "20-专题/2026-x/topic.md" }),
    true,
  );
  assert.equal(
    isRecoverableLifecycle({
      protection: "open",
      relativePath: "20-专题/2026-x",
      isDirectory: true,
      hasTopicHome: true,
    }),
    true,
  );
  assert.equal(
    isRecoverableLifecycle({ protection: "open", relativePath: "88-输出/2026-01-01-draft.md" }),
    true,
  );
});

test("shipped delete copy does not promise Archive for every delete", () => {
  const zhShell = readJson("src/locales/zh-CN/shell.json");
  const enShell = readJson("src/locales/en-US/shell.json");
  const zhWs = readJson("src/locales/zh-CN/workspace.json");
  const enWs = readJson("src/locales/en-US/workspace.json");

  const blobs = [
    zhShell.sidebar.treeView.confirmDeleteFileDesc,
    zhShell.sidebar.treeView.confirmDeleteTopicDesc,
    enShell.sidebar.treeView.confirmDeleteFileDesc,
    enShell.sidebar.treeView.confirmDeleteTopicDesc,
    zhWs.inbox.confirmDeleteOnceMore,
    zhWs.inbox.deleteToArchive,
    zhWs.menu.toastDeleted,
    zhWs.menu.confirmDeleteMsg,
    enWs.inbox.confirmDeleteOnceMore,
    enWs.inbox.deleteToArchive,
    enWs.menu.toastDeleted,
    enWs.menu.confirmDeleteMsg,
  ];
  for (const text of blobs) {
    assert.doesNotMatch(String(text), ALWAYS_ARCHIVE_LIE, text);
  }

  assert.match(zhShell.sidebar.treeView.confirmDeleteFileDesc, /普通笔记不会进回收站/);
  assert.match(enShell.sidebar.treeView.confirmDeleteFileDesc, /Ordinary notes are not moved to Archive/);
  assert.match(zhShell.sidebar.treeView.confirmDeleteTopicDesc, /topic\.md/);
  assert.match(enShell.sidebar.treeView.confirmDeleteTopicDesc, /topic\.md/);
  assert.equal(zhWs.menu.toastDeleted, "已删除");
  assert.equal(enWs.menu.toastDeleted, "Deleted");
  assert.equal(zhWs.inbox.deleteToArchive, "删除");
  assert.equal(enWs.inbox.deleteToArchive, "Delete");
});

test("formatWritebackToast mentions backup only when evidence has backupPath", async () => {
  const mod = await import(pathToFileURL(path.join(root, "src/lib/writeback-toast.ts")).href);
  const { formatWritebackToast } = mod;
  const noBackup = formatWritebackToast("已删除", {
    operation: "delete",
    targetPath: "00-收件箱/scratch.md",
    savedAt: new Date().toISOString(),
  });
  assert.match(noBackup, /已删除/);
  assert.doesNotMatch(noBackup, /备份|Archive|归档/u);

  const withBackup = formatWritebackToast("已删除", {
    operation: "delete",
    targetPath: "memory/profile.md",
    savedAt: new Date().toISOString(),
    backupPath: "99-归档/backups/trash/memory/stamp__profile.md",
  });
  assert.match(withBackup, /备份/);
});

test("file menu and inbox delete toasts consume WritebackEvidence", () => {
  const menu = read("src/components/ui/workspace-file-menu.tsx");
  assert.match(menu, /toastWriteback/);
  assert.match(menu, /toastWriteback\(t\("workspace:menu.toastDeleted"\), ev\)/);
  assert.doesNotMatch(
    menu,
    /toast:show", wasPermanent \? t\("workspace:menu.toastPermanentDeleted"\) : t\("workspace:menu.toastDeleted"\)/,
  );

  const inbox = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  assert.match(inbox, /toastWriteback\(t\("workspace:menu.toastDeleted"\), res\)/);
});
