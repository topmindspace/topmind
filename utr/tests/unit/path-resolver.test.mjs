import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveContractArgs } from "../../core/path-resolver.mjs";
import {
  archiveRoot,
  detectUserWorkspaceRoot,
  inboxRoot,
  categoryRoot,
  topicRoot,
  userWorkspaceCategoriesRoot,
  globalOutputsRoot,
  resolveWorkspacePath,
} from "../../core/workspace-context.mjs";
import { loadContractRegistry, getCommand } from "../../core/contract-registry.mjs";

const pathContext = {
  engineRoot: "/tmp/topmind",
  userWorkspaceRoot: "/tmp/topmind-workspace",
};

function p(...parts) {
  return path.join(...parts).replace(/\\/gu, "/");
}

function eq(actual, expected) {
  const norm = (s) => s.replace(/\\/gu, "/").replace(/^[/\\]?[A-Z]:/iu, "");
  assert.equal(norm(actual), norm(expected));
}

let registry;

test.before(async () => {
  registry = await loadContractRegistry();
});

test("workspace context exposes v3.4 data roots (10-60 + 88/99 numbering)", () => {
  eq(userWorkspaceCategoriesRoot(pathContext), "/tmp/topmind-workspace");
  eq(categoryRoot(pathContext, "20 研究"), "/tmp/topmind-workspace/20 研究");
  eq(topicRoot(pathContext, "20 研究", "2026-示例专题"), "/tmp/topmind-workspace/20 研究/2026-示例专题");
  // Default separator is hyphen when FS has no dirs (PROJECT-MODEL recommended form)
  eq(inboxRoot(pathContext), "/tmp/topmind-workspace/00-收件箱");
  eq(archiveRoot(pathContext), "/tmp/topmind-workspace/99-归档");
  eq(globalOutputsRoot(pathContext), "/tmp/topmind-workspace/88-输出");
});

test("workspace context detects active roots under 99 Archive (v3.4 archive safety layer)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-workspace-"));
  const engineRoot = path.join(root, "topmind");
  const userWorkspaceRoot = path.join(root, "topmind-workspace");

  try {
    await fs.mkdir(path.join(engineRoot, "skills"), { recursive: true });
    await fs.mkdir(path.join(engineRoot, "utr"), { recursive: true });
    await fs.mkdir(userWorkspaceRoot, { recursive: true });
    // v3.4 default categories (10-60 + 88/99)
    for (const dir of ["00-收件箱", "10-动态", "20-研究", "30-阅读", "40-创作", "50-其他", "60-参考资料", "88-输出", "99-归档"]) {
      await fs.mkdir(path.join(userWorkspaceRoot, dir), { recursive: true });
    }

    assert.equal(
      await detectUserWorkspaceRoot(path.join(userWorkspaceRoot, "20 研究"), { engineRoot }),
      userWorkspaceRoot,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveWorkspacePath routes v3.4 paths only to user data", () => {
  // Category + topic path → user data
  eq(resolveWorkspacePath(pathContext, "20 研究/2026-示例专题/topic.md"), "/tmp/topmind-workspace/20 研究/2026-示例专题/topic.md");
  eq(resolveWorkspacePath(pathContext, "00 Inbox/capture.md"), "/tmp/topmind-workspace/00 Inbox/capture.md");
  // path traversal blocked
  assert.throws(() => resolveWorkspacePath(pathContext, "../../etc/passwd"), /Traversal/);
  eq(resolveWorkspacePath(pathContext, "99 Archive/backups/20 研究/2026-示例专题/topic.md"), "/tmp/topmind-workspace/99 Archive/backups/20 研究/2026-示例专题/topic.md");
  // v3.4 88 Outputs flat
  eq(resolveWorkspacePath(pathContext, "88 Outputs/2026-06-14-report.md"), "/tmp/topmind-workspace/88 Outputs/2026-06-14-report.md");
  // Engine paths
  eq(resolveWorkspacePath(pathContext, "utr/contracts/schema.json"), "/tmp/topmind/utr/contracts/schema.json");
  // v3.4 forbids legacy roots
  assert.throws(() => resolveWorkspacePath(pathContext, "knowledge/old.md"), /不支持的工作区根/u);
  assert.throws(() => resolveWorkspacePath(pathContext, "writing/old.md"), /不支持的工作区根/u);
  assert.throws(() => resolveWorkspacePath(pathContext, "projects/old.md"), /不支持的工作区根/u);
});

test("workspace-read inspect-topic resolves v3.4 category-first roots", () => {
  const { contract, commandName } = getCommand(registry, "workspace-read", "inspect-topic");
  const args = resolveContractArgs(contract, commandName, pathContext, { category: "20 研究", topic: "2026-示例专题" });
  assert.ok(args.includes("--categories-root"));
  assert.ok(args.some((a) => a.includes("topmind-workspace")));
  assert.ok(args.includes("--inbox-root"));
  assert.ok(args.some((a) => /00[- ]收件箱/.test(a)));
  // v3.4: archive is 99-Archive / 99 Archive (not archive/)
  assert.ok(args.includes("--archive-root"));
  assert.ok(args.some((a) => /99[- ]归档/.test(a)));
  assert.ok(args.includes("--category"));
  assert.ok(args.includes("20 研究"));
  assert.ok(args.includes("--topic"));
  assert.ok(args.includes("2026-示例专题"));
  assert.ok(args.includes("inspect-topic"));
});

test("workspace-write capture-note resolves inbox target without v2.x roots", () => {
  const { contract, commandName } = getCommand(registry, "workspace-write", "capture-note");
  const args = resolveContractArgs(contract, commandName, pathContext, {
    title: "Quick Capture",
    content: "Captured text",
    dryRun: true,
  });
  assert.ok(args.includes("--inbox-root"));
  assert.ok(args.some((a) => /00[- ]收件箱/.test(a)));
  assert.ok(args.includes("--mode"));
  assert.ok(args.includes("preview"));
  assert.equal(args.includes("--dry-run"), false);
  // v3.4 forbids legacy paths
  assert.ok(!args.some((arg) => arg.includes("/writing")));
  assert.ok(!args.some((arg) => arg.includes("/knowledge")));
  assert.ok(!args.some((arg) => arg.includes("/projects")));
});


test("workspace-maintain archive-topic resolves 99 Archive source path", () => {
  const { contract, commandName } = getCommand(registry, "workspace-maintain", "archive-topic");
  const args = resolveContractArgs(contract, commandName, pathContext, { category: "20 研究", topic: "2026-示例专题", dryRun: true });
  assert.ok(args.includes("--topic-root"));
  assert.ok(args.some((a) => a.includes("20 研究") && a.includes("2026-示例专题")));
  assert.ok(args.includes("--archive-root"));
  assert.ok(args.some((a) => /99[- ]归档/.test(a)));
  assert.ok(args.includes("--mode"));
  assert.ok(args.includes("preview"));
  assert.equal(args.includes("--dry-run"), false);
});