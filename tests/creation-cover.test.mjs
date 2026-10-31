import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildDefaultContract, stringifyContract } from "../lib/contract-engine.mjs";
import { coverFixture } from "./helpers/creation-cover-fixtures.mjs";
import { inspectCreationContext, inspectCreationCoverPaths, linkCreationCover,
  importCreationCoverRendition, buildCreationInputSnapshot } from "../lib/kernel-api.mjs";

const parentId = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
const variantId = "e3aa264f-c02f-4ab6-a0e4-a9480eed48c8";
const sourcePath = "20-研究/images/original.png";
const renditionPath = "20-研究/images/wechat.png";
const variantPath = "20-研究/公众号稿.md";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-cover-link-"));
  const ws = path.join(root, "workspace");
  fs.mkdirSync(path.join(ws, "20-研究", "images"), { recursive: true });
  fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(buildDefaultContract()));
  const mother = `---\ncreation_id: ${parentId}\n---\n\n# 母稿\n`;
  fs.writeFileSync(path.join(ws, "20-研究/母稿.md"), mother);
  const variant = `\ufeff---\r\ntitle: '公众号稿'\r\nsource_type: ai-derived\r\ntags:\r\n  - 原有标签\r\ncreation_variant_id: ${variantId}\r\ncreation_parent_id: ${parentId}\r\ncreation_target:\r\n  platform: wechat\r\n  format: article\r\n  entrypoint: copy-html\r\ncreation_source_sha256: ${sha256(mother)}\r\n---\r\n\r\n# 正文\r\n`;
  fs.writeFileSync(path.join(ws, variantPath), variant);
  const source = coverFixture("a");
  const rendition = coverFixture("b");
  fs.writeFileSync(path.join(ws, sourcePath), source);
  fs.writeFileSync(path.join(ws, renditionPath), rendition);
  const options = { workspaceRoot: ws, variantPath, sourcePath, renditionPath,
    expectedVariantSha256: sha256(Buffer.from(variant)), expectedSourceSha256: sha256(source),
    expectedRenditionSha256: sha256(rendition), userConfirmed: true };
  try { return run({ root, ws, variant, source, rendition, options }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe("linkCreationCover", () => {
  it("imports a managed rendition without editing the variant, then links after review", () => withWorkspace(({ ws, variant, options }) => {
    const renditionBytes = coverFixture("c");
    const imported = importCreationCoverRendition({ ...options,
      renditionBytes, expectedRenditionSha256: sha256(renditionBytes) });
    assert.equal(imported.status, "imported-unlinked");
    assert.equal(imported.writebackEvidence.wroteFiles, true);
    assert.equal(fs.readFileSync(path.join(ws, variantPath), "utf8"), variant);
    assert.deepEqual(fs.readFileSync(path.join(ws, imported.renditionPath)), renditionBytes);
    assert.match(imported.renditionPath, /images\/creation-covers\/e3aa264f-c02f-4ab6-a0e4-a9480eed48c8\/rendition-[a-f0-9]{64}\.png$/u);
    const repeated = importCreationCoverRendition({ ...options,
      renditionBytes, expectedRenditionSha256: sha256(renditionBytes) });
    assert.equal(repeated.status, "existing-unlinked");
    assert.equal(repeated.writebackEvidence.wroteFiles, false);
    const linked = linkCreationCover({ ...options,
      renditionPath: imported.renditionPath, expectedRenditionSha256: sha256(renditionBytes) });
    assert.equal(linked.status, "linked");
  }));

  it("imports JPEG and WebP renditions with encoded dimensions", () => {
    for (const [fixture, extension, format] of [["jpeg", "jpg", "jpeg"], ["webp", "webp", "webp"]]) {
      withWorkspace(({ ws, options }) => {
        const renditionBytes = coverFixture(fixture);
        const expectedRenditionSha256 = sha256(renditionBytes);
        const imported = importCreationCoverRendition({ ...options, renditionBytes, expectedRenditionSha256 });
        assert.equal(imported.status, "imported-unlinked");
        assert.equal(imported.format, format);
        assert.deepEqual([imported.width, imported.height], [4, 4]);
        assert.ok(imported.renditionPath.endsWith(`.${extension}`));
        assert.deepEqual(fs.readFileSync(path.join(ws, imported.renditionPath)), renditionBytes);
        const linked = linkCreationCover({ ...options,
          renditionPath: imported.renditionPath, expectedRenditionSha256 });
        assert.equal(linked.status, "linked");
      });
    }
  });

  it("rejects stale input and occupied managed paths without editing the note", () => withWorkspace(({ ws, variant, options }) => {
    const renditionBytes = coverFixture("d");
    const expectedRenditionSha256 = sha256(renditionBytes);
    const args = { ...options, renditionBytes, expectedRenditionSha256 };
    assert.throws(() => importCreationCoverRendition({ ...args, userConfirmed: false }),
      { code: "user-action-required" });
    assert.throws(() => importCreationCoverRendition({ ...args, expectedRenditionSha256: "0".repeat(64) }),
      { code: "stale-rendition" });
    const magicOnly = renditionBytes.subarray(0, 8);
    assert.throws(() => importCreationCoverRendition({ ...args,
      renditionBytes: magicOnly, expectedRenditionSha256: sha256(magicOnly) }),
    { code: "invalid-rendition" });
    const relative = `20-研究/images/creation-covers/${variantId}/rendition-${expectedRenditionSha256}.png`;
    assert.equal(fs.existsSync(path.join(ws, relative)), false);
    fs.mkdirSync(path.dirname(path.join(ws, relative)), { recursive: true });
    fs.writeFileSync(path.join(ws, relative), "occupied");
    assert.throws(() => importCreationCoverRendition(args), { code: "target-conflict" });
    assert.equal(fs.readFileSync(path.join(ws, relative), "utf8"), "occupied");
    assert.equal(fs.readFileSync(path.join(ws, variantPath), "utf8"), variant);
  }));

  it("retains an imported image when linking sees a changed variant, then permits a fresh retry", () => withWorkspace(({ ws, variant, options }) => {
    const renditionBytes = coverFixture("e");
    const expectedRenditionSha256 = sha256(renditionBytes);
    const imported = importCreationCoverRendition({ ...options,
      renditionBytes, expectedRenditionSha256 });
    const changed = variant + "人工补充\r\n";
    fs.writeFileSync(path.join(ws, variantPath), changed);
    assert.throws(() => linkCreationCover({ ...options,
      renditionPath: imported.renditionPath, expectedRenditionSha256 }),
    { code: "stale-variant" });
    assert.deepEqual(fs.readFileSync(path.join(ws, imported.renditionPath)), renditionBytes);
    assert.equal(fs.readFileSync(path.join(ws, variantPath), "utf8"), changed);
    const retry = linkCreationCover({ ...options, expectedVariantSha256: sha256(changed),
      renditionPath: imported.renditionPath, expectedRenditionSha256 });
    assert.equal(retry.status, "linked");
  }));

  it("links two existing files through writeback while preserving YAML, body and image bytes", () => withWorkspace(({ ws, variant, source, rendition, options }) => {
    const prepared = inspectCreationCoverPaths({ workspaceRoot: ws, targetPath: variantPath,
      sourcePath, renditionPath });
    assert.deepEqual(prepared.diagnostics, []);
    assert.deepEqual(prepared.assets.map((asset) => asset.sha256),
      [options.expectedSourceSha256, options.expectedRenditionSha256]);
    const result = linkCreationCover(options);
    assert.equal(result.status, "linked");
    assert.equal(result.targetPath, variantPath);
    assert.equal(result.variantId, variantId);
    assert.equal(result.writebackEvidence.wroteFiles, true);
    const text = fs.readFileSync(path.join(ws, variantPath), "utf8");
    assert.ok(text.startsWith("\ufeff---\r\ntitle: '公众号稿'\r\nsource_type: ai-derived\r\ntags:\r\n  - 原有标签\r\n"));
    assert.ok(text.endsWith("---\r\n\r\n# 正文\r\n"));
    assert.ok(text.includes(`creation_cover:\r\n  source_path: "${sourcePath}"\r\n  rendition_path: "${renditionPath}"\r\n`));
    assert.notEqual(text, variant);
    assert.deepEqual(fs.readFileSync(path.join(ws, sourcePath)), source);
    assert.deepEqual(fs.readFileSync(path.join(ws, renditionPath)), rendition);
    const inspected = inspectCreationContext({ workspaceRoot: ws, targetPath: variantPath });
    assert.deepEqual(inspected.assets.filter((asset) => asset.kind === "cover").map((asset) => asset.sha256),
      [options.expectedSourceSha256, options.expectedRenditionSha256]);
    const snapshot = buildCreationInputSnapshot({ workspaceRoot: ws, targetPath: variantPath,
      platform: "wechat", format: "article", entry: "copy-html",
      ruleset: { id: "wechat", version: "1" }, provider: { id: "renderer", version: "1" } });
    assert.equal(snapshot.inputsComplete, true);
    assert.throws(() => linkCreationCover({ ...options, expectedVariantSha256: inspected.target.sha256 }),
      { code: "cover-already-linked" });
  }));

  it("keeps source drift visible while allowing a reviewed cover import and link", () => withWorkspace(({ ws, variant, options }) => {
    fs.appendFileSync(path.join(ws, "20-研究/母稿.md"), "\n母稿后续修改\n");
    const renditionBytes = coverFixture("c");
    const expectedRenditionSha256 = sha256(renditionBytes);
    const imported = importCreationCoverRendition({ ...options, renditionBytes, expectedRenditionSha256 });
    assert.equal(imported.status, "imported-unlinked");
    assert.ok(imported.diagnostics.some((item) => item.code === "variant-source-stale"));
    assert.deepEqual(fs.readFileSync(path.join(ws, imported.renditionPath)), renditionBytes);
    assert.equal(fs.readFileSync(path.join(ws, variantPath), "utf8"), variant);
    const linked = linkCreationCover({ ...options,
      renditionPath: imported.renditionPath, expectedRenditionSha256 });
    assert.equal(linked.status, "linked-needs-review");
    assert.equal(linked.writebackEvidence.wroteFiles, true);
    assert.ok(linked.diagnostics.some((item) => item.code === "variant-source-stale"));
  }));

  it("honors locked-note writeback confirmation and preserves a backup receipt", () => withWorkspace(({ ws, variant, options }) => {
    const locked = variant.replace("source_type: ai-derived\r\n", "source_type: ai-derived\r\nprotection: locked\r\n");
    fs.writeFileSync(path.join(ws, variantPath), locked);
    const result = linkCreationCover({ ...options, expectedVariantSha256: sha256(locked) });
    assert.equal(result.status, "linked");
    assert.equal(result.writebackEvidence.wroteFiles, true);
    assert.ok(result.writebackEvidence.backupPath);
    assert.ok(result.writebackEvidence.receiptPath);
  }));

  it("requires explicit action and exact current hashes before any write", () => withWorkspace(({ ws, variant, options }) => {
    const note = path.join(ws, variantPath);
    for (const change of [
      { userConfirmed: false }, { expectedVariantSha256: "0".repeat(64) },
      { expectedSourceSha256: "0".repeat(64) }, { expectedRenditionSha256: "0".repeat(64) },
      { expectedSourceSha256: "bad" },
    ]) {
      assert.throws(() => linkCreationCover({ ...options, ...change }));
      assert.equal(fs.readFileSync(note, "utf8"), variant);
    }
  }));

  it("rejects same-file aliases, escapes and unknown formats without writing", () => withWorkspace(({ root, ws, variant, options }) => {
    const note = path.join(ws, variantPath);
    const rendition = path.join(ws, renditionPath);
    fs.rmSync(rendition);
    fs.symlinkSync(path.join(ws, sourcePath), rendition);
    assert.throws(() => linkCreationCover({ ...options, expectedRenditionSha256: options.expectedSourceSha256 }),
      { code: "invalid-cover-assets" });
    fs.rmSync(rendition);
    fs.linkSync(path.join(ws, sourcePath), rendition);
    assert.deepEqual(inspectCreationCoverPaths({ workspaceRoot: ws, targetPath: variantPath,
      sourcePath, renditionPath }).diagnostics.map((item) => item.code), ["cover-invalid"]);
    assert.throws(() => linkCreationCover({ ...options, expectedRenditionSha256: options.expectedSourceSha256 }),
      { code: "invalid-cover-assets" });
    fs.rmSync(rendition);
    const outside = path.join(root, "outside.png");
    fs.writeFileSync(outside, coverFixture("a"));
    fs.symlinkSync(outside, rendition);
    assert.throws(() => linkCreationCover(options), { code: "invalid-cover-assets" });
    fs.rmSync(rendition);
    fs.writeFileSync(rendition, "not an image");
    assert.throws(() => linkCreationCover({ ...options, expectedRenditionSha256: sha256("not an image") }),
      { code: "invalid-cover-assets" });
    assert.equal(fs.readFileSync(note, "utf8"), variant);
  }));
});
