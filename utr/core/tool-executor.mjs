import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getCommand } from "./contract-registry.mjs";
import { resolveContractArgs } from "./path-resolver.mjs";
import { validateCommandPayload, normalizeCommandPayload } from "./contract-validator.mjs";
import { topicRoot, resolveWorkspacePath } from "./workspace-context.mjs";
import path from "node:path";
import { t } from "./i18n-strings.mjs";

import { clearTransactionalBackups, restoreAffectedFiles, snapshotAffectedFiles } from "./writeback-safety.mjs";
import { parseToolOutput, unwrapToolData, buildResultEnvelope } from "./result-envelope.mjs";
import { mergeToolReceipt } from "./receipt.mjs";
import {
  resolveNodeExecutable,
  isElectronExecutable,
} from "./node-runtime.mjs";

const execFileAsync = promisify(execFile);
const NODE_RUNTIME = "node";

function runtimeExecutable(runtime) {
  return runtime === NODE_RUNTIME ? resolveNodeExecutable() : runtime;
}

function runtimeDisplayName(runtime) {
  return runtime === NODE_RUNTIME ? NODE_RUNTIME : runtime;
}

import { resolveReviewPolicy, checkReviewRequired } from "./review-policy.mjs";
import { resolveWritebackModeInput } from "./writeback-mode.mjs";

/**
 * Execute a topmind tool command.
 *
 * This is the SINGLE generic executor that replaces all 11 TOOL_INVOCATION_BUILDERS.
 * Flow: validate → review policy check → resolve args → execFile → parse output → result
 *
 * @param {object} options
 * @param {object} options.registry - Contract registry from loadContractRegistry()
 * @param {string} options.kind - Tool kind (e.g. "workspace-read")
 * @param {string} options.command - Command name (e.g. "create-topic")
 * @param {object} options.payload - User-supplied payload fields
 * @param {object} options.pathContext - { engineRoot, userWorkspaceRoot }
 * @param {boolean} [options.reviewed] - Whether the review step has authorized execution
 * @param {object} [options.tracking] - { snapshotBefore, snapshotAfter, buildDiff } for file tracking
 * @returns {object} Standardized tool result
 */
export async function executeTool(options) {
  const {
    registry,
    kind,
    command: commandName,
    payload = {},
    pathContext,
    reviewed = false,
    tracking,
  } = options;

  const startedAt = new Date().toISOString();
  const canonicalCommand = `${kind}.${commandName}`;

  // 1. Look up contract
  let entry;
  try {
    entry = getCommand(registry, kind, commandName);
  } catch (e) {
    return {
      ok: false,
      kind,
      command: canonicalCommand,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: "",
      stderr: t("error.unknownOperation", { kind, commandName }),
      wroteFiles: false,
      affectedFiles: [],
    };
  }

  const { contract, command: cmdDef } = entry;

  // 2. Normalize and validate payload
  const payloadHasDryRun = Object.prototype.hasOwnProperty.call(payload, "dryRun");
  // Writeback modes: auto | confirm only — reject batch / unknown (no silent batch→auto)
  const modeResolution = resolveWritebackModeInput({
    payloadHasMode: Object.prototype.hasOwnProperty.call(payload, "writebackMode"),
    payloadMode: payload.writebackMode,
    optionMode: options?.writebackMode,
    envMode: process.env.topmind_WRITEBACK_MODE,
  });
  if (!modeResolution.ok) {
    return {
      ok: false,
      kind,
      command: canonicalCommand,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: "",
      stderr: t("error.validationFailed", { errors: modeResolution.error }),
      wroteFiles: false,
      affectedFiles: [],
      validationErrors: [modeResolution.error],
    };
  }
  const writebackMode = modeResolution.mode;
  const normalized = normalizeCommandPayload(cmdDef, { ...payload, kind, command: commandName });
  normalized.writebackMode = writebackMode;
  if (writebackMode === "auto" && cmdDef.supports_dry_run && !payloadHasDryRun) {
    normalized.dryRun = false;
  }
  const validationErrors = validateCommandPayload(cmdDef, normalized);
  if (validationErrors.length > 0) {
    return {
      ok: false,
      kind,
      command: canonicalCommand,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: "",
      stderr: t("error.validationFailed", { errors: validationErrors.join("\n") }),
      wroteFiles: false,
      affectedFiles: [],
      validationErrors,
    };
  }

  // 3. Review policy — confirm requires review; auto writes through
  const effectiveReviewed = reviewed || writebackMode === "auto";
  if (!effectiveReviewed) {
    const reviewRequired = checkReviewRequired(cmdDef, commandName);
    if (reviewRequired) {
      return {
        ok: false,
        kind,
        command: canonicalCommand,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout: "",
        stderr: "",
        wroteFiles: false,
        affectedFiles: [],
        requiresReview: true,
        reviewPolicy: reviewRequired,
      };
    }
  }

  // 4. Resolve CLI args (script path + contract args)
  const script = contract.execution?.script;
  const runtime = contract.execution?.runtime || "node";
  if (!script) {
    return {
      ok: false,
      kind,
      command: canonicalCommand,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: "",
      stderr: t("error.missingScript", { kind }),
      wroteFiles: false,
      affectedFiles: [],
    };
  }
  const resolvedArgs = resolveContractArgs(contract, commandName, pathContext, normalized);
  const args = [script, ...resolvedArgs];
  const cwd = contract.execution?.cwd_mode === "topic_root" && normalized.category && normalized.topic
    ? topicRoot(pathContext, normalized.category, normalized.topic)
    : pathContext.engineRoot;

  // 5. File tracking (before)
  let beforeSnapshots;
  if (tracking?.snapshotBefore) {
    beforeSnapshots = await tracking.snapshotBefore(pathContext, normalized, cmdDef);
  }

  // 6. Write-safety snapshot (high-risk writes only — backup before executing)
  const isHighRiskWrite = cmdDef.risk_level === "high"
    && Array.isArray(cmdDef.writes)
    && cmdDef.writes.length > 0;
  let writeSafeBackups = [];
  if (isHighRiskWrite) {
    try {
      const resolvedPaths = (cmdDef.writes || []).map((pattern) =>
        resolveWritePatternAbsolute(pattern, pathContext, normalized)
      ).filter(Boolean);
      writeSafeBackups = await snapshotAffectedFiles(resolvedPaths);
    } catch { /* non-fatal */ }
  }

  // 7. Execute
  const executable = runtimeExecutable(runtime);
  const displayRuntime = runtimeDisplayName(runtime);
  const displayCommand = [displayRuntime, ...args].join(" ");
  try {
    // If the resolved executable is the Electron binary (fallback path in
    // packaged app where no system Node.js is available), set
    // ELECTRON_RUN_AS_NODE=1 so Electron boots as a pure Node.js runtime
    // without initializing the app module or creating any window/dock icon.
    const opts = {
      cwd,
      maxBuffer: 1024 * 1024 * 6,
      timeout: 120_000,
    };
    if (isElectronExecutable(executable)) {
      opts.env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    }
    const { stdout, stderr } = await execFileAsync(executable, args, opts);

    const { parsed } = parseToolOutput(stdout);
    const data = unwrapToolData(parsed);

    // Clear transactional backups on success
    if (writeSafeBackups.length > 0) {
      await clearTransactionalBackups(writeSafeBackups);
    }

    // File tracking (after)
    let affectedFiles = [];
    if (tracking?.snapshotAfter && tracking?.buildDiff) {
      const afterSnapshots = await tracking.snapshotAfter(pathContext, normalized, cmdDef);
      affectedFiles = tracking.buildDiff(pathContext, beforeSnapshots, afterSnapshots);
    }

    const receipt = mergeToolReceipt({
      command: canonicalCommand,
      writebackMode,
      data,
      affectedFiles,
      generatedAt: new Date().toISOString(),
    });
    const envelope = buildResultEnvelope({
      ok: true,
      kind,
      command: canonicalCommand,
      data,
      receipt,
    });

    return {
      ok: true,
      kind,
      command: canonicalCommand,
      displayCommand,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      parsed,
      data,
      receipt,
      envelope,
      wroteFiles: affectedFiles.length > 0,
      affectedFiles,
    };
  } catch (error) {
    // Restore transactional backups on failure
    let restoredFiles = [];
    if (writeSafeBackups.length > 0) {
      try {
        const result = await restoreAffectedFiles(writeSafeBackups);
        restoredFiles = result.restored;
      } catch { /* restoration failed — worst case */ }
    }

    // File tracking (after, even on error)
    let affectedFiles = [];
    if (tracking?.snapshotAfter && tracking?.buildDiff) {
      try {
        const afterSnapshots = await tracking.snapshotAfter(pathContext, normalized, cmdDef);
        affectedFiles = tracking.buildDiff(pathContext, beforeSnapshots, afterSnapshots);
      } catch { /* tracking error is non-fatal */ }
    }

    return {
      ok: false,
      kind,
      command: canonicalCommand,
      displayCommand,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout: error.stdout?.trim?.() || "",
      stderr: error.stderr?.trim?.() || error.message,
      errorCode: error.code || undefined,
      wroteFiles: affectedFiles.length > 0,
      affectedFiles,
      ...(restoredFiles.length > 0 ? { restoredFromBackup: restoredFiles } : {}),
    };
  }
}

/**
 * Resolve a write-pattern template (e.g. "{category_root}/{topic}/topic.md")
 * against the payload and path context to produce a human-readable estimate.
 */
function resolveWritePattern(pattern, pathContext, payload) {
  let resolved = String(pattern || "");
  resolved = resolved.replace(/\{category_root\}/g, payload.category_root || "?");
  resolved = resolved.replace(/\{topic_root\}/g, payload.topic_root || "?");
  resolved = resolved.replace(/\{category\}/g, payload.category || "?");
  resolved = resolved.replace(/\{topic\}/g, payload.topic || "?");
  // Replace any remaining {vars} with ? to indicate unresolved
  resolved = resolved.replace(/\{[^}]+\}/g, "?");
  return resolved;
}

function resolveWritePatternAbsolute(pattern, pathContext, payload) {
  const displayPath = resolveWritePattern(pattern, pathContext, payload);
  if (!displayPath || displayPath.includes("?")) return null;
  try {
    return resolveWorkspacePath(pathContext, displayPath);
  } catch {
    return null;
  }
}

/**
 * Preview a tool execution without actually running it.
 * Returns readiness assessment, missing fields, and the command that would run.
 */
export function previewTool(registry, kind, commandName, payload, pathContext) {
  try {
    const { contract, command: cmdDef } = getCommand(registry, kind, commandName);
    const normalized = normalizeCommandPayload(cmdDef, { ...payload, kind, command: commandName });
    const validationErrors = validateCommandPayload(cmdDef, normalized);

    // Check which required fields are missing
    const missingFields = [];
    const inputs = cmdDef.inputs || {};
    for (const [fieldName, fieldDef] of Object.entries(inputs)) {
      if (fieldDef.required) {
        const value = normalized[fieldName];
        if (value === undefined || value === null || value === "") {
          missingFields.push({ field: fieldName, label: fieldDef.label || fieldName });
        }
      }
    }

    const ready = validationErrors.length === 0;
    let invocationPlan = null;
    if (ready) {
      const script = contract.execution?.script;
      const resolvedArgs = resolveContractArgs(contract, commandName, pathContext, normalized);
      const args = script ? [script, ...resolvedArgs] : resolvedArgs;
      const runtime = contract.execution?.runtime || "node";
      const displayRuntime = runtimeDisplayName(runtime);
      const cwd = contract.execution?.cwd_mode === "topic_root" && normalized.category && normalized.topic
        ? topicRoot(pathContext, normalized.category, normalized.topic)
        : pathContext.engineRoot;
      invocationPlan = {
        command: displayRuntime,
        args,
        cwd,
        displayCommand: [displayRuntime, ...args].join(" "),
      };
    }

    // Estimate which files would be affected by a write command
    let estimatedEffects = null;
    const writes = Array.isArray(cmdDef.writes) ? cmdDef.writes : [];
    if (ready && writes.length > 0) {
      estimatedEffects = {
        files: writes.map((pattern) => ({
          pattern,
          resolved: resolveWritePattern(pattern, pathContext, normalized),
        })),
        totalFiles: writes.length,
      };
    }

    const reviewPolicy = resolveReviewPolicy(cmdDef, contract.review_overrides, commandName);
    return {
      tool: { kind: contract.kind, label: contract.label, command: commandName, commandLabel: cmdDef.label },
      ready,
      missingFields,
      validationErrors,
      reviewPolicy,
      invocationPlan,
      estimatedEffects,
    };
  } catch (error) {
    return {
      tool: { kind, command: commandName },
      ready: false,
      missingFields: [],
      validationErrors: [error.message],
      reviewPolicy: null,
      invocationPlan: null,
    };
  }
}
