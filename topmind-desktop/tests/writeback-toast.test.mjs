import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("writeback-toast helper formats evidence paths", async () => {
  const mod = await import(pathToFileURL(path.join(root, "src/lib/writeback-toast.ts")).href);
  const { formatWritebackToast, formatBatchEvidenceLine } = mod;
  assert.equal(formatWritebackToast("已保存"), "✓ 已保存");
  assert.equal(
    formatWritebackToast("已发布", {
      operation: "publish",
      targetPath: "88-输出/2026-01-01-note.md",
      savedAt: new Date().toISOString(),
      backupPath: "99-归档/backups/output-ow/x__note.md",
    }),
    // shortPath keeps last 2 segments for path visibility
    "✓ 已发布 · 88-输出/2026-01-01-note.md · 备份 output-ow/x__note.md",
  );
  assert.equal(formatWritebackToast("失败", null, { fail: true }), "✗ 失败");

  const batchLine = formatBatchEvidenceLine({
    writeCount: 2,
    message: "本轮多文件写回 2 处 · 目标 2 · 备份 1",
    targetPaths: ["10-日常/a.md", "10-日常/b.md"],
    backupPaths: ["99-归档/backups/x.md"],
  });
  assert.match(batchLine, /多文件写回 2/);
  assert.match(batchLine, /10-日常\/a\.md/);
  assert.match(batchLine, /备份 1/);
  assert.equal(formatBatchEvidenceLine(null), "");
  assert.equal(formatBatchEvidenceLine({ writeCount: 0 }), "");
});

test("writeback-toast is wired into key UI call sites", () => {
  for (const rel of [
    "src/plugins/topmind-workspace/views/FileEditorView.tsx",
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/components/overlays/CaptureForm.tsx",
    "src/stores/ai-store.ts",
    "src/stores/action-store.ts",
  ]) {
    const src = readFileSync(path.join(root, rel), "utf8");
    assert.match(
      src,
      /writeback-toast|toastWriteback|toastBatchEvidence|lastBatchEvidence|BatchEvidenceBanner/,
      `${rel} should consume writeback toast / batch receipt UI`,
    );
  }
});
