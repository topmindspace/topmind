import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildDefaultContract, stringifyContract } from "../lib/contract-engine.mjs";
import { coverFixture } from "./helpers/creation-cover-fixtures.mjs";
import { MAX_CREATION_COVER_BYTES } from "../lib/creation-image-metadata.mjs";
import {
  inspectCreationContext,
  CREATION_ASSET_STATUS,
  CREATION_DIAGNOSTIC_CODE,
} from "../lib/kernel-api.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-creation-"));
  const ws = path.join(root, "workspace");
  fs.mkdirSync(path.join(ws, "20-研究"), { recursive: true });
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(buildDefaultContract()));
  try {
    return run({ root, ws });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(ws, rel, content) {
  const absolute = path.join(ws, rel);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return absolute;
}

function fileList(ws) {
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else found.push(path.relative(ws, absolute));
    }
  }
  walk(ws);
  return found.sort();
}

describe("inspectCreationContext", () => {
  it("reads an explicitly selected single-article folder with local image and no writes", () => withWorkspace(({ ws }) => {
    write(ws, "20-研究/单篇稿夹/正文.md", "---\ntitle: 独立文章\n---\n\n正文\n![封面](images/cover.png)\n");
    write(ws, "20-研究/单篇稿夹/images/cover.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const before = fileList(ws);
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/单篇稿夹/正文.md", engineRoot });
    assert.deepEqual(fileList(ws), before);
    assert.equal(result.schemaVersion, 3);
    assert.equal(result.target.relativePath, "20-研究/单篇稿夹/正文.md");
    assert.equal(result.target.title, "独立文章");
    assert.match(result.target.sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(result.category, { directory: "20-研究", role: "deep-work" });
    assert.equal(result.topic, null, "a folder name alone does not establish a topic");
    assert.deepEqual(result.variants, [], "neighboring notes are not guessed as variants");
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].relativePath, "20-研究/单篇稿夹/images/cover.png");
    assert.equal(result.assets[0].status, CREATION_ASSET_STATUS.PRESENT);
    assert.match(result.assets[0].sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(result.diagnostics, []);
  }));

  it("finds only an existing topic.md and keeps short notes independent", () => withWorkspace(({ ws }) => {
    write(ws, "20-研究/2026-专题/topic.md", "---\ntitle: 专题资料\n---\n");
    write(ws, "20-研究/2026-专题/长文.md", "# 文章标题\n\n正文\n");
    write(ws, "10-动态/快讯.md", "# 今日快讯\n\n正文\n");
    const topic = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/2026-专题/长文.md" });
    assert.deepEqual(topic.topic, { relativePath: "20-研究/2026-专题/topic.md", title: "专题资料" });
    assert.equal(topic.target.title, "文章标题");
    const brief = inspectCreationContext({ workspaceRoot: ws, targetPath: "10-动态/快讯.md" });
    assert.equal(brief.topic, null);
    assert.equal(brief.category.role, "loose-stream");
  }));

  it("reports missing, escaped and remote images without reading outside files", () => withWorkspace(({ root, ws }) => {
    const outside = write(root, "secret.png", "outside bytes");
    const folder = "20-研究/单篇稿夹";
    write(ws, `${folder}/正文.md`, [
      "![缺图](missing.png)",
      "![越界](../../../secret.png)",
      `![绝对](${outside})`,
      "![符号链接](leak.png)",
      "![远程](https://example.invalid/img.png?token=secret-credential)",
      "```md",
      "![示例](ignored.png)",
      "```",
      "",
    ].join("\n"));
    fs.symlinkSync(outside, path.join(ws, folder, "leak.png"));
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: `${folder}/正文.md` });
    assert.deepEqual(result.assets.map((a) => a.status), [
      CREATION_ASSET_STATUS.MISSING,
      CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE,
      CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE,
      CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE,
      CREATION_ASSET_STATUS.REMOTE,
    ]);
    assert.deepEqual(result.diagnostics.map((d) => d.code), [
      CREATION_DIAGNOSTIC_CODE.ASSET_MISSING,
      CREATION_DIAGNOSTIC_CODE.ASSET_OUTSIDE_WORKSPACE,
      CREATION_DIAGNOSTIC_CODE.ASSET_OUTSIDE_WORKSPACE,
      CREATION_DIAGNOSTIC_CODE.ASSET_OUTSIDE_WORKSPACE,
      CREATION_DIAGNOSTIC_CODE.ASSET_REMOTE,
    ]);
    assert.ok(result.assets.every((a) => a.relativePath == null || !a.relativePath.includes("..")));
    assert.equal(result.assets[4].reference, "https://example.invalid/img.png");
    assert.ok(!JSON.stringify(result).includes(outside));
    assert.ok(result.assets.filter((a) => a.status === CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE)
      .every((a) => a.reference === "[outside-workspace]"));
    assert.ok(!JSON.stringify(result).includes("secret-credential"));
  }));

  it("resolves reference-style images and signals unresolved Markdown images", () => withWorkspace(({ ws }) => {
    write(ws, "20-研究/images/cover.png", Buffer.from("cover"));
    write(ws, "20-研究/引用式.md", "![图片][cover]\n\n[cover]: images/cover.png\n");
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/引用式.md" });
    assert.equal(result.assets[0].status, CREATION_ASSET_STATUS.PRESENT);
    assert.deepEqual(result.diagnostics, []);
    write(ws, "20-研究/引用式.md", "![图片][unknown]\n");
    const unresolved = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/引用式.md" });
    assert.deepEqual(unresolved.assets, []);
    assert.deepEqual(unresolved.diagnostics.map((d) => d.code), [CREATION_DIAGNOSTIC_CODE.ASSET_SCAN_PARTIAL]);
  }));

  it("resolves Obsidian image embeds by vault path or unique basename", () => withWorkspace(({ ws }) => {
    write(ws, "attachments/cover.png", Buffer.from("cover-v1"));
    write(ws, "attachments/unique.png", Buffer.from("unique"));
    write(ws, "attachments/encoded name.png", Buffer.from("encoded"));
    const note = "20-研究/嵌入稿.md";
    write(ws, note, "![[attachments/cover.png|300]]\n![[unique.png]]\n![[encoded%20name.png|说明]]\n`![[ignored.png]]`\n```md\n![[fenced.png]]\n```\n");
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: note });
    assert.deepEqual(result.assets.map((asset) => asset.relativePath), [
      "attachments/cover.png", "attachments/unique.png", "attachments/encoded name.png",
    ]);
    assert.ok(result.assets.every((asset) => asset.syntax === "wikilink" && asset.status === CREATION_ASSET_STATUS.PRESENT));
    assert.deepEqual(result.diagnostics, []);
    write(ws, "20-研究/unique.png", Buffer.from("duplicate"));
    const ambiguous = inspectCreationContext({ workspaceRoot: ws, targetPath: note });
    assert.equal(ambiguous.assets[1].status, CREATION_ASSET_STATUS.AMBIGUOUS);
    assert.ok(ambiguous.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.ASSET_AMBIGUOUS));
  }));

  it("fails closed for missing and unsafe image embeds", () => withWorkspace(({ root, ws }) => {
    write(root, "outside.png", Buffer.from("outside"));
    const note = "20-研究/失效嵌入.md";
    write(ws, note, "![[missing.png]]\n![[..%2Foutside.png]]\n");
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: note });
    assert.equal(result.assets[0].status, CREATION_ASSET_STATUS.MISSING);
    assert.ok(result.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.ASSET_SCAN_PARTIAL));
    assert.ok(!JSON.stringify(result).includes(path.join(root, "outside.png")));
  }));

  it("flags malformed Markdown and HTML image markup as an incomplete asset scan", () => withWorkspace(({ ws }) => {
    const rel = "20-研究/图片语法.md";
    write(ws, rel, "# 正文\n\n![未结束\n![]( )\n<img alt=缺少来源>\n<img src=\"\">\n");
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: rel });
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.diagnostics.map((d) => d.code), [CREATION_DIAGNOSTIC_CODE.ASSET_SCAN_PARTIAL]);
  }));

  it("does not claim complete asset discovery for a frontmatter cover", () => withWorkspace(({ ws }) => {
    write(ws, "20-研究/封面稿.md", "---\ncover_image: images/platform-cover.png\n---\n\n# 文章\n");
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/封面稿.md" });
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.diagnostics.map((d) => d.code), [CREATION_DIAGNOSTIC_CODE.ASSET_SCAN_PARTIAL]);
  }));

  it("rejects creation_cover on a note without a verified variant relation", () => withWorkspace(({ ws }) => {
    write(ws, "20-研究/封面变体.md", "---\ncreation_cover:\n  source_path: images/original.png\n  rendition_path: images/x.png\n---\n正文\n");
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/封面变体.md" });
    assert.ok(result.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.COVER_INVALID));
  }));

  it("inspects both explicit cover paths on a verified variant without overwriting the original", () => withWorkspace(({ ws }) => {
    const parentId = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
    const parent = write(ws, "20-研究/母稿.md", `---\ncreation_id: ${parentId}\n---\n\n# 母稿\n`);
    const parentSha = createHash("sha256").update(fs.readFileSync(parent)).digest("hex");
    write(ws, "20-研究/images/original.png", coverFixture("a"));
    write(ws, "20-研究/images/wechat.png", coverFixture("b"));
    write(ws, "20-研究/微信稿.md", `---\ncreation_variant_id: e3aa264f-c02f-4ab6-a0e4-a9480eed48c8\ncreation_parent_id: ${parentId}\ncreation_target:\n  platform: wechat\n  format: article\n  entrypoint: copy-html\ncreation_source_sha256: ${parentSha}\ncreation_cover:\n  source_path: 20-研究/images/original.png\n  rendition_path: 20-研究/images/wechat.png\n---\n\n# 变体\n`);
    const result = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/微信稿.md" });
    assert.deepEqual(result.assets.map((asset) => [asset.kind, asset.role, asset.status]), [
      ["cover", "source", CREATION_ASSET_STATUS.PRESENT],
      ["cover", "rendition", CREATION_ASSET_STATUS.PRESENT],
    ]);
    assert.notEqual(result.assets[0].sha256, result.assets[1].sha256);
    assert.deepEqual(result.assets.map((asset) => [asset.format, asset.width, asset.height]),
      [["png", 4, 4], ["png", 4, 4]]);
    assert.deepEqual(result.diagnostics, []);
    const renditionFile = path.join(ws, "20-研究/images/wechat.png");
    fs.writeFileSync(renditionFile, coverFixture("b").subarray(0, 8));
    const damaged = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/微信稿.md" });
    assert.ok(damaged.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.COVER_IMAGE_INVALID));
    fs.truncateSync(renditionFile, MAX_CREATION_COVER_BYTES + 1);
    const oversized = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/微信稿.md" });
    assert.ok(oversized.diagnostics.some((item) => item.code === CREATION_DIAGNOSTIC_CODE.COVER_TOO_LARGE));
  }));

  it("changes the discovered asset hash when bytes change at the same path", () => withWorkspace(({ ws }) => {
    write(ws, "20-研究/稿.md", "![图](images/a.png)\n");
    const image = write(ws, "20-研究/images/a.png", Buffer.from("first"));
    const before = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/稿.md" });
    fs.writeFileSync(image, Buffer.from("second"));
    const after = inspectCreationContext({ workspaceRoot: ws, targetPath: "20-研究/稿.md" });
    assert.equal(before.target.sha256, after.target.sha256);
    assert.notEqual(before.assets[0].sha256, after.assets[0].sha256);
  }));

  it("rejects target escapes, missing notes, non-Markdown and invalid contracts", () => withWorkspace(({ root, ws }) => {
    write(ws, "20-研究/正文.md", "# 正文\n");
    const outside = write(root, "outside.md", "private\n");
    fs.symlinkSync(outside, path.join(ws, "20-研究", "leak.md"));
    const inspect = (targetPath) => inspectCreationContext({ workspaceRoot: ws, targetPath });
    assert.throws(() => inspect("../outside.md"), { code: "target-outside-workspace" });
    assert.throws(() => inspect("20-研究/leak.md"), { code: "target-outside-workspace" });
    assert.throws(() => inspect(outside), { code: "invalid-target" });
    assert.throws(() => inspect("20-研究/missing.md"), { code: "target-not-found" });
    assert.throws(() => inspect("20-研究/image.png"), { code: "target-not-markdown" });
    assert.throws(() => inspect("topmind.yaml"), { code: "target-not-markdown" });
    write(ws, "99-归档/旧稿.md", "# 已归档\n");
    assert.throws(() => inspect("99-归档/旧稿.md"), { code: "target-system-category" });
    fs.writeFileSync(path.join(ws, "topmind.yaml"), "contract_version: [broken\n");
    assert.throws(() => inspect("20-研究/正文.md"), { code: "invalid-contract" });
  }));

  it("uses the path as a temporary identity after a rename", () => withWorkspace(({ ws }) => {
    const oldRel = "20-研究/旧名.md";
    const newRel = "20-研究/新名.md";
    write(ws, oldRel, "# 同一篇文章\n");
    const before = inspectCreationContext({ workspaceRoot: ws, targetPath: oldRel });
    fs.renameSync(path.join(ws, oldRel), path.join(ws, newRel));
    const after = inspectCreationContext({ workspaceRoot: ws, targetPath: newRel });
    assert.notEqual(before.target.relativePath, after.target.relativePath);
    assert.equal(before.target.sha256, after.target.sha256);
  }));
});
