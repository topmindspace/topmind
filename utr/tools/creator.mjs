#!/usr/bin/env node
import { inspectCreationContext, buildCreationInputSnapshot, compareCreationLengthReport,
  compareCreationLocalLengthChain } from "../../lib/kernel-api.mjs";
import { parseArgs } from "../core/cli-args.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";

function requireText(args, key, flag) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(t("error.missingRequiredFlag", { flag }));
  }
  return value;
}

function requireObject(args, key, flag, required = true) {
  const raw = args[key];
  if ((raw === undefined || raw === null) && !required) return {};
  try {
    const value = JSON.parse(requireText(args, key, flag));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* fail with a field-specific error below */ }
  throw new Error(`${flag} must be a JSON object`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "inspect") {
    const result = inspectCreationContext({
      workspaceRoot: requireText(args, "workspaceRoot", "workspace-root"),
      targetPath: requireText(args, "targetPath", "target-path"),
      engineRoot: args.engineRoot,
    });
    emitResult(result, args.format);
    return;
  }
  if (args.command === "snapshot") {
    emitResult(buildCreationInputSnapshot({
      workspaceRoot: requireText(args, "workspaceRoot", "workspace-root"),
      targetPath: requireText(args, "targetPath", "target-path"),
      engineRoot: args.engineRoot,
      platform: requireText(args, "platform", "platform"),
      format: requireText(args, "creationFormat", "creation-format"),
      entry: requireText(args, "entry", "entry"),
      ruleset: requireObject(args, "ruleset", "ruleset"),
      provider: requireObject(args, "provider", "provider"),
      accountCapabilities: requireObject(args, "accountCapabilities", "account-capabilities", false),
      lengthValidation: args.lengthValidation === undefined ? undefined : requireObject(args, "lengthValidation", "length-validation"),
      parameters: requireObject(args, "parameters", "parameters", false),
    }), args.format);
    return;
  }
  if (args.command === "matchLengthReport") {
    const snapshot = requireObject(args, "snapshot", "snapshot");
    const report = requireObject(args, "report", "report");
    emitResult(args.articleResult === undefined
      ? compareCreationLengthReport(snapshot, report)
      : compareCreationLocalLengthChain(snapshot,
        requireObject(args, "articleResult", "article-result"), report), args.format);
    return;
  }
  throw new Error(t("error.unknownCommand", { command: args.command || "(empty)" }));
}

try {
  main();
} catch (error) {
  process.stderr.write(JSON.stringify({
    code: error?.code || "CREATOR_INSPECT_FAILED",
    message: error instanceof Error ? error.message : String(error),
  }) + "\n");
  process.exitCode = 1;
}
