/**
 * Maps UTR contract commands to MCP tool schemas.
 *
 * Converts each contract command into a JSON Schema-based MCP tool
 * with name = "{kind}.{command}", human-readable description, and
 * input properties derived from the contract's inputs definition.
 */

import { t } from "../core/i18n-strings.mjs";

// ── Type mapping: contract input type → JSON Schema type ─────────────────

const TYPE_MAP = {
  text: "string",
  path: "string",
  number: "number",
  select: "string",
  toggle: "boolean",
};

function buildInputSchema(inputs, command = {}) {
  if (!inputs || Object.keys(inputs).length === 0) {
    return { type: "object", properties: {} };
  }

  const properties = {};
  const required = [];
  const writebackModeControlsDryRun = Boolean(inputs.writebackMode && inputs.dryRun && command.supports_dry_run);

  for (const [name, def] of Object.entries(inputs)) {
    const jsonType = TYPE_MAP[def.type] || "string";
    const prop = {
      type: jsonType,
      description: def.label || def.hint || def.placeholder || name,
    };

    if (def.type === "select" && Array.isArray(def.options)) {
      prop.enum = def.options.map((o) => o.value);
    }
    if (def.type === "number") {
      if (typeof def.min === "number") prop.minimum = def.min;
      if (typeof def.max === "number") prop.maximum = def.max;
    }
    if (Object.hasOwn(def, "default") && !(name === "dryRun" && writebackModeControlsDryRun)) {
      prop.default = def.default;
    }
    if (name === "dryRun" && writebackModeControlsDryRun) {
      prop.description = `${prop.description}${t("msg.dryRunOmitted")}`;
    }
    if (def.placeholder) {
      prop.description = `${prop.description}${t("msg.placeholderExample", { placeholder: def.placeholder })}`;
    }

    properties[name] = prop;
    if (def.required) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build an MCP tool schema from a contract command entry.
 */
export function buildMcpToolSchema(entry) {
  const { contract, commandName, command } = entry;
  const toolName = `${contract.kind}.${commandName}`;
  const inputSchema = buildInputSchema(command.inputs, command);

  const baseDescription = command.description || contract.description || "";
  // Dedup: if command.description already contains the command label, skip the label line
  const labelLine = command.label && !baseDescription.includes(command.label)
    ? `— ${command.label}`
    : "";

  return {
    name: toolName,
    description: [
      contract.label,
      labelLine,
      baseDescription,
    ].filter(Boolean).join("\n"),
    inputSchema,
  };
}

/**
 * Build MCP tool list from contract registry.
 *
 * Default agent surface: exposure = primary | danger (core + high-risk maintain).
 * Set options.includeAdvanced=true or env topmind_MCP_ALL=1 to include advanced.
 */
export function buildMcpToolList(registry, options = {}) {
  const includeAdvanced =
    options.includeAdvanced === true
    || process.env.topmind_MCP_ALL === "1"
    || process.env.topmind_MCP_ALL === "true";
  const tools = [];
  for (const [, entry] of registry.byCommand) {
    const exposure = entry.command?.exposure || "advanced";
    if (!includeAdvanced && exposure === "advanced") continue;
    tools.push(buildMcpToolSchema(entry));
  }
  return tools;
}
