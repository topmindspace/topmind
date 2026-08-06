#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs, resolveMode } from "../core/cli-args.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import { rebuildAllDerived, loadContract } from "../../lib/kernel-api.mjs";

// ── rebuild ─────────────────────────────────────────────────────────────────

async function rebuild({ mode }, ctxObj) {
  const contract = loadContract(ctxObj.userWorkspaceRoot);
  const stats = rebuildAllDerived({
    workspaceRoot: ctxObj.userWorkspaceRoot,
    contract,
  });

  return {
    command: "rebuild",
    mode,
    applied: mode === "auto",
    stats,
  };
}

// ── dispatcher ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const roots = validateRequiredRoots(args);
  const ctxObj = buildCliContext(roots);
  const mode = resolveMode(args);

  let data;
  switch (args.command) {
    case "rebuild":
      data = await rebuild({ mode }, ctxObj);
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
