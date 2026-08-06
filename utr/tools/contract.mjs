#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs } from "../core/cli-args.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import { loadContract, validateContract } from "../../lib/kernel-api.mjs";

// ── validate ────────────────────────────────────────────────────────────────

async function validate(ctxObj) {
  const contractPath = path.join(ctxObj.userWorkspaceRoot, "topmind.yaml");
  const contract = loadContract(ctxObj.userWorkspaceRoot);
  const validation = validateContract(contract);

  return {
    command: "validate",
    contractPath: ctxObj.userWorkspaceRoot ? path.relative(ctxObj.userWorkspaceRoot, contractPath) : contractPath,
    valid: validation.valid,
    errors: validation.errors,
    contract,
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
    default:
      throw new Error(t("error.unknownCommand", { command: args.command || "(empty)" }));
  }

  emitResult(data, args.format);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
