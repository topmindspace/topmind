/**
 * Real shipped path helpers for list-safety + restore-safety (B1/M1 audit).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArchiveReceiptPath,
  stripBackupStampName,
  classifySafetyReceiptType,
  inferTopicFromSafetyPath,
  classifyRestoreTarget,
} from "../../core/safety-receipt-paths.mjs";

test("parseArchiveReceiptPath accepts 99-* roots and legacy archive/", () => {
  assert.deepEqual(parseArchiveReceiptPath("99-归档/backups/trash/x.md"), {
    archiveRoot: "99-归档",
    rest: "backups/trash/x.md",
  });
  assert.deepEqual(parseArchiveReceiptPath("99 Archive/trash/20 研究/a.md"), {
    archiveRoot: "99 Archive",
    rest: "trash/20 研究/a.md",
  });
  assert.deepEqual(parseArchiveReceiptPath("archive/backups/c/t/f.md"), {
    archiveRoot: "archive",
    rest: "backups/c/t/f.md",
  });
  assert.equal(parseArchiveReceiptPath("20 研究/topic/note.md"), null);
});

test("stripBackupStampName handles Kernel and legacy stamps", () => {
  assert.equal(
    stripBackupStampName("20260725T120000000Z__note.md"),
    "note.md",
  );
  assert.equal(
    stripBackupStampName("20260614-055900-topic.md"),
    "topic.md",
  );
  assert.equal(stripBackupStampName("plain.md"), "plain.md");
});

test("classifySafetyReceiptType prefers backups/trash as trash not backup", () => {
  assert.equal(
    classifySafetyReceiptType("99-归档/backups/trash/10-动态/20260725T1Z__a.md"),
    "trash",
  );
  assert.equal(
    classifySafetyReceiptType("99 归档/backups/20 研究/2026-t/20260614-055900-topic.md"),
    "backup",
  );
  assert.equal(
    classifySafetyReceiptType("99 Archive/trash/20 研究/2026-t/old.md"),
    "trash",
  );
  assert.equal(
    classifySafetyReceiptType("99 归档/20 研究-2026-t-20260614-060000"),
    "archived-topic",
  );
  assert.equal(
    classifySafetyReceiptType("88 输出/report - 修订版.md"),
    "revision",
  );
  assert.equal(
    classifySafetyReceiptType("99-归档/restore-receipts/x.json"),
    null,
  );
});

test("inferTopicFromSafetyPath offsets match Kernel and legacy trash", () => {
  assert.deepEqual(
    inferTopicFromSafetyPath(
      "99-归档/backups/trash/20 研究/2026-示例/stamp__n.md",
      "trash",
    ),
    { category: "20 研究", topic: "2026-示例" },
  );
  assert.deepEqual(
    inferTopicFromSafetyPath(
      "99 Archive/trash/20 研究/2026-示例/old.md",
      "trash",
    ),
    { category: "20 研究", topic: "2026-示例" },
  );
  assert.deepEqual(
    inferTopicFromSafetyPath(
      "99 归档/backups/20 研究/2026-示例/20260614-055900-topic.md",
      "backup",
    ),
    { category: "20 研究", topic: "2026-示例" },
  );
});

test("classifyRestoreTarget maps real 99 Archive trash to original content path", () => {
  const legacy = classifyRestoreTarget(
    "99 Archive/trash/20 研究/2026-示例专题/recoverable.md",
  );
  assert.equal(legacy.kind, "trash");
  assert.equal(legacy.destRel, "20 研究/2026-示例专题/recoverable.md");

  const kernel = classifyRestoreTarget(
    "99-归档/backups/trash/10-动态/20260725T120000000Z__note.md",
  );
  assert.equal(kernel.kind, "trash");
  assert.equal(kernel.destRel, "10-动态/note.md");

  const backup = classifyRestoreTarget(
    "99 归档/backups/20 研究/2026-示例专题/20260614-055900-topic.md",
  );
  assert.equal(backup.kind, "backup");
  assert.equal(backup.destRel, "20 研究/2026-示例专题/topic.md");

  // Must NOT treat 99 Archive as category (pre-fix bug)
  const bad = classifyRestoreTarget(
    "99 Archive/trash/20 研究/2026-示例专题/recoverable.md",
  );
  assert.notEqual(bad.destRel.split("/")[0], "99 Archive");
  assert.notEqual(bad.kind, "raw");
});
