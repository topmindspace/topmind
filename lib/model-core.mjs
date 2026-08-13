// ── topmind Workspace Model · Core ─────────────────────────────────────────
// Constants, category parse/discovery, config normalize/persist, attribute
// merge, and the central resolveWorkspaceModel(). Split from workspace-model
// facade — import via workspace-model.mjs (stable surface) or here directly.

import fsSync from "node:fs";
import path from "node:path";
import { loadTemplate, DEFAULT_TEMPLATE } from "./template-loader.mjs";
import { DEFAULT_PROTECTION_BY_ROLE } from "./contract-engine.mjs";
import {
  normalizeStreamConfig,
  normalizeMemoryConfig,
  DEFAULT_STREAM,
  DEFAULT_MEMORY,
} from "./stream-period.mjs";
import { loadContract, CONTRACT_FILE_NAME, writeContract } from "./contract-engine.mjs";

/** Three-Plane Model Constants (v4 Architecture) */
export const PLANES = Object.freeze({
  CONTENT: "content",
  SEMANTIC: "semantic",
  SYSTEM: "system",
});

/** Match first-level category directories: `00-Inbox` or `00 Inbox`. */
export const CATEGORY_PATTERN = /^\d{2}[ -].+/u;

export const VALID_ROLES = Object.freeze([
  "buffer",
  "loose-stream",
  "deep-work",
  "fallback",
  "reference",
  "delivery",
  "system",
]);

/** Roles that must exist for a workspace to be considered initialized. */
export const REQUIRED_ROLES = Object.freeze(["buffer", "delivery", "system"]);

/**
 * Slot → role when template is unavailable (fs-only discovery).
 * Keeps protection / ensure semantics stable without engineRoot.
 * Custom slots (11+, 20+, …) still default to deep-work.
 */
export const SLOT_ROLE_HEURISTICS = Object.freeze({
  "00": "buffer",
  "10": "loose-stream",
  "88": "delivery",
  "99": "system",
});

export const CONFIG_NAME = CONTRACT_FILE_NAME;
export { DEFAULT_TEMPLATE };

// ── Parse / discover ──────────────────────────────────────────────────────

/**
 * @param {string} dirName
 * @returns {{ slot: string, separator: string, name: string } | null}
 */
export function parseCategoryDirName(dirName) {
  if (!dirName || typeof dirName !== "string") return null;
  if (!CATEGORY_PATTERN.test(dirName)) return null;
  const slot = dirName.slice(0, 2);
  const separator = dirName.charAt(2);
  const name = dirName.slice(3);
  if (!name) return null;
  return { slot, separator, name };
}

export function isValidCategoryName(name) {
  return Boolean(parseCategoryDirName(name));
}

/**
 * Whether absPath is strictly inside workspaceRoot (not equal, not outside).
 * @param {string} workspaceRoot
 * @param {string} absPath
 * @returns {boolean}
 */
export function isPathInsideWorkspace(workspaceRoot, absPath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absPath);
  if (target === root) return false;
  const rel = path.relative(root, target);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Local file/dir read outside the current workspace.
 * Denied until the caller passes `authorized: true` (explicit user confirm).
 * In-root reads are allowed. Network URLs are not this helper's job.
 *
 * @param {{ workspaceRoot: string, targetPath: string, authorized?: boolean }} p
 * @returns {{ allowed: boolean, needsConfirm: boolean, reason: string }}
 */
export function evaluateOutsideRead({ workspaceRoot, targetPath, authorized = false }) {
  if (isPathInsideWorkspace(workspaceRoot, targetPath)) {
    return { allowed: true, needsConfirm: false, reason: "inside workspace" };
  }
  if (authorized === true) {
    return { allowed: true, needsConfirm: false, reason: "authorized outside read" };
  }
  return {
    allowed: false,
    needsConfirm: true,
    reason: "Local path outside workspace requires explicit user authorization",
  };
}

/**
 * Scan workspace root for category directories (physical truth).
 * @param {string} workspaceRoot
 * @returns {string[]} sorted directory names
 */
export function discoverCategoryDirs(workspaceRoot) {
  if (!workspaceRoot || !fsSync.existsSync(workspaceRoot)) return [];
  let entries;
  try {
    entries = fsSync.readdirSync(workspaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && CATEGORY_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
}

// ── Config load / migrate ─────────────────────────────────────────────────

/**
 * @param {string} workspaceRoot
 * @returns {object}
 */
export function loadWorkspaceConfig(workspaceRoot) {
  return loadContract(workspaceRoot);
}

/**
 * Normalize config to v4 contract shape (in-memory; does not write).
 * Adds flat convenience aliases alongside the v4 nested structure.
 * @param {object} raw
 * @returns {object}
 */
export function normalizeConfig(raw = {}) {
  const config = { ...raw };
  // Flat convenience aliases (consumed by resolveSlotAttributes etc.)
  if (config.categories?.extensions && !config.categoryExtensions) {
    config.categoryExtensions = config.categories.extensions;
  }
  if (config.categories?.overrides && !config.categoryOverrides) {
    config.categoryOverrides = config.categories.overrides;
  }
  if (config.workspace?.template && !config.template) {
    config.template = config.workspace.template;
  }
  if (config.workspace?.category_separator && !config.categorySeparator) {
    config.categorySeparator = config.workspace.category_separator;
  }
  if (config.workspace?.locale && !config.locale) {
    config.locale = config.workspace.locale;
  }

  config.contract_version = Number(config.contract_version) || 4;
  if (!config.categoryExtensions || typeof config.categoryExtensions !== "object") {
    config.categoryExtensions = {};
  }
  if (!config.categoryOverrides || typeof config.categoryOverrides !== "object") {
    config.categoryOverrides = {};
  }
  if (!config.template) config.template = DEFAULT_TEMPLATE;
  if (config.categorySeparator !== " " && config.categorySeparator !== "-") {
    config.categorySeparator = config.categorySeparator || "-";
    if (config.categorySeparator !== " " && config.categorySeparator !== "-") {
      config.categorySeparator = "-";
    }
  }
  // Stream packing + memory (v4 normalized for internal use)
  config.stream = normalizeStreamConfig(config.stream);
  config.memory = normalizeMemoryConfig(config.memory);
  if (!config.locale) config.locale = "zh-CN";
  return config;
}

/**
 * Persist full v4 contract to topmind.yaml. Returns absolute path written.
 * Reconstructs the complete v4 contract from config, preserving all sections.
 * @param {string} workspaceRoot
 * @param {object} config
 * @returns {string} absolute path to topmind.yaml
 */
export function saveWorkspaceConfig(workspaceRoot, config) {
  const normalized = normalizeConfig(config);
  const resolvedRoot = path.resolve(workspaceRoot);

  const ws = normalized.workspace || {};
  const cats = normalized.categories || {};
  const stream = normalized.stream || {};
  const mem = normalized.memory || {};
  const writeback = normalized.writeback || {};
  const ingest = normalized.ingest || {};
  const agent = normalized.agent || {};
  const presentation = normalized.presentation || {};
  const protection = normalized.protection || {};
  const lifecycle = normalized.lifecycle || {};

  // Build full v4 contract object
  const contract = {
    contract_version: normalized.contract_version || 4,
    workspace: {
      name: ws.name || "我的 topmind",
      locale: ws.locale || normalized.locale || "zh-CN",
      template: normalized.template || ws.template || "stream",
      category_separator: normalized.categorySeparator || ws.category_separator || "-",
    },
    categories: {
      extensions: normalized.categoryExtensions || cats.extensions || {},
      overrides: normalized.categoryOverrides || cats.overrides || {},
    },
    stream: {
      packing: stream.packing || "weekly",
      append_heading: stream.append_heading || stream.appendHeading || "day",
      year_dir: stream.yearDir !== undefined ? stream.yearDir : (stream.year_dir !== undefined ? stream.year_dir : true),
    },
    memory: {
      dir: mem.dir || "memory",
      layers: mem.layers || {
        global: { file: mem.profileFile || "profile.md", update: "on-suggest" },
        periodic: { dir: "periodic", cadence: "weekly", style: "brief" },
        topics: { dir: "topics", auto_create: false },
      },
      promotion: mem.promotion || { enabled: true, min_occurrences: 2, require_confirm: true },
    },
    protection: Object.keys(protection).length > 0
      ? protection
      : { defaults: { by_role: DEFAULT_PROTECTION_BY_ROLE } },
    lifecycle: Object.keys(lifecycle).length > 0
      ? lifecycle
      : {
          inbox: { review_after_days: 7 },
          catch_all: { retention_days: 30 },
          stream: { digest_after_periods: 4 },
          topic: { stale_after_days: 90, suggest_archive: true },
          output: { lock_after_days: 30 },
        },
    writeback: {
      mode: writeback.mode || "auto",
      shadow: writeback.shadow !== undefined ? writeback.shadow : true,
      backup_to: writeback.backup_to || "99-归档/backups",
      receipts: writeback.receipts || "99-归档/receipts",
    },
    ingest: Object.keys(ingest).length > 0
      ? ingest
      : { default_target: "stream", url: { renderer: "auto" } },
    agent: Object.keys(agent).length > 0
      ? agent
      : { skills_entry: "topmind", confirm_by_default: false },
    presentation: Object.keys(presentation).length > 0
      ? presentation
      : { views: { default: "stream", enabled: ["stream", "category", "timeline", "tags", "kanban"] } },
  };

  // Single contract writer: sanitize + stringify lives in writeContract.
  return writeContract(resolvedRoot, contract);
}

/**
 * Infer separator from existing dirs or config; default `-`.
 * @param {string[]} discovered
 * @param {object} config
 */
export function resolveSeparator(discovered, config = {}) {
  if (config.categorySeparator === " " || config.categorySeparator === "-") {
    return config.categorySeparator;
  }
  const hasHyphen = discovered.some((name) => name.charAt(2) === "-");
  const hasSpace = discovered.some((name) => name.charAt(2) === " ");
  if (hasHyphen || !hasSpace) return "-";
  return " ";
}

// ── Attribute merge ───────────────────────────────────────────────────────

/**
 * Resolve behavioral attributes for one slot.
 * Priority: categoryOverrides > categoryExtensions > template.categories > defaults
 *
 * @param {string} slot
 * @param {object} config — normalized
 * @param {object|null} template
 * @param {{ name?: string, fromFs?: boolean }} [fsMeta] — name from directory when present
 */
export function resolveSlotAttributes(slot, config, template, fsMeta = {}) {
  const tmplDef = template?.categories?.[slot] || null;
  const ext = config.categoryExtensions?.[slot] || null;
  const over = config.categoryOverrides?.[slot] || null;

  const name =
    (over && typeof over.name === "string" && over.name) ||
    (ext && typeof ext.name === "string" && ext.name) ||
    fsMeta.name ||
    tmplDef?.name ||
    slot;

  let role =
    (over && typeof over.role === "string" && over.role) ||
    (ext && typeof ext.role === "string" && ext.role) ||
    tmplDef?.role ||
    null;

  if (role && !VALID_ROLES.includes(role)) role = null;
  // Template missing: known slots keep canonical roles; other slots → deep-work
  if (!role) role = SLOT_ROLE_HEURISTICS[slot] || "deep-work";

  const specialBehavior =
    over?.specialBehavior ?? ext?.specialBehavior ?? tmplDef?.specialBehavior ?? undefined;
  const catchAll = over?.catchAll ?? ext?.catchAll ?? tmplDef?.catchAll ?? undefined;
  const referenceOnly =
    over?.referenceOnly ?? ext?.referenceOnly ?? tmplDef?.referenceOnly ?? undefined;
  const required = Boolean(tmplDef?.required);
  const retentionDays =
    over?.retentionDays ?? ext?.retentionDays ?? tmplDef?.retentionDays ?? undefined;
  const hidden = Boolean(over?.hidden);

  let source = "fs-only";
  if (over && (over.role || over.name || over.hidden != null)) source = "fs+override";
  else if (ext) source = "fs+config";
  else if (tmplDef) source = "fs+template";

  if (!fsMeta.name && !fsMeta.fromFs) {
    if (ext) source = "config-only";
    else if (tmplDef) source = "template-only";
  }

  return {
    slot,
    name,
    role,
    specialBehavior,
    catchAll: catchAll === true ? true : undefined,
    referenceOnly: referenceOnly === true ? true : undefined,
    required,
    retentionDays,
    hidden,
    source,
  };
}

// ── Model resolution ──────────────────────────────────────────────────────

/**
 * Build full workspace model from disk + config + template.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot] — required to load template from disk
 * @param {object} [options.config] — preloaded config
 * @param {object} [options.template] — preloaded template
 * @param {string} [options.locale]
 * @param {boolean} [options.includeMissingRequired=true]
 * @returns {{
 *   workspaceRoot: string,
 *   templateId: string,
 *   separator: string,
 *   config: object,
 *   stream: object,
 *   memory: object,
 *   categories: Array<object>,
 *   missingRequired: Array<object>,
 *   generatedAt: string,
 * }}
 */
export function resolveWorkspaceModel(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || "");
  const rawConfig = options.config || loadWorkspaceConfig(workspaceRoot);
  const config = normalizeConfig(rawConfig);
  const discovered = discoverCategoryDirs(workspaceRoot);
  const separator = resolveSeparator(discovered, config);

  let template = options.template || null;
  if (!template && options.engineRoot) {
    try {
      template = loadTemplate(options.engineRoot, config.template || DEFAULT_TEMPLATE, { locale: options.locale });
    } catch {
      template = null;
    }
  }

  const templateId = template?.templateId || config.template || DEFAULT_TEMPLATE;
  const bySlot = new Map();

  for (const dir of discovered) {
    const parsed = parseCategoryDirName(dir);
    if (!parsed) continue;
    const attrs = resolveSlotAttributes(parsed.slot, config, template, {
      name: parsed.name,
      fromFs: true,
    });
    // Prefer actual directory name on disk (separator + spelling)
    bySlot.set(parsed.slot, {
      ...attrs,
      name: parsed.name,
      directory: dir,
      path: path.join(workspaceRoot, dir),
      ok: true,
      separator: parsed.separator,
    });
  }

  // Extensions declared but not yet on disk
  for (const [slot, ext] of Object.entries(config.categoryExtensions || {})) {
    if (bySlot.has(slot)) continue;
    if (!/^\d{2}$/u.test(slot)) continue;
    const attrs = resolveSlotAttributes(slot, config, template, { name: ext.name });
    const dirName = `${slot}${separator}${attrs.name}`;
    bySlot.set(slot, {
      ...attrs,
      directory: dirName,
      path: path.join(workspaceRoot, dirName),
      ok: false,
      pendingCreate: true,
      separator,
      source: "config-only",
    });
  }

  const categories = Array.from(bySlot.values()).sort((a, b) =>
    a.directory.localeCompare(b.directory, "en"),
  );

  const missingRequired = [];
  if (options.includeMissingRequired !== false && template?.categories) {
    for (const [slot, def] of Object.entries(template.categories)) {
      if (!def.required) continue;
      const existing = bySlot.get(slot);
      if (existing?.ok) continue;
      // Also accept any on-disk category with same required role
      const roleCovered = categories.some((c) => c.ok && c.role === def.role);
      if (roleCovered) continue;
      const dirName = `${slot}${separator}${def.name}`;
      missingRequired.push({
        slot,
        name: def.name,
        role: def.role,
        directory: dirName,
        required: true,
      });
    }
  }

  // Merge template-level stream/memory defaults under config (config wins)
  const tmplStream = template?.stream ? normalizeStreamConfig(template.stream) : null;
  const tmplMemory = template?.memory ? normalizeMemoryConfig(template.memory) : null;
  if (tmplStream && rawConfig.stream == null) {
    config.stream = tmplStream;
  }
  if (tmplMemory && rawConfig.memory == null) {
    config.memory = tmplMemory;
  }

  return {
    workspaceRoot,
    templateId,
    separator,
    config,
    stream: config.stream || { ...DEFAULT_STREAM },
    memory: config.memory || { ...DEFAULT_MEMORY },
    categories,
    missingRequired,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "+00:00"),
  };
}

/**
 * @param {ReturnType<typeof resolveWorkspaceModel>} model
 * @param {string} role
 * @returns {object|null}
 */
export function findCategoryByRole(model, role) {
  const hit = model.categories.find((c) => c.ok && c.role === role && !c.hidden);
  return hit || model.categories.find((c) => c.ok && c.role === role) || null;
}

/**
 * Resolve absolute path for a system role directory.
 * Prefers existing FS match; else template/config expected name.
 *
 * @param {string} workspaceRoot
 * @param {string} role — buffer | delivery | system
 * @param {object} [options]
 * @param {string} [options.engineRoot]
 * @param {object} [options.config]
 * @param {object} [options.template]
 * @param {string} [options.fallbackHyphen]
 * @param {string} [options.fallbackSpace]
 */
export function resolveSystemRoot(workspaceRoot, role, options = {}) {
  const root = path.resolve(workspaceRoot);
  const model = resolveWorkspaceModel({
    workspaceRoot: root,
    engineRoot: options.engineRoot,
    config: options.config,
    template: options.template,
    includeMissingRequired: false,
  });
  const hit = findCategoryByRole(model, role);
  if (hit?.ok) return hit.path;

  // On-disk {NN-Name} even when template names are Chinese (00-Inbox, 00-Capture).
  try {
    const entries = fsSync.readdirSync(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const parsed = parseCategoryDirName(e.name);
      if (!parsed) continue;
      if (SLOT_ROLE_HEURISTICS[parsed.slot] === role) return path.join(root, e.name);
    }
  } catch {
    /* ignore */
  }

  const sep = model.separator;
  if (hit && !hit.ok) {
    return path.join(root, hit.directory);
  }

  // Template slot for role — only if that dir already exists
  const tmpl = options.template;
  if (tmpl?.categories) {
    for (const [slot, def] of Object.entries(tmpl.categories)) {
      if (def.role === role) {
        const dir = `${slot}${sep}${def.name}`;
        if (fsSync.existsSync(path.join(root, dir))) return path.join(root, dir);
        const space = `${slot} ${def.name}`;
        if (fsSync.existsSync(path.join(root, space))) return path.join(root, space);
      }
    }
  }

  const fallbacks = {
    buffer: ["00-收件箱", "00 收件箱", "00-Inbox", "00 Inbox"],
    delivery: ["88-输出", "88 输出", "88-Outputs", "88 Outputs"],
    system: ["99-归档", "99 归档", "99-Archive", "99 Archive"],
  };
  const names = fallbacks[role] || [];
  for (const n of names) {
    if (fsSync.existsSync(path.join(root, n))) return path.join(root, n);
  }
  if (options.fallbackHyphen && fsSync.existsSync(path.join(root, options.fallbackHyphen))) {
    return path.join(root, options.fallbackHyphen);
  }
  return path.join(root, options.fallbackHyphen || names[0] || `00${sep}收件箱`);
}

/**
 * Workspace-relative archive plane (`{systemDir}/backups` or `{systemDir}/receipts`).
 * Honors contract writeback.backup_to / receipts when that top-level dir exists;
 * otherwise uses the live system-role directory (00-Inbox / 99-Archive / renamed).
 *
 * @param {string} workspaceRoot
 * @param {object} [contract]
 * @param {"backups"|"receipts"} [leaf="backups"]
 * @returns {string} posix relative path
 */
export function resolveArchivePlaneRel(workspaceRoot, contract, leaf = "backups") {
  const want = leaf === "receipts" ? "receipts" : "backups";
  const configured =
    want === "receipts"
      ? contract?.writeback?.receipts
      : contract?.writeback?.backup_to;
  if (configured) {
    const top = String(configured).replace(/\\/g, "/").split("/")[0];
    if (top && fsSync.existsSync(path.join(workspaceRoot, top))) {
      return String(configured).replace(/\\/g, "/");
    }
  }
  try {
    const sysAbs = resolveSystemRoot(workspaceRoot, "system", { config: contract });
    const dirName = path.basename(sysAbs);
    if (dirName) return `${dirName}/${want}`;
  } catch {
    /* fall through */
  }
  return want === "receipts" ? "99-归档/receipts" : "99-归档/backups";
}
