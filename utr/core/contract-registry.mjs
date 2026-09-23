import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { t } from "./i18n-strings.mjs";
import { normalizeContractCommand } from "./contract-metadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, "..", "contracts");
const SCHEMA_PATH = path.join(CONTRACTS_DIR, "schema.json");
const WORKSPACE_TOOL_DOMAINS = ["workspace-read", "workspace-write", "workspace-transform", "workspace-maintain", "contract", "memory", "lifecycle", "derived"];

let _schemaCache = null;

async function loadSchema() {
  if (_schemaCache) return _schemaCache;
  _schemaCache = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  return _schemaCache;
}

async function listContractSkillDirs(contractsDir, skills) {
  if (Array.isArray(skills) && skills.length > 0) {
    return skills;
  }

  if (path.resolve(contractsDir) === CONTRACTS_DIR) {
    return WORKSPACE_TOOL_DOMAINS;
  }

  const entries = await fs.readdir(contractsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function pathExists(targetPath) {
  if (!targetPath) return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Naive structural validation against the contract schema.
 * Checks required top-level keys, command structure, and field types.
 * Full JSON Schema validation would use a library like ajv, but this
 * gives us fast startup validation with clear error messages.
 */
function validateContract(contract, schema) {
  const errors = [];

  // Top-level required fields
  for (const key of schema.required || []) {
    if (!(key in contract)) {
      errors.push(t("error.missingField", { key }));
    }
  }

  if (contract.schema_version !== 1) {
    errors.push(t("error.unsupportedSchema", { version: contract.schema_version }));
  }

  // Validate top-level skill enum
  const validSkills = schema.properties.skill.enum;
  if (contract.skill && !validSkills.includes(contract.skill)) {
    errors.push(t("error.invalidSkill", { skill: contract.skill, allowed: validSkills.join(", ") }));
  }

  // Validate execution block
  if (contract.execution) {
    const runtimeSchema = schema.properties.execution.properties.runtime;
    const validRuntimes = runtimeSchema.enum || (runtimeSchema.const ? [runtimeSchema.const] : []);
    if (contract.execution.runtime && !validRuntimes.includes(contract.execution.runtime)) {
      errors.push(t("error.invalidRuntime", { runtime: contract.execution.runtime, allowed: validRuntimes.join(", ") }));
    }
    if (!contract.execution.runtime) errors.push(t("error.missingRuntime"));
    if (!contract.execution.script) errors.push(t("error.missingScriptField"));
    if (contract.execution.fallback) {
      errors.push(t("error.deprecatedFallback"));
    }
  }

  // Validate commands
  if (contract.commands && typeof contract.commands === "object") {
    for (const [cmdName, cmd] of Object.entries(contract.commands)) {
      if (!cmd.label) errors.push(t("error.missingCmdField", { name: cmdName, field: "label" }));
      if (!cmd.group) errors.push(t("error.missingCmdField", { name: cmdName, field: "group" }));
      if (!cmd.risk_level) errors.push(t("error.missingCmdField", { name: cmdName, field: "risk_level" }));
      if (!cmd.review_policy) errors.push(t("error.missingCmdField", { name: cmdName, field: "review_policy" }));

      const validGroups = schema.properties.commands.additionalProperties.properties.group.enum;
      if (cmd.group && !validGroups.includes(cmd.group)) {
        errors.push(t("error.invalidCmdGroup", { name: cmdName, value: cmd.group, allowed: validGroups.join(", ") }));
      }

      const validRisk = schema.properties.commands.additionalProperties.properties.risk_level.enum;
      if (cmd.risk_level && !validRisk.includes(cmd.risk_level)) {
        errors.push(t("error.invalidCmdRisk", { name: cmdName, value: cmd.risk_level }));
      }

      const validPolicies = schema.properties.commands.additionalProperties.properties.review_policy.enum;
      if (cmd.review_policy && !validPolicies.includes(cmd.review_policy)) {
        errors.push(t("error.invalidCmdPolicy", { name: cmdName, value: cmd.review_policy }));
      }
    }
  } else {
    errors.push(t("error.commandsMissing"));
  }

  return errors;
}

/**
 * Load all contracts from utr/contracts/{skill}/ directories.
 *
 * Options:
 * - contractsDir: override contracts directory
 * - skills: explicit skill dir list
 * - plugins: plugin manifests from discoverPlugins() — if provided, used to
 *   cross-validate that every plugin-provided tool has a contract, and to
 *   discover additional contract directories
 *
 * Returns a registry indexed by tool kind and kind.command.
 */
export async function loadContractRegistry(options = {}) {
  const contractsDir = options.contractsDir
    ? path.resolve(options.contractsDir)
    : CONTRACTS_DIR;
  const schema = await loadSchema();
  const byKind = new Map();
  const byCommand = new Map();
  const errors = [];

  let skillDirs = [];
  try {
    skillDirs = await listContractSkillDirs(contractsDir, options.skills);
  } catch (error) {
    throw new Error(t("error.contractsDirFailed", { dir: contractsDir, message: error.message }));
  }

  for (const skill of skillDirs) {
    const skillDir = path.join(contractsDir, skill);
    let entries;
    try {
      entries = await fs.readdir(skillDir);
    } catch {
      continue; // skill dir doesn't exist (e.g., future skills)
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(skillDir, entry);
      const raw = await fs.readFile(filePath, "utf8");
      let contract;
      try {
        contract = JSON.parse(raw);
      } catch (e) {
        errors.push(`${filePath}: ${t("error.jsonParseFailed", { message: e.message })}`);
        continue;
      }

      const validationErrors = validateContract(contract, schema);
      if (validationErrors.length > 0) {
        errors.push(`${filePath}: ${validationErrors.join("; ")}`);
        continue;
      }

      if (byKind.has(contract.kind)) {
        errors.push(`${filePath}: ${t("error.duplicateKind", { kind: contract.kind })}`);
        continue;
      }

      byKind.set(contract.kind, contract);
      if (contract.commands) {
        for (const [cmdName, cmdDef] of Object.entries(contract.commands)) {
          const key = `${contract.kind}.${cmdName}`;
          if (byCommand.has(key)) {
            errors.push(`${filePath}: ${t("error.duplicateCommand", { key })}`);
            continue;
          }
          byCommand.set(key, { contract, commandName: cmdName, command: { name: cmdName, ...cmdDef } });
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(t("error.contractsLoadFailed", { errors: errors.join("\n") }));
  }

  return {
    byKind,
    byCommand,
    toolCount: byKind.size,
    commandCount: byCommand.size,
  };
}

// v3.2: legacy v2.x project-* command aliases (previously injected by
// injectLegacyCommandAliases) have been removed entirely. The 28 commands
// are the source of truth. See contract files under utr/contracts/ for details.

/** Get a single tool contract by kind. */
export function getTool(registry, kind) {
  const contract = registry.byKind.get(kind);
  if (!contract) throw new Error(t("error.unknownTool", { kind }));
  return contract;
}

/** Get a single command definition by kind.command. */
export function getCommand(registry, kind, command) {
  const key = `${kind}.${command}`;
  const entry = registry.byCommand.get(key);
  if (!entry) throw new Error(t("error.unknownCommandInRegistry", { key }));
  return entry;
}

/** List tools, optionally filtered. */
export function listTools(registry, filter = {}) {
  let tools = [...registry.byKind.values()];

  if (filter.skill) {
    tools = tools.filter((t) => t.skill === filter.skill);
  }

  return tools.map((t) => {
    let entries = Object.entries(t.commands);
    if (filter.exposure) {
      const allowed = Array.isArray(filter.exposure) ? filter.exposure : [filter.exposure];
      entries = entries.filter(([, cmd]) => allowed.includes(cmd.exposure || "advanced"));
    }
    if (filter.primaryOnly) {
      entries = entries.filter(([, cmd]) => {
        const exp = cmd.exposure || "advanced";
        return exp === "primary" || exp === "danger";
      });
    }
    return {
      kind: t.kind,
      label: t.label,
      description: t.description,
      skill: t.skill,
      commandCount: entries.length,
      commands: entries.map(([name, cmd]) => ({
        name,
        label: cmd.label,
        group: cmd.group,
        exposure: cmd.exposure || "advanced",
        riskLevel: cmd.risk_level,
        reviewPolicy: cmd.review_policy,
        requiresTopic: cmd.requires_topic,
        idempotent: cmd.idempotent,
      })),
    };
  }).filter((t) => t.commandCount > 0 || !filter.primaryOnly);
}

/** List all individual commands (actions), optionally filtered. */
export function listCommands(registry, filter = {}) {
  const commands = [];
  for (const [, entry] of registry.byCommand) {
    if (entry.command.aliasOf) continue;
    if (filter.skill && entry.contract.skill !== filter.skill) continue;
    if (filter.group && entry.command.group !== filter.group) continue;
    const normalized = normalizeContractCommand(entry.contract, entry.commandName, entry.command);
    commands.push({
      kind: normalized.kind,
      command: normalized.command,
      label: normalized.label,
      description: normalized.description,
      skill: normalized.skill,
      sourceEngine: normalized.sourceEngine,
      sourceEngineLabel: normalized.sourceEngineLabel,
      group: normalized.group,
      exposure: normalized.exposure,
      advanced: normalized.advanced,
      riskLevel: normalized.riskLevel,
      reviewPolicy: normalized.reviewPolicy,
      supportsDryRun: normalized.supportsDryRun,
      idempotent: normalized.idempotent,
      destructive: normalized.destructive,
      inputs: normalized.inputs,
      fields: normalized.fields,
      reads: normalized.reads,
      writes: normalized.writes,
      contexts: normalized.contexts,
      recommendedTriggers: normalized.recommendedTriggers,
      artifactPolicy: normalized.artifactPolicy,
      workflowNote: normalized.workflowNote,
    });
  }
  return commands;
}
