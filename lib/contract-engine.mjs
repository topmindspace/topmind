// ── topmind Contract Engine (Kernel 1/8) ──────────────────────────────────
// Authoritative engine for topmind.yaml (schema v4) loading, parsing, validation,
// protection level resolution, v3 JSON → v4 YAML migration, and
// ensure / repair / diagnose / reseed lifecycle (single truth for all surfaces).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parse as parseYaml, stringify as stringifyYaml } from "./yaml-bridge.mjs";

const require = createRequire(import.meta.url);

export const CONTRACT_FILE_NAME = "topmind.yaml";
export const CONTRACT_VERSION = 4;
/** Legacy v3 config filename (auto-migrated to topmind.yaml). */
export const LEGACY_CONFIG_FILE_NAME = ".topmind-config.json";

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
 * @returns {object} parsed JavaScript object (empty object on hard failure)
 */
export function parseYamlSubset(content) {
  const result = tryParseContractContent(content);
  return result.ok ? result.value : {};
}

/**
 * Strict parse of contract file content.
 * @param {string} content
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function tryParseContractContent(content) {
  if (!content || typeof content !== "string") {
    return { ok: false, error: "Contract content is empty" };
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, error: "Contract content is empty" };
  }
  if (trimmed.startsWith("{")) {
    try {
      const value = JSON.parse(trimmed);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "Contract JSON root must be an object" };
      }
      return { ok: true, value };
    } catch (err) {
      // Fall through to YAML parser (YAML may start with { in rare cases)
    }
  }

  try {
    const doc = parseYaml(content);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return { ok: false, error: "Contract YAML root must be a mapping/object" };
    }
    return { ok: true, value: doc };
  } catch (err) {
    return { ok: false, error: err?.message || "YAML parse failed" };
  }
}

/**
 * @param {object|null|undefined} obj
 * @returns {boolean}
 */
export function hasRecognizedContractKeys(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.keys(obj).some((k) => VALID_CONTRACT_TOP_KEYS.has(k))
  );
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
 * @returns {object} clean v4 contract object (only VALID_CONTRACT_TOP_KEYS).
 *   Consumers needing flat convenience aliases (categoryExtensions, template,
 *   categorySeparator, etc.) should use normalizeConfig() from model-core.mjs
 *   or access the v4 nested structure directly (contract.workspace.template,
 *   contract.categories.extensions, …).
 */
export function loadContract(workspaceRoot) {
  // Best-effort in-memory contract for engines. Does NOT write disk and does
  // NOT claim the on-disk file is healthy — use inspectContract / ensureContract
  // for open-path lifecycle and honest health status.
  let contract = null;
  const yamlPath = path.join(workspaceRoot, CONTRACT_FILE_NAME);
  if (fs.existsSync(yamlPath)) {
    try {
      const raw = fs.readFileSync(yamlPath, "utf8");
      const parsed = tryParseContractContent(raw);
      if (parsed.ok) contract = parsed.value;
    } catch {
      // fall through
    }
  }

  if (!hasRecognizedContractKeys(contract)) {
    const legacyJsonPath = path.join(workspaceRoot, LEGACY_CONFIG_FILE_NAME);
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

  // Return a sanitized clean v4 shape (no flat aliases) for consumers.
  return sanitizeContract(contract, {});
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

// ── Contract lifecycle: inspect / sanitize / write / ensure / reseed ───────

/**
 * Deep-merge source onto target (source wins for defined leaves).
 * Arrays are replaced, not concatenated. Pure; does not mutate inputs.
 * @param {any} target
 * @param {any} source
 * @returns {any}
 */
export function deepMergeContract(target, source) {
  if (source === null || source === undefined) {
    return target === undefined ? null : structuredCloneSafe(target);
  }
  if (Array.isArray(source)) {
    return source.map((item) => structuredCloneSafe(item));
  }
  if (typeof source !== "object") {
    return source;
  }
  const base =
    target && typeof target === "object" && !Array.isArray(target)
      ? { ...target }
      : {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      base[key] = deepMergeContract(base[key], value);
    } else {
      base[key] = deepMergeContract(undefined, value);
    }
  }
  return base;
}

function structuredCloneSafe(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

/**
 * Build a clean v4 contract: defaults ⊕ user partial, strip unknown top keys.
 * Applies optional workspace overrides (template/locale/separator/name).
 *
 * @param {object} [partial]
 * @param {{ templateId?: string, locale?: string, categorySeparator?: string, name?: string }} [opts]
 * @returns {object} clean v4 contract (VALID_CONTRACT_TOP_KEYS only)
 */
export function sanitizeContract(partial = {}, opts = {}) {
  const defaults = buildDefaultContract();
  const cleaned = {};
  if (partial && typeof partial === "object" && !Array.isArray(partial)) {
    for (const key of VALID_CONTRACT_TOP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(partial, key) && partial[key] !== undefined) {
        cleaned[key] = partial[key];
      }
    }
  }
  const merged = deepMergeContract(defaults, cleaned);
  merged.contract_version = CONTRACT_VERSION;

  // Apply explicit open-path overrides (first-time template choice, etc.)
  if (!merged.workspace || typeof merged.workspace !== "object") {
    merged.workspace = { ...defaults.workspace };
  }
  if (opts.templateId) merged.workspace.template = opts.templateId;
  if (opts.locale) merged.workspace.locale = opts.locale;
  if (opts.categorySeparator === " " || opts.categorySeparator === "-") {
    merged.workspace.category_separator = opts.categorySeparator;
  }
  if (opts.name) merged.workspace.name = opts.name;

  // Normalize writeback.mode
  if (merged.writeback?.mode && !["auto", "confirm"].includes(merged.writeback.mode)) {
    merged.writeback.mode = "auto";
  }
  // Normalize stream.packing
  const validPacking = new Set(["atom", "daily", "weekly", "monthly"]);
  if (merged.stream?.packing && !validPacking.has(merged.stream.packing)) {
    merged.stream.packing = "weekly";
  }
  // Normalize separator
  if (
    merged.workspace.category_separator !== " " &&
    merged.workspace.category_separator !== "-"
  ) {
    merged.workspace.category_separator = "-";
  }

  // Ensure protection by_role always has system:locked baseline
  if (!merged.protection?.defaults?.by_role) {
    merged.protection = {
      defaults: { by_role: { ...DEFAULT_PROTECTION_BY_ROLE } },
    };
  } else {
    merged.protection.defaults.by_role = {
      ...DEFAULT_PROTECTION_BY_ROLE,
      ...merged.protection.defaults.by_role,
    };
  }

  return merged;
}

/**
 * Serialize clean contract to YAML string.
 * @param {object} contract
 * @returns {string}
 */
export function stringifyContract(contract) {
  const clean = sanitizeContract(contract);
  return stringifyYaml(clean, { lineWidth: 0 });
}

/**
 * Write clean v4 contract to workspace root topmind.yaml.
 * @param {string} workspaceRoot
 * @param {object} contract
 * @returns {string} absolute path written
 */
export function writeContract(workspaceRoot, contract) {
  const root = path.resolve(workspaceRoot);
  fs.mkdirSync(root, { recursive: true });
  const yamlPath = path.join(root, CONTRACT_FILE_NAME);
  const content = stringifyContract(contract);
  fs.writeFileSync(yamlPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return yamlPath;
}

/**
 * Inspect on-disk contract health without writing and without inventing a healthy disk state.
 *
 * @param {string} workspaceRoot
 * @returns {{
 *   path: string,
 *   exists: boolean,
 *   legacyExists: boolean,
 *   state: 'missing'|'legacy_v3'|'ok'|'repairable'|'corrupt'|'unreadable',
 *   onDiskValid: boolean,
 *   parseOk: boolean,
 *   parseError: string|null,
 *   raw: object|null,
 *   validation: { valid: boolean, errors: string[] },
 *   needsRewrite: boolean,
 *   errors: string[],
 *   warnings: string[],
 * }}
 */
export function inspectContract(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const yamlPath = path.join(root, CONTRACT_FILE_NAME);
  const legacyPath = path.join(root, LEGACY_CONFIG_FILE_NAME);
  const legacyExists = fs.existsSync(legacyPath);
  const exists = fs.existsSync(yamlPath);

  const base = {
    path: yamlPath,
    exists,
    legacyExists,
    state: "missing",
    onDiskValid: false,
    parseOk: false,
    parseError: null,
    raw: null,
    validation: { valid: false, errors: [] },
    needsRewrite: false,
    errors: [],
    warnings: [],
  };

  if (!exists) {
    if (legacyExists) {
      base.state = "legacy_v3";
      base.needsRewrite = true;
      base.warnings.push(
        `Legacy ${LEGACY_CONFIG_FILE_NAME} present; migrate to ${CONTRACT_FILE_NAME}`,
      );
      return base;
    }
    base.state = "missing";
    base.errors.push(`Missing ${CONTRACT_FILE_NAME}`);
    return base;
  }

  let rawText;
  try {
    rawText = fs.readFileSync(yamlPath, "utf8");
  } catch (err) {
    base.state = "unreadable";
    base.errors.push(`Cannot read ${CONTRACT_FILE_NAME}: ${err?.message || err}`);
    return base;
  }

  const parsed = tryParseContractContent(rawText);
  if (!parsed.ok) {
    base.state = "corrupt";
    base.parseOk = false;
    base.parseError = parsed.error;
    base.errors.push(`Corrupt ${CONTRACT_FILE_NAME}: ${parsed.error}`);
    return base;
  }

  base.parseOk = true;
  base.raw = parsed.value;

  if (!hasRecognizedContractKeys(parsed.value)) {
    // Parsed but no v4 keys — treat as corrupt / unusable shape
    base.state = "corrupt";
    base.errors.push(
      `${CONTRACT_FILE_NAME} has no recognized v4 top-level keys`,
    );
    return base;
  }

  const validation = validateContract(parsed.value);
  base.validation = validation;

  // Detect repairable drift: wrong version, unknown keys, missing nested sections
  const unknownKeys = Object.keys(parsed.value).filter(
    (k) => !VALID_CONTRACT_TOP_KEYS.has(k),
  );
  const versionWrong =
    parsed.value.contract_version != null &&
    Number(parsed.value.contract_version) !== CONTRACT_VERSION;
  const missingSections = ["workspace", "writeback", "stream", "memory", "protection"].filter(
    (k) => parsed.value[k] == null || typeof parsed.value[k] !== "object",
  );

  if (!validation.valid || unknownKeys.length || versionWrong || missingSections.length) {
    base.state = "repairable";
    base.needsRewrite = true;
    base.onDiskValid = false;
    if (unknownKeys.length) {
      base.warnings.push(`Unknown top-level keys will be stripped: ${unknownKeys.join(", ")}`);
    }
    if (versionWrong) {
      base.warnings.push(
        `contract_version ${parsed.value.contract_version} → ${CONTRACT_VERSION}`,
      );
    }
    if (missingSections.length) {
      base.warnings.push(`Missing sections will be filled from defaults: ${missingSections.join(", ")}`);
    }
    for (const e of validation.errors) base.errors.push(e);
    return base;
  }

  base.state = "ok";
  base.onDiskValid = true;
  base.needsRewrite = false;
  return base;
}

/**
 * Backup a bad contract file before reseed. Prefers content-plane backup dir
 * when system category exists; falls back to .topmind/contract-backups/.
 * Never deletes user content directories.
 *
 * @param {string} workspaceRoot
 * @returns {string|null} relative backup path, or null if nothing to backup
 */
export function backupContractFile(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const yamlPath = path.join(root, CONTRACT_FILE_NAME);
  if (!fs.existsSync(yamlPath)) return null;

  const stamp = new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
  const backupName = `topmind.yaml.corrupt-${stamp}`;

  // Prefer 99-*/backups under system role dirs; else .topmind/contract-backups
  let backupDir = null;
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const systemDir = entries.find(
      (e) => e.isDirectory() && /^99[ -]/.test(e.name),
    );
    if (systemDir) {
      backupDir = path.join(root, systemDir.name, "backups", "contract");
    }
  } catch {
    // fall through
  }
  if (!backupDir) {
    backupDir = path.join(root, ".topmind", "contract-backups");
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, backupName);
  fs.copyFileSync(yamlPath, dest);
  return path.relative(root, dest).split(path.sep).join("/");
}

/**
 * Ensure workspace has a valid on-disk v4 topmind.yaml.
 *
 * - missing → create defaults (optionally with templateId/locale)
 * - legacy v3 JSON → migrate + write
 * - repairable (wrong version / unknown keys / missing sections) → merge + rewrite
 * - corrupt/unreadable → structured unrepairable (unless options.reseed)
 *
 * Never invents a healthy on-disk state for unrepairable files without reseed.
 * Content directories are never wiped.
 *
 * @param {string} workspaceRoot
 * @param {{
 *   reseed?: boolean,
 *   templateId?: string,
 *   locale?: string,
 *   categorySeparator?: string,
 *   name?: string,
 * }} [options]
 * @returns {{
 *   status: 'ok'|'created'|'repaired'|'migrated'|'reseeded'|'unrepairable',
 *   path: string,
 *   onDiskValid: boolean,
 *   contract: object|null,
 *   operationalContract: object,
 *   actions: string[],
 *   errors: string[],
 *   warnings: string[],
 *   backupPath?: string|null,
 *   inspection: object,
 * }}
 */
export function ensureContract(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  fs.mkdirSync(root, { recursive: true });
  const yamlPath = path.join(root, CONTRACT_FILE_NAME);
  const opts = {
    templateId: options.templateId,
    locale: options.locale,
    categorySeparator: options.categorySeparator,
    name: options.name,
  };

  const inspection = inspectContract(root);
  const actions = [];
  const errors = [...inspection.errors];
  const warnings = [...inspection.warnings];

  const finish = (status, contract, extra = {}) => ({
    status,
    path: yamlPath,
    onDiskValid: status !== "unrepairable",
    contract: status === "unrepairable" ? null : contract,
    operationalContract: contract || buildDefaultContract(),
    actions,
    errors,
    warnings,
    inspection,
    ...extra,
  });

  // Healthy on disk — optional override still rewrites only when opts force template? no
  if (inspection.state === "ok" && inspection.onDiskValid) {
    const contract = sanitizeContract(inspection.raw, {});
    return finish("ok", contract);
  }

  // Missing → create
  if (inspection.state === "missing") {
    const contract = sanitizeContract({}, opts);
    writeContract(root, contract);
    actions.push("created");
    return finish("created", contract);
  }

  // Legacy v3 JSON only (or YAML missing/corrupt with legacy present)
  if (inspection.state === "legacy_v3" || (inspection.legacyExists && inspection.state === "corrupt")) {
    const legacyPath = path.join(root, LEGACY_CONFIG_FILE_NAME);
    try {
      const rawJson = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      const contract = sanitizeContract(migrateV3ToV4(rawJson), opts);
      writeContract(root, contract);
      actions.push("migrated_v3");
      return finish("migrated", contract);
    } catch (err) {
      if (inspection.state === "legacy_v3") {
        // Bad legacy only — seed defaults
        const contract = sanitizeContract({}, opts);
        writeContract(root, contract);
        actions.push("created_after_legacy_parse_fail");
        warnings.push(`Legacy config parse failed: ${err?.message || err}`);
        return finish("created", contract);
      }
      // corrupt YAML + bad legacy → unrepairable path below
      errors.push(`Legacy config parse failed: ${err?.message || err}`);
    }
  }

  // Repairable: has recognized keys but needs rewrite
  if (inspection.state === "repairable" && inspection.raw) {
    const contract = sanitizeContract(inspection.raw, opts);
    writeContract(root, contract);
    actions.push("repaired");
    return finish("repaired", contract);
  }

  // Corrupt / unreadable
  if (inspection.state === "corrupt" || inspection.state === "unreadable") {
    if (options.reseed) {
      const backupPath = backupContractFile(root);
      const contract = sanitizeContract({}, opts);
      writeContract(root, contract);
      actions.push("reseeded");
      if (backupPath) actions.push(`backed_up:${backupPath}`);
      return finish("reseeded", contract, { backupPath });
    }
    return finish("unrepairable", null, {
      onDiskValid: false,
      operationalContract: sanitizeContract({}, opts),
    });
  }

  // Fallback: treat as create
  const contract = sanitizeContract({}, opts);
  writeContract(root, contract);
  actions.push("created");
  return finish("created", contract);
}

/**
 * User-triggered recovery: backup bad contract (if any) and write fresh defaults.
 * Content dirs are never wiped.
 *
 * @param {string} workspaceRoot
 * @param {{ templateId?: string, locale?: string, categorySeparator?: string, name?: string }} [options]
 * @returns {ReturnType<typeof ensureContract>}
 */
export function reseedContract(workspaceRoot, options = {}) {
  return ensureContract(workspaceRoot, { ...options, reseed: true });
}
