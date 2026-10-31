/**
 * Read-only creation context for an explicitly selected Markdown note.
 *
 * `target.relativePath` is a path identity, not a durable creation ID: moving
 * or renaming the file changes it. Only explicit, verified frontmatter links
 * appear in `variants`; neighboring files are never guessed to be variants.
 * This module never writes to the workspace.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectContract } from "./contract-engine.mjs";
import { titleFromMarkdown } from "./github-md.mjs";
import { resolveWorkspaceModel, resolveWorkspacePath } from "./workspace-model.mjs";
import { isMarkdownNotePath } from "./text-note.mjs";
import { peekFrontmatter } from "./writeback-engine.mjs";
import { inspectCreationIdentity, inspectCreationVariants } from "./creation-id.mjs";
import { parseCreationFrontmatter } from "./creation-frontmatter.mjs";
import { parseCreationImageEmbed, resolveCreationImageEmbeds } from "./creation-image-embed.mjs";
import { inspectCreationCoverImageBytes, sniffCreationCoverFormat,
  MAX_CREATION_COVER_BYTES } from "./creation-image-metadata.mjs";

export const CREATION_CONTEXT_SCHEMA_VERSION = 3;
export const CREATION_ASSET_STATUS = Object.freeze({
  PRESENT: "present",
  MISSING: "missing",
  OUTSIDE_WORKSPACE: "outside-workspace",
  REMOTE: "remote",
  AMBIGUOUS: "ambiguous",
  UNSUPPORTED: "unsupported",
});
export const CREATION_DIAGNOSTIC_CODE = Object.freeze({
  ASSET_MISSING: "asset-missing",
  ASSET_OUTSIDE_WORKSPACE: "asset-outside-workspace",
  ASSET_REMOTE: "asset-remote-unverified",
  ASSET_UNSUPPORTED: "asset-reference-unsupported",
  ASSET_SCAN_PARTIAL: "asset-scan-partial",
  ASSET_AMBIGUOUS: "asset-ambiguous",
  CREATION_ID_INVALID: "creation-id-invalid",
  CREATION_ID_CONFLICT: "creation-id-conflict",
  CREATION_ID_SCAN_INCOMPLETE: "creation-id-scan-incomplete",
  VARIANT_INVALID: "variant-invalid",
  VARIANT_ID_CONFLICT: "variant-id-conflict",
  VARIANT_PARENT_CONFLICT: "variant-parent-conflict",
  VARIANT_SCAN_INCOMPLETE: "variant-scan-incomplete",
  VARIANT_SOURCE_STALE: "variant-source-stale",
  COVER_INVALID: "cover-invalid",
  COVER_OUTSIDE_WORKSPACE: "cover-outside-workspace",
  COVER_MISSING: "cover-missing",
  COVER_FORMAT_UNSUPPORTED: "cover-format-unsupported",
  COVER_IMAGE_INVALID: "cover-image-invalid",
  COVER_TOO_LARGE: "cover-too-large",
  LINKED_ASSET_SCAN_STALE: "linked-asset-scan-stale",
});

/** Historical source drift needs review, but does not make current local inputs unavailable. */
export function isBlockingCreationDiagnostic(item) {
  return item.code !== CREATION_DIAGNOSTIC_CODE.VARIANT_SOURCE_STALE;
}

export class CreationContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CreationContextError";
    this.code = code;
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestFile(absolutePath) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(absolutePath, "r");
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function noteTitle(markdown, filename) {
  const frontmatterTitle = peekFrontmatter(markdown).title;
  return typeof frontmatterTitle === "string" && frontmatterTitle.trim()
    ? frontmatterTitle.trim()
    : titleFromMarkdown(markdown, filename);
}

const FRONTMATTER_ASSET_HINTS = new Set([
  "cover", "coverimage", "coverurl", "thumbnail", "thumbnailurl",
  "heroimage", "featuredimage", "ogimage", "image",
]);

function hasUnmodeledFrontmatterAsset(markdown) {
  return Object.entries(peekFrontmatter(markdown)).some(([key, value]) => {
    const normalized = key.replace(/[_-]/gu, "").toLowerCase();
    return FRONTMATTER_ASSET_HINTS.has(normalized)
      && value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
  });
}

function markdownImageReferences(markdown) {
  // Fenced examples are text, not file dependencies. Common inline, reference
  // and HTML image sources are recognized; unparsed Markdown image syntax
  // triggers an explicit incomplete-scan diagnostic.
  const lines = markdown.split(/\r?\n/u);
  const visible = [];
  let fence = null;
  for (const line of lines) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (mark) {
      if (!fence) fence = { marker: mark[0], length: mark.length };
      else if (mark[0] === fence.marker && mark.length >= fence.length) fence = null;
      continue;
    }
    if (!fence) visible.push(line);
  }
  // Match the editor's prose boundary: inline code is not an asset reference.
  const text = visible.join("\n").replace(/(`+)([^`]*)\1/gu, (span) => " ".repeat(span.length));
  const found = [];
  const wikiEmbeds = [];
  let parsedMarkdownImages = 0;
  const wiki = /!\[\[([^\]\n]+)\]\]/gu;
  for (const match of text.matchAll(wiki)) {
    const parsed = parseCreationImageEmbed(match[1]);
    if (!parsed) continue;
    parsedMarkdownImages += 1;
    wikiEmbeds.push(parsed.target);
  }
  const inline = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^)\n])*?))(?:\s+["'][^"'\n]*["'])?\s*\)/gu;
  for (const match of text.matchAll(inline)) {
    const ref = (match[1] || match[2] || "").trim();
    if (ref) {
      parsedMarkdownImages += 1;
      found.push(ref.replace(/\\([() ])/gu, "$1"));
    }
  }
  const definitions = new Map();
  const definition = /^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gmu;
  for (const match of text.matchAll(definition)) {
    const key = match[1].trim().replace(/\s+/gu, " ").toLowerCase();
    definitions.set(key, match[2] || match[3]);
  }
  const reference = /!\[([^\]\n]*)\]\[([^\]\n]*)\]/gu;
  for (const match of text.matchAll(reference)) {
    const key = (match[2] || match[1]).trim().replace(/\s+/gu, " ").toLowerCase();
    const ref = definitions.get(key);
    if (!ref) continue;
    parsedMarkdownImages += 1;
    found.push(ref.replace(/\\([() ])/gu, "$1"));
  }
  const html = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>"']+))[^>]*>/giu;
  let parsedHtmlImages = 0;
  for (const match of text.matchAll(html)) {
    const ref = (match[1] || match[2] || match[3] || "").trim();
    if (ref) {
      parsedHtmlImages += 1;
      found.push(ref);
    }
  }
  const markdownImageCount = [...text.matchAll(/!\[/gu)].length;
  const htmlImageCount = [...text.matchAll(/<img\b/giu)].length;
  return {
    references: [...new Set(found)],
    wikiEmbeds: [...new Set(wikiEmbeds)],
    scanPartial: markdownImageCount > parsedMarkdownImages || htmlImageCount > parsedHtmlImages,
  };
}

function diagnostic(code, targetPath, reference) {
  return { code, severity: "warning", path: targetPath, reference };
}

function safeRemoteReference(reference) {
  try {
    const protocolRelative = reference.startsWith("//");
    const url = new URL(protocolRelative ? `https:${reference}` : reference);
    return protocolRelative ? `//${url.host}${url.pathname}` : `${url.origin}${url.pathname}`;
  } catch {
    return "[remote-image]";
  }
}

function inspectImage(root, targetRel, reference, workspaceRelative = false) {
  const common = { kind: "image", reference };
  if (/^https?:\/\//iu.test(reference) || reference.startsWith("//")) {
    const safe = safeRemoteReference(reference);
    return {
      asset: { kind: "image", reference: safe, status: CREATION_ASSET_STATUS.REMOTE },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_REMOTE, targetRel, safe),
    };
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(reference) || reference.startsWith("#")) {
    const scheme = reference.match(/^([a-z][a-z\d+.-]*):/iu)?.[1] || "fragment";
    const safe = `${scheme.toLowerCase()}:[redacted]`;
    return {
      asset: { kind: "image", reference: safe, status: CREATION_ASSET_STATUS.UNSUPPORTED },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_UNSUPPORTED, targetRel, safe),
    };
  }
  const source = workspaceRelative ? reference : reference.split(/[?#]/u, 1)[0];
  let decoded;
  try {
    decoded = workspaceRelative ? source : decodeURIComponent(source);
  } catch {
    return {
      asset: { ...common, status: CREATION_ASSET_STATUS.UNSUPPORTED },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_UNSUPPORTED, targetRel, reference),
    };
  }
  if (!decoded || path.posix.isAbsolute(decoded) || path.win32.isAbsolute(decoded)) {
    const safe = "[outside-workspace]";
    return {
      asset: { kind: "image", reference: safe, status: CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_OUTSIDE_WORKSPACE, targetRel, safe),
    };
  }
  const candidate = workspaceRelative ? decoded : path.posix.join(path.posix.dirname(targetRel), decoded.replace(/\\/gu, "/"));
  let resolved;
  try {
    resolved = resolveWorkspacePath(root, candidate);
  } catch {
    const safe = "[outside-workspace]";
    return {
      asset: { kind: "image", reference: safe, status: CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_OUTSIDE_WORKSPACE, targetRel, safe),
    };
  }
  let sha256;
  try {
    if (!fs.statSync(resolved.absolute).isFile()) throw new Error("not a file");
    sha256 = digestFile(resolved.absolute);
  } catch {
    return {
      asset: { ...common, relativePath: resolved.relativePath, status: CREATION_ASSET_STATUS.MISSING },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_MISSING, targetRel, reference),
    };
  }
  return {
    asset: {
      ...common,
      relativePath: resolved.relativePath,
      status: CREATION_ASSET_STATUS.PRESENT,
      sha256,
    },
    diagnostic: null,
  };
}

function inspectCoverAsset(root, targetRel, relativePath, role) {
  const common = { kind: "cover", role };
  const invalid = () => ({ asset: { ...common, status: CREATION_ASSET_STATUS.UNSUPPORTED },
    diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null) });
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      /[\x00-\x1f?#:]/u.test(relativePath) || path.posix.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    return invalid();
  }
  let resolved;
  try {
    resolved = resolveWorkspacePath(root, relativePath);
  } catch {
    return { asset: { ...common, status: CREATION_ASSET_STATUS.OUTSIDE_WORKSPACE },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_OUTSIDE_WORKSPACE, targetRel, null) };
  }
  let bytes;
  try {
    const stat = fs.statSync(resolved.absolute);
    if (!stat.isFile()) throw new Error("not a file");
    if (stat.size > MAX_CREATION_COVER_BYTES) {
      return { asset: { ...common, relativePath: resolved.relativePath, status: CREATION_ASSET_STATUS.UNSUPPORTED },
        diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_TOO_LARGE, targetRel, null) };
    }
    bytes = fs.readFileSync(resolved.absolute);
  } catch {
    return { asset: { ...common, relativePath: resolved.relativePath, status: CREATION_ASSET_STATUS.MISSING },
      diagnostic: diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_MISSING, targetRel, null) };
  }
  const sha256 = digest(bytes);
  const metadata = inspectCreationCoverImageBytes(bytes);
  const expectedExtensions = { png: [".png"], jpeg: [".jpg", ".jpeg"], webp: [".webp"] };
  const sniffed = sniffCreationCoverFormat(bytes);
  const extensionMatches = Boolean(sniffed && expectedExtensions[sniffed].includes(path.extname(resolved.relativePath).toLowerCase()));
  if (!metadata || !extensionMatches) {
    const code = sniffed && extensionMatches ? CREATION_DIAGNOSTIC_CODE.COVER_IMAGE_INVALID
      : CREATION_DIAGNOSTIC_CODE.COVER_FORMAT_UNSUPPORTED;
    return { asset: { ...common, relativePath: resolved.relativePath, status: CREATION_ASSET_STATUS.UNSUPPORTED, sha256 },
      diagnostic: diagnostic(code, targetRel, null) };
  }
  return { asset: { ...common, relativePath: resolved.relativePath,
    status: CREATION_ASSET_STATUS.PRESENT, sha256, ...metadata }, diagnostic: null };
}

function inspectCoverPaths(root, targetRel, cover) {
  const assets = [];
  const diagnostics = [];
  if (!cover || typeof cover !== "object" || Array.isArray(cover) ||
      Object.keys(cover).sort().join(",") !== "rendition_path,source_path" ||
      cover.source_path === cover.rendition_path) {
    return { assets, diagnostics: [diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null)] };
  }
  for (const [key, role] of [["source_path", "source"], ["rendition_path", "rendition"]]) {
    const result = inspectCoverAsset(root, targetRel, cover[key], role);
    assets.push(result.asset);
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  }
  if (assets[0]?.relativePath && assets[0].relativePath === assets[1]?.relativePath) {
    diagnostics.push(diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null));
  } else if (assets.every((asset) => asset.status === CREATION_ASSET_STATUS.PRESENT)) {
    try {
      const source = fs.statSync(resolveWorkspacePath(root, assets[0].relativePath).absolute);
      const rendition = fs.statSync(resolveWorkspacePath(root, assets[1].relativePath).absolute);
      if (source.ino && source.dev === rendition.dev && source.ino === rendition.ino) {
        diagnostics.push(diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null));
      }
    } catch {
      diagnostics.push(diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null));
    }
  }
  return { assets, diagnostics };
}

/** Validate an explicit cover pair without reading or changing note metadata. */
export function inspectCreationCoverPaths({ workspaceRoot, targetPath, sourcePath, renditionPath }) {
  const root = fs.realpathSync(workspaceRoot);
  const selected = resolveWorkspacePath(root, targetPath);
  return inspectCoverPaths(root, selected.relativePath,
    { source_path: sourcePath, rendition_path: renditionPath });
}

/** Read-only inspection of one candidate cover file before a rendition import. */
export function inspectCreationCoverAsset({ workspaceRoot, targetPath, assetPath, role = "source" }) {
  const root = fs.realpathSync(workspaceRoot);
  const selected = resolveWorkspacePath(root, targetPath);
  return inspectCoverAsset(root, selected.relativePath, assetPath, role);
}

function inspectAssetDependencies(root, targetRel, markdown, allowCover) {
  const assets = [];
  const diagnostics = [];
  const scan = markdownImageReferences(markdown);
  for (const reference of scan.references) {
    const result = inspectImage(root, targetRel, reference);
    assets.push(result.asset);
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  }
  let wikiResolutions;
  try { wikiResolutions = resolveCreationImageEmbeds(root, scan.wikiEmbeds); }
  catch { wikiResolutions = new Map(); }
  for (const reference of scan.wikiEmbeds) {
    const resolved = wikiResolutions.get(reference) || { status: "scan-incomplete" };
    if (resolved.status === "found") {
      const result = inspectImage(root, targetRel, resolved.relativePath, true);
      assets.push({ ...result.asset, syntax: "wikilink" });
      if (result.diagnostic) diagnostics.push(result.diagnostic);
    } else {
      const code = resolved.status === "ambiguous" ? CREATION_DIAGNOSTIC_CODE.ASSET_AMBIGUOUS
        : resolved.status === "missing" ? CREATION_DIAGNOSTIC_CODE.ASSET_MISSING
          : CREATION_DIAGNOSTIC_CODE.ASSET_SCAN_PARTIAL;
      assets.push({ kind: "image", syntax: "wikilink", reference,
        status: resolved.status === "ambiguous" ? CREATION_ASSET_STATUS.AMBIGUOUS
          : resolved.status === "missing" ? CREATION_ASSET_STATUS.MISSING : CREATION_ASSET_STATUS.UNSUPPORTED });
      diagnostics.push(diagnostic(code, targetRel, reference));
    }
  }
  const parsed = parseCreationFrontmatter(markdown);
  if (parsed.valid && Object.hasOwn(parsed.fields, "creation_cover")) {
    if (!allowCover) {
      diagnostics.push(diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null));
    } else {
      const checked = inspectCoverPaths(root, targetRel, parsed.fields.creation_cover);
      assets.push(...checked.assets);
      diagnostics.push(...checked.diagnostics);
    }
  } else if (!parsed.valid && /creation_cover/iu.test(markdown.slice(0, 64 * 1024))) {
    diagnostics.push(diagnostic(CREATION_DIAGNOSTIC_CODE.COVER_INVALID, targetRel, null));
  }
  if (scan.scanPartial || hasUnmodeledFrontmatterAsset(markdown)) {
    diagnostics.push(diagnostic(CREATION_DIAGNOSTIC_CODE.ASSET_SCAN_PARTIAL, targetRel, null));
  }
  return { assets, diagnostics };
}

/** Read only the asset dependencies of an already verified linked note. */
export function inspectCreationAssetDependencies({ workspaceRoot, targetPath, allowCover = false }) {
  const root = fs.realpathSync(workspaceRoot);
  const resolved = resolveWorkspacePath(root, targetPath);
  const bytes = fs.readFileSync(resolved.absolute);
  const inspected = inspectAssetDependencies(root, resolved.relativePath, bytes.toString("utf8"), allowCover);
  return { ...inspected, noteSha256: digest(bytes) };
}

function inspectTopic(root, targetRel) {
  const segments = targetRel.split("/");
  if (segments.length < 3) return null;
  const homeRel = path.posix.join(segments[0], segments[1], "topic.md");
  let resolved;
  try {
    resolved = resolveWorkspacePath(root, homeRel);
    if (!fs.statSync(resolved.absolute).isFile()) return null;
  } catch {
    return null;
  }
  const content = fs.readFileSync(resolved.absolute, "utf8");
  return { relativePath: resolved.relativePath, title: noteTitle(content, "topic.md") };
}

/**
 * @param {{ workspaceRoot: string, targetPath: string, engineRoot?: string }} options
 * @returns {{ schemaVersion: 3, target: {relativePath: string, title: string, sha256: string}, category: {directory: string, role: string}, topic: {relativePath: string, title: string}|null, assets: object[], variants: object[], diagnostics: object[] }}
 */
export function inspectCreationContext({ workspaceRoot, targetPath, engineRoot } = {}) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new CreationContextError("invalid-workspace", "A workspaceRoot is required");
  }
  let root;
  try {
    root = fs.realpathSync(workspaceRoot);
    if (!fs.statSync(root).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new CreationContextError("invalid-workspace", "Workspace root is not a readable directory");
  }
  try {
    resolveWorkspacePath(root, "topmind.yaml");
  } catch {
    throw new CreationContextError("invalid-contract", "Workspace contract resolves outside the workspace");
  }
  const inspection = inspectContract(root);
  if (inspection.state !== "ok") {
    throw new CreationContextError("invalid-contract", `Workspace contract state: ${inspection.state}`);
  }
  if (typeof targetPath !== "string" || !targetPath.trim() || targetPath.includes("\0") ||
      path.posix.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath)) {
    throw new CreationContextError("invalid-target", "targetPath must be a workspace-relative Markdown path");
  }
  let selected;
  try {
    selected = resolveWorkspacePath(root, targetPath);
  } catch {
    throw new CreationContextError("target-outside-workspace", "Selected note resolves outside the workspace");
  }
  if (!isMarkdownNotePath(selected.relativePath)) {
    throw new CreationContextError("target-not-markdown", "Selected note must be Markdown");
  }
  try {
    if (!fs.statSync(selected.absolute).isFile()) throw new Error("not a file");
  } catch {
    throw new CreationContextError("target-not-found", "Selected Markdown note was not found");
  }
  const model = resolveWorkspaceModel({ workspaceRoot: root, engineRoot });
  const category = model.categories.find((item) => item.ok && item.directory === selected.relativePath.split("/")[0]);
  if (!category) {
    throw new CreationContextError("target-not-in-category", "Selected note is outside content categories");
  }
  if (category.role === "system") {
    throw new CreationContextError("target-system-category", "System category notes cannot be creation targets");
  }
  const bytes = fs.readFileSync(selected.absolute);
  const markdown = bytes.toString("utf8");
  const assets = [];
  const diagnostics = [];
  const identity = inspectCreationIdentity(root, model, markdown, selected.relativePath);
  if (identity.status !== "none" && identity.status !== "valid") {
    const codes = {
      invalid: CREATION_DIAGNOSTIC_CODE.CREATION_ID_INVALID,
      conflict: CREATION_DIAGNOSTIC_CODE.CREATION_ID_CONFLICT,
      "scan-incomplete": CREATION_DIAGNOSTIC_CODE.CREATION_ID_SCAN_INCOMPLETE,
    };
    diagnostics.push(diagnostic(codes[identity.status], selected.relativePath, null));
  }
  const relation = inspectCreationVariants(root, model, markdown, selected.relativePath, identity.creationId, digest(bytes));
  for (const item of relation.diagnostics) {
    diagnostics.push(diagnostic(item.code, item.path, null));
  }
  const dependencies = inspectAssetDependencies(root, selected.relativePath, markdown, relation.variantStatus === "valid");
  assets.push(...dependencies.assets);
  diagnostics.push(...dependencies.diagnostics);
  return {
    schemaVersion: CREATION_CONTEXT_SCHEMA_VERSION,
    target: {
      relativePath: selected.relativePath,
      title: noteTitle(markdown, path.basename(selected.relativePath)),
      sha256: digest(bytes),
      creationId: identity.creationId,
      identityStatus: identity.status,
      creationVariantId: relation.variantId,
      variantStatus: relation.variantStatus,
      creationTarget: relation.creationTarget,
      parentCreationId: relation.parentCreationId,
      parentRelativePath: relation.parentRelativePath,
      parentSha256: relation.parentSha256,
    },
    category: { directory: category.directory, role: category.role },
    topic: inspectTopic(root, selected.relativePath),
    assets,
    variants: relation.variants,
    diagnostics,
  };
}
