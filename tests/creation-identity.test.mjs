import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDefaultContract, stringifyContract } from "../lib/contract-engine.mjs";
import {
  assignCreationId, inspectCreationContext, executeWrite, CREATION_DIAGNOSTIC_CODE,
} from "../lib/kernel-api.mjs";

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-creation-id-"));
  const ws = path.join(root, "workspace");
  fs.mkdirSync(path.join(ws, "20-研究"), { recursive: true });
  fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(buildDefaultContract()));
  try { return run(ws); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function write(ws, rel, body) {
  const absolute = path.join(ws, rel);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body);
  return absolute;
}

const inspect = (ws, rel) => inspectCreationContext({ workspaceRoot: ws, targetPath: rel });

describe("assignCreationId", () => {
  it("requires explicit action and exact selected hash; old notes stay readable", () => withWorkspace((ws) => {
    const rel = "20-研究/旧稿.md";
    const absolute = write(ws, rel, "# 旧稿\n\n内容\n");
    const before = inspect(ws, rel);
    assert.equal(before.target.creationId, null);
    assert.equal(before.target.identityStatus, "none");
    assert.throws(() => assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256 }), { code: "user-action-required" });
    assert.throws(() => assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true }), { code: "title-required" });
    assert.equal(fs.readFileSync(absolute, "utf8"), "# 旧稿\n\n内容\n");
    const result = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true, title: "旧稿", sourceType: "user-original" });
    assert.equal(result.status, "assigned");
    assert.match(result.creationId, /^[a-f0-9-]{36}$/u);
    assert.equal(result.writebackEvidence.wroteFiles, true);
    assert.equal(result.writebackEvidence.targetPath, rel);
    assert.match(fs.readFileSync(absolute, "utf8"), /^---\ntitle: "旧稿"\nsource_type: user-original\ncreation_id: [a-f0-9-]+\n---\n\n# 旧稿/u);
    const after = inspect(ws, rel);
    assert.equal(after.target.creationId, result.creationId);
    assert.equal(after.target.identityStatus, "valid");
    assert.deepEqual(after.diagnostics, []);
    const unchanged = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: after.target.sha256, userConfirmed: true });
    assert.equal(unchanged.status, "unchanged");
    assert.equal(unchanged.writebackEvidence, null);
  }));

  it("preserves valid nested YAML, CRLF, BOM and body; ID survives rename", () => withWorkspace((ws) => {
    const rel = "20-研究/原稿.md";
    const original = "\ufeff---\r\ntitle: '标题'\r\nsource_type: user-original\r\ntags:\r\n  - 创作\r\nAIGC:\r\n  model: test\r\n---\r\n\r\n# 正文\r\n";
    const absolute = write(ws, rel, original);
    const before = inspect(ws, rel);
    const result = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true });
    const expected = original.replace("---\r\n\r\n# 正文", `creation_id: ${result.creationId}\r\n---\r\n\r\n# 正文`);
    assert.equal(fs.readFileSync(absolute, "utf8"), expected);
    fs.renameSync(absolute, path.join(ws, "20-研究/新名.md"));
    const renamed = inspect(ws, "20-研究/新名.md");
    assert.equal(renamed.target.creationId, result.creationId);
    assert.equal(renamed.target.identityStatus, "valid");
  }));

  it("reports copied ID conflict, invalid ID, and rejects stale/escaped writes", () => withWorkspace((ws) => {
    const rel = "20-研究/正文.md";
    const original = write(ws, rel, "---\ntitle: 正文\nsource_type: user-original\n---\n\n正文\n");
    const first = inspect(ws, rel);
    assert.throws(() => assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: "0".repeat(64), userConfirmed: true }), { code: "stale-target" });
    assert.throws(() => assignCreationId({ workspaceRoot: ws, targetPath: "../leak.md", expectedSha256: first.target.sha256, userConfirmed: true }));
    assert.equal(inspect(ws, rel).target.identityStatus, "none");
    const assigned = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: first.target.sha256, userConfirmed: true });
    const copyRel = "20-研究/复制稿.md";
    write(ws, copyRel, fs.readFileSync(original, "utf8"));
    for (const target of [rel, copyRel]) {
      const context = inspect(ws, target);
      assert.equal(context.target.creationId, null);
      assert.equal(context.target.identityStatus, "conflict");
      assert.ok(context.diagnostics.some((d) => d.code === CREATION_DIAGNOSTIC_CODE.CREATION_ID_CONFLICT));
      assert.throws(() => assignCreationId({ workspaceRoot: ws, targetPath: target, expectedSha256: context.target.sha256, userConfirmed: true }), { code: "identity-conflict" });
    }
    fs.rmSync(path.join(ws, copyRel));
    assert.equal(inspect(ws, rel).target.creationId, assigned.creationId);
    write(ws, copyRel, "---\ntitle: 错误 ID\ncreation_id: bad\n---\n");
    const invalid = inspect(ws, copyRel);
    assert.equal(invalid.target.identityStatus, "invalid");
    assert.ok(invalid.diagnostics.some((d) => d.code === CREATION_DIAGNOSTIC_CODE.CREATION_ID_INVALID));
    assert.equal(inspect(ws, rel).target.creationId, assigned.creationId, "unrelated bad ID does not poison a valid creation");
  }));

  it("uses the existing write gate and returns backup evidence for locked notes", () => withWorkspace((ws) => {
    const rel = "20-研究/锁定稿.md";
    write(ws, rel, "---\ntitle: 锁定稿\nsource_type: user-original\nprotection: locked\n---\n\n正文\n");
    const before = inspect(ws, rel);
    const result = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true });
    assert.equal(result.writebackEvidence.protection, "locked");
    assert.ok(result.writebackEvidence.backupPath);
    assert.ok(result.writebackEvidence.receiptPath);
    assert.ok(fs.existsSync(path.join(ws, result.writebackEvidence.backupPath)));
    const absolute = path.join(ws, rel);
    const edited = executeWrite({
      workspaceRoot: ws, targetPath: absolute, role: "deep-work", actor: "user",
      content: fs.readFileSync(absolute, "utf8") + "后续修改\n", operation: "update",
    });
    assert.equal(edited.wroteFiles, true);
    assert.ok(fs.readFileSync(path.join(ws, edited.backupPath), "utf8").includes(`creation_id: ${result.creationId}`));
    assert.equal(inspect(ws, rel).target.creationId, result.creationId, "safety backups are not creation owners");
  }));

  it("ignores derived copies and configured safety planes while retaining real archived notes", () => withWorkspace((ws) => {
    const contract = buildDefaultContract();
    contract.writeback.backup_to = "20-研究/safety/backups";
    contract.writeback.receipts = "20-研究/safety/receipts";
    fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(contract));
    const rel = "20-研究/原创.md";
    const original = write(ws, rel, "---\ntitle: 原创\nsource_type: user-original\n---\n正文\n");
    const before = inspect(ws, rel);
    const result = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true });
    const bytes = fs.readFileSync(original);
    write(ws, "20-研究/.derived/原创.md", bytes);
    write(ws, "20-研究/node_modules/copied.md", bytes);
    write(ws, "20-研究/safety/backups/原创.md", bytes);
    write(ws, "20-研究/safety/receipts/原创.md", bytes);
    assert.equal(inspect(ws, rel).target.creationId, result.creationId);
    write(ws, "99-归档/真正归档.md", bytes);
    assert.equal(inspect(ws, rel).target.identityStatus, "conflict", "real archived content still owns its ID");
  }));

  it("refuses scalar and malformed YAML headers without damaging them", () => withWorkspace((ws) => {
    const rel = "20-研究/格式损坏.md";
    for (const header of ["false", "0", "null", "[a, b]", "title: [broken"]) {
      const body = `---\n${header}\n---\n\n# 原样\n`;
      const absolute = write(ws, rel, body);
      const before = inspect(ws, rel);
      assert.throws(() => assignCreationId({
        workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256,
        userConfirmed: true, title: "原样", sourceType: "user-original",
      }), { code: "invalid-frontmatter" });
      assert.equal(fs.readFileSync(absolute, "utf8"), body);
    }
  }));

  it("reports a persisted ID when the safety receipt cannot be written", () => withWorkspace((ws) => {
    const contract = buildDefaultContract();
    fs.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
    fs.writeFileSync(path.join(ws, "99-归档", "receipts"), "occupied");
    fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(contract));
    const rel = "20-研究/回执故障.md";
    write(ws, rel, "---\ntitle: 回执故障\nsource_type: user-original\nprotection: locked\n---\n正文\n");
    const before = inspect(ws, rel);
    const result = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true });
    assert.equal(result.status, "assigned-needs-review");
    assert.equal(result.writebackEvidence.wroteFiles, true);
    assert.equal(result.writebackEvidence.partial, true);
    assert.equal(result.writebackEvidence.reason, "receipt-write-failed");
    assert.ok(result.writebackEvidence.backupPath);
    assert.equal(inspect(ws, rel).target.creationId, result.creationId);
  }));

  it("prevents generic writers from silently dropping an assigned ID", () => withWorkspace((ws) => {
    const rel = "20-研究/受保护稿.md";
    const absolute = write(ws, rel, "---\ntitle: 受保护稿\nsource_type: user-original\n---\n正文\n");
    const before = inspect(ws, rel);
    const assigned = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true });
    const persisted = fs.readFileSync(absolute, "utf8");
    assert.throws(() => executeWrite({
      workspaceRoot: ws, targetPath: absolute, role: "deep-work", actor: "user",
      content: "---\ntitle: 被覆盖\nsource_type: user-original\n---\n正文\n",
      operation: "update",
    }), /creation metadata requires/u);
    assert.equal(fs.readFileSync(absolute, "utf8"), persisted);
    assert.equal(inspect(ws, rel).target.creationId, assigned.creationId);
  }));

  it("protects nested variant metadata from generic rewrites", () => withWorkspace((ws) => {
    const rel = "20-研究/变体.md";
    const absolute = write(ws, rel, "---\ntitle: 变体\ncreation_target:\n  platform: x\n  format: article\n  entrypoint: manual-copy\n---\n正文\n");
    const changed = "---\ntitle: 变体\ncreation_target:\n  platform: wechat\n  format: article\n  entrypoint: manual-copy\n---\n正文\n";
    assert.throws(() => executeWrite({
      workspaceRoot: ws, targetPath: absolute, role: "deep-work", actor: "user", content: changed,
    }), /creation metadata requires/u);
    assert.match(fs.readFileSync(absolute, "utf8"), /platform: x/u);
    const edited = executeWrite({
      workspaceRoot: ws, targetPath: absolute, role: "deep-work", actor: "user",
      content: fs.readFileSync(absolute, "utf8") + "后续编辑\n",
    });
    assert.equal(edited.wroteFiles, true);
    assert.match(fs.readFileSync(absolute, "utf8"), /platform: x/u);
    const variant = inspect(ws, rel);
    assert.throws(() => assignCreationId({
      workspaceRoot: ws, targetPath: rel, expectedSha256: variant.target.sha256,
      userConfirmed: true, sourceType: "user-original",
    }), { code: "identity-conflict" });
  }));

  it("prevents generic writers from introducing creation metadata", () => withWorkspace((ws) => {
    const rel = "20-研究/普通稿.md";
    const absolute = write(ws, rel, "# 普通稿\n");
    const injected = "---\ncreation_id: 426ca86c-eabc-4cb1-86d2-9a59437fb532\n---\n# 普通稿\n";
    assert.throws(() => executeWrite({ workspaceRoot: ws, targetPath: absolute,
      role: "deep-work", actor: "user", content: injected }), /creation metadata requires/u);
    const copy = path.join(ws, "20-研究/复制稿.md");
    assert.throws(() => executeWrite({ workspaceRoot: ws, targetPath: copy,
      role: "deep-work", actor: "user", content: injected, operation: "create" }), /creation metadata requires/u);
    assert.equal(fs.existsSync(copy), false);
    assert.equal(fs.readFileSync(absolute, "utf8"), "# 普通稿\n");
  }));

  it("fails closed when another note has a frontmatter header beyond the scan bound", () => withWorkspace((ws) => {
    const rel = "20-研究/正文.md";
    write(ws, rel, "---\ntitle: 正文\nsource_type: user-original\n---\n正文\n");
    const before = inspect(ws, rel);
    const assigned = assignCreationId({ workspaceRoot: ws, targetPath: rel, expectedSha256: before.target.sha256, userConfirmed: true });
    write(ws, "20-研究/超长头.md", `---\n${" ".repeat(270_000)}\ncreation_id: ${assigned.creationId}\n---\n`);
    const result = inspect(ws, rel);
    assert.equal(result.target.identityStatus, "scan-incomplete");
    assert.ok(result.diagnostics.some((d) => d.code === CREATION_DIAGNOSTIC_CODE.CREATION_ID_SCAN_INCOMPLETE));
  }));
});
