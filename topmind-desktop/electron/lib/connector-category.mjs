/**
 * Shared connector → category resolution.
 *
 * Truth order:
 * 1. Explicit preference that exists on disk (exact name)
 * 2. Explicit preference remapped by slot (30 阅读 ↔ 30-阅读) using workspace separator
 * 3. `auto` / empty → template connectorHints + FS discovery
 * 4. Synthesize dir name from template (caller may mkdir)
 *
 * Never hardcode space-only names like "30 阅读" — always honor
 * `topmind.yaml` `workspace.category_separator` and live category dirs.
 */
import path from "node:path";
import { resolveDataRoot, CATEGORY_PATTERN, engineRootOf } from "./path-model.mjs";
import { loadWorkspaceConfigSync } from "./workspace-home.mjs";
import { listDir, exists } from "./fs-utils.mjs";
// Packaged Desktop: never import monorepo ../../lib — use engine-root template API.
import { resolveConnectorCategory } from "./template-api.mjs";

const CONNECTOR_FALLBACK = {
  weread: { slot: "30", name: "阅读", keywords: /阅读|读书|read/i },
  x: { slot: "60", name: "参考资料", keywords: /参考|资料|reference|social|素材/i },
};

/**
 * Pure: pick best category name from existing dirs + preference + separator.
 * Used by tests without FS.
 *
 * @param {string[]} categories — live dir names matching NN-Name / NN Name
 * @param {object} opts
 * @param {string} [opts.preferred] — "auto" | explicit dir | legacy "30 阅读"
 * @param {string} opts.connectorType — "weread" | "x"
 * @param {string} [opts.separator="-"]
 * @param {string} [opts.templateResolved] — from resolveConnectorCategory
 */
export function pickConnectorCategory(categories, opts = {}) {
  const cats = Array.isArray(categories) ? categories.filter(Boolean) : [];
  const sep = opts.separator === " " ? " " : "-";
  const pref = String(opts.preferred || "").trim();
  const type = opts.connectorType === "x" ? "x" : "weread";
  const fb = CONNECTOR_FALLBACK[type];

  if (pref && pref !== "auto") {
    if (cats.includes(pref)) return pref;
    const slot = pref.slice(0, 2);
    if (/^\d{2}$/.test(slot)) {
      const bySlot = cats.find((c) => c.startsWith(slot) && (c.charAt(2) === "-" || c.charAt(2) === " "));
      if (bySlot) return bySlot;
      const namePart = pref.length > 3 ? pref.slice(3) : fb.name;
      return `${slot}${sep}${namePart}`;
    }
    const fuzzy = cats.find((c) => c.includes(pref) || pref.includes(c.slice(3)));
    if (fuzzy) return fuzzy;
  }

  if (opts.templateResolved && cats.includes(opts.templateResolved)) {
    return opts.templateResolved;
  }
  if (opts.templateResolved) {
    const tSlot = opts.templateResolved.slice(0, 2);
    if (/^\d{2}$/.test(tSlot)) {
      const bySlot = cats.find((c) => c.startsWith(tSlot));
      if (bySlot) return bySlot;
    }
  }

  const byKw = cats.find((c) => fb.keywords.test(c));
  if (byKw) return byKw;
  const bySlot = cats.find((c) => c.startsWith(fb.slot));
  if (bySlot) return bySlot;
  if (opts.templateResolved) return opts.templateResolved;
  return `${fb.slot}${sep}${fb.name}`;
}

/**
 * Resolve the physical category directory for a connector.
 *
 * @param {object|string} workspaceRoot — workspace context or path
 * @param {string} [preferred] — settings syncCategory
 * @param {"weread"|"x"} connectorType
 * @param {object} [options]
 * @param {string} [options.engineRoot]
 * @returns {Promise<string>} category directory name (not absolute path)
 */
export async function resolveConnectorSyncCategory(workspaceRoot, preferred, connectorType, options = {}) {
  const root = resolveDataRoot(workspaceRoot);
  // loadWorkspaceConfigSync projects v4 nested → flat aliases
  const config = loadWorkspaceConfigSync(root);
  const rawSep = config.categorySeparator;
  const sep = rawSep === " " ? " " : (rawSep || "-");
  const templateId = config.template || "stream";
  let engineRoot = options.engineRoot || null;
  try {
    engineRoot = engineRoot || engineRootOf(workspaceRoot);
  } catch {
    engineRoot = options.engineRoot || null;
  }

  let cats = [];
  try {
    const entries = await listDir(root);
    // Prefer model (respects hidden); fall back to pure FS
    try {
      const { resolveWorkspaceModel } = await import("./workspace-model-api.mjs");
      const model = await resolveWorkspaceModel(root, { engineRoot: engineRoot || undefined });
      cats = model.categories.filter((c) => c.ok && !c.hidden).map((c) => c.directory);
    } catch {
      cats = entries.filter((e) => CATEGORY_PATTERN.test(e));
    }
    if (cats.length === 0) {
      cats = entries.filter((e) => CATEGORY_PATTERN.test(e));
    }
  } catch {
    cats = [];
  }

  let templateResolved = "";
  if (engineRoot) {
    try {
      templateResolved = resolveConnectorCategory(engineRoot, templateId, connectorType, sep);
    } catch {
      templateResolved = "";
    }
  }

  const pref = String(preferred || "").trim();
  // Workspace-level connectorDefaults override empty app setting
  const configPref =
    pref && pref !== "auto"
      ? pref
      : (config.connectorDefaults?.[connectorType]?.syncCategory || pref || "auto");

  const resolved = pickConnectorCategory(cats, {
    preferred: configPref,
    connectorType,
    separator: sep,
    templateResolved,
  });

  // If exact path missing but we resolved a name, still return it (caller mkdir)
  if (cats.includes(resolved)) return resolved;
  if (await exists(path.join(root, resolved))) return resolved;
  return resolved;
}
