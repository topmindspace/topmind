/**
 * Deterministic, read-only creation input snapshot.
 * `inputsComplete` covers local dependencies only; it is never a platform
 * validation result or authorization to publish.
 */
import { createHash } from "node:crypto";
import {
  inspectCreationContext, inspectCreationAssetDependencies,
  CREATION_ASSET_STATUS, CREATION_DIAGNOSTIC_CODE, isBlockingCreationDiagnostic,
} from "./creation-context.mjs";

export const CREATION_SNAPSHOT_SCHEMA_VERSION = 5;

export class CreationSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CreationSnapshotError";
    this.code = code;
  }
}

const SENSITIVE_KEY = /(?:token|secret|password|credential|authorization|cookie|api[_-]?key)/iu;
const UNSAFE_KEY = new Set(["__proto__", "prototype", "constructor"]);

function canonical(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new CreationSnapshotError("invalid-input", "Snapshot input must be finite JSON data");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonical(item, seen));
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CreationSnapshotError("invalid-input", "Snapshot input must be plain JSON data");
    }
    const ordered = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (UNSAFE_KEY.has(key) || SENSITIVE_KEY.test(key)) {
        throw new CreationSnapshotError("sensitive-input", "Snapshot input contains a forbidden field");
      }
      ordered[key] = canonical(value[key], seen);
    }
    return ordered;
  } finally {
    seen.delete(value);
  }
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

const SHA256 = /^[a-f0-9]{64}$/u;
const isSha256 = (value) => typeof value === "string" && SHA256.test(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function label(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new CreationSnapshotError("invalid-input", `${field} must be a nonempty string up to 128 characters`);
  }
  return value.trim();
}

function versioned(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreationSnapshotError("invalid-input", `${field} must have id and version`);
  }
  return { id: label(value.id, `${field}.id`), version: label(value.version, `${field}.version`) };
}

function boundRuleset(value) {
  const identity = versioned(value, "ruleset");
  // Bind the actual JSON rule data, not a caller supplied digest or version label.
  // Omit the data from the response so a snapshot remains a compact receipt.
  return { ...identity, contentDigest: Object.hasOwn(value, "rules") ? digest(value.rules) : null };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function boundLengthValidation(value, accountCapabilities) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("|") !== "asOf|document|provider") {
    throw new CreationSnapshotError("invalid-input", "lengthValidation needs document, provider and asOf");
  }
  const document = value.document;
  if (!document || typeof document !== "object" || Array.isArray(document) ||
      document.text_kind !== "platform_text" ||
      Object.keys(document).some((key) => !["text_kind", "title", "body"].includes(key)) ||
      !["title", "body"].some((key) => Object.hasOwn(document, key)) ||
      ["title", "body"].some((key) => Object.hasOwn(document, key) && typeof document[key] !== "string")) {
    throw new CreationSnapshotError("invalid-input", "lengthValidation needs prepared platform text");
  }
  if (!validDate(value.asOf)) {
    throw new CreationSnapshotError("invalid-input", "lengthValidation.asOf must be an ISO calendar date");
  }
  const accountCapability = label(accountCapabilities?.account_capability, "accountCapabilities.account_capability");
  if (["any", "unknown"].includes(accountCapability)) {
    throw new CreationSnapshotError("invalid-input", "lengthValidation needs a confirmed account capability");
  }
  return { accountCapability, documentDigest: digest(document), provider: versioned(value.provider, "lengthValidation.provider"),
    asOf: value.asOf };
}

/**
 * @param {{workspaceRoot:string,targetPath:string,engineRoot?:string,platform:string,format:string,entry:string,accountCapabilities?:object,ruleset:{id:string,version:string,rules?:object|Array},provider:{id:string,version:string},parameters?:object,lengthValidation?:{document:object,provider:{id:string,version:string},asOf:string}}} options
 */
export function buildCreationInputSnapshot({
  workspaceRoot,
  targetPath,
  engineRoot,
  platform,
  format,
  entry,
  accountCapabilities = {},
  ruleset,
  provider,
  parameters = {},
  lengthValidation,
} = {}) {
  const selection = {
    platform: label(platform, "platform"),
    format: label(format, "format"),
    entry: label(entry, "entry"),
    ruleset: boundRuleset(ruleset),
    provider: versioned(provider, "provider"),
    accountCapabilitiesDigest: digest(accountCapabilities),
    parametersDigest: digest(parameters),
    lengthValidation: boundLengthValidation(lengthValidation, accountCapabilities),
  };
  const context = inspectCreationContext({ workspaceRoot, targetPath, engineRoot });
  const target = { relativePath: context.target.relativePath, sha256: context.target.sha256 };
  const requestedTarget = { platform: selection.platform, format: selection.format, entrypoint: selection.entry };
  const selectedIsVariant = context.target.variantStatus === "valid";
  // A variant may leave its delivery entry open; the snapshot still binds the chosen entry.
  const matchingVariants = selectedIsVariant ? [] : context.variants.filter((item) =>
    item.target.platform === requestedTarget.platform && item.target.format === requestedTarget.format &&
    (!item.target.entrypoint || item.target.entrypoint === requestedTarget.entrypoint));
  const source = selectedIsVariant
    ? { relativePath: context.target.parentRelativePath, sha256: context.target.parentSha256,
      creationId: context.target.parentCreationId }
    : context.target.identityStatus === "valid"
      ? { relativePath: target.relativePath, sha256: target.sha256, creationId: context.target.creationId }
      : null;
  const variant = selectedIsVariant
    ? { relativePath: target.relativePath, sha256: target.sha256, variantId: context.target.creationVariantId }
    : matchingVariants.length === 1
      ? { relativePath: matchingVariants[0].relativePath, sha256: matchingVariants[0].sha256,
        variantId: matchingVariants[0].variantId }
      : null;
  const linked = { source, variant };
  const diagnostics = [...context.diagnostics];
  const assets = context.assets.map((asset) => ({
    notePath: target.relativePath,
    kind: asset.kind,
    role: asset.role || null,
    relativePath: asset.relativePath || null,
    status: asset.status,
    sha256: asset.sha256 || null,
  }));
  const other = selectedIsVariant ? source : variant;
  if (other && other.relativePath !== target.relativePath) {
    try {
      const inspected = inspectCreationAssetDependencies({
        workspaceRoot, targetPath: other.relativePath, allowCover: !selectedIsVariant,
      });
      if (inspected.noteSha256 !== other.sha256) {
        diagnostics.push({ code: CREATION_DIAGNOSTIC_CODE.LINKED_ASSET_SCAN_STALE,
          severity: "warning", path: other.relativePath, reference: null });
      }
      diagnostics.push(...inspected.diagnostics);
      assets.push(...inspected.assets.map((asset) => ({
        notePath: other.relativePath,
        kind: asset.kind,
        role: asset.role || null,
        relativePath: asset.relativePath || null,
        status: asset.status,
        sha256: asset.sha256 || null,
      })));
    } catch {
      diagnostics.push({ code: CREATION_DIAGNOSTIC_CODE.LINKED_ASSET_SCAN_STALE,
        severity: "warning", path: other.relativePath, reference: null });
    }
  }
  if (selectedIsVariant && (context.target.creationTarget?.platform !== requestedTarget.platform ||
      context.target.creationTarget?.format !== requestedTarget.format ||
      (context.target.creationTarget?.entrypoint &&
        context.target.creationTarget.entrypoint !== requestedTarget.entrypoint))) {
    diagnostics.push({ code: "variant-target-mismatch", severity: "warning", path: target.relativePath, reference: null });
  }
  if (matchingVariants.length > 1) {
    diagnostics.push({ code: "variant-target-ambiguous", severity: "warning", path: target.relativePath, reference: null });
  }
  const inputsComplete = assets.every((asset) => asset.status === CREATION_ASSET_STATUS.PRESENT)
    && diagnostics.every((item) => !isBlockingCreationDiagnostic(item));
  const fingerprint = digest({
    schemaVersion: CREATION_SNAPSHOT_SCHEMA_VERSION,
    target,
    assets,
    linked,
    selection,
    diagnosticCodes: diagnostics.map((item) => item.code).sort(),
  });
  return {
    schemaVersion: CREATION_SNAPSHOT_SCHEMA_VERSION,
    fingerprint,
    target,
    assets,
    linked,
    selection,
    rulesetBound: selection.ruleset.contentDigest !== null,
    lengthValidationBound: selection.lengthValidation !== null,
    inputsComplete,
    diagnostics,
  };
}

/** Check a snapshot's covered payload and derived flags. This is not origin authentication or a filesystem refresh. */
export function inspectCreationSnapshotConsistency(snapshot) {
  const invalid = (reason) => ({ consistent: false, reason });
  try {
    if (snapshot?.schemaVersion !== CREATION_SNAPSHOT_SCHEMA_VERSION) return invalid("snapshot-unsupported");
    if (!isSha256(snapshot.fingerprint) || !record(snapshot.target) ||
        typeof snapshot.target.relativePath !== "string" || !isSha256(snapshot.target.sha256) ||
        !record(snapshot.linked) || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.diagnostics) ||
        !record(snapshot.selection) || !record(snapshot.selection.ruleset) ||
        !record(snapshot.selection.provider) || !isSha256(snapshot.selection.accountCapabilitiesDigest) ||
        !isSha256(snapshot.selection.parametersDigest) ||
        snapshot.assets.some((asset) => !record(asset) || typeof asset.status !== "string" ||
          (asset.status === CREATION_ASSET_STATUS.PRESENT && !isSha256(asset.sha256))) ||
        snapshot.diagnostics.some((diagnostic) => !record(diagnostic) || typeof diagnostic.code !== "string") ||
        typeof snapshot.rulesetBound !== "boolean" || typeof snapshot.lengthValidationBound !== "boolean" ||
        typeof snapshot.inputsComplete !== "boolean") return invalid("snapshot-payload-invalid");
    const rulesDigest = snapshot.selection.ruleset.contentDigest;
    if (rulesDigest !== null && !isSha256(rulesDigest)) return invalid("snapshot-payload-invalid");
    const length = snapshot.selection.lengthValidation;
    if (length !== null && (!record(length) || !isSha256(length.documentDigest) ||
        typeof length.accountCapability !== "string" || !record(length.provider) ||
        !validDate(length.asOf))) return invalid("snapshot-payload-invalid");
    if (snapshot.rulesetBound !== (rulesDigest !== null) ||
        snapshot.lengthValidationBound !== (length !== null) ||
        snapshot.inputsComplete !== (snapshot.diagnostics.every((item) => !isBlockingCreationDiagnostic(item)) &&
          snapshot.assets.every((asset) => asset.status === CREATION_ASSET_STATUS.PRESENT))) {
      return invalid("snapshot-derived-flags-mismatch");
    }
    const expected = digest({ schemaVersion: CREATION_SNAPSHOT_SCHEMA_VERSION,
      target: snapshot.target, assets: snapshot.assets, linked: snapshot.linked, selection: snapshot.selection,
      diagnosticCodes: snapshot.diagnostics.map((item) => item.code).sort() });
    if (expected !== snapshot.fingerprint) return invalid("snapshot-fingerprint-mismatch");
    return { consistent: true, reason: "consistent" };
  } catch {
    return invalid("snapshot-payload-invalid");
  }
}

/**
 * Compare two already computed snapshots; no file I/O and no implicit refresh.
 * Call buildCreationInputSnapshot again to inspect the current filesystem.
 */
export function compareCreationInputSnapshots(previous, current) {
  if (!previous || typeof previous.fingerprint !== "string") {
    return { stale: true, reason: "missing-previous" };
  }
  if (!current || typeof current.fingerprint !== "string") {
    return { stale: true, reason: "missing-current" };
  }
  if (!inspectCreationSnapshotConsistency(previous).consistent) {
    return { stale: true, reason: "invalid-previous-snapshot" };
  }
  if (!inspectCreationSnapshotConsistency(current).consistent) {
    return { stale: true, reason: "invalid-current-snapshot" };
  }
  if (previous.inputsComplete !== true || current.inputsComplete !== true) {
    return { stale: true, reason: "incomplete-inputs" };
  }
  if (previous.rulesetBound !== true || current.rulesetBound !== true) {
    return { stale: true, reason: "ruleset-unbound" };
  }
  if (previous.fingerprint !== current.fingerprint) {
    return { stale: true, reason: "fingerprint-changed" };
  }
  return { stale: false, reason: "unchanged" };
}

/** Compare declared validation inputs only; this does not prove rendering lineage or authorize delivery. */
export function compareCreationLengthReport(snapshot, report) {
  const mismatch = (reason) => ({ matches: false, reason, sourceLineageVerified: false, publishReady: false });
  if (snapshot?.schemaVersion !== CREATION_SNAPSHOT_SCHEMA_VERSION || typeof snapshot.fingerprint !== "string") {
    return mismatch("snapshot-unsupported");
  }
  if (!inspectCreationSnapshotConsistency(snapshot).consistent) return mismatch("snapshot-inconsistent");
  if (snapshot.inputsComplete !== true) return mismatch("incomplete-inputs");
  if (snapshot.rulesetBound !== true || !snapshot.selection?.ruleset?.contentDigest) return mismatch("ruleset-unbound");
  if (snapshot.lengthValidationBound !== true || !snapshot.selection?.lengthValidation) return mismatch("length-validation-unbound");
  const input = report?.input;
  const statusByVerdict = { pass: "ok", review: "warning", block: "error" };
  if (report?.schemaVersion !== 1 || report.capabilityId !== "platform.validate.length-ruleset" ||
      !Object.hasOwn(statusByVerdict, report.verdict) || report.status !== statusByVerdict[report.verdict] ||
      !/^[a-f0-9]{64}$/u.test(input?.fingerprint ?? "") ||
      !Array.isArray(report.checks) || !Array.isArray(report.diagnostics) ||
      (report.verdict !== "review" && !report.checks.some((check) => check?.category === "platform_limit"))) {
    return mismatch("invalid-report");
  }
  const selected = snapshot.selection;
  const length = selected.lengthValidation;
  if (input.creationSnapshotFingerprint !== snapshot.fingerprint) return mismatch("snapshot-fingerprint-mismatch");
  if (input.ruleSet?.id !== selected.ruleset.id || input.ruleSet?.version !== selected.ruleset.version) return mismatch("ruleset-identity-mismatch");
  if (input.rulesDigest !== selected.ruleset.contentDigest) return mismatch("ruleset-content-mismatch");
  if (input.target?.platform !== selected.platform || input.target?.format !== selected.format ||
      input.target?.entrypoint !== selected.entry) return mismatch("target-mismatch");
  if (input.target?.account_capability !== length.accountCapability) return mismatch("account-capability-mismatch");
  if (input.documentDigest !== length.documentDigest) return mismatch("document-mismatch");
  if (report.provider?.id !== length.provider.id || report.provider?.version !== length.provider.version) return mismatch("provider-mismatch");
  if (input.asOf !== length.asOf) return mismatch("evaluation-date-mismatch");
  return { matches: true, reason: "declared-inputs-match", verdict: report.verdict,
    snapshotFingerprint: snapshot.fingerprint, reportFingerprint: input.fingerprint,
    sourceLineageVerified: false, publishReady: false };
}

/**
 * Compare an article result produced from exact source bytes with a selected
 * snapshot. This checks local declarations and artifact bytes, not a platform
 * editor's interpretation or the origin of a later length-check document.
 */
export function compareCreationArticleResult(snapshot, result) {
  const mismatch = (reason) => ({ matches: false, reason, sourceLineageVerified: false, publishReady: false });
  if (snapshot?.schemaVersion !== CREATION_SNAPSHOT_SCHEMA_VERSION || typeof snapshot.fingerprint !== "string") {
    return mismatch("snapshot-unsupported");
  }
  if (!inspectCreationSnapshotConsistency(snapshot).consistent) return mismatch("snapshot-inconsistent");
  if (snapshot.inputsComplete !== true) return mismatch("incomplete-inputs");
  if (result?.schemaVersion !== 1 || result.capabilityId !== "article.render" ||
      !["ok", "warning"].includes(result.status) || !/^[a-f0-9]{64}$/u.test(result.input?.fingerprint ?? "") ||
      !Array.isArray(result.diagnostics) || !Array.isArray(result.artifacts)) {
    return mismatch("invalid-article-result");
  }
  if (result.input.creationSnapshotFingerprint !== snapshot.fingerprint) {
    return mismatch("snapshot-fingerprint-mismatch");
  }
  if (result.input.source?.relativePath !== snapshot.target?.relativePath ||
      result.input.source?.sha256 !== snapshot.target?.sha256) return mismatch("selected-source-mismatch");
  if (result.provider?.id !== snapshot.selection?.provider?.id ||
      result.provider?.version !== snapshot.selection?.provider?.version) return mismatch("renderer-provider-mismatch");
  if (result.input.target?.platform !== snapshot.selection?.platform) return mismatch("platform-mismatch");
  const renderParameters = result.input.renderParameters;
  if (!renderParameters || typeof renderParameters !== "object" || Array.isArray(renderParameters) ||
      Object.keys(renderParameters).sort().join("|") !== "theme|title" ||
      typeof renderParameters.theme !== "string" ||
      renderParameters.theme !== result.input.target?.theme ||
      typeof renderParameters.title !== "string" ||
      renderParameters.title !== (result.input.localTextTitle ?? "") ||
      digest(renderParameters) !== snapshot.selection.parametersDigest) return mismatch("renderer-parameters-mismatch");
  if (!Array.isArray(result.input.imageBytes)) return mismatch("rendered-assets-mismatch");
  const expectedImages = new Map();
  for (const asset of snapshot.assets ?? []) {
    if (asset.notePath !== snapshot.target.relativePath || asset.kind !== "image") continue;
    if (asset.status !== CREATION_ASSET_STATUS.PRESENT || !asset.relativePath ||
        !/^[a-f0-9]{64}$/u.test(asset.sha256 ?? "") ||
        (expectedImages.has(asset.relativePath) && expectedImages.get(asset.relativePath) !== asset.sha256)) {
      return mismatch("rendered-assets-mismatch");
    }
    expectedImages.set(asset.relativePath, asset.sha256);
  }
  if (result.input.imageBytes.length !== expectedImages.size) return mismatch("rendered-assets-mismatch");
  const returnedImages = new Set();
  for (const image of result.input.imageBytes) {
    if (typeof image?.relativePath !== "string" || returnedImages.has(image.relativePath) ||
        expectedImages.get(image.relativePath) !== image.sha256) return mismatch("rendered-assets-mismatch");
    returnedImages.add(image.relativePath);
  }
  const formats = new Map([
    ["preview", "text/html"],
    ["clipboard-html", "text/html"],
    ["source-markdown", "text/markdown"],
    ["image-checklist", "text/markdown"],
    ["local-clipboard-text", "text/plain"],
  ]);
  if (result.artifacts.length !== formats.size) return mismatch("article-artifacts-invalid");
  const seen = new Set();
  for (const artifact of result.artifacts) {
    if (!formats.has(artifact?.role) || seen.has(artifact.role) || artifact.format !== formats.get(artifact.role) ||
        typeof artifact.content !== "string" || Buffer.byteLength(artifact.content, "utf8") > 32 * 1024 * 1024 ||
        artifact.sha256 !== createHash("sha256").update(artifact.content).digest("hex")) {
      return mismatch("article-artifacts-invalid");
    }
    seen.add(artifact.role);
  }
  const title = result.input.localTextTitle;
  if (title !== null && typeof title !== "string") return mismatch("article-artifacts-invalid");
  const body = result.artifacts.find((artifact) => artifact.role === "local-clipboard-text").content;
  const localTextDocumentDigest = digest({ text_kind: "platform_text", ...(title === null ? {} : { title }), body });
  return { matches: true, reason: "selected-source-and-artifacts-match",
    snapshotFingerprint: snapshot.fingerprint, rendererFingerprint: result.input.fingerprint,
    artifactHashesVerified: true, renderedImageBytesVerified: true, localTextDocumentDigest,
    sourceLineageVerified: false, publishReady: false };
}

/** Match local render text, selected source and length report to one snapshot. */
export function compareCreationLocalLengthChain(snapshot, articleResult, lengthReport) {
  const mismatch = (reason) => ({ matches: false, reason, localTextChainMatched: false,
    platformEditorVerified: false, sourceLineageVerified: false, publishReady: false });
  const article = compareCreationArticleResult(snapshot, articleResult);
  if (!article.matches) return mismatch(article.reason);
  if (snapshot.lengthValidationBound !== true || !snapshot.selection?.lengthValidation) {
    return mismatch("length-validation-unbound");
  }
  if (article.localTextDocumentDigest !== snapshot.selection.lengthValidation.documentDigest) {
    return mismatch("local-text-document-mismatch");
  }
  const length = compareCreationLengthReport(snapshot, lengthReport);
  if (!length.matches) return mismatch(length.reason);
  return { matches: true, reason: "local-text-chain-match", verdict: length.verdict,
    snapshotFingerprint: snapshot.fingerprint, rendererFingerprint: article.rendererFingerprint,
    reportFingerprint: length.reportFingerprint, localTextChainMatched: true,
    platformEditorVerified: false, sourceLineageVerified: false, publishReady: false };
}
