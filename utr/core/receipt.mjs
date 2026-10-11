import crypto from "node:crypto";

/**
 * Generate a deterministic-looking receipt id.
 *
 * Format: `{prefix}-{ISO-with-dashes}-{6 hex chars}`.
 * Used by workspace-write and workspace-maintain to write
 * `99-归档/backups/.../receipt-{id}.json` (or localized archive root) and to tag
 * receipts in the in-memory result envelope.
 */
export function receiptId(prefix) {
  const ts = new Date().toISOString().replace(/[:.]/gu, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  return `${prefix}-${ts}-${rand}`;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== ""),
  );
}

export function normalizeAffectedFiles(affectedFiles = []) {
  if (!Array.isArray(affectedFiles)) {
    return [];
  }

  return affectedFiles
    .map((item) => {
      if (typeof item === "string") {
        return { path: item, relativePath: item, status: "unknown" };
      }
      if (!item || typeof item !== "object") {
        return null;
      }
      const relativePath = item.relativePath || item.path || "";
      if (!relativePath) {
        return null;
      }
      return {
        path: item.path || relativePath,
        relativePath,
        status: item.status || "unknown",
        ...(item.diffPreview ? { diffPreview: item.diffPreview } : {}),
      };
    })
    .filter(Boolean);
}

export function buildReceipt({
  target,
  path,
  projectId,
  action,
  writebackMode,
  routeConfidence,
  routeReason,
  affectedFiles = [],
  backupPath,
  revisionPath,
  reversible,
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedAffectedFiles = normalizeAffectedFiles(affectedFiles);
  const nextTarget = target || path || normalizedAffectedFiles[0]?.relativePath || "";
  return compactObject({
    target: nextTarget,
    path,
    projectId,
    action,
    writebackMode,
    reversible: reversible ?? Boolean(backupPath || revisionPath || normalizedAffectedFiles.length > 0),
    backupPath,
    revisionPath,
    route: compactObject({
      confidence: routeConfidence,
      reason: routeReason,
    }),
    affectedFiles: normalizedAffectedFiles,
    generatedAt,
  });
}

export function mergeToolReceipt({
  command,
  writebackMode,
  data = {},
  affectedFiles = [],
  generatedAt,
} = {}) {
  const toolReceipt = data?.receipt && typeof data.receipt === "object" ? data.receipt : {};
  return buildReceipt({
    ...toolReceipt,
    target: toolReceipt.target || data.path || data.target,
    path: toolReceipt.path || data.path,
    projectId: toolReceipt.projectId || data.projectId,
    action: command,
    writebackMode,
    routeConfidence: toolReceipt.routeConfidence || data.routeConfidence,
    routeReason: toolReceipt.routeReason || data.routeReason,
    backupPath: toolReceipt.backupPath || data.backupPath,
    revisionPath: toolReceipt.revisionPath || (data.operation === "create-revision" ? data.path : undefined),
    affectedFiles,
    generatedAt,
  });
}
