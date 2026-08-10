import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReceipt,
  mergeToolReceipt,
  normalizeAffectedFiles,
} from "../../core/receipt.mjs";

test("normalizeAffectedFiles keeps stable relative path fields", () => {
  const affected = normalizeAffectedFiles([
    { path: "/tmp/workspace/20-研究/2026-demo/topic.md", relativePath: "20-研究/2026-demo/topic.md", status: "modified" },
    "99-归档/backups/demo/20260613-topic.md",
  ]);

  assert.deepEqual(affected, [
    { path: "/tmp/workspace/20-研究/2026-demo/topic.md", relativePath: "20-研究/2026-demo/topic.md", status: "modified" },
    { path: "99-归档/backups/demo/20260613-topic.md", relativePath: "99-归档/backups/demo/20260613-topic.md", status: "unknown" },
  ]);
});

test("buildReceipt records target, reversibility, route, and backup paths", () => {
  const receipt = buildReceipt({
    target: "20-研究/2026-demo/a.md",
    action: "capture-note",
    writebackMode: "auto",
    routeConfidence: "medium",
    routeReason: "recent project",
    backupPath: "99-归档/backups/demo/topic.md",
    affectedFiles: ["20-研究/2026-demo/a.md"],
  });

  assert.equal(receipt.target, "20-研究/2026-demo/a.md");
  assert.equal(receipt.action, "capture-note");
  assert.equal(receipt.writebackMode, "auto");
  assert.equal(receipt.reversible, true);
  assert.equal(receipt.backupPath, "99-归档/backups/demo/topic.md");
  assert.equal(receipt.route.confidence, "medium");
  assert.equal(receipt.route.reason, "recent project");
  assert.equal(receipt.affectedFiles[0].relativePath, "20-研究/2026-demo/a.md");
});

test("mergeToolReceipt prefers explicit tool receipt but augments backup and affected files", () => {
  const receipt = mergeToolReceipt({
    command: "workspace-write.capture-note",
    writebackMode: "auto",
    data: {
      path: "20-研究/2026-demo/a.md",
      backupPath: "99-归档/backups/demo/topic.md",
      receipt: {
        target: "project",
        projectId: "demo",
        path: "20-研究/2026-demo/a.md",
        routeConfidence: "high",
      },
    },
    affectedFiles: [{ relativePath: "20-研究/2026-demo/a.md", status: "added" }],
  });

  assert.equal(receipt.target, "project");
  assert.equal(receipt.path, "20-研究/2026-demo/a.md");
  assert.equal(receipt.projectId, "demo");
  assert.equal(receipt.backupPath, "99-归档/backups/demo/topic.md");
  assert.equal(receipt.action, "workspace-write.capture-note");
  assert.equal(receipt.writebackMode, "auto");
  assert.equal(receipt.route.confidence, "high");
  assert.equal(receipt.affectedFiles[0].relativePath, "20-研究/2026-demo/a.md");
});
