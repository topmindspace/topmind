import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefaultContract, stringifyContract } from "../lib/kernel-api.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packScript = path.join(repoRoot, "scripts", "pack-utr-runtime.mjs");

function startSnapshotMcp(runtimeRoot, workspaceRoot, cwd) {
  const child = spawn(process.execPath, [
    path.join(runtimeRoot, "utr", "server", "topmind-mcp.mjs"),
    "--engine-root", runtimeRoot,
    "--workspace-root", workspaceRoot,
  ], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const reader = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  reader.on("line", (line) => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    request.resolve(response);
  });
  child.on("exit", (code) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`Snapshot MCP exited (${code}): ${stderr}`));
    }
    pending.clear();
  });
  return {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Snapshot MCP ${method} timed out: ${stderr}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    close() {
      child.stdin.end();
      child.kill();
      reader.close();
    },
  };
}

test("UTR runtime snapshot relocates and rejects changed files", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-snapshot-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const targetPath = "20-创作/测试稿.md";
  let mcp;
  try {
    const build = await execFileAsync(process.execPath, [
      packScript, "--out", runtimeRoot, "--allow-dirty",
    ], { cwd: temporaryRoot });
    const receipt = JSON.parse(build.stdout);
    assert.equal(receipt.output, runtimeRoot);
    assert.match(receipt.treeSha256, /^[a-f0-9]{64}$/u);
    assert.ok(receipt.fileCount > 0);

    await fs.mkdir(path.join(workspaceRoot, "00-Inbox"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "20-创作"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "99-归档"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "topmind.yaml"), stringifyContract(buildDefaultContract()));
    await fs.writeFile(path.join(workspaceRoot, targetPath), "---\ntitle: 测试稿\n---\n\n# 内容\n");

    const check = await execFileAsync(process.execPath, [
      packScript, "--verify", runtimeRoot,
    ], { cwd: temporaryRoot });
    assert.equal(JSON.parse(check.stdout).verified, true);

    mcp = startSnapshotMcp(runtimeRoot, workspaceRoot, temporaryRoot);
    const initialized = await mcp.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "snapshot-relocation-test", version: "1" },
    });
    assert.ok(initialized.result?.capabilities);
    const listed = await mcp.request("tools/list");
    assert.ok(listed.result?.tools?.some((tool) => tool.name === "creator.inspect"));
    assert.ok(listed.result?.tools?.some((tool) => tool.name === "creator.snapshot"));
    assert.ok(listed.result?.tools?.some((tool) => tool.name === "creator.matchLengthReport"));
    const called = await mcp.request("tools/call", {
      name: "creator.inspect", arguments: { targetPath },
    });
    assert.equal(called.result.isError, false);
    const payload = JSON.parse(called.result.content[0].text);
    assert.equal(payload.data.data.target.relativePath, targetPath);
    const snapshot = await mcp.request("tools/call", {
      name: "creator.snapshot",
      arguments: {
        targetPath,
        platform: "wechat",
        format: "article",
        entry: "copy-html",
        ruleset: { id: "wechat-article", version: "2026-10-29", rules: [{ id: "synthetic.title", max: 20 }] },
        provider: { id: "article-renderer", version: "1.0.0" },
      },
    });
    assert.equal(snapshot.result.isError, false);
    const snapshotPayload = JSON.parse(snapshot.result.content[0].text);
    assert.equal(snapshotPayload.data.data.schemaVersion, 5);
    assert.equal(snapshotPayload.data.data.rulesetBound, true);
    assert.equal(snapshotPayload.wroteFiles, false);
    mcp.close();
    mcp = null;

    const copiedModule = path.join(runtimeRoot, "lib", "creation-context.mjs");
    await fs.appendFile(copiedModule, "\n// tampered\n");
    await assert.rejects(execFileAsync(process.execPath, [
      packScript, "--verify", runtimeRoot,
    ], { cwd: temporaryRoot }), /Runtime file inventory or SHA256 mismatch/u);
  } finally {
    mcp?.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("release snapshot uses tracked source and a lock-verified dependency", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-release-"));
  const fixtureRoot = path.join(temporaryRoot, "repo");
  const packageRoot = path.join(temporaryRoot, "yaml-package");
  const outputRoot = path.join(temporaryRoot, "runtime");
  const npmEnv = { ...process.env, npm_config_cache: path.join(temporaryRoot, "npm-cache"), npm_config_offline: "true" };
  try {
    await fs.mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
    await fs.copyFile(packScript, path.join(fixtureRoot, "scripts", "pack-utr-runtime.mjs"));
    for (const relative of ["lib", "templates", "utr/bin", "utr/contracts", "utr/core", "utr/server", "utr/tools", "skills"]) {
      await fs.mkdir(path.join(fixtureRoot, relative), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, relative, ".keep"), "");
    }
    await fs.writeFile(path.join(fixtureRoot, "lib", "tracked.mjs"), "export const source = 'tracked';\n");
    await fs.writeFile(path.join(fixtureRoot, "utr", "VERSION"), "1.0.0\n");
    await fs.writeFile(path.join(fixtureRoot, ".gitignore"), "node_modules/\nlib/ignored-secret.mjs\nalias\n");

    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "yaml", version: "7.3.0", main: "index.js" }));
    await fs.writeFile(path.join(packageRoot, "index.js"), "module.exports = 'locked archive';\n");
    const { stdout: packedName } = await execFileAsync("npm", ["pack", "--ignore-scripts", "--pack-destination", temporaryRoot], { cwd: packageRoot, env: npmEnv });
    const archive = path.join(temporaryRoot, packedName.trim());
    const integrity = `sha512-${createHash("sha512").update(await fs.readFile(archive)).digest("base64")}`;
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture", dependencies: { yaml: "7.3.0" } }));
    await fs.writeFile(path.join(fixtureRoot, "package-lock.json"), JSON.stringify({
      name: "fixture", lockfileVersion: 3, requires: true,
      packages: {
        "": { name: "fixture", dependencies: { yaml: "7.3.0" } },
        "node_modules/yaml": { version: "7.3.0", resolved: `file:${archive}`, integrity },
      },
    }));
    await execFileAsync("git", ["init", "-q"], { cwd: fixtureRoot });
    await execFileAsync("git", ["add", "."], { cwd: fixtureRoot });
    await execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: fixtureRoot });

    await fs.writeFile(path.join(fixtureRoot, "lib", "ignored-secret.mjs"), "export const secret = 'must not ship';\n");
    await fs.mkdir(path.join(fixtureRoot, "node_modules", "yaml"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "node_modules", "yaml", "package.json"), JSON.stringify({ name: "yaml", version: "7.3.0" }));
    await fs.writeFile(path.join(fixtureRoot, "node_modules", "yaml", "index.js"), "module.exports = 'local tamper';\n");
    await fs.symlink(path.join(fixtureRoot, "lib"), path.join(fixtureRoot, "alias"));

    await assert.rejects(execFileAsync(process.execPath, [
      path.join(fixtureRoot, "scripts", "pack-utr-runtime.mjs"), "--out", path.join(fixtureRoot, "alias", "runtime"), "--ref", "HEAD",
    ], { cwd: temporaryRoot, env: npmEnv }), /Output cannot be inside runtime source/u);

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(fixtureRoot, "scripts", "pack-utr-runtime.mjs"), "--out", outputRoot, "--ref", "HEAD",
    ], { cwd: temporaryRoot, env: npmEnv });
    const result = JSON.parse(stdout);
    assert.equal(result.source.dirty, false);
    const manifest = JSON.parse(await fs.readFile(path.join(outputRoot, "runtime-manifest.json"), "utf8"));
    assert.equal(manifest.dependencies.yaml.installMode, "npm-ci-locked");
    assert.equal(await fs.readFile(path.join(outputRoot, "node_modules", "yaml", "index.js"), "utf8"), "module.exports = 'locked archive';\n");
    await assert.rejects(fs.access(path.join(outputRoot, "lib", "ignored-secret.mjs")));
    const check = await execFileAsync(process.execPath, [packScript, "--verify", outputRoot], { cwd: temporaryRoot });
    assert.equal(JSON.parse(check.stdout).verified, true);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
