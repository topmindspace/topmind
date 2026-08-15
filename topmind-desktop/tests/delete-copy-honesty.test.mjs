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
  /删除前会自动备份|可从 99-Archive 恢复|可从 Archive 恢复|可从归档恢复|已移入归档备份|删除到 Archive|备份进 99-Archive|整文件覆盖\/删除进归档|仍会备份到 99-Archive|删除仍备份|仍走备份链|A backup will be saved to 99-Archive|restorable from Archive|Delete to Archive|backed up to 99-Archive|Backs up to 99-Archive|full overwrite\/delete go to archive|still backs up to 99-Archive/iu;

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
  const zhSettings = readJson("src/locales/zh-CN/settings.json");
  const enSettings = readJson("src/locales/en-US/settings.json");
  const zhEditor = readJson("src/locales/zh-CN/editor.json");
  const enEditor = readJson("src/locales/en-US/editor.json");
  const zhX = readJson("src/locales/zh-CN/x.json");
  const enX = readJson("src/locales/en-US/x.json");

  const blobs = [
    zhShell.sidebar.treeView.confirmDeleteFileDesc,
    zhShell.sidebar.treeView.confirmDeleteTopicDesc,
    enShell.sidebar.treeView.confirmDeleteFileDesc,
    enShell.sidebar.treeView.confirmDeleteTopicDesc,
    zhWs.inbox.confirmDeleteOnceMore,
    zhWs.inbox.deleteToArchive,
    zhWs.inbox.confirmBatchDelete,
    zhWs.inbox.batchDeleteToast,
    zhWs.inbox.batchDeleteTooltip,
    zhWs.menu.toastDeleted,
    zhWs.menu.confirmDeleteMsg,
    enWs.inbox.confirmDeleteOnceMore,
    enWs.inbox.deleteToArchive,
    enWs.inbox.confirmBatchDelete,
    enWs.inbox.batchDeleteToast,
    enWs.inbox.batchDeleteTooltip,
    enWs.menu.toastDeleted,
    enWs.menu.confirmDeleteMsg,
    zhSettings.general.writebackHelpAuto,
    enSettings.general.writebackHelpAuto,
    zhEditor.ai.writebackAutoHint,
    enEditor.ai.writebackAutoHint,
    zhX.appendMode,
    enX.appendMode,
  ];
  for (const text of blobs) {
    assert.doesNotMatch(String(text), ALWAYS_ARCHIVE_LIE, String(text));
  }

  assert.match(zhShell.sidebar.treeView.confirmDeleteFileDesc, /普通笔记不会进回收站/);
  assert.match(enShell.sidebar.treeView.confirmDeleteFileDesc, /Ordinary notes are not moved to Archive/);
  assert.match(zhShell.sidebar.treeView.confirmDeleteTopicDesc, /topic\.md/);
  assert.match(enShell.sidebar.treeView.confirmDeleteTopicDesc, /topic\.md/);
  assert.match(zhWs.inbox.confirmBatchDelete, /普通收件箱笔记不会进回收站/);
  assert.match(enWs.inbox.confirmBatchDelete, /Ordinary inbox notes are not moved to Archive/);
  assert.match(zhSettings.general.writebackHelpAuto, /普通开放笔记删除不进回收站/);
  assert.match(enSettings.general.writebackHelpAuto, /ordinary open-note deletes do not/);
  assert.equal(zhWs.menu.toastDeleted, "已删除");
  assert.equal(enWs.menu.toastDeleted, "Deleted");
  assert.equal(zhWs.inbox.deleteToArchive, "删除");
  assert.equal(enWs.inbox.deleteToArchive, "Delete");
});

test("inbox batch-delete and 写出来 delete use split honest copy", () => {
  const zhWs = readJson("src/locales/zh-CN/workspace.json");
  const enWs = readJson("src/locales/en-US/workspace.json");
  const inboxView = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  const outputsView = read("src/plugins/topmind-workspace/views/OutputsView.tsx");

  assert.match(inboxView, /workspace:inbox\.confirmBatchDelete/);
  assert.match(inboxView, /workspace:inbox\.batchDeleteToast/);
  assert.match(inboxView, /workspace:inbox\.batchDeleteTooltip/);
  assert.doesNotMatch(outputsView, /workspace:inbox\.confirmBatchDelete/);
  assert.match(outputsView, /workspace:outputsView\.confirmDelete/);

  assert.match(zhWs.outputsView.confirmDelete, /写出来稿会先移到归档/);
  assert.match(enWs.outputsView.confirmDelete, /Ship-it files are moved to Archive/);
  assert.doesNotMatch(zhWs.outputsView.confirmDelete, ALWAYS_ARCHIVE_LIE);
  assert.doesNotMatch(enWs.outputsView.confirmDelete, ALWAYS_ARCHIVE_LIE);
});

test("living Desktop ARCHITECTURE/DESIGN do not claim every save/delete backs up", () => {
  const arch = read("ARCHITECTURE.md");
  const design = read("DESIGN.md");
  assert.doesNotMatch(arch, /save_file`\/删除仍备份/);
  assert.doesNotMatch(arch, /删除\/重命名仍走备份链/);
  assert.doesNotMatch(arch, /删除仍备份/);
  assert.doesNotMatch(arch, /仍走备份链/);
  assert.match(arch, /isRecoverableLifecycle/);
  assert.match(arch, /open 覆盖不备份|open 不备份/);
  assert.doesNotMatch(design, /整文件 `save_file` 才备份/);
  assert.match(design, /仅 locked 覆盖才备份/);
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
