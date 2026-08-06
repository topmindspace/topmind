// ── topmind Workspace Model (v4 / contract schema v4) ─────────────────────
// Facade + structural mutations. Resolution logic lives in focused modules:
//   model-core.mjs   — constants · parse/discover · config · resolveWorkspaceModel
//   model-topic.mjs  — create_topic placement gating
//   model-stream.mjs — stream category / period-note targets
//   model-memory.mjs — memory plane paths (我的情况)
// This file keeps the stable import surface (Desktop / UTR / Skills) and the
// category mutation operations (ensure / add / update / rename / map).

import fsSync from "node:fs";
import path from "node:path";
import { loadTemplate, DEFAULT_TEMPLATE } from "./template-loader.mjs";
import { executeWrite } from "./writeback-engine.mjs";
import {
  seedPeriodNoteBody,
  periodNoteTitle,
  periodFileStem,
  periodYearDir,
  normalizeStreamConfig,
  normalizeMemoryConfig,
  DEFAULT_STREAM,
  DEFAULT_MEMORY,
  reconcilePeriodBody,
  packingLabel,
  isoWeekKeyFromDate,
  seedCoreProfileMarkdown,
} from "./stream-period.mjs";
import {
  VALID_ROLES,
  REQUIRED_ROLES,
  CONFIG_NAME,
  parseCategoryDirName,
  discoverCategoryDirs,
  loadWorkspaceConfig,
  normalizeConfig,
  saveWorkspaceConfig,
  resolveSeparator,
  resolveSlotAttributes,
  resolveWorkspaceModel,
} from "./model-core.mjs";

// ── Re-exports (stable facade surface) ─────────────────────────────────────

export {
  PLANES,
  CATEGORY_PATTERN,
  VALID_ROLES,
  REQUIRED_ROLES,
  parseCategoryDirName,
  isValidCategoryName,
  isPathInsideWorkspace,
  discoverCategoryDirs,
  loadWorkspaceConfig,
  normalizeConfig,
  saveWorkspaceConfig,
  resolveSeparator,
  resolveSlotAttributes,
  resolveWorkspaceModel,
  findCategoryByRole,
  resolveSystemRoot,
} from "./model-core.mjs";

export {
  TOPIC_DISALLOWED_ROLES,
  isReservedTopicCategory,
  isDisallowedTopicCategoryRole,
  inferTopicDisallowedRoleFromCategoryName,
  resolveCategoryRoleForTopic,
  sanitizeTopicPlacement,
  sanitizeCategorySegment,
} from "./model-topic.mjs";

export {
  findStreamCategory,
  resolveStreamTarget,
  shouldAppendToPeriodNote,
  listStreamPeriods,
} from "./model-stream.mjs";

export { resolveMemoryPaths, ensureCoreProfile } from "./model-memory.mjs";

export {
  seedPeriodNoteBody,
  periodNoteTitle,
  periodFileStem,
  periodYearDir,
  normalizeStreamConfig,
  normalizeMemoryConfig,
  DEFAULT_STREAM,
  DEFAULT_MEMORY,
  reconcilePeriodBody,
  packingLabel,
  isoWeekKeyFromDate,
  seedCoreProfileMarkdown,
};

export { DEFAULT_TEMPLATE, CONFIG_NAME };
export { TEMPLATE_LOCALES } from "./template-loader.mjs";

// ── Structural mutations ───────────────────────────────────────────────────

/**
 * Ensure required role directories exist. Does NOT recreate optional template slots
 * the user deleted. Optionally materializes pending categoryExtensions.
 *
 * @param {string} workspaceRoot
 * @param {object} [options]
 * @param {string} [options.engineRoot]
 * @param {string} [options.templateId]
 * @param {string} [options.locale]
 * @param {boolean} [options.materializeExtensions=false]
 * @returns {{ created: string[], model: object }}
 */
export function ensureRequiredStructure(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  fsSync.mkdirSync(root, { recursive: true });

  let config = normalizeConfig(loadWorkspaceConfig(root));
  if (options.templateId) config.template = options.templateId;

  let template = null;
  if (options.engineRoot) {
    try {
      template = loadTemplate(options.engineRoot, config.template || DEFAULT_TEMPLATE, { locale: options.locale });
    } catch {
      template = null;
    }
  }

  const discovered = discoverCategoryDirs(root);
  const separator = resolveSeparator(discovered, config);
  config.categorySeparator = separator;

  const created = [];
  const rolesPresent = new Set();
  for (const dir of discovered) {
    const parsed = parseCategoryDirName(dir);
    if (!parsed) continue;
    const attrs = resolveSlotAttributes(parsed.slot, config, template, {
      name: parsed.name,
      fromFs: true,
    });
    rolesPresent.add(attrs.role);
  }

  const ensureDir = (dirName) => {
    const abs = path.join(root, dirName);
    if (!fsSync.existsSync(abs)) {
      fsSync.mkdirSync(abs, { recursive: true });
      created.push(dirName);
    }
  };

  // Required roles from template, or hard fallbacks — never recreate optional slots
  if (template?.categories) {
    for (const [slot, def] of Object.entries(template.categories)) {
      const must = def.required === true || REQUIRED_ROLES.includes(def.role);
      if (!must) continue;
      if (rolesPresent.has(def.role)) continue;
      const dirName = `${slot}${separator}${def.name}`;
      ensureDir(dirName);
      rolesPresent.add(def.role);
    }
  } else {
    // Locale-aware fallback when no template is available
    const localeNames = {
      "zh-CN": { buffer: "收件箱", delivery: "输出", system: "归档" },
      "en-US": { buffer: "Inbox", delivery: "Outputs", system: "Archive" },
    };
    const ln = localeNames[config.locale] || localeNames["zh-CN"];
    for (const [role, dirName] of [
      ["buffer", `00${separator}${ln.buffer}`],
      ["delivery", `88${separator}${ln.delivery}`],
      ["system", `99${separator}${ln.system}`],
    ]) {
      if (rolesPresent.has(role)) continue;
      ensureDir(dirName);
      rolesPresent.add(role);
    }
  }

  if (options.materializeExtensions) {
    for (const [slot, ext] of Object.entries(config.categoryExtensions || {})) {
      if (!/^\d{2}$/u.test(slot) || !ext?.name) continue;
      const dirName = `${slot}${separator}${ext.name}`;
      ensureDir(dirName);
    }
  }

  // Seed topmind.yaml if missing or needs v4 upgrade
  const configPath = path.join(root, CONFIG_NAME);
  const hadConfig = fsSync.existsSync(configPath);
  if (!hadConfig) {
    // First-time init: write full v4 contract
    const prev = loadWorkspaceConfig(root);
    const merged = normalizeConfig({
      ...prev,
      ...config,
      template: config.template || DEFAULT_TEMPLATE,
      categorySeparator: separator,
    });
    saveWorkspaceConfig(root, merged);
    config = merged;
  }

  const model = resolveWorkspaceModel({
    workspaceRoot: root,
    engineRoot: options.engineRoot,
    config,
    template,
  });
  return { created, model };
}

/**
 * Create a new first-level category: mkdir + categoryExtensions.
 *
 * @param {string} workspaceRoot
 * @param {{ slot: string, name: string, role?: string, specialBehavior?: string, catchAll?: boolean, referenceOnly?: boolean, retentionDays?: number, engineRoot?: string }} spec
 * @returns {{ directory: string, category: object, configPath: string }}
 */
export function addCategory(workspaceRoot, spec) {
  const root = path.resolve(workspaceRoot);
  const slot = String(spec.slot || "").padStart(2, "0").slice(0, 2);
  if (!/^\d{2}$/u.test(slot)) {
    throw new Error(`Invalid category slot: ${spec.slot} (expected two digits 00-99)`);
  }
  const name = String(spec.name || "").trim();
  if (!name) throw new Error("Category name required.");
  if (/[/\\]/.test(name)) throw new Error("Category name must not contain path separators.");

  const role = spec.role || "deep-work";
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}. Expected one of ${VALID_ROLES.join(", ")}`);
  }

  const config = normalizeConfig(loadWorkspaceConfig(root));
  const discovered = discoverCategoryDirs(root);
  const separator = resolveSeparator(discovered, config);
  config.categorySeparator = separator;

  // Collision: same slot or same directory name
  for (const dir of discovered) {
    const p = parseCategoryDirName(dir);
    if (p?.slot === slot) {
      throw new Error(`Slot ${slot} already exists as ${dir}`);
    }
  }
  const directory = `${slot}${separator}${name}`;
  if (discovered.includes(directory)) {
    throw new Error(`Directory already exists: ${directory}`);
  }

  const ext = {
    name,
    role,
  };
  if (spec.specialBehavior) ext.specialBehavior = spec.specialBehavior;
  if (spec.catchAll === true) ext.catchAll = true;
  if (spec.referenceOnly === true) ext.referenceOnly = true;
  if (typeof spec.retentionDays === "number") ext.retentionDays = spec.retentionDays;

  config.categoryExtensions[slot] = {
    ...(config.categoryExtensions[slot] || {}),
    ...ext,
  };
  if (!config.categories || typeof config.categories !== "object") config.categories = {};
  config.categories[slot] = name;

  fsSync.mkdirSync(path.join(root, directory), { recursive: true });
  const configPath = saveWorkspaceConfig(root, config);

  const model = resolveWorkspaceModel({
    workspaceRoot: root,
    engineRoot: spec.engineRoot,
    config,
  });
  const category = model.categories.find((c) => c.slot === slot);

  return { directory, category, configPath };
}

/**
 * Update role/behavior for an existing slot (config override or extension). Does not rename dir.
 *
 * @param {string} workspaceRoot
 * @param {string} slot
 * @param {{ role?: string, specialBehavior?: string|null, catchAll?: boolean, referenceOnly?: boolean, hidden?: boolean, name?: string, engineRoot?: string }} patch
 */
export function updateCategoryAttributes(workspaceRoot, slot, patch = {}) {
  const root = path.resolve(workspaceRoot);
  const slotKey = String(slot).padStart(2, "0").slice(0, 2);
  if (!/^\d{2}$/u.test(slotKey)) throw new Error(`Invalid slot: ${slot}`);

  const config = normalizeConfig(loadWorkspaceConfig(root));
  const discovered = discoverCategoryDirs(root);
  const onDisk = discovered.find((d) => parseCategoryDirName(d)?.slot === slotKey);
  const hasExtension = Boolean(config.categoryExtensions[slotKey]);

  if (patch.role && !VALID_ROLES.includes(patch.role)) {
    throw new Error(`Invalid role: ${patch.role}`);
  }

  // Behavior owned by extensions (user-created) or overrides (template/FS tweaks)
  const useExtension =
    hasExtension ||
    (onDisk &&
      !hasExtension &&
      (() => {
        const modelProbe = resolveWorkspaceModel({ workspaceRoot: root, config });
        const cat = modelProbe.categories.find((c) => c.slot === slotKey);
        return cat?.source === "fs-only" && patch.role !== undefined;
      })());

  if (useExtension && onDisk && !hasExtension && patch.role) {
    const parsed = parseCategoryDirName(onDisk);
    config.categoryExtensions[slotKey] = {
      name: parsed.name,
      role: patch.role,
    };
  }

  const targetKey = useExtension || hasExtension ? "categoryExtensions" : "categoryOverrides";
  const prev = { ...(config[targetKey][slotKey] || {}) };

  if (patch.role !== undefined) prev.role = patch.role;
  if (patch.specialBehavior !== undefined) {
    if (patch.specialBehavior === null || patch.specialBehavior === "") delete prev.specialBehavior;
    else prev.specialBehavior = patch.specialBehavior;
  }
  if (patch.catchAll !== undefined) {
    if (patch.catchAll) prev.catchAll = true;
    else delete prev.catchAll;
  }
  if (patch.referenceOnly !== undefined) {
    if (patch.referenceOnly) prev.referenceOnly = true;
    else delete prev.referenceOnly;
  }
  // hidden always lives on overrides so template slots stay hide-able without claiming extension
  if (patch.hidden !== undefined) {
    const over = { ...(config.categoryOverrides[slotKey] || {}) };
    if (patch.hidden) over.hidden = true;
    else delete over.hidden;
    if (Object.keys(over).length === 0) delete config.categoryOverrides[slotKey];
    else config.categoryOverrides[slotKey] = over;
  }
  if (patch.name !== undefined && typeof patch.name === "string" && patch.name.trim()) {
    prev.name = patch.name.trim();
  }

  // Persist non-hidden attrs on chosen target (skip empty after only-hidden patch)
  const persist = { ...prev };
  // If we only touched hidden via overrides, still may need to write extension empty skip
  if (Object.keys(persist).length > 0) {
    config[targetKey][slotKey] = persist;
  }

  const configPath = saveWorkspaceConfig(root, config);
  const model = resolveWorkspaceModel({
    workspaceRoot: root,
    engineRoot: patch.engineRoot,
    config,
  });
  return {
    configPath,
    category: model.categories.find((c) => c.slot === slotKey) || null,
    model,
  };
}

/**
 * Rename a category directory (name part only; slot stays).
 * Updates config display/extensions and rewrites frontmatter `category` under that tree.
 * Does not rewrite wiki-links or cross-file content (規约 6: migration is explicit).
 *
 * @param {string} workspaceRoot
 * @param {{ slot: string, newName: string, engineRoot?: string, updateFrontmatter?: boolean }} spec
 * @returns {{ from: string, to: string, frontmatterUpdated: number, category: object|null, configPath: string }}
 */
export function renameCategory(workspaceRoot, spec) {
  const root = path.resolve(workspaceRoot);
  const slotKey = String(spec.slot || "").padStart(2, "0").slice(0, 2);
  if (!/^\d{2}$/u.test(slotKey)) throw new Error(`Invalid slot: ${spec.slot}`);
  const newName = String(spec.newName || "").trim();
  if (!newName) throw new Error("newName required.");
  if (/[/\\]/.test(newName)) throw new Error("Category name must not contain path separators.");

  const config = normalizeConfig(loadWorkspaceConfig(root));
  const discovered = discoverCategoryDirs(root);
  const onDisk = discovered.find((d) => parseCategoryDirName(d)?.slot === slotKey);
  if (!onDisk) throw new Error(`No category directory for slot ${slotKey}`);

  const parsed = parseCategoryDirName(onDisk);
  if (!parsed) throw new Error(`Invalid category directory: ${onDisk}`);
  if (parsed.name === newName) {
    const model = resolveWorkspaceModel({ workspaceRoot: root, engineRoot: spec.engineRoot, config });
    return {
      from: onDisk,
      to: onDisk,
      frontmatterUpdated: 0,
      category: model.categories.find((c) => c.slot === slotKey) || null,
      configPath: path.join(root, CONFIG_NAME),
      unchanged: true,
    };
  }

  const separator = parsed.separator || resolveSeparator(discovered, config);
  const toDir = `${slotKey}${separator}${newName}`;
  if (discovered.includes(toDir)) {
    throw new Error(`Target directory already exists: ${toDir}`);
  }

  const fromAbs = path.join(root, onDisk);
  const toAbs = path.join(root, toDir);
  fsSync.renameSync(fromAbs, toAbs);

  // Config bookkeeping
  if (!config.categories || typeof config.categories !== "object") config.categories = {};
  config.categories[slotKey] = newName;
  if (config.categoryExtensions[slotKey]) {
    config.categoryExtensions[slotKey] = {
      ...config.categoryExtensions[slotKey],
      name: newName,
    };
  }
  if (config.categoryOverrides[slotKey]?.name) {
    config.categoryOverrides[slotKey] = {
      ...config.categoryOverrides[slotKey],
      name: newName,
    };
  }
  // Remap connectorDefaults if they pointed at old directory name
  const connectors = config.connectorDefaults || {};
  for (const key of Object.keys(connectors)) {
    const entry = connectors[key];
    if (entry && typeof entry === "object" && entry.syncCategory === onDisk) {
      entry.syncCategory = toDir;
    }
  }
  config.connectorDefaults = connectors;

  const configPath = saveWorkspaceConfig(root, config);

  let frontmatterUpdated = 0;
  if (spec.updateFrontmatter !== false) {
    frontmatterUpdated = rewriteCategoryFrontmatter(toAbs, onDisk, toDir, root);
  }

  const model = resolveWorkspaceModel({
    workspaceRoot: root,
    engineRoot: spec.engineRoot,
    config,
  });

  return {
    from: onDisk,
    to: toDir,
    frontmatterUpdated,
    category: model.categories.find((c) => c.slot === slotKey) || null,
    configPath,
  };
}

/**
 * Walk markdown under categoryDir; set frontmatter category from→to when it matches.
 * Minimal YAML-aware: only rewrites `category: <from>` lines (quoted or bare).
 * Durable .md bodies go through writeback-engine (no raw writeFileSync).
 * @param {string} categoryDir
 * @param {string} fromName
 * @param {string} toName
 * @param {string} workspaceRoot
 * @returns {number} files updated
 */
function rewriteCategoryFrontmatter(categoryDir, fromName, toName, workspaceRoot) {
  if (!workspaceRoot) {
    throw new Error("rewriteCategoryFrontmatter requires workspaceRoot for write-gate");
  }
  let updated = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!e.isFile() || !/\.md$/iu.test(e.name)) continue;
      let text;
      try {
        text = fsSync.readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      if (!text.startsWith("---")) continue;
      const end = text.indexOf("\n---", 3);
      if (end === -1) continue;
      const fmBlock = text.slice(0, end + 4);
      const body = text.slice(end + 4);
      const escaped = fromName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const re = new RegExp(
        `^(category:\\s*)(["']?)${escaped}\\2\\s*$`,
        "mu",
      );
      if (!re.test(fmBlock)) continue;
      const nextFm = fmBlock.replace(re, `$1$2${toName}$2`);
      if (nextFm === fmBlock) continue;
      executeWrite({
        targetPath: abs,
        content: nextFm + body,
        workspaceRoot,
        operation: "update",
        actor: "user",
        confirmed: true,
        skipBackup: true,
        skipReceipt: true,
      });
      updated += 1;
    }
  };
  walk(categoryDir);
  return updated;
}

/**
 * Write a disposable derived workspace map (NOT content truth).
 * Path: `{workspace}/.topmind/workspace-map.json` — rebuild anytime.
 * v4: derived follows categories (.derived/ subdirs), NOT .topmind/derived/
 *
 * @param {string} workspaceRoot
 * @param {object} [options]
 * @param {string} [options.engineRoot]
 * @returns {{ path: string, model: object }}
 */
export function writeWorkspaceMap(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  const model = resolveWorkspaceModel({
    workspaceRoot: root,
    engineRoot: options.engineRoot,
  });
  const dir = path.join(root, ".topmind");
  fsSync.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "workspace-map.json");
  const payload = {
    contract_version: 4,
    derived: true,
    note: "Rebuilt from FS + topmind.yaml. Not content truth — safe to delete.",
    generatedAt: model.generatedAt,
    templateId: model.templateId,
    separator: model.separator,
    categories: model.categories.map((c) => ({
      slot: c.slot,
      directory: c.directory,
      role: c.role,
      specialBehavior: c.specialBehavior,
      hidden: c.hidden || false,
      source: c.source,
      ok: c.ok,
    })),
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  fsSync.writeFileSync(outPath, content, "utf-8");
  // Normalize to forward slashes for cross-platform consistency
  return { path: outPath.replace(/\\/g, "/"), model };
}

/**
 * Suggest next free slot in a band (e.g. start 11 for lifestyle).
 * @param {string[]} occupiedSlots
 * @param {number} [start=10]
 * @param {number} [end=87]
 */
export function suggestNextSlot(occupiedSlots, start = 10, end = 87) {
  const used = new Set(occupiedSlots.map((s) => String(s).padStart(2, "0")));
  for (let n = start; n <= end; n += 1) {
    const slot = String(n).padStart(2, "0");
    if (!used.has(slot)) return slot;
  }
  for (let n = 1; n <= 99; n += 1) {
    const slot = String(n).padStart(2, "0");
    if (["00", "88", "99"].includes(slot)) continue;
    if (!used.has(slot)) return slot;
  }
  throw new Error("No free category slots (00-99).");
}

/**
 * Directory names only (compat with older discoverCategories).
 * Falls back to template required+default slots when workspace empty but looks like a workspace.
 */
export function discoverCategories(workspaceRoot, engineRoot, locale) {
  const discovered = discoverCategoryDirs(workspaceRoot);
  if (discovered.length > 0) return discovered;
  if (!workspaceRoot || !fsSync.existsSync(workspaceRoot)) return [];
  const hasConfig = fsSync.existsSync(path.join(workspaceRoot, CONFIG_NAME));
  const isNamedWorkspace = /topmind-workspace$/u.test(workspaceRoot);
  if (!(hasConfig || isNamedWorkspace) || !engineRoot) return [];
  let config = null;
  try {
    config = normalizeConfig(loadWorkspaceConfig(workspaceRoot));
    const template = loadTemplate(engineRoot, config.template || DEFAULT_TEMPLATE, { locale });
    const sep = config.categorySeparator || template.separator || "-";
    return Object.entries(template.categories)
      .map(([slot, def]) => `${slot}${sep}${def.name}`)
      .sort();
  } catch {
    const fallback = config?.locale === "en-US"
      ? ["00-Inbox", "88-Outputs", "99-Archive"]
      : ["00-收件箱", "88-输出", "99-归档"];
    return fallback;
  }
}
