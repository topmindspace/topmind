/** Explicit, CAS-guarded assignment of a creation ID to one selected note. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { inspectCreationContext } from "./creation-context.mjs";
import { findCreationIdOwners, parseCreationFrontmatter } from "./creation-id.mjs";
import { resolveWorkspaceModel, resolveWorkspacePath } from "./workspace-model.mjs";
import { executeWrite } from "./writeback-engine.mjs";
import { contentHash } from "./content-hash.mjs";

const SOURCE_TYPES = new Set(["user-original", "ai-derived", "external-capture"]);

export class CreationIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CreationIdentityError";
    this.code = code;
  }
}

function requiredTitle(value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/u.test(value)) {
    throw new CreationIdentityError("title-required", "A single-line title is required for this note");
  }
  return value.trim();
}

/** Requires explicit user action and the selected target's exact SHA-256. */
export function assignCreationId({
  workspaceRoot, targetPath, engineRoot, expectedSha256,
  title, sourceType, userConfirmed = false,
} = {}) {
  if (userConfirmed !== true) {
    throw new CreationIdentityError("user-action-required", "Creation identity requires an explicit user action");
  }
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new CreationIdentityError("expected-hash-required", "The selected note SHA-256 is required");
  }
  const context = inspectCreationContext({ workspaceRoot, targetPath, engineRoot });
  if (context.target.sha256 !== expectedSha256) {
    throw new CreationIdentityError("stale-target", "Selected note changed; inspect it again");
  }
  if (context.target.identityStatus !== "none" && context.target.identityStatus !== "valid") {
    throw new CreationIdentityError("identity-conflict", `Creation identity is ${context.target.identityStatus}`);
  }
  if (context.target.creationId) {
    return { status: "unchanged", creationId: context.target.creationId, targetPath: context.target.relativePath, writebackEvidence: null };
  }
  const root = fs.realpathSync(workspaceRoot);
  const selected = resolveWorkspacePath(root, context.target.relativePath);
  const raw = fs.readFileSync(selected.absolute);
  if (createHash("sha256").update(raw).digest("hex") !== expectedSha256) {
    throw new CreationIdentityError("stale-target", "Selected note changed; inspect it again");
  }
  const markdown = raw.toString("utf8");
  const parsed = parseCreationFrontmatter(markdown);
  if (!parsed.valid) throw new CreationIdentityError("invalid-frontmatter", "Repair malformed frontmatter before assigning an ID");
  const fields = parsed.fields;
  if (Object.hasOwn(fields, "creation_id")) {
    throw new CreationIdentityError("identity-conflict", "Existing creation_id needs manual review");
  }
  if (["creation_variant_id", "creation_parent_id", "creation_target", "creation_source_sha256", "creation_cover"]
    .some((key) => Object.hasOwn(fields, key))) {
    throw new CreationIdentityError("identity-conflict", "A variant note cannot be assigned a mother creation_id");
  }
  if (Object.hasOwn(fields, "title") && (typeof fields.title !== "string" || !fields.title.trim())) {
    throw new CreationIdentityError("invalid-frontmatter", "Repair title before assigning an ID");
  }
  if (Object.hasOwn(fields, "source_type") && !SOURCE_TYPES.has(fields.source_type)) {
    throw new CreationIdentityError("invalid-frontmatter", "Repair source_type before assigning an ID");
  }
  const missing = [];
  if (!Object.hasOwn(fields, "title")) missing.push(`title: ${JSON.stringify(requiredTitle(title))}`);
  if (!Object.hasOwn(fields, "source_type")) {
    if (!SOURCE_TYPES.has(sourceType)) {
      throw new CreationIdentityError("source-type-required", "An explicit valid sourceType is required for this note");
    }
    missing.push(`source_type: ${sourceType}`);
  }
  const model = resolveWorkspaceModel({ workspaceRoot: root, engineRoot });
  let id;
  try {
    do { id = randomUUID(); } while (findCreationIdOwners(root, model, id).length > 0);
  } catch {
    throw new CreationIdentityError("identity-scan-incomplete", "Could not verify creation ID uniqueness");
  }
  const eol = parsed.eol;
  const addition = [...missing, `creation_id: ${id}`].join(eol) + eol;
  const next = parsed.exists
    ? markdown.slice(0, parsed.insertOffset) + addition + markdown.slice(parsed.insertOffset)
    : `${parsed.bom}---${eol}${addition}---${eol}${eol}${markdown.slice(parsed.bom.length)}`;
  const evidence = executeWrite({
    targetPath: selected.absolute,
    content: next,
    workspaceRoot: root,
    role: context.category.role,
    actor: "user",
    operation: "update",
    expectedHash: contentHash(markdown.replace(/\r\n?/gu, "\n")),
    expectedRawSha256: expectedSha256,
    casRequiresExisting: true,
    allowCreationMetadataChange: true,
  });
  if (!evidence.wroteFiles) {
    throw new CreationIdentityError("write-not-committed", `Creation identity was not written: ${evidence.reason || "unknown"}`);
  }
  return { status: evidence.partial ? "assigned-needs-review" : "assigned", creationId: id, targetPath: context.target.relativePath, writebackEvidence: evidence };
}
