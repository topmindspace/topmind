import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDefaultContract, stringifyContract } from "../lib/contract-engine.mjs";
import { assignCreationId, inspectCreationContext, linkCreationVariant,
  CREATION_DIAGNOSTIC_CODE } from "../lib/kernel-api.mjs";

const target = { platform: "x", format: "article", entrypoint: "manual-copy" };

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-creation-variant-"));
  const ws = path.join(root, "workspace");
  fs.mkdirSync(path.join(ws, "20-研究"), { recursive: true });
  fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(buildDefaultContract()));
  try { return run(ws); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function write(ws, relativePath, content) {
  const absolute = path.join(ws, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return absolute;
}

const inspect = (ws, relativePath) => inspectCreationContext({ workspaceRoot: ws, targetPath: relativePath });

function mother(ws, relativePath = "20-研究/母稿.md") {
  const absolute = write(ws, relativePath, "---\ntitle: 母稿\nsource_type: user-original\n---\n\n# 母稿\n");
  const before = inspect(ws, relativePath);
  const assigned = assignCreationId({ workspaceRoot: ws, targetPath: relativePath,
    expectedSha256: before.target.sha256, userConfirmed: true });
  return { absolute, relativePath, creationId: assigned.creationId, context: inspect(ws, relativePath) };
}

function link(ws, parent, variantPath, options = {}) {
  const variant = inspect(ws, variantPath);
  return linkCreationVariant({ workspaceRoot: ws, parentPath: parent.relativePath, variantPath,
    expectedParentSha256: parent.context.target.sha256, expectedVariantSha256: variant.target.sha256,
    target, userConfirmed: true, ...options });
}

describe("linkCreationVariant", () => {
  it("links an exploratory platform variant without fixing its delivery entrypoint", () => withWorkspace((ws) => {
    const parent = mother(ws);
    const variantPath = "20-研究/探索稿.md";
    const variantAbsolute = write(ws, variantPath, "---\ntitle: 探索稿\nsource_type: ai-derived\n---\n\n# 探索稿\n");
    const openTarget = { platform: "x", format: "article" };
    const linked = link(ws, parent, variantPath, { target: openTarget });
    assert.equal(linked.status, "linked");
    assert.match(fs.readFileSync(variantAbsolute, "utf8"), /creation_target:\n  platform: x\n  format: article\n/u);
    assert.equal(fs.readFileSync(variantAbsolute, "utf8").includes("entrypoint:"), false);
    assert.deepEqual(inspect(ws, variantPath).target.creationTarget, openTarget);
    assert.deepEqual(inspect(ws, parent.relativePath).variants[0].target, openTarget);
  }));

  it("links only the selected existing note, preserves nested YAML and body, and exposes both sides", () => withWorkspace((ws) => {
    const parent = mother(ws);
    const originalMother = fs.readFileSync(parent.absolute, "utf8");
    const variantPath = "20-研究/平台稿/原名.md";
    const original = "\ufeff---\r\ntitle: '平台稿'\r\nsource_type: ai-derived\r\ntags:\r\n  - 原有标签\r\nAIGC:\r\n  model: test\r\n---\r\n\r\n# 平台正文\r\n";
    const variantAbsolute = write(ws, variantPath, original);
    write(ws, "20-研究/平台稿/邻居.md", "# 同目录非变体\n");
    assert.deepEqual(inspect(ws, parent.relativePath).variants, []);
    const result = link(ws, parent, variantPath);
    assert.equal(result.status, "linked");
    assert.equal(result.writebackEvidence.wroteFiles, true);
    assert.equal(fs.readFileSync(parent.absolute, "utf8"), originalMother, "mother is not rewritten");
    const linkedText = fs.readFileSync(variantAbsolute, "utf8");
    assert.ok(linkedText.startsWith("\ufeff---\r\ntitle: '平台稿'\r\nsource_type: ai-derived\r\ntags:\r\n  - 原有标签\r\nAIGC:\r\n  model: test\r\n"));
    assert.ok(linkedText.endsWith("---\r\n\r\n# 平台正文\r\n"));
    assert.match(linkedText, new RegExp(`creation_variant_id: ${result.variantId}\\r\\ncreation_parent_id: ${parent.creationId}`));
    assert.match(linkedText, /creation_target:\r\n  platform: x\r\n  format: article\r\n  entrypoint: manual-copy\r\n/u);
    assert.match(linkedText, new RegExp(`creation_source_sha256: ${parent.context.target.sha256}`));
    const motherView = inspect(ws, parent.relativePath);
    assert.equal(motherView.variants.length, 1);
    assert.deepEqual(motherView.variants[0], {
      relativePath: variantPath, variantId: result.variantId, target,
      sourceSha256: parent.context.target.sha256, sha256: inspect(ws, variantPath).target.sha256,
    });
    const variantView = inspect(ws, variantPath);
    assert.equal(variantView.schemaVersion, 3);
    assert.equal(variantView.target.creationVariantId, result.variantId);
    assert.equal(variantView.target.variantStatus, "valid");
    assert.deepEqual(variantView.target.creationTarget, target);
    assert.equal(variantView.target.parentCreationId, parent.creationId);
    assert.equal(variantView.target.parentRelativePath, parent.relativePath);
    assert.equal(variantView.target.parentSha256, parent.context.target.sha256);
    assert.deepEqual(variantView.diagnostics, []);
    assert.equal(inspect(ws, "20-研究/平台稿/邻居.md").target.variantStatus, "none");
  }));

  it("survives variant rename, but copied variant IDs become ambiguous and are not projected", () => withWorkspace((ws) => {
    const parent = mother(ws);
    const oldPath = "20-研究/X稿.md";
    const newPath = "20-研究/X稿-改名.md";
    write(ws, oldPath, "---\ntitle: X稿\nsource_type: ai-derived\n---\n正文\n");
    const result = link(ws, parent, oldPath);
    fs.renameSync(path.join(ws, oldPath), path.join(ws, newPath));
    assert.equal(inspect(ws, newPath).target.creationVariantId, result.variantId);
    assert.equal(inspect(ws, parent.relativePath).variants[0].relativePath, newPath);
    const copyPath = "20-研究/X稿-复制.md";
    write(ws, copyPath, fs.readFileSync(path.join(ws, newPath), "utf8"));
    const parentView = inspect(ws, parent.relativePath);
    assert.deepEqual(parentView.variants, []);
    assert.ok(parentView.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.VARIANT_ID_CONFLICT));
    for (const rel of [newPath, copyPath]) {
      const view = inspect(ws, rel);
      assert.equal(view.target.variantStatus, "conflict");
      assert.equal(view.target.parentCreationId, null);
      assert.equal(view.target.parentRelativePath, null);
      assert.equal(view.target.parentSha256, null);
      assert.equal(view.target.creationTarget, null);
    }
  }));

  it("reports source drift and parent duplication without guessing another parent", () => withWorkspace((ws) => {
    const parent = mother(ws);
    const variantPath = "20-研究/改写稿.md";
    write(ws, variantPath, "# 改写稿\n");
    link(ws, parent, variantPath, { title: "改写稿", sourceType: "ai-derived" });
    fs.appendFileSync(parent.absolute, "母稿新增内容\n");
    const drift = inspect(ws, variantPath);
    assert.equal(drift.target.variantStatus, "valid");
    assert.equal(drift.target.parentSha256, inspect(ws, parent.relativePath).target.sha256);
    assert.ok(drift.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.VARIANT_SOURCE_STALE));
    write(ws, "20-研究/复制母稿.md", fs.readFileSync(parent.absolute));
    const ambiguous = inspect(ws, variantPath);
    assert.equal(ambiguous.target.variantStatus, "parent-conflict");
    assert.equal(ambiguous.target.parentCreationId, null);
    assert.equal(ambiguous.target.parentRelativePath, null);
    assert.ok(ambiguous.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.VARIANT_PARENT_CONFLICT));
  }));

  it("requires explicit action, both exact hashes, valid target, and an unlinked distinct Markdown note", () => withWorkspace((ws) => {
    const parent = mother(ws);
    const variantPath = "20-研究/待关联.md";
    const variantAbsolute = write(ws, variantPath, "# 待关联\n");
    const unchanged = fs.readFileSync(variantAbsolute, "utf8");
    const options = { workspaceRoot: ws, parentPath: parent.relativePath, variantPath,
      expectedParentSha256: parent.context.target.sha256,
      expectedVariantSha256: inspect(ws, variantPath).target.sha256,
      target, title: "待关联", sourceType: "ai-derived", userConfirmed: true };
    assert.throws(() => linkCreationVariant({ ...options, userConfirmed: false }), { code: "user-action-required" });
    assert.throws(() => linkCreationVariant({ ...options, expectedParentSha256: "0".repeat(64) }), { code: "stale-parent" });
    assert.throws(() => linkCreationVariant({ ...options, expectedVariantSha256: "0".repeat(64) }), { code: "stale-variant" });
    assert.throws(() => linkCreationVariant({ ...options, target: { ...target, format: "X Article" } }), { code: "invalid-target" });
    assert.throws(() => linkCreationVariant({ ...options, target: { platform: "x", format: "article", entrypoint: "" } }), { code: "invalid-target" });
    assert.throws(() => linkCreationVariant({ ...options, target: { platform: "x", format: "article", unknown: "value" } }), { code: "invalid-target" });
    assert.throws(() => linkCreationVariant({ ...options, target: Object.create({ platform: "x", format: "article" }) }), { code: "invalid-target" });
    assert.throws(() => linkCreationVariant({ ...options, variantPath: parent.relativePath,
      expectedVariantSha256: parent.context.target.sha256 }), { code: "variant-already-linked" });
    assert.throws(() => linkCreationVariant({ ...options, variantPath: "../escape.md" }));
    write(ws, "99-归档/系统稿.md", "# 系统稿\n");
    assert.throws(() => linkCreationVariant({ ...options, variantPath: "99-归档/系统稿.md" }), { code: "target-system-category" });
    assert.equal(fs.readFileSync(variantAbsolute, "utf8"), unchanged);
    fs.appendFileSync(variantAbsolute, "改动\n");
    assert.throws(() => linkCreationVariant(options), { code: "stale-variant" });
  }));

  it("rejects malformed or partial relationship metadata without rewriting it", () => withWorkspace((ws) => {
    const parent = mother(ws);
    const variantPath = "20-研究/损坏.md";
    for (const content of [
      "---\ntitle: [broken\n---\n正文\n",
      `---\ntitle: 子稿\ncreation_parent_id: ${parent.creationId}\n---\n正文\n`,
      "---\ntitle: 子稿\ncreation_variant_id: not-a-uuid\n---\n正文\n",
      "---\ntitle: 子稿\ncreation_cover:\n  source_path: images/a.png\n---\n正文\n",
    ]) {
      const absolute = write(ws, variantPath, content);
      const before = inspect(ws, variantPath);
      assert.throws(() => linkCreationVariant({ workspaceRoot: ws, parentPath: parent.relativePath,
        variantPath, expectedParentSha256: parent.context.target.sha256,
        expectedVariantSha256: before.target.sha256, target,
        title: "子稿", sourceType: "ai-derived", userConfirmed: true }));
      assert.equal(fs.readFileSync(absolute, "utf8"), content);
    }
  }));
});
