// ── topmind Contract Engine (Kernel 1/8) ──────────────────────────────────
// Authoritative engine for topmind.yaml (schema v4) loading, parsing, validation,
// protection level resolution, and v3 JSON → v4 YAML migration.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parse as parseYaml } from "./yaml-bridge.mjs";

const require = createRequire(import.meta.url);

export const CONTRACT_FILE_NAME = "topmind.yaml";
export const CONTRACT_VERSION = 4;

/** Valid 8 contract categories whitelist according to v4 proposal §5.1 */
export const VALID_CONTRACT_TOP_KEYS = new Set([
  "contract_version",
  "workspace",
  "categories",
  "stream",
  "memory",
  "protection",
  "lifecycle",
  "writeback",
  "ingest",
  "agent",
  "presentation",
]);

/** Default protection level mappings by role (v3 simplified: open | locked) */
export const DEFAULT_PROTECTION_BY_ROLE = {
  buffer: "open",
  "loose-stream": "open",
  "deep-work": "open",
  memory: "open",
  delivery: "open",
  system: "locked",
};

/**
 * Parse YAML content using the `yaml` package (robust, spec-compliant).
 * Falls back to JSON.parse if input starts with '{'.
 *
 * @param {string} content - raw YAML string
 * @returns {object} parsed JavaScript object
 */
export function parseYamlSubset(content) {
  if (!content || typeof content !== "string") return {};
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to YAML parser
    }
  }

  try {
    const doc = parseYaml(content);
    return doc && typeof doc === "object" ? doc : {};
  } catch {
    // Silent fallback — callers get empty object on parse failure
    return {};
  }
}

/**
 * Validate that a contract object adheres to schema v4.
 * Checks contract_version and whitelist of top-level keys.
 *
 * @param {object} contract
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object") {
    return { valid: false, errors: ["Contract must be an object"] };
  }

  for (const key of Object.keys(contract)) {
    if (!VALID_CONTRACT_TOP_KEYS.has(key)) {
      errors.push(`Unknown top-level contract key: '${key}'`);
    }
  }

  if (contract.contract_version && contract.contract_version !== CONTRACT_VERSION) {
    errors.push(`Unsupported contract_version: ${contract.contract_version} (expected ${CONTRACT_VERSION})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load workspace contract (topmind.yaml) from root directory.
 * If topmind.yaml is missing, falls back to legacy .topmind-config.json auto-migration.
 *
 * @param {string} workspaceRoot - absolute path to user workspace root
 * @returns {object} contract object (normalized to schema v4 shape)
 */
export function loadContract(workspaceRoot) {
  let contract = null;
  const yamlPath = path.join(workspaceRoot, CONTRACT_FILE_NAME);
  if (fs.existsSync(yamlPath)) {
    try {
      const raw = fs.readFileSync(yamlPath, "utf8");
      contract = parseYamlSubset(raw);
    } catch {
      // Silent fallback — loadDefaultContract() will be used
    }
  }

  const hasRecognizedKeys =
    contract &&
    typeof contract === "object" &&
    Object.keys(contract).some((k) => VALID_CONTRACT_TOP_KEYS.has(k));
  if (!hasRecognizedKeys) {
    const legacyJsonPath = path.join(workspaceRoot, ".topmind-config.json");
    if (fs.existsSync(legacyJsonPath)) {
      try {
        const rawJson = JSON.parse(fs.readFileSync(legacyJsonPath, "utf8"));
        contract = migrateV3ToV4(rawJson);
      } catch {
        contract = buildDefaultContract();
      }
    } else {
      contract = buildDefaultContract();
    }
  }

  contract.contract_version = contract.contract_version || CONTRACT_VERSION;
  if (contract.categories?.extensions) {
    contract.categoryExtensions = contract.categories.extensions;
  }
  if (contract.categories?.overrides) {
    contract.categoryOverrides = contract.categories.overrides;
  }
  if (contract.workspace?.template) {
    contract.template = contract.workspace.template;
  }
  if (contract.workspace?.category_separator) {
    contract.categorySeparator = contract.workspace.category_separator;
  }

  return contract;
}

/**
 * Build default v4 contract.
 * @returns {object}
 */
export function buildDefaultContract() {
  return {
    contract_version: 4,
    workspace: {
      name: "我的 topmind",
      locale: "zh-CN",
      template: "stream",
      category_separator: "-",
    },
    categories: {
      extensions: {},
      overrides: {},
    },
    stream: {
      packing: "weekly",
      append_heading: "day",
      default_view: "stream",
    },
    memory: {
      dir: "memory",
      layers: {
        global: { file: "profile.md", update: "on-suggest" },
        periodic: { dir: "periodic", cadence: "weekly", style: "brief" },
        topics: { dir: "topics", auto_create: false },
      },
      promotion: {
        enabled: true,
        min_occurrences: 2,
        require_confirm: true,
      },
    },
    protection: {
      defaults: {
        by_role: DEFAULT_PROTECTION_BY_ROLE,
      },
    },
    lifecycle: {
      inbox: { review_after_days: 7 },
      catch_all: { retention_days: 30 },
      stream: { digest_after_periods: 4 },
      topic: { stale_after_days: 90, suggest_archive: true },
      output: { lock_after_days: 30 },
    },
    writeback: {
      mode: "auto",
      shadow: true,
      backup_to: "99-归档/backups",
      receipts: "99-归档/receipts",
    },
    ingest: {
      default_target: "stream",
      url: { renderer: "auto" },
    },
    agent: {
      skills_entry: "topmind",
      confirm_by_default: false,
    },
    presentation: {
      views: { default: "stream", enabled: ["stream", "category", "timeline", "tags", "kanban"] },
    },
  };
}

/**
 * Migrate legacy .topmind-config.json (schema v3) to topmind.yaml (schema v4).
 *
 * @param {object} v3Config
 * @returns {object} v4 contract
 */
export function migrateV3ToV4(v3Config = {}) {
  const base = buildDefaultContract();
  if (v3Config.template) base.workspace.template = v3Config.template;
  if (v3Config.separator || v3Config.categorySeparator) {
    base.workspace.category_separator = v3Config.separator || v3Config.categorySeparator;
  }
  if (v3Config.locale) base.workspace.locale = v3Config.locale;
  if (v3Config.categoryExtensions) base.categories.extensions = v3Config.categoryExtensions;
  if (v3Config.categoryOverrides) base.categories.overrides = v3Config.categoryOverrides;
  if (v3Config.stream?.packing) base.stream.packing = v3Config.stream.packing;
  if (v3Config.memory?.profileFile) base.memory.layers.global.file = v3Config.memory.profileFile;

  return base;
}

/**
 * Resolve protection level for a given file path and role.
 * Protection levels: open | locked (v3 simplified)
 *
 * @param {object} contract - v4 contract object
 * @param {string} relativePath - relative file path from workspace root
 * @param {string} [role] - category role if known
 * @param {object} [options] - additional options
 * @param {string} [options.workspaceRoot] - workspace root for role resolution
 * @param {string} [options.engineRoot] - engine root for template loading
 * @returns {"open"|"locked"} protection level
 */
export function resolveProtection(contract, relativePath = "", role = "deep-work", options = {}) {
  const cleanPath = String(relativePath).replace(/\\/g, "/");

  // Machine state (.topmind/) is open for rebuilding
  if (cleanPath.startsWith(".topmind/")) {
    return "open";
  }

  // Resolve role from path if workspace root is provided
  let pathRole = null;
  if (options.workspaceRoot) {
    pathRole = resolveRoleFromPath(options.workspaceRoot, cleanPath, options.engineRoot);
  }
  const resolvedRole = pathRole || role || "deep-work";

  // Merge defaults so partial topmind.yaml (only a few by_role keys) still locks system
  const byRole = {
    ...DEFAULT_PROTECTION_BY_ROLE,
    ...(contract?.protection?.defaults?.by_role || {}),
  };

  // Prefer the stricter of path role vs explicit role when either is locked
  const candidates = [...new Set([resolvedRole, role].filter(Boolean))];
  for (const r of candidates) {
    if (byRole[r] === "locked") return "locked";
  }
  if (resolvedRole && byRole[resolvedRole]) {
    return byRole[resolvedRole];
  }
  if (role && byRole[role]) {
    return byRole[role];
  }

  return "open";
}

/**
 * Resolve category role from file path using workspace model.
 * @param {string} workspaceRoot
 * @param {string} relativePath
 * @param {string} [engineRoot]
 * @returns {string|null} role
 */
function resolveRoleFromPath(workspaceRoot, relativePath, engineRoot) {
  const { resolveWorkspaceModel } = require("./workspace-model.mjs");
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot });
  const firstSegment = relativePath.split("/")[0];
  const category = model.categories.find((c) => c.directory === firstSegment);
  return category?.role || null;
}
