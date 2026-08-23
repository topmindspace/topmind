#!/usr/bin/env node

/**
 * topmind-cli — Unified CLI entry point for all topmind workspace tools.
 *
 * Usage:
 *   topmind-cli --version
 *   topmind-cli doctor [--json] [--mcp]
 *   topmind-cli tool list [--skill workspace-read|workspace-write|workspace-transform|workspace-maintain|contract|memory|lifecycle|derived]
 *   topmind-cli tool inspect <kind>
 *   topmind-cli tool preview <kind> <command> --input-json '<json>'
 *   topmind-cli tool run <kind> <command> --input-json '<json>' [--reviewed] [--engine-root <path>] [--workspace-root <path>]
 *
 * Phase 2: Direct CLI execution.
 * Phase 3: Also serves as the execution backend for the MCP server.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContractRegistry, getTool, getCommand, listTools, listCommands } from "../core/contract-registry.mjs";
import { executeTool, previewTool } from "../core/tool-executor.mjs";
import { doctorUtr, formatDoctorText } from "../core/doctor.mjs";
import { resolveUtrWorkspaceContext } from "../core/workspace-context.mjs";
import { t, setLocaleFromConfig } from "../core/i18n-strings.mjs";
import { loadWorkspaceConfig } from "../core/workspace-context.mjs";

const CLI_VERSION = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "VERSION"),
  "utf8",
).trim();

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

function usage() {
  process.stderr.write(`topmind-cli — topmind Unified Action Runtime (v${CLI_VERSION})

Usage:
  topmind-cli --version                                Show version
  topmind-cli doctor [--json] [--mcp]                  Check UTR/CLI/MCP status
  topmind-cli tool list    [--skill <name>]            List all available actions
  topmind-cli tool inspect <kind>                      Inspect tool domain
  topmind-cli tool preview <kind> <command> --input-json '<json>'  Preview execution
  topmind-cli tool run     <kind> <command> --input-json '<json>' [--reviewed]  Run action

Options:
  --engine-root <path>     topmind engine root (auto-detected by default)
  --workspace-root <path>  topmind user workspace root (auto-detected by default)
  --skill <name>           Filter by skill domain (workspace-read | workspace-write | workspace-check | workspace-transform | workspace-maintain)
  --reviewed               Indicates confirm-mode review completed, allows execution
  --input-json '<json>'    Action parameters JSON (or - to read from stdin)
  --json                   doctor output as JSON
  --mcp                    doctor also checks MCP tool schema
  --version, -v            Show version
  --help, -h               Show help

Exit codes:
  0    Success
  1    Action failed / doctor check failed / parameter error
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--version" || arg === "-v") {
      process.stdout.write(`topmind-cli v${CLI_VERSION}\n`);
      process.exit(0);
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

async function resolveCliPathContext(args) {
  // Accept both topmind_WORKSPACE_ROOT (UTR-native) and topmind_USER_WORKSPACE (Desktop-consistent)
  const userWorkspaceRoot = args["workspace-root"]
    || process.env.topmind_WORKSPACE_ROOT
    || process.env.topmind_USER_WORKSPACE;
  return resolveUtrWorkspaceContext(args["workspace-root"] || args["engine-root"] || process.cwd(), {
    engineRoot: args["engine-root"] || process.env.topmind_ENGINE_ROOT,
    userWorkspaceRoot,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subcommand = args._[0];
  const subArgs = args._.slice(1);

  if (subcommand === "doctor") {
    const report = await doctorUtr({
      candidatePath: args["workspace-root"] || args["engine-root"] || process.cwd(),
      engineRoot: args["engine-root"] || process.env.topmind_ENGINE_ROOT,
      userWorkspaceRoot: args["workspace-root"] || process.env.topmind_WORKSPACE_ROOT,
      includeMcp: Boolean(args.mcp),
    });
    process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : formatDoctorText(report));
    if (!report.ok) process.exit(1);
    return;
  }

  if (subcommand !== "tool") {
    process.stderr.write(t("cli.unknownSubcommand") + "\n");
    process.stderr.write(t("cli.runHelpForUsage") + "\n");
    process.exit(1);
  }

  const action = subArgs[0];
  if (!["list", "inspect", "preview", "run"].includes(action)) {
    process.stderr.write(t("cli.unknownAction", { action }) + "\n");
    process.stderr.write(t("cli.runHelpForUsage") + "\n");
    process.exit(1);
  }

  const pathContext = await resolveCliPathContext(args);
  // Resolve locale from workspace config
  const wsConfig = loadWorkspaceConfig(pathContext.userWorkspaceRoot);
  setLocaleFromConfig(wsConfig);
  const registry = await loadContractRegistry({ engineRoot: pathContext.engineRoot });

  // --- tool list ---
  if (action === "list") {
    const tools = listTools(registry, { skill: args.skill });
    const output = tools.map((t) => ({
      kind: t.kind,
      label: t.label,
      skill: t.skill,
      commands: t.commands.map((c) => `${c.name} (${c.group}, ${c.riskLevel})`),
    }));
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return;
  }

  // --- tool inspect ---
  if (action === "inspect") {
    const kind = subArgs[1];
    if (!kind) {
      process.stderr.write(t("cli.missingKind") + "\n");
      process.exit(1);
    }
    const contract = getTool(registry, kind);
    const commands = Object.entries(contract.commands).map(([name, cmd]) => ({
      name,
      label: cmd.label,
      group: cmd.group,
      riskLevel: cmd.risk_level,
      reviewPolicy: cmd.review_policy,
      inputs: cmd.inputs,
    }));
    process.stdout.write(JSON.stringify({
      kind: contract.kind,
      label: contract.label,
      skill: contract.skill,
      description: contract.description,
      execution: contract.execution,
      commands,
    }, null, 2) + "\n");
    return;
  }

  // --- tool preview & run need kind, command, and input-json ---
  const kind = subArgs[1];
  const command = subArgs[2];
  if (!kind || !command) {
    process.stderr.write(t("cli.missingKindOrCommand") + "\n");
    process.exit(1);
  }

  let payload = {};
  if (args["input-json"]) {
    try {
      let raw = args["input-json"];
      // Support --input-json - to read from stdin (pipe-friendly)
      if (raw === "-") {
        raw = await readStdin();
      }
      payload = JSON.parse(raw);
    } catch {
      process.stderr.write(t("cli.invalidJson") + "\n");
      process.exit(1);
    }
  }

  // --- tool preview ---
  if (action === "preview") {
    const result = previewTool(registry, kind, command, payload, pathContext);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  // --- tool run ---
  if (action === "run") {
    const result = await executeTool({
      registry,
      kind,
      command,
      payload,
      pathContext,
      reviewed: Boolean(args.reviewed),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ok) process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(t("cli.error", { message: err.message }) + "\n");
  process.exit(1);
});
