/**
 * Desktop template API — always loads from the resolved engine root.
 *
 * Do NOT static-import monorepo `../../lib/template-loader.mjs` from electron/:
 * that path only exists in dev checkout and is missing from packaged app.asar
 * (Windows/mac/Linux installers crash at main-process load with ERR_MODULE_NOT_FOUND).
 *
 * Engine layouts:
 * - Dev: monorepo root (…/topmind) with templates/ + lib/
 * - Packaged: process.resourcesPath/topmind-engine/ with templates/ + lib/
 *
 * Logic mirrors root lib/template-loader.mjs but uses loadTemplateJson so
 * ENGINE_ROOT / setEngineRoot stays the single resolution path.
 */
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { loadTemplateJson, getEngineRoot } from "./workspace-home.mjs";
import { defaultEngineCandidate } from "./engine-root.mjs";

const DEFAULT_TEMPLATE = "stream";

const TEMPLATE_ALIASES = {
  simple: "stream",
  minimal: "stream",
  "knowledge-management": "balanced",
  academic: "research",
  project: "periodic",
  gtd: "periodic",
};

/** Supported template locale overlay suffixes. */
const TEMPLATE_LOCALES = ["en-US"];

function engineOf(engineRoot) {
  return path.resolve(engineRoot || getEngineRoot() || defaultEngineCandidate());
}

/**
 * Deep-merge a locale overlay onto a base template.
 * Only localizable fields are merged: name, description, category names,
 * memory.profileFile, and connectorHints.nameKeywords.
 */
function applyTemplateOverlay(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base };
  if (typeof overlay.name === "string") merged.name = overlay.name;
  if (typeof overlay.description === "string") merged.description = overlay.description;
  if (overlay.categories && typeof overlay.categories === "object") {
    merged.categories = {};
    for (const [slot, def] of Object.entries(base.categories || {})) {
      const ov = overlay.categories[slot];
      merged.categories[slot] = {
        ...def,
        ...(ov && typeof ov.name === "string" ? { name: ov.name } : {}),
      };
    }
  }
  if (overlay.memory && typeof overlay.memory === "object") {
    merged.memory = { ...base.memory };
    if (typeof overlay.memory.profileFile === "string") {
      merged.memory.profileFile = overlay.memory.profileFile;
    }
  }
  if (overlay.connectorHints && typeof overlay.connectorHints === "object") {
    merged.connectorHints = {};
    for (const [key, hint] of Object.entries(base.connectorHints || {})) {
      const ov = overlay.connectorHints[key];
      merged.connectorHints[key] = {
        ...hint,
        ...(ov && Array.isArray(ov.nameKeywords) ? { nameKeywords: ov.nameKeywords } : {}),
      };
    }
  }
  return merged;
}

/**
 * @param {string} [engineRoot]
 * @param {string} [templateId]
 * @param {object} [options]
 * @param {string} [options.locale] — e.g. "en-US"; if overlay exists, localized fields are merged
 * @returns {object|null}
 */
export function loadTemplate(engineRoot, templateId, options = {}) {
  const root = engineOf(engineRoot);
  const requested = templateId || DEFAULT_TEMPLATE;
  const id = TEMPLATE_ALIASES[requested] || requested;
  const t = loadTemplateJson(id, root);
  if (!t) {
    if (id === DEFAULT_TEMPLATE) {
      throw new Error(
        `Default template missing under engine: ${path.join(root, "templates", `${DEFAULT_TEMPLATE}.json`)}`,
      );
    }
    return loadTemplate(root, DEFAULT_TEMPLATE, options);
  }
  // Apply locale overlay if requested and available
  const locale = options.locale;
  if (locale && TEMPLATE_LOCALES.includes(locale)) {
    const overlay = loadTemplateJson(`${id}.${locale}`, root);
    if (overlay) return applyTemplateOverlay(t, overlay);
  }
  return t;
}

/**
 * @param {string} [engineRoot]
 * @returns {string[]}
 */
export function listTemplateIds(engineRoot) {
  const root = engineOf(engineRoot);
  const dir = path.join(root, "templates");
  if (!existsSync(dir)) return [DEFAULT_TEMPLATE];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/u, ""))
    .filter((id) => {
      // Exclude locale overlay files (e.g. "simple.en-US")
      for (const loc of TEMPLATE_LOCALES) {
        if (id.endsWith(`.${loc}`)) return false;
      }
      return true;
    })
    .sort();
}

/**
 * @param {string} [engineRoot]
 * @param {object} [options]
 * @param {string} [options.locale] — when provided, returns localized name/description
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function listTemplateDescriptors(engineRoot, options = {}) {
  const root = engineOf(engineRoot);
  return listTemplateIds(root)
    .map((id) => {
      try {
        const t = loadTemplate(root, id, options);
        return {
          id: t.templateId || id,
          name: t.name || id,
          description: t.description || "",
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * @param {string} engineRoot
 * @param {string} templateId
 * @param {string} role
 * @param {string} [separator]
 * @returns {Array<{slot: string, dirName: string, def: object}>}
 */
export function findCategoriesByRole(engineRoot, templateId, role, separator) {
  const template = loadTemplate(engineRoot, templateId);
  const sep = separator || template.separator || "-";
  const results = [];
  for (const [slot, def] of Object.entries(template.categories || {})) {
    if (def.role === role) {
      results.push({ slot, dirName: `${slot}${sep}${def.name}`, def });
    }
  }
  return results;
}

/**
 * Resolve best-fit sync category for a connector via template connectorHints.
 * @param {string} engineRoot
 * @param {string} templateId
 * @param {string} connectorType — "weread" | "x"
 * @param {string} [separator]
 * @param {object} [options]
 * @param {string} [options.locale] — locale overlay for nameKeywords matching
 * @returns {string}
 */
export function resolveConnectorCategory(engineRoot, templateId, connectorType, separator = "-", options = {}) {
  const template = loadTemplate(engineRoot, templateId, options);
  const hints = (template.connectorHints && template.connectorHints[connectorType]) || {};
  const sep = separator || template.separator || "-";

  if (hints.preferSlot && template.categories?.[hints.preferSlot]) {
    const def = template.categories[hints.preferSlot];
    return `${hints.preferSlot}${sep}${def.name}`;
  }

  const keywords = hints.nameKeywords || [];
  if (hints.preferRole) {
    const byRole = findCategoriesByRole(engineRoot, templateId, hints.preferRole, sep);
    for (const cat of byRole) {
      if (keywords.some((kw) => cat.def.name.includes(kw))) {
        return cat.dirName;
      }
    }
    if (byRole.length > 0) return byRole[0].dirName;
  }

  for (const role of ["deep-work", "loose-stream", "buffer"]) {
    const cats = findCategoriesByRole(engineRoot, templateId, role, sep);
    if (cats.length > 0) return cats[0].dirName;
  }

  const firstUserCat = Object.entries(template.categories || {}).find(
    ([, def]) => def.role !== "system" && def.role !== "delivery",
  );
  if (firstUserCat) {
    return `${firstUserCat[0]}${sep}${firstUserCat[1].name}`;
  }

  // Use locale-aware buffer category name from template if available
  const bufferCat = Object.entries(template.categories || {}).find(([, def]) => def.role === "buffer");
  const bufferName = bufferCat ? bufferCat[1].name : "Inbox";
  return `00${sep}${bufferName}`;
}

export { DEFAULT_TEMPLATE };
