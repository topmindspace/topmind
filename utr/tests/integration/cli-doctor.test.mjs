import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "utr", "bin", "topmind-cli.mjs");

async function createCategoryFirstWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-cli-doctor-"));
  const workspaceRoot = path.join(base, "topmind-workspace");
  // v3.4: 10-60 + 88/99 numbering, notes at topic root, 99 Archive numbered, 88 Outputs flat
  await fs.mkdir(path.join(workspaceRoot, "10-动态", "2026-日常"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "88-输出"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "00-收件箱"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "99-归档"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "10-动态", "2026-日常", "topic.md"), "# 2026-日常\n", "utf8");
  // Clean workspace must include complete valid v4 contract (shared by all surfaces)
  const { writeContract, buildDefaultContract } = await import(
    path.join(repoRoot, "lib", "contract-engine.mjs")
  );
  writeContract(workspaceRoot, {
    ...buildDefaultContract(),
    workspace: {
      ...buildDefaultContract().workspace,
      template: "stream",
      locale: "zh-CN",
    },
  });
  return { base, workspaceRoot };
}

test("topmind-cli doctor emits machine-readable UTR status for a clean workspace", async () => {
  const fixture = await createCategoryFirstWorkspace();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "doctor",
      "--json",
      "--engine-root",
      repoRoot,
      "--workspace-root",
      fixture.workspaceRoot,
    ], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });

    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.equal(report.paths.engineRoot, repoRoot);
    assert.equal(report.paths.userWorkspaceRoot, fixture.workspaceRoot);
    assert.equal(report.paths.categoriesRoot, fixture.workspaceRoot);
    assert.equal(report.paths.inboxRoot, path.join(fixture.workspaceRoot, "00-收件箱"));
    assert.equal(report.paths.archiveRoot, path.join(fixture.workspaceRoot, "99-归档"));
    assert.equal(report.registry.toolCount, 8);
    assert.equal(report.registry.commandCount, 27);
    assert.equal(report.checks.contracts.ok, true);
    assert.equal(report.checks.plugins.ok, true);
    assert.equal(report.checks.plugins.pluginCount, 0);
    assert.equal(report.checks.scripts.ok, true);
    assert.equal(report.checks.workspace.ok, true);
    assert.equal(report.issues.length, 0);
  } finally {
    await fs.rm(fixture.base, { recursive: true, force: true });
  }
});

test("topmind-cli doctor surfaces workspace diagnostics from category-first checks", async () => {
  const fixture = await createCategoryFirstWorkspace();
  try {
    // v3.4 forbidden: .DS_Store, hidden runtime state under workspace root, and v2.x legacy roots
    await fs.writeFile(path.join(fixture.workspaceRoot, ".DS_Store"), "", "utf8");
    await fs.mkdir(path.join(workspaceRootWithGuard(fixture), ".state"), { recursive: true });
    await fs.writeFile(path.join(workspaceRootWithGuard(fixture), ".state", "tool-call-log.jsonl"), "{}\n", "utf8");
    // Create a legacy root to trigger forbidden-entry
    await fs.mkdir(path.join(fixture.workspaceRoot, "projects"), { recursive: true });

    let stdout = "";
    try {
      const result = await execFileAsync(process.execPath, [
        cliPath,
        "doctor",
        "--json",
        "--engine-root",
        repoRoot,
        "--workspace-root",
        fixture.workspaceRoot,
      ], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      stdout = error.stdout;
      assert.equal(error.code, 1);
    }

    const report = JSON.parse(stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.workspace.ok, false);
    assert.ok(report.checks.workspace.summary.errorCount >= 2);
    assert.ok(report.issues.some((issue) => issue.code === "workspace-forbidden-entry"));
    assert.ok(report.issues.some((issue) => issue.code === "workspace-runtime-state"));
  } finally {
    await fs.rm(fixture.base, { recursive: true, force: true });
  }
});

function workspaceRootWithGuard(fixture) {
  return fixture.workspaceRoot;
}

test("topmind-cli help keeps tool subcommand protocol but explains actions in user copy", async () => {
  let stderr = "";
  try {
    await execFileAsync(process.execPath, [cliPath, "--help"], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    stderr = error.stderr;
    assert.equal(error.code, 1);
  }

  assert.match(stderr, /Unified Action Runtime/u);
  assert.match(stderr, /List all available actions/u);
  assert.match(stderr, /Inspect tool domain/u);
  assert.match(stderr, /Preview execution/u);
  assert.match(stderr, /Run action/u);
  assert.match(stderr, /Filter by skill domain/u);
  assert.match(stderr, /Action parameters JSON/u);
  assert.doesNotMatch(stderr, /统一工具运行时|列出所有可用工具|查看工具详情|预览工具执行|执行工具|按工具域过滤|工具参数 JSON/u);
});