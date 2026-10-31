/** Explicitly link an existing Markdown note to a verified creation mother. */
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { inspectCreationContext } from "./creation-context.mjs";
import { findVariantIdOwners, parseCreationFrontmatter, validCreationTarget } from "./creation-id.mjs";
import { resolveWorkspaceModel, resolveWorkspacePath } from "./workspace-model.mjs";
import { executeWrite } from "./writeback-engine.mjs";
import { contentHash } from "./content-hash.mjs";

const SOURCE_TYPES = new Set(["user-original", "ai-derived", "external-capture"]);
const SHA256 = /^[a-f0-9]{64}$/u;

export class CreationVariantError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CreationVariantError";
    this.code = code;
  }
}

function requiredHash(hash, field) {
  if (typeof hash !== "string" || !SHA256.test(hash)) {
    throw new CreationVariantError("expected-hash-required", `${field} must be an exact SHA-256 from inspection`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function linkCreationVariant({
  workspaceRoot, parentPath, variantPath, engineRoot,
  expectedParentSha256, expectedVariantSha256, target,
  title, sourceType, userConfirmed = false,
} = {}) {
  if (userConfirmed !== true) {
    throw new CreationVariantError("user-action-required", "Linking a platform variant requires an explicit user action");
  }
  requiredHash(expectedParentSha256, "expectedParentSha256");
  requiredHash(expectedVariantSha256, "expectedVariantSha256");
  if (!validCreationTarget(target)) {
    throw new CreationVariantError("invalid-target", "target needs platform and format slugs; entrypoint is optional");
  }
  const mother = inspectCreationContext({ workspaceRoot, targetPath: parentPath, engineRoot });
  if (mother.target.sha256 !== expectedParentSha256) {
    throw new CreationVariantError("stale-parent", "Mother note changed; inspect it again");
  }
  if (mother.target.identityStatus !== "valid" || !mother.target.creationId || mother.target.variantStatus !== "none") {
    throw new CreationVariantError("invalid-parent", "Selected mother has no verified creation_id");
  }
  const variant = inspectCreationContext({ workspaceRoot, targetPath: variantPath, engineRoot });
  if (variant.target.sha256 !== expectedVariantSha256) {
    throw new CreationVariantError("stale-variant", "Variant note changed; inspect it again");
  }
  if (variant.target.relativePath === mother.target.relativePath || variant.target.identityStatus !== "none" ||
      variant.target.variantStatus !== "none") {
    throw new CreationVariantError("variant-already-linked", "Selected variant is already a mother or has creation relationship metadata");
  }
  const root = fs.realpathSync(workspaceRoot);
  const parent = resolveWorkspacePath(root, mother.target.relativePath);
  const selected = resolveWorkspacePath(root, variant.target.relativePath);
  const parentRaw = fs.readFileSync(parent.absolute);
  const variantRaw = fs.readFileSync(selected.absolute);
  if (sha256(parentRaw) !== expectedParentSha256) throw new CreationVariantError("stale-parent", "Mother note changed; inspect it again");
  if (sha256(variantRaw) !== expectedVariantSha256) throw new CreationVariantError("stale-variant", "Variant note changed; inspect it again");
  const markdown = variantRaw.toString("utf8");
  const parsed = parseCreationFrontmatter(markdown);
  if (!parsed.valid) throw new CreationVariantError("invalid-frontmatter", "Repair malformed variant frontmatter first");
  const fields = parsed.fields;
  for (const key of ["creation_id", "creation_variant_id", "creation_parent_id", "creation_target", "creation_source_sha256", "creation_cover"]) {
    if (Object.hasOwn(fields, key)) throw new CreationVariantError("variant-already-linked", "Existing creation metadata needs manual review");
  }
  if (Object.hasOwn(fields, "title") && (typeof fields.title !== "string" || !fields.title.trim())) {
    throw new CreationVariantError("invalid-frontmatter", "Repair variant title first");
  }
  if (Object.hasOwn(fields, "source_type") && !SOURCE_TYPES.has(fields.source_type)) {
    throw new CreationVariantError("invalid-frontmatter", "Repair variant source_type first");
  }
  const additions = [];
  if (!Object.hasOwn(fields, "title")) {
    if (typeof title !== "string" || !title.trim() || /[\r\n]/u.test(title)) {
      throw new CreationVariantError("title-required", "Explicit single-line title required for this variant");
    }
    additions.push(`title: ${JSON.stringify(title.trim())}`);
  }
  if (!Object.hasOwn(fields, "source_type")) {
    if (!SOURCE_TYPES.has(sourceType)) throw new CreationVariantError("source-type-required", "Explicit valid sourceType required for this variant");
    additions.push(`source_type: ${sourceType}`);
  }
  const model = resolveWorkspaceModel({ workspaceRoot: root, engineRoot });
  let variantId;
  try {
    do { variantId = randomUUID(); } while (findVariantIdOwners(root, model, variantId).length > 0);
  } catch {
    throw new CreationVariantError("variant-scan-incomplete", "Could not verify variant ID uniqueness");
  }
  additions.push(`creation_variant_id: ${variantId}`);
  additions.push(`creation_parent_id: ${mother.target.creationId}`);
  additions.push("creation_target:");
  for (const key of ["platform", "format", "entrypoint"]) {
    if (Object.hasOwn(target, key)) additions.push(`  ${key}: ${target[key]}`);
  }
  additions.push(`creation_source_sha256: ${expectedParentSha256}`);
  const eol = parsed.eol;
  const addition = additions.join(eol) + eol;
  const next = parsed.exists
    ? markdown.slice(0, parsed.insertOffset) + addition + markdown.slice(parsed.insertOffset)
    : `${parsed.bom}---${eol}${addition}---${eol}${eol}${markdown.slice(parsed.bom.length)}`;
  if (sha256(fs.readFileSync(parent.absolute)) !== expectedParentSha256) {
    throw new CreationVariantError("stale-parent", "Mother note changed during linking");
  }
  const evidence = executeWrite({
    targetPath: selected.absolute, content: next, workspaceRoot: root,
    role: variant.category.role, actor: "user", operation: "update",
    expectedHash: contentHash(markdown.replace(/\r\n?/gu, "\n")), casRequiresExisting: true,
    expectedRawSha256: expectedVariantSha256,
    allowCreationMetadataChange: true,
  });
  if (!evidence.wroteFiles) {
    throw new CreationVariantError("write-not-committed", `Variant relation was not written: ${evidence.reason || "unknown"}`);
  }
  const checked = inspectCreationContext({ workspaceRoot: root, targetPath: selected.relativePath, engineRoot });
  const needsReview = evidence.partial || checked.target.variantStatus !== "valid" ||
    checked.target.parentCreationId !== mother.target.creationId ||
    checked.diagnostics.some((item) => item.code.startsWith("variant-"));
  return {
    status: needsReview ? "linked-needs-review" : "linked",
    variantId, parentCreationId: mother.target.creationId,
    targetPath: selected.relativePath, writebackEvidence: evidence,
    diagnostics: checked.diagnostics.filter((item) => item.code.startsWith("variant-")),
  };
}
