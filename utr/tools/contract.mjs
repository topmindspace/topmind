#!/usr/bin/env node
import path from "node:path";

import {
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs } from "../core/cli-args.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import {
  loadContract,
  validateContract,
  inspectContract,
  ensureContract,
  reseedContract,
} from "../../lib/kernel-api.mjs";

// ── validate ────────────────────────────────────────────────────────────────

/**
 * Honest on-disk validation. Does not pretend a corrupt file is healthy just
 * because loadContract() can invent operational defaults in memory.
 */
async function validate(ctxObj) {
  const contractPath = path.join(ctxObj.userWorkspaceRoot, "topmind.yaml");
  const inspection = inspectContract(ctxObj.userWorkspaceRoot);
  const operational = loadContract(ctxObj.userWorkspaceRoot);
  const validation = inspection.onDiskValid
    ? validateContract(operational)
    : inspection.validation?.errors?.length
      ? inspection.validation
      : {
          valid: false,
          errors: inspection.errors.length
            ? inspection.errors
            : ["Contract on disk is not a valid v4 topmind.yaml"],
        };

  return {
    command: "validate",
    contractPath: ctxObj.userWorkspaceRoot
      ? path.relative(ctxObj.userWorkspaceRoot, contractPath)
      : contractPath,
    valid: inspection.onDiskValid && validation.valid,
    onDiskValid: inspection.onDiskValid,
    state: inspection.state,
    errors: validation.valid && inspection.onDiskValid
      ? []
      : [...new Set([...(validation.errors || []), ...inspection.errors])],
    warnings: inspection.warnings,
    needsRewrite: inspection.needsRewrite,
    recovery: inspection.onDiskValid
      ? null
      : {
          ensure: "contract.ensure — create/repair when safe",
          reseed: "contract.reseed — backup bad file + write fresh defaults (content dirs kept)",
        },
    // Only include contract body when on-disk is valid (no silent lie)
    contract: inspection.onDiskValid ? operational : null,
    operationalContract: operational,
  };
}

// ── ensure ──────────────────────────────────────────────────────────────────

async function ensure(ctxObj, args) {
  const result = ensureContract(ctxObj.userWorkspaceRoot, {
    templateId: args.template || args.templateId,
    locale: args.locale,
    reseed: false,
  });
  return {
    command: "ensure",
    ...result,
    contractPath: path.relative(ctxObj.userWorkspaceRoot, result.path),
  };
}

// ── reseed ──────────────────────────────────────────────────────────────────

async function reseed(ctxObj, args) {
  const result = reseedContract(ctxObj.userWorkspaceRoot, {
    templateId: args.template || args.templateId,
    locale: args.locale,
  });
  return {
    command: "reseed",
    ...result,
    contractPath: path.relative(ctxObj.userWorkspaceRoot, result.path),
  };
}

// ── dispatcher ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const roots = validateRequiredRoots(args);
  const ctxObj = buildCliContext(roots);

  let data;
  switch (args.command) {
    case "validate":
      data = await validate(ctxObj);
      break;
    case "ensure":
      data = await ensure(ctxObj, args);
      break;
    case "reseed":
      data = await reseed(ctxObj, args);
      break;
    default:
      throw new Error(t("error.unknownCommand", { command: args.command || "(empty)" }));
  }

  emitResult(data, args.format);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
