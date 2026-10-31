/** Explicitly link two existing, independent image files to a verified variant. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectCreationContext, inspectCreationCoverAsset, inspectCreationCoverPaths,
  CREATION_ASSET_STATUS, CREATION_DIAGNOSTIC_CODE, isBlockingCreationDiagnostic } from "./creation-context.mjs";
import { inspectCreationCoverImageBytes, MAX_CREATION_COVER_BYTES } from "./creation-image-metadata.mjs";
import { parseCreationFrontmatter } from "./creation-frontmatter.mjs";
import { resolveWorkspacePath } from "./workspace-model.mjs";
import { executeWrite, executeBinaryCreate } from "./writeback-engine.mjs";
import { contentHash } from "./content-hash.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;

export class CreationCoverError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CreationCoverError";
    this.code = code;
  }
}

function requiredHash(value, field) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new CreationCoverError("expected-hash-required", `${field} must be an inspected SHA-256`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkedPair({ workspaceRoot, targetPath, sourcePath, renditionPath,
  expectedSourceSha256, expectedRenditionSha256 }) {
  const result = inspectCreationCoverPaths({ workspaceRoot, targetPath, sourcePath, renditionPath });
  if (result.diagnostics.length || result.assets.length !== 2 ||
      result.assets.some((asset) => asset.status !== CREATION_ASSET_STATUS.PRESENT)) {
    throw new CreationCoverError("invalid-cover-assets", "Cover files must be distinct, local, readable PNG, JPEG or WebP images");
  }
  const [source, rendition] = result.assets;
  if (source.sha256 !== expectedSourceSha256) {
    throw new CreationCoverError("stale-source", "Source image changed; inspect it again");
  }
  if (rendition.sha256 !== expectedRenditionSha256) {
    throw new CreationCoverError("stale-rendition", "Rendition image changed; inspect it again");
  }
  return { source, rendition };
}

function checkedVariant({ workspaceRoot, variantPath, engineRoot, expectedVariantSha256 }) {
  requiredHash(expectedVariantSha256, "expectedVariantSha256");
  const variant = inspectCreationContext({ workspaceRoot, targetPath: variantPath, engineRoot });
  if (variant.target.sha256 !== expectedVariantSha256) {
    throw new CreationCoverError("stale-variant", "Variant note changed; inspect it again");
  }
  if (variant.target.variantStatus !== "valid" || !variant.target.creationVariantId ||
      variant.diagnostics.some((item) => item.code.startsWith("variant-") && isBlockingCreationDiagnostic(item))) {
    throw new CreationCoverError("invalid-variant", "Cover can be linked only to a current, verified platform variant");
  }
  const root = fs.realpathSync(workspaceRoot);
  const selected = resolveWorkspacePath(root, variant.target.relativePath);
  const variantRaw = fs.readFileSync(selected.absolute);
  if (sha256(variantRaw) !== expectedVariantSha256) {
    throw new CreationCoverError("stale-variant", "Variant note changed during inspection");
  }
  const markdown = variantRaw.toString("utf8");
  const parsed = parseCreationFrontmatter(markdown);
  if (!parsed.valid || !parsed.exists || Object.hasOwn(parsed.fields, "creation_cover")) {
    throw new CreationCoverError("cover-already-linked", "Existing or malformed cover metadata needs review");
  }
  return { variant, root, selected, markdown, parsed };
}

export function linkCreationCover({
  workspaceRoot, variantPath, engineRoot,
  sourcePath, renditionPath,
  expectedVariantSha256, expectedSourceSha256, expectedRenditionSha256,
  userConfirmed = false,
} = {}) {
  if (userConfirmed !== true) {
    throw new CreationCoverError("user-action-required", "Linking a cover requires an explicit user action");
  }
  requiredHash(expectedSourceSha256, "expectedSourceSha256");
  requiredHash(expectedRenditionSha256, "expectedRenditionSha256");
  const { variant, root, selected, markdown, parsed } = checkedVariant({
    workspaceRoot, variantPath, engineRoot, expectedVariantSha256,
  });
  const pair = checkedPair({ workspaceRoot: root, targetPath: selected.relativePath,
    sourcePath, renditionPath, expectedSourceSha256, expectedRenditionSha256 });
  const eol = parsed.eol;
  const addition = ["creation_cover:",
    `  source_path: ${JSON.stringify(pair.source.relativePath)}`,
    `  rendition_path: ${JSON.stringify(pair.rendition.relativePath)}`,
    ""].join(eol);
  const next = markdown.slice(0, parsed.insertOffset) + addition + markdown.slice(parsed.insertOffset);
  checkedPair({ workspaceRoot: root, targetPath: selected.relativePath,
    sourcePath, renditionPath, expectedSourceSha256, expectedRenditionSha256 });
  const evidence = executeWrite({
    targetPath: selected.absolute, content: next, workspaceRoot: root,
    role: variant.category.role, actor: "user", operation: "update", confirmed: true,
    expectedHash: contentHash(markdown.replace(/\r\n?/gu, "\n")), casRequiresExisting: true,
    expectedRawSha256: expectedVariantSha256,
    allowCreationMetadataChange: true,
  });
  if (!evidence.wroteFiles) {
    throw new CreationCoverError("write-not-committed", `Cover relation was not written: ${evidence.reason || "unknown"}`);
  }
  let checked = null;
  try { checked = inspectCreationContext({ workspaceRoot: root, targetPath: selected.relativePath, engineRoot }); }
  catch { /* The write committed; return a review state instead of implying failure. */ }
  const coverAssets = checked?.assets.filter((asset) => asset.kind === "cover") || [];
  const diagnostics = checked?.diagnostics.filter((item) => item.code.startsWith("cover-") || item.code.startsWith("variant-")) ||
    [{ code: "cover-post-inspection-failed", severity: "warning", path: selected.relativePath, reference: null }];
  const needsReview = evidence.partial || checked?.target.variantStatus !== "valid" || diagnostics.length > 0 ||
    coverAssets.length !== 2 || coverAssets[0].sha256 !== expectedSourceSha256 ||
    coverAssets[1].sha256 !== expectedRenditionSha256;
  return {
    status: needsReview ? "linked-needs-review" : "linked",
    targetPath: selected.relativePath,
    variantId: variant.target.creationVariantId,
    cover: { sourcePath: pair.source.relativePath, renditionPath: pair.rendition.relativePath,
      sourceSha256: expectedSourceSha256, renditionSha256: expectedRenditionSha256 },
    writebackEvidence: evidence,
    diagnostics,
  };
}

/** Import an already-rendered platform image into a stable, managed path. */
export function importCreationCoverRendition({
  workspaceRoot, variantPath, engineRoot, sourcePath, renditionBytes,
  expectedVariantSha256, expectedSourceSha256, expectedRenditionSha256,
  userConfirmed = false,
} = {}) {
  if (userConfirmed !== true) {
    throw new CreationCoverError("user-action-required", "Importing a cover requires an explicit user action");
  }
  requiredHash(expectedSourceSha256, "expectedSourceSha256");
  requiredHash(expectedRenditionSha256, "expectedRenditionSha256");
  const { variant, root, selected } = checkedVariant({
    workspaceRoot, variantPath, engineRoot, expectedVariantSha256,
  });
  const source = inspectCreationCoverAsset({ workspaceRoot: root, targetPath: selected.relativePath,
    assetPath: sourcePath, role: "source" });
  if (source.diagnostic || source.asset.status !== CREATION_ASSET_STATUS.PRESENT) {
    throw new CreationCoverError("invalid-source", "Source cover must be a local, readable PNG, JPEG or WebP image");
  }
  if (source.asset.sha256 !== expectedSourceSha256) {
    throw new CreationCoverError("stale-source", "Source image changed; inspect it again");
  }
  if (!(renditionBytes instanceof Uint8Array) || renditionBytes.byteLength === 0 ||
      renditionBytes.byteLength > MAX_CREATION_COVER_BYTES) {
    throw new CreationCoverError("invalid-rendition", "Rendition must be 1 byte to 32 MiB");
  }
  const bytes = Buffer.from(renditionBytes);
  if (sha256(bytes) !== expectedRenditionSha256) {
    throw new CreationCoverError("stale-rendition", "Rendition changed; inspect it again");
  }
  const metadata = inspectCreationCoverImageBytes(bytes);
  if (!metadata) throw new CreationCoverError("invalid-rendition", "Rendition must be a structurally valid PNG, JPEG or WebP image");
  const { format } = metadata;
  const extension = format === "jpeg" ? "jpg" : format;
  const renditionPath = path.posix.join(path.posix.dirname(selected.relativePath),
    "images", "creation-covers", variant.target.creationVariantId,
    `rendition-${expectedRenditionSha256}.${extension}`);
  if (source.asset.relativePath === renditionPath) {
    throw new CreationCoverError("invalid-source", "Source and rendition must be independent files");
  }
  const evidence = executeBinaryCreate({ workspaceRoot: root, targetPath: renditionPath,
    bytes, expectedSha256: expectedRenditionSha256, role: variant.category.role,
    actor: "user", confirmed: true });
  let checked;
  try {
    checked = inspectCreationCoverPaths({ workspaceRoot: root, targetPath: selected.relativePath,
      sourcePath: source.asset.relativePath, renditionPath });
  } catch {
    checked = { assets: [], diagnostics: [{ code: "cover-post-inspection-failed",
      severity: "warning", path: selected.relativePath, reference: null }] };
  }
  const valid = checked.diagnostics.length === 0 && checked.assets.length === 2 &&
    checked.assets[0].sha256 === expectedSourceSha256 && checked.assets[1].sha256 === expectedRenditionSha256;
  if (!valid && !evidence.wroteFiles) {
    throw new CreationCoverError("target-conflict", "Managed rendition path exists with different or invalid content");
  }
  return {
    status: !valid || evidence.partial ? "imported-needs-review" : evidence.wroteFiles ? "imported-unlinked" : "existing-unlinked",
    variantId: variant.target.creationVariantId,
    variantPath: selected.relativePath,
    sourcePath: source.asset.relativePath,
    renditionPath,
    sourceSha256: expectedSourceSha256,
    renditionSha256: expectedRenditionSha256,
    ...metadata,
    writebackEvidence: evidence,
    diagnostics: [...checked.diagnostics, ...variant.diagnostics.filter((item) =>
      item.code === CREATION_DIAGNOSTIC_CODE.VARIANT_SOURCE_STALE)],
  };
}
