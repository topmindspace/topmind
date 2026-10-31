import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDefaultContract,
  stringifyContract,
  inspectCreationContext,
  buildCreationInputSnapshot,
  compareCreationLengthReport,
  compareCreationLocalLengthChain,
} from "../../../lib/kernel-api.mjs";

const execFileAsync = promisify(execFile);
const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cliPath = path.join(engineRoot, "utr", "bin", "topmind-cli.mjs");
const mcpPath = path.join(engineRoot, "utr", "server", "topmind-mcp.mjs");

async function snapshotWorkspace(workspaceRoot) {
  const relativePaths = (await fs.readdir(workspaceRoot, { recursive: true })).sort();
  return Promise.all(relativePaths.map(async (relativePath) => {
    const absolute = path.join(workspaceRoot, relativePath);
    const stat = await fs.lstat(absolute);
    return [relativePath, stat.isDirectory() ? "directory" : (await fs.readFile(absolute)).toString("hex")];
  }));
}

function startMcp(workspaceRoot) {
  const child = spawn(process.execPath, [
    mcpPath,
    "--engine-root", engineRoot,
    "--workspace-root", workspaceRoot,
  ], { cwd: engineRoot, stdio: ["pipe", "pipe", "pipe"] });
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
      request.reject(new Error(`MCP server exited (${code}): ${stderr}`));
    }
    pending.clear();
  });
  return {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP ${method} timed out: ${stderr}`));
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

test("creator.inspect returns Kernel creation context through CLI and MCP without writes", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-utr-creator-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const targetPath = "20-研究/单篇稿夹/正文.md";
  const plainTargetPath = "20-研究/单篇稿夹/纯文本.md";
  let mcp;
  try {
    await fs.mkdir(path.join(workspaceRoot, "00-Inbox"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "99-归档"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "20-研究", "单篇稿夹", "images"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "topmind.yaml"), stringifyContract(buildDefaultContract()));
    await fs.writeFile(path.join(workspaceRoot, targetPath), "---\ntitle: 测试文章\n---\n\n![封面](images/cover.png)\n![缺图](images/missing.png)\n");
    await fs.writeFile(path.join(workspaceRoot, plainTargetPath), "# 纯文本\n");
    await fs.writeFile(path.join(workspaceRoot, "20-研究", "单篇稿夹", "images", "cover.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const expected = inspectCreationContext({ workspaceRoot, targetPath, engineRoot });
    const before = await snapshotWorkspace(workspaceRoot);
    const cli = await execFileAsync(process.execPath, [
      cliPath, "tool", "run", "creator", "inspect",
      "--engine-root", engineRoot,
      "--workspace-root", workspaceRoot,
      "--input-json", JSON.stringify({ targetPath }),
    ], { cwd: engineRoot });
    const cliResult = JSON.parse(cli.stdout);
    assert.equal(cliResult.ok, true, cliResult.stderr);
    assert.equal(cliResult.wroteFiles, false);
    assert.deepEqual(cliResult.data, expected);
    assert.deepEqual(await snapshotWorkspace(workspaceRoot), before);

    mcp = startMcp(workspaceRoot);
    const initialized = await mcp.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "creator-inspect-test", version: "1" },
    });
    assert.ok(initialized.result?.capabilities);
    const listed = await mcp.request("tools/list");
    assert.ok(listed.result?.tools?.some((tool) => tool.name === "creator.inspect"));
    const called = await mcp.request("tools/call", {
      name: "creator.inspect",
      arguments: { targetPath },
    });
    const mcpResult = JSON.parse(called.result.content[0].text);
    assert.equal(called.result.isError, false, mcpResult.stderr);
    assert.equal(mcpResult.status, "success");
    assert.equal(mcpResult.wroteFiles, false);
    assert.deepEqual(mcpResult.data.data, expected);
    assert.deepEqual(await snapshotWorkspace(workspaceRoot), before);

    const snapshotInput = {
      targetPath, platform: "wechat", format: "article", entry: "copy-html",
      ruleset: { id: "wechat-article", version: "2026-10-29", rules: [{ id: "synthetic.title", max: 20 }] },
      provider: { id: "article-renderer", version: "1.0.0" },
      accountCapabilities: { uploadImage: true, account_capability: "basic" },
      lengthValidation: { document: { text_kind: "platform_text", body: "正文" },
        provider: { id: "topmind-writing-skills/length-ruleset", version: "1.1.0" }, asOf: "2026-10-29" },
      parameters: { theme: "minimal-ink", title: "" },
    };
    const expectedSnapshot = buildCreationInputSnapshot({ workspaceRoot, engineRoot, ...snapshotInput });
    assert.equal(expectedSnapshot.inputsComplete, false, "missing image stays incomplete");
    assert.equal(expectedSnapshot.lengthValidationBound, true);
    const snapshotCli = await execFileAsync(process.execPath, [
      cliPath, "tool", "run", "creator", "snapshot",
      "--engine-root", engineRoot, "--workspace-root", workspaceRoot,
      "--input-json", JSON.stringify(snapshotInput),
    ], { cwd: engineRoot });
    const snapshotCliResult = JSON.parse(snapshotCli.stdout);
    assert.equal(snapshotCliResult.ok, true, snapshotCliResult.stderr);
    assert.equal(snapshotCliResult.wroteFiles, false);
    assert.deepEqual(snapshotCliResult.data, expectedSnapshot);
    assert.ok(!snapshotCliResult.displayCommand.includes("minimal-ink"), "object parameters are hidden from command receipts");
    const preview = await execFileAsync(process.execPath, [
      cliPath, "tool", "preview", "creator", "snapshot",
      "--engine-root", engineRoot, "--workspace-root", workspaceRoot,
      "--input-json", JSON.stringify({ ...snapshotInput, parameters: { apiKey: "DO_NOT_ECHO_VALUE" } }),
    ], { cwd: engineRoot });
    const previewResult = JSON.parse(preview.stdout);
    assert.equal(previewResult.ready, true);
    assert.equal(preview.stdout.includes("DO_NOT_ECHO_VALUE"), false);
    const snapshotTool = listed.result.tools.find((tool) => tool.name === "creator.snapshot");
    assert.equal(snapshotTool.inputSchema.properties.ruleset.type, "object");
    assert.equal(snapshotTool.inputSchema.properties.lengthValidation.type, "object");
    assert.equal(snapshotTool.inputSchema.properties.parameters.type, "object");
    const snapshotMcp = await mcp.request("tools/call", { name: "creator.snapshot", arguments: snapshotInput });
    const snapshotMcpResult = JSON.parse(snapshotMcp.result.content[0].text);
    assert.equal(snapshotMcp.result.isError, false, snapshotMcpResult.stderr);
    assert.deepEqual(snapshotMcpResult.data.data, expectedSnapshot);
    assert.deepEqual(await snapshotWorkspace(workspaceRoot), before);
    const completeSnapshot = buildCreationInputSnapshot({ workspaceRoot, engineRoot, ...snapshotInput, targetPath: plainTargetPath });
    assert.equal(completeSnapshot.inputsComplete, true);
    const report = { schemaVersion: 1, capabilityId: "platform.validate.length-ruleset",
      provider: snapshotInput.lengthValidation.provider, status: "ok", verdict: "pass",
      checks: [{ category: "platform_limit", ruleId: "synthetic.title" }], diagnostics: [],
      input: { fingerprint: "a".repeat(64), creationSnapshotFingerprint: completeSnapshot.fingerprint,
        ruleSet: { id: snapshotInput.ruleset.id, version: snapshotInput.ruleset.version },
        rulesDigest: completeSnapshot.selection.ruleset.contentDigest,
        documentDigest: completeSnapshot.selection.lengthValidation.documentDigest,
        target: { platform: snapshotInput.platform, format: snapshotInput.format,
          entrypoint: snapshotInput.entry, account_capability: "basic" }, asOf: "2026-10-29" } };
    const expectedMatch = compareCreationLengthReport(completeSnapshot, report);
    assert.equal(expectedMatch.matches, true);
    assert.equal(expectedMatch.publishReady, false);
    const matchInput = { snapshot: completeSnapshot, report };
    const matchCli = await execFileAsync(process.execPath, [cliPath, "tool", "run", "creator", "matchLengthReport",
      "--engine-root", engineRoot, "--workspace-root", workspaceRoot, "--input-json", JSON.stringify(matchInput)], { cwd: engineRoot });
    const matchCliResult = JSON.parse(matchCli.stdout);
    assert.equal(matchCliResult.ok, true, matchCliResult.stderr);
    assert.equal(matchCliResult.wroteFiles, false);
    assert.deepEqual(matchCliResult.data, expectedMatch);
    assert.equal(matchCliResult.displayCommand.includes(completeSnapshot.fingerprint), false);
    const matchTool = listed.result.tools.find((tool) => tool.name === "creator.matchLengthReport");
    assert.equal(matchTool.inputSchema.properties.snapshot.type, "object");
    assert.equal(matchTool.inputSchema.properties.report.type, "object");
    assert.equal(matchTool.inputSchema.properties.articleResult.type, "object");
    const matchMcp = await mcp.request("tools/call", { name: "creator.matchLengthReport", arguments: matchInput });
    const matchMcpResult = JSON.parse(matchMcp.result.content[0].text);
    assert.equal(matchMcp.result.isError, false, matchMcpResult.stderr);
    assert.deepEqual(matchMcpResult.data.data, expectedMatch);
    const alteredSnapshot = { ...completeSnapshot,
      selection: { ...completeSnapshot.selection, platform: "x" } };
    const alteredMatch = await mcp.request("tools/call", {
      name: "creator.matchLengthReport", arguments: { snapshot: alteredSnapshot, report },
    });
    const alteredMatchResult = JSON.parse(alteredMatch.result.content[0].text);
    assert.equal(alteredMatch.result.isError, false, alteredMatchResult.stderr);
    assert.deepEqual(alteredMatchResult.data.data, { matches: false, reason: "snapshot-inconsistent",
      sourceLineageVerified: false, publishReady: false });
    const alteredCli = await execFileAsync(process.execPath, [cliPath, "tool", "run", "creator", "matchLengthReport",
      "--engine-root", engineRoot, "--workspace-root", workspaceRoot,
      "--input-json", JSON.stringify({ snapshot: alteredSnapshot, report })], { cwd: engineRoot });
    const alteredCliResult = JSON.parse(alteredCli.stdout);
    assert.equal(alteredCliResult.ok, true, alteredCliResult.stderr);
    assert.deepEqual(alteredCliResult.data, alteredMatchResult.data.data);
    const artifact = (role, format, content) => ({ role, format, content,
      sha256: createHash("sha256").update(content).digest("hex") });
    const articleResult = { schemaVersion: 1, capabilityId: "article.render",
      provider: snapshotInput.provider, status: "ok", diagnostics: [],
      input: { fingerprint: "c".repeat(64), creationSnapshotFingerprint: completeSnapshot.fingerprint,
        source: { relativePath: completeSnapshot.target.relativePath, sha256: completeSnapshot.target.sha256 },
        imageBytes: [], localTextTitle: null, target: { platform: "wechat", theme: "minimal-ink" },
        renderParameters: { theme: "minimal-ink", title: "" } },
      artifacts: [artifact("preview", "text/html", "<html>正文</html>"),
        artifact("clipboard-html", "text/html", "<p>正文</p>"),
        artifact("source-markdown", "text/markdown", "# 纯文本"),
        artifact("image-checklist", "text/markdown", "清单"),
        artifact("local-clipboard-text", "text/plain", "正文")], images: [] };
    const chainInput = { ...matchInput, articleResult };
    const expectedChain = compareCreationLocalLengthChain(completeSnapshot, articleResult, report);
    assert.equal(expectedChain.matches, true);
    const chainCli = await execFileAsync(process.execPath, [cliPath, "tool", "run", "creator", "matchLengthReport",
      "--engine-root", engineRoot, "--workspace-root", workspaceRoot, "--input-json", JSON.stringify(chainInput)], { cwd: engineRoot });
    const chainCliResult = JSON.parse(chainCli.stdout);
    assert.equal(chainCliResult.ok, true, chainCliResult.stderr);
    assert.deepEqual(chainCliResult.data, expectedChain);
    const chainMcp = await mcp.request("tools/call", { name: "creator.matchLengthReport", arguments: chainInput });
    const chainMcpResult = JSON.parse(chainMcp.result.content[0].text);
    assert.equal(chainMcp.result.isError, false, chainMcpResult.stderr);
    assert.deepEqual(chainMcpResult.data.data, expectedChain);
    assert.deepEqual(await snapshotWorkspace(workspaceRoot), before);
    const sensitive = await mcp.request("tools/call", { name: "creator.snapshot", arguments: {
      ...snapshotInput, parameters: { nested: { apiKey: "DO_NOT_ECHO_VALUE" } },
    } });
    assert.equal(sensitive.result.isError, true);
    assert.equal(JSON.stringify(sensitive).includes("DO_NOT_ECHO_VALUE"), false);

    const invalid = await mcp.request("tools/call", {
      name: "creator.inspect",
      arguments: { targetPath: "../outside.md" },
    });
    const errorResult = JSON.parse(invalid.result.content[0].text);
    assert.equal(invalid.result.isError, true);
    assert.equal(JSON.parse(errorResult.stderr).code, "target-outside-workspace");
    assert.deepEqual(await snapshotWorkspace(workspaceRoot), before);

    const motherPath = "20-研究/母稿.md";
    const variantPath = "20-研究/公众号版.md";
    const mother = "---\ncreation_id: 426ca86c-eabc-4cb1-86d2-9a59437fb532\n---\n\n# 母稿\n";
    await fs.writeFile(path.join(workspaceRoot, motherPath), mother);
    await fs.writeFile(path.join(workspaceRoot, variantPath), `---\nsource_type: ai-derived\ncreation_variant_id: e3aa264f-c02f-4ab6-a0e4-a9480eed48c8\ncreation_parent_id: 426ca86c-eabc-4cb1-86d2-9a59437fb532\ncreation_target:\n  platform: wechat\n  format: article\ncreation_source_sha256: ${createHash("sha256").update(mother).digest("hex")}\n---\n\n# 公众号版\n`);
    await fs.appendFile(path.join(workspaceRoot, motherPath), "\n母稿更新\n");
    const driftInput = { ...snapshotInput, targetPath: variantPath };
    const expectedDrift = buildCreationInputSnapshot({ workspaceRoot, engineRoot, ...driftInput });
    assert.equal(expectedDrift.inputsComplete, true);
    assert.ok(expectedDrift.diagnostics.some((item) => item.code === "variant-source-stale"));
    const driftBefore = await snapshotWorkspace(workspaceRoot);
    const driftCli = await execFileAsync(process.execPath, [cliPath, "tool", "run", "creator", "snapshot",
      "--engine-root", engineRoot, "--workspace-root", workspaceRoot,
      "--input-json", JSON.stringify(driftInput)], { cwd: engineRoot });
    const driftCliResult = JSON.parse(driftCli.stdout);
    assert.equal(driftCliResult.ok, true, driftCliResult.stderr);
    assert.equal(driftCliResult.wroteFiles, false);
    assert.deepEqual(driftCliResult.data, expectedDrift);
    const driftMcp = await mcp.request("tools/call", { name: "creator.snapshot", arguments: driftInput });
    const driftMcpResult = JSON.parse(driftMcp.result.content[0].text);
    assert.equal(driftMcp.result.isError, false, driftMcpResult.stderr);
    assert.equal(driftMcpResult.wroteFiles, false);
    assert.deepEqual(driftMcpResult.data.data, expectedDrift);
    assert.deepEqual(await snapshotWorkspace(workspaceRoot), driftBefore);
  } finally {
    mcp?.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
