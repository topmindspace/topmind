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
import { scanLifecycle, loadContract } from "../../lib/kernel-api.mjs";

// ── scan ────────────────────────────────────────────────────────────────────

async function scan(ctxObj) {
  const contract = loadContract(ctxObj.userWorkspaceRoot);
  const candidates = scanLifecycle({
    workspaceRoot: ctxObj.userWorkspaceRoot,
    contract,
    engineRoot: ctxObj.engineRoot,
  });

  return {
    command: "scan",
    candidates,
  };
}

// ── dispatcher ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const roots = validateRequiredRoots(args);
  const ctxObj = buildCliContext(roots);

  let data;
  switch (args.command) {
    case "scan":
      data = await scan(ctxObj);
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
