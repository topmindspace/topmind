import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildCreationInputSnapshot,
  inspectCreationSnapshotConsistency,
  compareCreationInputSnapshots,
  compareCreationLengthReport,
  compareCreationArticleResult,
  compareCreationLocalLengthChain,
} from "../lib/kernel-api.mjs";
import { buildDefaultContract, stringifyContract } from "../lib/contract-engine.mjs";
import { coverFixture } from "./helpers/creation-cover-fixtures.mjs";

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-snapshot-"));
  const ws = path.join(root, "workspace");
  fs.mkdirSync(path.join(ws, "20-研究", "images"), { recursive: true });
  fs.writeFileSync(path.join(ws, "topmind.yaml"), stringifyContract(buildDefaultContract()));
  const note = path.join(ws, "20-研究", "文章.md");
  const image = path.join(ws, "20-研究", "images", "cover.png");
  fs.writeFileSync(note, "# 文章\n\n![封面](images/cover.png)\n");
  fs.writeFileSync(image, "image-v1");
  try {
    return run({ ws, note, image });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function options(ws) {
  return {
    workspaceRoot: ws,
    targetPath: "20-研究/文章.md",
    platform: "wechat",
    format: "article",
    entry: "copy-html",
    accountCapabilities: { uploadImage: true, limits: { coverBytes: 10_000_000 } },
    ruleset: { id: "wechat-article", version: "2026-10-28", rules: [{ id: "synthetic.title", max: 20 }] },
    provider: { id: "article-renderer", version: "1.0.0" },
    parameters: { theme: "classic", quality: 85 },
  };
}

describe("creation input snapshots", () => {
  it("keeps a linked variant open across delivery entries while fingerprinting the chosen entry", () => withWorkspace(({ ws, note }) => {
    const creationId = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
    const variantId = "e3aa264f-c02f-4ab6-a0e4-a9480eed48c8";
    fs.writeFileSync(note, `---\ncreation_id: ${creationId}\n---\n\n# 文章\n\n![封面](images/cover.png)\n`);
    const parentSha = createHash("sha256").update(fs.readFileSync(note)).digest("hex");
    const variantPath = "20-研究/开放入口稿.md";
    fs.writeFileSync(path.join(ws, variantPath), `---\ncreation_variant_id: ${variantId}\ncreation_parent_id: ${creationId}\ncreation_target:\n  platform: wechat\n  format: article\ncreation_source_sha256: ${parentSha}\n---\n\n# 开放入口稿\n`);
    const copied = buildCreationInputSnapshot(options(ws));
    const drafted = buildCreationInputSnapshot({ ...options(ws), entry: "platform-draft" });
    assert.equal(copied.inputsComplete, true);
    assert.equal(drafted.inputsComplete, true);
    assert.equal(copied.linked.variant.relativePath, variantPath);
    assert.equal(drafted.linked.variant.relativePath, variantPath);
    assert.notEqual(copied.fingerprint, drafted.fingerprint);
    const selected = buildCreationInputSnapshot({ ...options(ws), targetPath: variantPath, entry: "platform-draft" });
    assert.equal(selected.inputsComplete, true);
    assert.equal(selected.linked.source.relativePath, "20-研究/文章.md");
    assert.throws(() => buildCreationInputSnapshot({ ...options(ws), entry: undefined }), { code: "invalid-input" });
    fs.writeFileSync(path.join(ws, "20-研究/另一个开放入口稿.md"), `---\ncreation_variant_id: 89e4c7c5-e847-45b7-a0c9-ec421c0f9b57\ncreation_parent_id: ${creationId}\ncreation_target:\n  platform: wechat\n  format: article\ncreation_source_sha256: ${parentSha}\n---\n\n# 另一个开放入口稿\n`);
    const ambiguous = buildCreationInputSnapshot(options(ws));
    assert.equal(ambiguous.inputsComplete, false);
    assert.equal(ambiguous.linked.variant, null);
    assert.ok(ambiguous.diagnostics.some((item) => item.code === "variant-target-ambiguous"));
  }));

  it("is deterministic across object key order and does not write files", () => withWorkspace(({ ws }) => {
    const before = fs.readdirSync(ws).sort();
    const first = buildCreationInputSnapshot(options(ws));
    const reordered = buildCreationInputSnapshot({
      ...options(ws),
      accountCapabilities: { limits: { coverBytes: 10_000_000 }, uploadImage: true },
      parameters: { quality: 85, theme: "classic" },
    });
    assert.equal(first.schemaVersion, 5);
    assert.equal(first.rulesetBound, true);
    assert.equal(first.lengthValidationBound, false);
    assert.match(first.selection.ruleset.contentDigest, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(first).includes("synthetic.title"), false, "rule data is returned only as a digest");
    assert.equal(first.inputsComplete, true);
    assert.match(first.fingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(inspectCreationSnapshotConsistency(first), { consistent: true, reason: "consistent" });
    assert.equal(first.fingerprint, reordered.fingerprint);
    assert.deepEqual(compareCreationInputSnapshots(first, reordered), { stale: false, reason: "unchanged" });
    assert.deepEqual(fs.readdirSync(ws).sort(), before);
    assert.equal(JSON.stringify(first).includes("uploadImage"), false, "capabilities are returned only as a digest");
    assert.equal(JSON.stringify(first).includes("classic"), false, "parameters are returned only as a digest");
  }));

  it("rejects altered snapshot payloads and derived flags before comparing receipts", () => withWorkspace(({ ws }) => {
    const original = buildCreationInputSnapshot(options(ws));
    const changedSelection = { ...original, selection: { ...original.selection, platform: "x" } };
    const changedFlag = { ...original, inputsComplete: false };
    const changedRulesFlag = { ...original, rulesetBound: false };
    const changedAsset = { ...original, assets: original.assets.map((asset) =>
      ({ ...asset, sha256: "0".repeat(64) })) };
    assert.deepEqual(inspectCreationSnapshotConsistency(changedSelection),
      { consistent: false, reason: "snapshot-fingerprint-mismatch" });
    assert.deepEqual(inspectCreationSnapshotConsistency(changedFlag),
      { consistent: false, reason: "snapshot-derived-flags-mismatch" });
    assert.deepEqual(inspectCreationSnapshotConsistency(changedRulesFlag),
      { consistent: false, reason: "snapshot-derived-flags-mismatch" });
    assert.deepEqual(inspectCreationSnapshotConsistency(changedAsset),
      { consistent: false, reason: "snapshot-fingerprint-mismatch" });
    assert.deepEqual(compareCreationInputSnapshots(changedSelection, original),
      { stale: true, reason: "invalid-previous-snapshot" });
    assert.deepEqual(compareCreationInputSnapshots(original, changedFlag),
      { stale: true, reason: "invalid-current-snapshot" });
    assert.equal(compareCreationLengthReport(changedFlag, {}).reason, "snapshot-inconsistent");
    assert.equal(compareCreationArticleResult(changedSelection, {}).reason, "snapshot-inconsistent");
    const cyclic = { ...original, selection: { ...original.selection } };
    cyclic.selection.self = cyclic.selection;
    assert.deepEqual(inspectCreationSnapshotConsistency(cyclic),
      { consistent: false, reason: "snapshot-payload-invalid" });
  }));

  it("invalidates when an image changes at the same path", () => withWorkspace(({ ws, image }) => {
    const prior = buildCreationInputSnapshot(options(ws));
    fs.writeFileSync(image, "image-v2");
    const current = buildCreationInputSnapshot(options(ws));
    assert.equal(prior.target.sha256, current.target.sha256);
    assert.notEqual(prior.assets[0].sha256, current.assets[0].sha256);
    assert.deepEqual(compareCreationInputSnapshots(prior, current), { stale: true, reason: "fingerprint-changed" });
  }));

  it("tracks Obsidian embeds and blocks ambiguous basenames", () => withWorkspace(({ ws, note }) => {
    const embedded = path.join(ws, "20-研究", "images", "pasted.png");
    fs.writeFileSync(note, "# 文章\n\n![[pasted.png|300]]\n");
    fs.writeFileSync(embedded, "pasted-v1");
    const before = buildCreationInputSnapshot(options(ws));
    assert.equal(before.inputsComplete, true);
    assert.equal(before.assets[0].relativePath, "20-研究/images/pasted.png");
    fs.writeFileSync(embedded, "pasted-v2");
    assert.deepEqual(compareCreationInputSnapshots(before, buildCreationInputSnapshot(options(ws))),
      { stale: true, reason: "fingerprint-changed" });
    fs.writeFileSync(path.join(ws, "20-研究", "pasted.png"), "another");
    const ambiguous = buildCreationInputSnapshot(options(ws));
    assert.equal(ambiguous.inputsComplete, false);
    assert.ok(ambiguous.diagnostics.some((item) => item.code === "asset-ambiguous"));
  }));

  it("invalidates for rules, entry, provider, platform, capabilities and parameters", () => withWorkspace(({ ws }) => {
    const base = options(ws);
    const prior = buildCreationInputSnapshot(base);
    const changes = [
      { ruleset: { ...base.ruleset, version: "2026-10-29" } },
      { ruleset: { ...base.ruleset, rules: [{ id: "synthetic.title", max: 21 }] } },
      { entry: "platform-draft" },
      { provider: { ...base.provider, version: "1.1.0" } },
      { platform: "x" },
      { format: "short-post" },
      { accountCapabilities: { uploadImage: false } },
      { parameters: { theme: "clean" } },
    ];
    for (const change of changes) {
      const current = buildCreationInputSnapshot({ ...base, ...change });
      assert.deepEqual(compareCreationInputSnapshots(prior, current), { stale: true, reason: "fingerprint-changed" });
    }
  }));

  it("does not certify an unchanged rule version without bound rule data", () => withWorkspace(({ ws }) => {
    const base = options(ws);
    const unbound = buildCreationInputSnapshot({ ...base,
      ruleset: { id: base.ruleset.id, version: base.ruleset.version } });
    assert.equal(unbound.inputsComplete, true, "local assets remain complete");
    assert.equal(unbound.rulesetBound, false);
    assert.equal(unbound.selection.ruleset.contentDigest, null);
    assert.deepEqual(compareCreationInputSnapshots(unbound, unbound),
      { stale: true, reason: "ruleset-unbound" });
    assert.deepEqual(compareCreationInputSnapshots(unbound, buildCreationInputSnapshot(base)),
      { stale: true, reason: "ruleset-unbound" });
    assert.throws(() => buildCreationInputSnapshot({ ...base,
      ruleset: { ...base.ruleset, rules: { apiKey: "sensitive" } } }), { code: "sensitive-input" });
  }));

  it("matches the shared rules content digest test vector", () => withWorkspace(({ ws }) => {
    const rules = [{ id: "a", check: { max: 5, field: "body" } }];
    const snapshot = buildCreationInputSnapshot({ ...options(ws),
      ruleset: { id: "vector", version: "1", rules } });
    assert.equal(snapshot.selection.ruleset.contentDigest,
      "83e4ff278a5b6eb76112c55654c54865b3a8a03dcef6bbebbb6c98ed88e29a49");
  }));

  it("binds declared length inputs and refuses mismatched or incomplete reports", () => withWorkspace(({ ws, image }) => {
    const base = options(ws);
    const lengthValidation = { document: { text_kind: "platform_text", body: "123" },
      provider: { id: "topmind-writing-skills/length-ruleset", version: "1.1.0" }, asOf: "2026-10-29" };
    const selected = { ...base, accountCapabilities: { ...base.accountCapabilities, account_capability: "basic" }, lengthValidation };
    const snapshot = buildCreationInputSnapshot(selected);
    assert.equal(snapshot.lengthValidationBound, true);
    assert.equal(snapshot.selection.lengthValidation.documentDigest,
      "9877f12d041804ff4ea36f1f71639614aae6c38bcd84f8024ff02f0dbab25407");
    const report = { schemaVersion: 1, capabilityId: "platform.validate.length-ruleset",
      provider: lengthValidation.provider, status: "ok", verdict: "pass",
      checks: [{ ruleId: "synthetic.title", category: "platform_limit", field: "body", observed: 3, max: 20 }], diagnostics: [],
      input: { fingerprint: "a".repeat(64), ruleSet: { id: base.ruleset.id, version: base.ruleset.version },
        creationSnapshotFingerprint: snapshot.fingerprint,
        rulesDigest: snapshot.selection.ruleset.contentDigest,
        documentDigest: snapshot.selection.lengthValidation.documentDigest,
        target: { platform: base.platform, format: base.format, entrypoint: base.entry, account_capability: "basic" },
        asOf: lengthValidation.asOf } };
    assert.deepEqual(compareCreationLengthReport(snapshot, report), {
      matches: true, reason: "declared-inputs-match", verdict: "pass", snapshotFingerprint: snapshot.fingerprint,
      reportFingerprint: report.input.fingerprint, sourceLineageVerified: false, publishReady: false });
    const changed = [
      ["ruleset-content-mismatch", { input: { ...report.input, rulesDigest: "0".repeat(64) } }],
      ["ruleset-identity-mismatch", { input: { ...report.input, ruleSet: { id: "other", version: base.ruleset.version } } }],
      ["target-mismatch", { input: { ...report.input, target: { ...report.input.target, entrypoint: "draft" } } }],
      ["account-capability-mismatch", { input: { ...report.input, target: { ...report.input.target, account_capability: "premium" } } }],
      ["document-mismatch", { input: { ...report.input, documentDigest: "0".repeat(64) } }],
      ["provider-mismatch", { provider: { ...report.provider, version: "2.0.0" } }],
      ["evaluation-date-mismatch", { input: { ...report.input, asOf: "2026-10-30" } }],
    ];
    for (const [reason, patch] of changed) {
      const compared = compareCreationLengthReport(snapshot, { ...report, ...patch });
      assert.equal(compared.matches, false);
      assert.equal(compared.reason, reason);
      assert.equal(compared.publishReady, false);
    }
    assert.equal(compareCreationLengthReport(snapshot, { ...report, verdict: "invalid" }).reason, "invalid-report");
    assert.equal(compareCreationLengthReport(snapshot, { ...report, checks: [] }).reason, "invalid-report");
    assert.equal(compareCreationLengthReport(snapshot, { ...report,
      input: { ...report.input, creationSnapshotFingerprint: undefined } }).reason, "snapshot-fingerprint-mismatch");
    assert.equal(compareCreationLengthReport(buildCreationInputSnapshot(base), report).reason, "length-validation-unbound");
    fs.writeFileSync(path.join(ws, "20-研究/文章.md"), "# 人工改动\n\n![封面](images/cover.png)\n");
    const refreshed = buildCreationInputSnapshot(selected);
    assert.deepEqual(compareCreationInputSnapshots(snapshot, refreshed), { stale: true, reason: "fingerprint-changed" });
    assert.equal(compareCreationLengthReport(refreshed, report).reason, "snapshot-fingerprint-mismatch");
    fs.rmSync(image);
    assert.equal(compareCreationLengthReport(buildCreationInputSnapshot(selected), report).reason, "incomplete-inputs");
    assert.throws(() => buildCreationInputSnapshot({ ...selected,
      accountCapabilities: { ...base.accountCapabilities, account_capability: "unknown" } }), { code: "invalid-input" });
    assert.throws(() => buildCreationInputSnapshot({ ...selected,
      lengthValidation: { ...lengthValidation, document: { ...lengthValidation.document, apiKey: "secret" } } }), { code: "invalid-input" });
  }));

  it("compares byte-bound article source, local text and length report without claiming editor verification", () =>
    withWorkspace(({ ws, note, image }) => {
      const lengthValidation = { document: { text_kind: "platform_text", title: "文章", body: "正文" },
        provider: { id: "topmind-writing-skills/length-ruleset", version: "1.1.0" }, asOf: "2026-10-29" };
      const selected = { ...options(ws), provider: { id: "topmind-writing-skills/article-renderer", version: "1.1.0" },
        accountCapabilities: { account_capability: "basic" }, parameters: { theme: "minimal-ink", title: "文章" },
        lengthValidation };
      const snapshot = buildCreationInputSnapshot(selected);
      const artifact = (role, format, content) => ({
        role, format, content, sha256: createHash("sha256").update(content).digest("hex"),
      });
      const report = { schemaVersion: 1, capabilityId: "article.render", provider: selected.provider,
        status: "ok", diagnostics: [], input: {
          fingerprint: "a".repeat(64), creationSnapshotFingerprint: snapshot.fingerprint,
          source: { relativePath: snapshot.target.relativePath, sha256: snapshot.target.sha256 },
          imageBytes: [{ relativePath: "20-研究/images/cover.png",
            sha256: createHash("sha256").update("image-v1").digest("hex") }],
          target: { platform: selected.platform, theme: "minimal-ink" }, localTextTitle: "文章",
          renderParameters: { theme: "minimal-ink", title: "文章" },
        }, artifacts: [
          artifact("preview", "text/html", "<html>正文</html>"),
          artifact("clipboard-html", "text/html", "<p>正文</p>"),
          artifact("source-markdown", "text/markdown", "# 文章"),
          artifact("image-checklist", "text/markdown", "# 图片清单"),
          artifact("local-clipboard-text", "text/plain", "正文"),
        ] };
      const matched = compareCreationArticleResult(snapshot, report);
      assert.equal(matched.matches, true);
      assert.equal(matched.artifactHashesVerified, true);
      assert.equal(matched.renderedImageBytesVerified, true);
      assert.equal(matched.sourceLineageVerified, false);
      assert.equal(matched.publishReady, false);
      assert.equal(matched.localTextDocumentDigest, snapshot.selection.lengthValidation.documentDigest);
      const lengthReport = { schemaVersion: 1, capabilityId: "platform.validate.length-ruleset",
        provider: lengthValidation.provider, status: "ok", verdict: "pass",
        checks: [{ category: "platform_limit", ruleId: "synthetic.title" }], diagnostics: [],
        input: { fingerprint: "b".repeat(64), creationSnapshotFingerprint: snapshot.fingerprint,
          ruleSet: { id: selected.ruleset.id, version: selected.ruleset.version },
          rulesDigest: snapshot.selection.ruleset.contentDigest,
          documentDigest: snapshot.selection.lengthValidation.documentDigest,
          target: { platform: selected.platform, format: selected.format, entrypoint: selected.entry,
            account_capability: "basic" }, asOf: lengthValidation.asOf } };
      const chain = compareCreationLocalLengthChain(snapshot, report, lengthReport);
      assert.equal(chain.matches, true);
      assert.equal(chain.localTextChainMatched, true);
      assert.equal(chain.platformEditorVerified, false);
      assert.equal(chain.publishReady, false);
      const alteredText = { ...report, artifacts: report.artifacts.map((item) => item.role === "local-clipboard-text"
        ? artifact(item.role, item.format, "改动") : item) };
      assert.equal(compareCreationLocalLengthChain(snapshot, alteredText, lengthReport).reason,
        "local-text-document-mismatch");
      assert.equal(compareCreationLocalLengthChain(snapshot, report, { ...lengthReport,
        input: { ...lengthReport.input, documentDigest: "0".repeat(64) } }).reason, "document-mismatch");
      assert.equal(compareCreationArticleResult(snapshot, { ...report,
        input: { ...report.input, source: { ...report.input.source, relativePath: "20-研究/其他.md" } } }).reason,
      "selected-source-mismatch");
      assert.equal(compareCreationArticleResult(snapshot, { ...report,
        provider: { ...report.provider, version: "2.0.0" } }).reason, "renderer-provider-mismatch");
      assert.equal(compareCreationArticleResult(snapshot, { ...report,
        input: { ...report.input, renderParameters: { theme: "newsprint", title: "文章" },
          target: { ...report.input.target, theme: "newsprint" } } }).reason, "renderer-parameters-mismatch");
      assert.equal(compareCreationArticleResult(snapshot, { ...report,
        artifacts: [{ ...report.artifacts[0], content: "<html>被篡改</html>" }, ...report.artifacts.slice(1)] }).reason,
      "article-artifacts-invalid");
      assert.equal(compareCreationArticleResult(snapshot, { ...report,
        input: { ...report.input, imageBytes: [{ ...report.input.imageBytes[0], sha256: "0".repeat(64) }] } }).reason,
      "rendered-assets-mismatch");
      fs.writeFileSync(image, "image-v2");
      const assetChanged = buildCreationInputSnapshot(selected);
      assert.equal(compareCreationArticleResult(assetChanged, report).reason, "snapshot-fingerprint-mismatch");
      fs.writeFileSync(note, "# 修改后的文章\n");
      const sourceChanged = buildCreationInputSnapshot(selected);
      assert.equal(compareCreationArticleResult(sourceChanged, report).reason, "snapshot-fingerprint-mismatch");
    }));

  it("marks missing, remote and incompletely scanned assets as incomplete", () => withWorkspace(({ ws, note, image }) => {
    const prior = buildCreationInputSnapshot(options(ws));
    fs.rmSync(image);
    const missing = buildCreationInputSnapshot(options(ws));
    assert.equal(missing.inputsComplete, false);
    assert.deepEqual(compareCreationInputSnapshots(prior, missing), { stale: true, reason: "incomplete-inputs" });
    fs.writeFileSync(note, "![远程](https://example.invalid/cover.png?access_token=sensitive)\n");
    const remote = buildCreationInputSnapshot(options(ws));
    assert.equal(remote.inputsComplete, false);
    assert.equal(JSON.stringify(remote).includes("sensitive"), false);
    fs.writeFileSync(note, "![引用][missing]\n");
    const partial = buildCreationInputSnapshot(options(ws));
    assert.equal(partial.inputsComplete, false);
    assert.ok(partial.diagnostics.some((d) => d.code === "asset-scan-partial"));
    fs.writeFileSync(note, "---\nthumbnail: images/other-cover.png\n---\n\n# 文章\n");
    const cover = buildCreationInputSnapshot(options(ws));
    assert.equal(cover.inputsComplete, false);
    assert.ok(cover.diagnostics.some((d) => d.code === "asset-scan-partial"));
  }));

  it("cannot mark an ambiguous copied creation ID as complete", () => withWorkspace(({ ws, note }) => {
    const id = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
    const original = `---\ntitle: 文章\nsource_type: user-original\ncreation_id: ${id}\n---\n\n# 文章\n`;
    fs.writeFileSync(note, original);
    fs.writeFileSync(path.join(ws, "20-研究", "副本.md"), original);
    const snapshot = buildCreationInputSnapshot(options(ws));
    assert.equal(snapshot.inputsComplete, false);
    assert.ok(snapshot.diagnostics.some((item) => item.code === "creation-id-conflict"));
  }));

  it("tracks a verified mother and matching variant and invalidates when either changes", () => withWorkspace(({ ws, note }) => {
    const creationId = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
    const variantId = "e3aa264f-c02f-4ab6-a0e4-a9480eed48c8";
    fs.writeFileSync(note, `---\ntitle: 文章\nsource_type: user-original\ncreation_id: ${creationId}\n---\n\n# 原稿\n\n![母稿图](images/source.png)\n`);
    const sourceImage = path.join(ws, "20-研究", "images", "source.png");
    fs.writeFileSync(sourceImage, "source-image-v1");
    const parentSha = createHash("sha256").update(fs.readFileSync(note)).digest("hex");
    const variantPath = path.join(ws, "20-研究", "公众号版.md");
    fs.writeFileSync(variantPath, `---\ntitle: 公众号版\nsource_type: ai-derived\ncreation_variant_id: ${variantId}\ncreation_parent_id: ${creationId}\ncreation_target:\n  platform: wechat\n  format: article\n  entrypoint: copy-html\ncreation_source_sha256: ${parentSha}\n---\n\n# 公众号版\n\n![变体图](images/variant.png)\n`);
    const variantImage = path.join(ws, "20-研究", "images", "variant.png");
    fs.writeFileSync(variantImage, "variant-image-v1");
    const motherSnapshot = buildCreationInputSnapshot(options(ws));
    assert.equal(motherSnapshot.inputsComplete, true);
    assert.equal(motherSnapshot.linked.source.sha256, parentSha);
    assert.equal(motherSnapshot.linked.variant.variantId, variantId);
    assert.ok(motherSnapshot.assets.some((asset) => asset.notePath === "20-研究/公众号版.md" &&
      asset.relativePath === "20-研究/images/variant.png"));
    const variantOptions = { ...options(ws), targetPath: "20-研究/公众号版.md" };
    const variantSnapshot = buildCreationInputSnapshot(variantOptions);
    assert.equal(variantSnapshot.inputsComplete, true);
    assert.equal(variantSnapshot.linked.source.sha256, parentSha);
    assert.ok(variantSnapshot.assets.some((asset) => asset.notePath === "20-研究/文章.md" &&
      asset.relativePath === "20-研究/images/source.png"));
    fs.writeFileSync(sourceImage, "source-image-v2");
    assert.deepEqual(compareCreationInputSnapshots(variantSnapshot, buildCreationInputSnapshot(variantOptions)), { stale: true, reason: "fingerprint-changed" });
    fs.writeFileSync(sourceImage, "source-image-v1");
    fs.writeFileSync(variantImage, "variant-image-v2");
    const imageChanged = buildCreationInputSnapshot(options(ws));
    assert.deepEqual(compareCreationInputSnapshots(motherSnapshot, imageChanged), { stale: true, reason: "fingerprint-changed" });
    fs.writeFileSync(variantImage, "variant-image-v1");
    fs.appendFileSync(variantPath, "\n后续编辑\n");
    const editedVariant = buildCreationInputSnapshot(options(ws));
    assert.deepEqual(compareCreationInputSnapshots(motherSnapshot, editedVariant), { stale: true, reason: "fingerprint-changed" });
    fs.appendFileSync(note, "\n母稿更新\n");
    const editedMother = buildCreationInputSnapshot(variantOptions);
    assert.equal(editedMother.inputsComplete, true);
    assert.equal(buildCreationInputSnapshot(options(ws)).inputsComplete, true);
    assert.ok(editedMother.diagnostics.some((item) => item.code === "variant-source-stale"));
    assert.deepEqual(inspectCreationSnapshotConsistency(editedMother), { consistent: true, reason: "consistent" });
    assert.deepEqual(compareCreationInputSnapshots(variantSnapshot, editedMother), { stale: true, reason: "fingerprint-changed" });
    assert.deepEqual(compareCreationInputSnapshots(editedMother, buildCreationInputSnapshot(variantOptions)),
      { stale: false, reason: "unchanged" });
    assert.deepEqual(inspectCreationSnapshotConsistency({ ...editedMother, inputsComplete: false }),
      { consistent: false, reason: "snapshot-derived-flags-mismatch" });
    fs.rmSync(sourceImage);
    const missingAfterDrift = buildCreationInputSnapshot(variantOptions);
    assert.equal(missingAfterDrift.inputsComplete, false);
    assert.ok(missingAfterDrift.diagnostics.some((item) => item.code === "asset-missing"));
  }));

  it("tracks both cover files and rejects missing, escaped or unknown renditions", () => withWorkspace(({ ws, note }) => {
    const parentId = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
    fs.writeFileSync(note, `---\ncreation_id: ${parentId}\n---\n\n# 原稿\n`);
    const parentSha = createHash("sha256").update(fs.readFileSync(note)).digest("hex");
    const original = path.join(ws, "20-研究", "images", "original.png");
    const rendition = path.join(ws, "20-研究", "images", "wechat.png");
    fs.writeFileSync(original, coverFixture("a"));
    fs.writeFileSync(rendition, coverFixture("b"));
    const variantPath = path.join(ws, "20-研究", "微信稿.md");
    const variant = (sourcePath, renditionPath) => `---\ncreation_variant_id: e3aa264f-c02f-4ab6-a0e4-a9480eed48c8\ncreation_parent_id: ${parentId}\ncreation_target:\n  platform: wechat\n  format: article\n  entrypoint: copy-html\ncreation_source_sha256: ${parentSha}\ncreation_cover:\n  source_path: ${sourcePath}\n  rendition_path: ${renditionPath}\n---\n\n# 微信稿\n`;
    fs.writeFileSync(variantPath, variant("20-研究/images/original.png", "20-研究/images/wechat.png"));
    const before = buildCreationInputSnapshot(options(ws));
    assert.equal(before.inputsComplete, true);
    assert.deepEqual(before.assets.filter((asset) => asset.kind === "cover").map((asset) => asset.role), ["source", "rendition"]);
    fs.writeFileSync(original, coverFixture("c"));
    assert.deepEqual(compareCreationInputSnapshots(before, buildCreationInputSnapshot(options(ws))), { stale: true, reason: "fingerprint-changed" });
    fs.writeFileSync(rendition, coverFixture("d"));
    assert.deepEqual(compareCreationInputSnapshots(before, buildCreationInputSnapshot(options(ws))), { stale: true, reason: "fingerprint-changed" });
    fs.rmSync(rendition);
    const missing = buildCreationInputSnapshot(options(ws));
    assert.equal(missing.inputsComplete, false);
    assert.ok(missing.diagnostics.some((item) => item.code === "cover-missing"));
    fs.writeFileSync(variantPath, variant("20-研究/images/original.png", "../outside.png"));
    const escaped = buildCreationInputSnapshot(options(ws));
    assert.equal(escaped.inputsComplete, false);
    assert.ok(escaped.diagnostics.some((item) => item.code === "cover-invalid"));
    fs.writeFileSync(rendition, "not an image");
    fs.writeFileSync(variantPath, variant("20-研究/images/original.png", "20-研究/images/wechat.png"));
    const unknown = buildCreationInputSnapshot(options(ws));
    assert.equal(unknown.inputsComplete, false);
    assert.ok(unknown.diagnostics.some((item) => item.code === "cover-format-unsupported"));
    const outside = path.join(path.dirname(ws), "outside.png");
    fs.writeFileSync(outside, coverFixture("a"));
    fs.rmSync(rendition);
    fs.symlinkSync(outside, rendition);
    const outsideCover = buildCreationInputSnapshot(options(ws));
    assert.equal(outsideCover.inputsComplete, false);
    assert.ok(outsideCover.diagnostics.some((item) => item.code === "cover-outside-workspace"));
    assert.ok(!JSON.stringify(outsideCover).includes(outside));
    fs.rmSync(rendition);
    fs.symlinkSync(original, rendition);
    const sameFile = buildCreationInputSnapshot(options(ws));
    assert.equal(sameFile.inputsComplete, false);
    assert.ok(sameFile.diagnostics.some((item) => item.code === "cover-invalid"));
  }));

  it("rejects a variant used for another delivery target", () => withWorkspace(({ ws, note }) => {
    const creationId = "426ca86c-eabc-4cb1-86d2-9a59437fb532";
    fs.writeFileSync(note, `---\ncreation_id: ${creationId}\n---\n\n# 原稿\n`);
    const parentSha = createHash("sha256").update(fs.readFileSync(note)).digest("hex");
    fs.writeFileSync(path.join(ws, "20-研究", "X版.md"), `---\ncreation_variant_id: e3aa264f-c02f-4ab6-a0e4-a9480eed48c8\ncreation_parent_id: ${creationId}\ncreation_target:\n  platform: x\n  format: article\n  entrypoint: copy-html\ncreation_source_sha256: ${parentSha}\n---\n\n# X版\n`);
    const snapshot = buildCreationInputSnapshot({ ...options(ws), targetPath: "20-研究/X版.md" });
    assert.equal(snapshot.inputsComplete, false);
    assert.ok(snapshot.diagnostics.some((item) => item.code === "variant-target-mismatch"));
  }));

  it("rejects nested sensitive keys without echoing values", () => withWorkspace(({ ws }) => {
    for (const change of [
      { accountCapabilities: { nested: { accessToken: "do-not-echo" } } },
      { parameters: { auth: [{ apiKey: "do-not-echo" }] } },
    ]) {
      assert.throws(() => buildCreationInputSnapshot({ ...options(ws), ...change }), (error) => {
        assert.equal(error.code, "sensitive-input");
        assert.ok(!error.message.includes("do-not-echo"));
        return true;
      });
    }
    assert.deepEqual(compareCreationInputSnapshots(null, null), { stale: true, reason: "missing-previous" });
  }));
});
