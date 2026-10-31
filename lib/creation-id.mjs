/** Stable creation identity belongs to the selected note's frontmatter. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseCreationFrontmatter } from "./creation-frontmatter.mjs";
export { parseCreationFrontmatter } from "./creation-frontmatter.mjs";
import { isMarkdownNotePath } from "./text-note.mjs";
import { resolveArchivePlaneRel, resolveWorkspacePath } from "./workspace-model.mjs";
import { isPathOnOrUnder } from "./model-core.mjs";
import { shouldSkipVaultDirName } from "./vault-walk.mjs";

export const CREATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_SCAN_FILES = 100_000;
const MAX_HEADER_BYTES = 256 * 1024;
const headerBuffer = Buffer.allocUnsafe(MAX_HEADER_BYTES);

function readIdentityHead(absolutePath) {
  const fd = fs.openSync(absolutePath, "r");
  let count;
  let size;
  try {
    size = fs.fstatSync(fd).size;
    count = fs.readSync(fd, headerBuffer, 0, MAX_HEADER_BYTES, 0);
  } finally {
    fs.closeSync(fd);
  }
  const markdown = headerBuffer.toString("utf8", 0, count);
  const parsed = parseCreationFrontmatter(markdown);
  if (size > count && parsed.exists && !parsed.valid && parsed.reason === "unclosed") {
    throw new Error("creation-id-header-too-large");
  }
  return markdown;
}

function noteIdentity(markdown) {
  const parsed = parseCreationFrontmatter(markdown);
  if (!parsed.valid) {
    return { id: null, invalid: /creation_id/iu.test(markdown.slice(0, 64 * 1024)) };
  }
  if (!Object.hasOwn(parsed.fields, "creation_id")) return { id: null, invalid: false };
  if (["creation_variant_id", "creation_parent_id", "creation_target", "creation_source_sha256"]
    .some((key) => Object.hasOwn(parsed.fields, key))) return { id: null, invalid: true };
  const id = parsed.fields.creation_id;
  return typeof id === "string" && CREATION_ID_RE.test(id)
    ? { id, invalid: false }
    : { id: null, invalid: true };
}

/** Bounded scan of real note headers, excluding derived trees and safety copies. */
export function scanCreationNotes(workspaceRoot, model, visit) {
  let visited = 0;
  const safetyPlanes = ["backups", "receipts"].map((leaf) =>
    resolveArchivePlaneRel(workspaceRoot, model.config, leaf));
  const isSafetyPath = (absolute) => {
    const relative = path.relative(workspaceRoot, absolute).replace(/\\/gu, "/");
    return safetyPlanes.some((plane) => isPathOnOrUnder(relative, plane));
  };
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (isSafetyPath(absolute)) continue;
      if (entry.isDirectory()) {
        if (!shouldSkipVaultDirName(entry.name)) walk(absolute);
      } else if (entry.isFile() && isMarkdownNotePath(entry.name)) {
        if (++visited > MAX_SCAN_FILES) throw new Error("creation-id-scan-limit");
        const markdown = readIdentityHead(absolute);
        visit({
          relativePath: path.relative(workspaceRoot, absolute).replace(/\\/gu, "/"),
          absolutePath: absolute,
          markdown,
          frontmatter: parseCreationFrontmatter(markdown),
        });
      }
    }
  };
  for (const category of model.categories) {
    if (!category.ok) continue;
    const resolved = resolveWorkspacePath(workspaceRoot, category.directory);
    const stat = fs.lstatSync(path.join(workspaceRoot, category.directory));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("creation-id-scan-unsafe-category");
    if (!isSafetyPath(resolved.absolute)) walk(resolved.absolute);
  }
}

/** Bounded, read-only scan of discovered category files. Throws if uniqueness cannot be checked. */
export function findCreationIdOwners(workspaceRoot, model, creationId) {
  const owners = [];
  scanCreationNotes(workspaceRoot, model, ({ relativePath, markdown }) => {
    const { id, invalid } = noteIdentity(markdown);
    // An unrelated malformed ID must not make every other creation unusable.
    // A malformed header containing the queried ID still blocks uniqueness.
    if (invalid && markdown.includes(creationId)) throw new Error("creation-id-scan-invalid-frontmatter");
    if (id === creationId) owners.push(relativePath);
  });
  return owners.sort();
}

export function findVariantIdOwners(workspaceRoot, model, variantId) {
  const owners = [];
  scanCreationNotes(workspaceRoot, model, ({ relativePath, markdown, frontmatter }) => {
    if (!frontmatter.valid) {
      if (markdown.includes(variantId)) throw new Error("creation-variant-scan-invalid-frontmatter");
      return;
    }
    if (frontmatter.fields.creation_variant_id === variantId) owners.push(relativePath);
  });
  return owners.sort();
}

const TARGET_FIELDS = ["platform", "format", "entrypoint"];
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/u;
export function validCreationTarget(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((field) => TARGET_FIELDS.includes(field)) &&
    ["platform", "format"].every((field) => Object.hasOwn(value, field) &&
      typeof value[field] === "string" && SLUG_RE.test(value[field])) &&
    (!Object.hasOwn(value, "entrypoint") ||
      (typeof value.entrypoint === "string" && SLUG_RE.test(value.entrypoint)));
}

function fileSha256(absolutePath) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(absolutePath, "r");
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Project explicit child links onto either a selected mother or a selected variant. */
export function inspectCreationVariants(workspaceRoot, model, markdown, targetPath, creationId, targetSha256) {
  const parsed = parseCreationFrontmatter(markdown);
  const fields = parsed.valid ? parsed.fields : null;
  const relatedSyntax = /creation_(?:variant_id|parent_id|target|source_sha256)/u.test(markdown.slice(0, 64 * 1024));
  const selectedIsVariant = Boolean(fields && ["creation_variant_id", "creation_parent_id", "creation_target", "creation_source_sha256"]
    .some((key) => Object.hasOwn(fields, key)));
  const empty = { variants: [], variantId: null, variantStatus: "none", creationTarget: null,
    parentCreationId: null, parentRelativePath: null, parentSha256: null, diagnostics: [] };
  if (!creationId && !selectedIsVariant && !(relatedSyntax && !parsed.valid)) return empty;
  if (selectedIsVariant && fields && Object.hasOwn(fields, "creation_id")) {
    return { ...empty, variantStatus: "invalid", diagnostics: [{ code: "variant-invalid", path: targetPath }] };
  }
  if (!parsed.valid && relatedSyntax) return { ...empty, variantStatus: "invalid", diagnostics: [{ code: "variant-invalid", path: targetPath }] };

  const candidate = selectedIsVariant ? {
    id: fields.creation_variant_id,
    parentId: fields.creation_parent_id,
    target: fields.creation_target,
    sourceSha256: fields.creation_source_sha256,
  } : null;
  const validCandidate = (item) => typeof item.id === "string" && CREATION_ID_RE.test(item.id) &&
    typeof item.parentId === "string" && CREATION_ID_RE.test(item.parentId) &&
    validCreationTarget(item.target) &&
    typeof item.sourceSha256 === "string" && /^[a-f0-9]{64}$/u.test(item.sourceSha256);
  if (candidate && !validCandidate(candidate)) {
    return { ...empty, variantStatus: "invalid", diagnostics: [{ code: "variant-invalid", path: targetPath }] };
  }
  const queryParentId = creationId || candidate.parentId;
  const motherOwners = [];
  const variantOwners = new Map();
  const children = [];
  try {
    scanCreationNotes(workspaceRoot, model, (item) => {
      const fm = item.frontmatter;
      if (!fm.valid) {
        if (item.markdown.includes(queryParentId)) throw new Error("creation-relation-scan-incomplete");
        return;
      }
      const data = fm.fields;
      if (data.creation_id === queryParentId) motherOwners.push(item.relativePath);
      if (typeof data.creation_variant_id === "string") {
        const owners = variantOwners.get(data.creation_variant_id) || [];
        owners.push(item.relativePath);
        variantOwners.set(data.creation_variant_id, owners);
      }
      if (data.creation_parent_id === queryParentId) {
        children.push({ ...item, id: data.creation_variant_id, parentId: data.creation_parent_id,
          target: data.creation_target, sourceSha256: data.creation_source_sha256 });
      }
    });
  } catch {
    return { ...empty, variantStatus: candidate ? "scan-incomplete" : "none",
      diagnostics: [{ code: "variant-scan-incomplete", path: targetPath }] };
  }
  if (motherOwners.length !== 1 || (creationId && motherOwners[0] !== targetPath)) {
    return { ...empty, variantStatus: candidate ? "parent-conflict" : "none",
      diagnostics: [{ code: "variant-parent-conflict", path: targetPath }] };
  }
  const parentRelativePath = motherOwners[0];
  let parentSha256;
  try {
    parentSha256 = creationId ? targetSha256 : fileSha256(path.join(workspaceRoot, parentRelativePath));
  } catch {
    return { ...empty, variantStatus: candidate ? "scan-incomplete" : "none",
      diagnostics: [{ code: "variant-scan-incomplete", path: targetPath }] };
  }
  const diagnostics = [];
  const variants = [];
  for (const child of children) {
    if (!validCandidate(child)) {
      diagnostics.push({ code: "variant-invalid", path: child.relativePath });
      continue;
    }
    if (variantOwners.get(child.id)?.length !== 1) {
      diagnostics.push({ code: "variant-id-conflict", path: child.relativePath });
      continue;
    }
    if (child.sourceSha256 !== parentSha256) {
      diagnostics.push({ code: "variant-source-stale", path: child.relativePath });
    }
    try {
      variants.push({ relativePath: child.relativePath, variantId: child.id,
        target: child.target, sourceSha256: child.sourceSha256,
        sha256: fileSha256(child.absolutePath) });
    } catch {
      diagnostics.push({ code: "variant-scan-incomplete", path: child.relativePath });
    }
  }
  variants.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  if (!candidate) return { ...empty, variants, diagnostics };
  const matching = variants.find((item) => item.relativePath === targetPath && item.variantId === candidate.id);
  if (!matching) {
    const unreadable = diagnostics.some((item) => item.code === "variant-scan-incomplete" && item.path === targetPath);
    return { ...empty, variantStatus: unreadable ? "scan-incomplete" : "conflict", diagnostics: unreadable
      ? diagnostics : [...diagnostics, { code: "variant-id-conflict", path: targetPath }] };
  }
  return { variants: [], variantId: candidate.id, variantStatus: "valid", creationTarget: candidate.target,
    parentCreationId: queryParentId, parentRelativePath, parentSha256, diagnostics };
}

export function inspectCreationIdentity(workspaceRoot, model, markdown, targetPath) {
  const identity = noteIdentity(markdown);
  if (identity.invalid) return { status: "invalid", creationId: null };
  if (!identity.id) return { status: "none", creationId: null };
  try {
    const owners = findCreationIdOwners(workspaceRoot, model, identity.id);
    return owners.length === 1 && owners[0] === targetPath
      ? { status: "valid", creationId: identity.id }
      : { status: "conflict", creationId: null };
  } catch {
    return { status: "scan-incomplete", creationId: null };
  }
}
