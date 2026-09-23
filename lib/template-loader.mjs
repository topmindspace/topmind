// ── topmind Template Loader (v4.x) ────────────────────────────────────────
// Shared by UTR and Desktop. Loads category templates from engine root.
// Template JSON files live in {engineRoot}/templates/*.json

import fsSync from "node:fs";
import path from "node:path";

/** Default onboarding template: stream profile. */
const DEFAULT_TEMPLATE = "stream";

/** Legacy template ID alias fallback mapping to v4 4-profile system. */
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

/**
 * Resolve the templates directory path from the engine root.
 * @param {string} engineRoot — absolute path to topmind/ engine root
 * @returns {string} absolute path to templates/ directory
 */
export function templatesDir(engineRoot) {
  return path.join(engineRoot, "templates");
}

/**
 * Deep-merge a locale overlay onto a base template.
 * Only localizable fields are merged: name, description, category names,
 * memory.profileFile, and connectorHints.nameKeywords.
 * Structural fields (roles, slots, behaviors) are never overridden.
 *
 * @param {object} base — full template
 * @param {object} overlay — locale overlay (partial)
 * @returns {object} merged template
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
 * Load a single template by ID, optionally with a locale overlay.
 * @param {string} engineRoot
 * @param {string} templateId — e.g. "stream" | "balanced" | "research" | "periodic" (legacy aliases: "simple"/"minimal"→stream, "knowledge-management"→balanced, "academic"→research, "project"/"gtd"→periodic)
 * @param {object} [options]
 * @param {string} [options.locale] — e.g. "en-US"; if an overlay file exists, localized fields are merged
 * @returns {object} template object
 * @throws {Error} if template not found or invalid
 */
export function loadTemplate(engineRoot, templateId, options = {}) {
  const requested = templateId || DEFAULT_TEMPLATE;
  const resolvedId = TEMPLATE_ALIASES[requested] || requested;
  const filePath = path.join(templatesDir(engineRoot), `${resolvedId}.json`);
  if (!fsSync.existsSync(filePath)) {
    if (resolvedId === DEFAULT_TEMPLATE) {
      throw new Error(`Default template missing: ${filePath}`);
    }
    return loadTemplate(engineRoot, DEFAULT_TEMPLATE, options);
  }
  const raw = fsSync.readFileSync(filePath, "utf-8");
  const template = JSON.parse(raw);
  if (!template.templateId || !template.categories) {
    throw new Error(`Invalid template at ${filePath}: missing templateId or categories`);
  }
  // Apply locale overlay if requested and available
  const locale = options.locale;
  if (locale && TEMPLATE_LOCALES.includes(locale)) {
    const overlayPath = path.join(templatesDir(engineRoot), `${resolvedId}.${locale}.json`);
    if (fsSync.existsSync(overlayPath)) {
      try {
        const overlay = JSON.parse(fsSync.readFileSync(overlayPath, "utf-8"));
        return applyTemplateOverlay(template, overlay);
      } catch {
        // Overlay parse error → fall back to base template
      }
    }
  }
  return template;
}

/**
 * List all available template IDs.
 * @param {string} engineRoot
 * @returns {string[]} sorted template IDs
 */
export function listTemplateIds(engineRoot) {
  const dir = templatesDir(engineRoot);
  if (!fsSync.existsSync(dir)) return [DEFAULT_TEMPLATE];
  const files = fsSync.readdirSync(dir);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
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
 * List all template descriptors (id + name + description) for UI display.
 * @param {string} engineRoot
 * @param {object} [options]
 * @param {string} [options.locale] — when provided, returns localized name/description
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function listTemplateDescriptors(engineRoot, options = {}) {
  const ids = listTemplateIds(engineRoot);
  return ids
    .map((id) => {
      try {
        const t = loadTemplate(engineRoot, id, options);
        return { id: t.templateId, name: t.name, description: t.description };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Build the resolved category map for a given template.
 * Returns a Map of categoryDir → { slot, name, role, ... } entries.
 *
 * @param {string} engineRoot
 * @param {string} templateId
 * @param {string} [separator] — override template separator, default "-"
 * @returns {Map<string, object>} keyed by resolved directory name like "00-Inbox"
 */
export function resolveCategoryMap(engineRoot, templateId, separator = "-") {
  const template = loadTemplate(engineRoot, templateId);
  const sep = separator || template.separator || "-";
  const map = new Map();
  for (const [slot, def] of Object.entries(template.categories)) {
    const dirName = `${slot}${sep}${def.name}`;
    map.set(dirName, { slot, ...def });
    // Also register the space-variant alias for discovery
    const spaceName = `${slot} ${def.name}`;
    if (spaceName !== dirName) {
      map.set(spaceName, { slot, ...def, _alias: true });
    }
  }
  return map;
}

/**
 * Find categories by role in a template.
 *
 * @param {string} engineRoot
 * @param {string} templateId
 * @param {string} role — "buffer" | "loose-stream" | "deep-work" | "fallback" | "reference" | "delivery" | "system"
 * @param {string} [separator] — override template separator (workspace `topmind.yaml` wins)
 * @returns {Array<{slot: string, dirName: string, def: object}>}
 */
export function findCategoriesByRole(engineRoot, templateId, role, separator) {
  const template = loadTemplate(engineRoot, templateId);
  const sep = separator || template.separator || "-";
  const results = [];
  for (const [slot, def] of Object.entries(template.categories)) {
    if (def.role === role) {
      results.push({ slot, dirName: `${slot}${sep}${def.name}`, def });
    }
  }
  return results;
}

/**
 * Resolve the best-fit sync category for a connector, using template hints.
 * Strategy: preferSlot → preferRole + nameKeywords → first deep-work → first loose-stream → buffer
 *
 * Always uses the provided workspace separator so `30-阅读` vs `30 阅读` stays consistent.
 *
 * @param {string} engineRoot
 * @param {string} templateId
 * @param {string} connectorType — "weread" | "x"
 * @param {string} [separator] — default from template, usually "-"
 * @param {object} [options]
 * @param {string} [options.locale] — locale overlay for nameKeywords matching
 * @returns {string} resolved category directory name (e.g., "30-Reading")
 */
export function resolveConnectorCategory(engineRoot, templateId, connectorType, separator = "-", options = {}) {
  const template = loadTemplate(engineRoot, templateId, options);
  const hints = (template.connectorHints && template.connectorHints[connectorType]) || {};
  const sep = separator || template.separator || "-";

  // 1. Try the preferred slot if it exists in the template
  if (hints.preferSlot && template.categories[hints.preferSlot]) {
    const def = template.categories[hints.preferSlot];
    return `${hints.preferSlot}${sep}${def.name}`;
  }

  // 2. Try keyword matching against preferred role
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

  // 3. Fallback: first deep-work, then loose-stream, then buffer
  for (const role of ["deep-work", "loose-stream", "buffer"]) {
    const cats = findCategoriesByRole(engineRoot, templateId, role, sep);
    if (cats.length > 0) return cats[0].dirName;
  }

  // 4. Absolute fallback: first non-system category
  const firstUserCat = Object.entries(template.categories).find(
    ([, def]) => def.role !== "system" && def.role !== "delivery"
  );
  if (firstUserCat) {
    return `${firstUserCat[0]}${sep}${firstUserCat[1].name}`;
  }

  // Use locale-aware buffer category name from template if available
  const bufferCat = Object.entries(template.categories || {}).find(([, def]) => def.role === "buffer");
  const bufferName = bufferCat ? bufferCat[1].name : "Inbox";
  return `00${sep}${bufferName}`;
}

export { DEFAULT_TEMPLATE, TEMPLATE_LOCALES };
