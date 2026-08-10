// ── topmind Workspace Model · Topic Placement ──────────────────────────────
// create_topic gating: reserved planes, disallowed roles, path sanitation.
// Split from workspace-model facade — import via workspace-model.mjs.

import fsSync from "node:fs";
import path from "node:path";
import {
  isPathInsideWorkspace,
  isValidCategoryName,
  resolveWorkspaceModel,
} from "./model-core.mjs";

/** Reserved planes / roots never host content-category topics. */
const RESERVED_TOPIC_CATEGORY_NAMES = new Set([
  "memory",
  ".topmind",
  ".obsidian",
  "node_modules",
]);

/**
 * Roles that must never host content-category topics (create_topic).
 * Same set as topic_classify / loadOpActivity parent skipRoles.
 */
export const TOPIC_DISALLOWED_ROLES = Object.freeze([
  "system",
  "buffer",
  "delivery",
  "loose-stream",
]);

/**
 * Whether a category directory name is a reserved system/semantic plane
 * (not a first-level content category for create_topic).
 * @param {string} category
 * @returns {boolean}
 */
export function isReservedTopicCategory(category) {
  const c = String(category || "").trim().replace(/\\/g, "/");
  if (!c) return true;
  if (RESERVED_TOPIC_CATEGORY_NAMES.has(c)) return true;
  if (c.startsWith(".")) return true;
  // memory/* plane never a content category
  if (c === "memory" || c.startsWith("memory/")) return true;
  return false;
}

/**
 * Whether a workspace role may host content topics.
 * @param {string} [role]
 * @returns {boolean}
 */
export function isDisallowedTopicCategoryRole(role) {
  if (!role) return false;
  return TOPIC_DISALLOWED_ROLES.includes(String(role));
}

/**
 * Infer non-content role from category directory name when model lacks explicit role.
 * Used only as a safety net for standard slots / name patterns.
 * @param {string} category
 * @returns {string|null}
 */
export function inferTopicDisallowedRoleFromCategoryName(category) {
  const c = String(category || "").trim();
  if (!c) return null;
  const slot = /^\d{2}/u.test(c) ? c.slice(0, 2) : "";
  // Required-role slots in default templates
  if (slot === "00") return "buffer";
  if (slot === "88") return "delivery";
  if (slot === "99") return "system";
  // Name / locale patterns
  if (/归档|archive|trash|backup/iu.test(c)) return "system";
  if (/收件|inbox|buffer/iu.test(c)) return "buffer";
  if (/输出|output|delivery|exports?/iu.test(c)) return "delivery";
  if (/动态|stream|journal|daily|period/iu.test(c)) return "loose-stream";
  return null;
}

/**
 * Resolve category role for create_topic gating.
 * Prefers workspace model; falls back to name heuristics for disallowed roles.
 * @param {string} workspaceRoot
 * @param {string} category
 * @param {{ engineRoot?: string, contract?: object, config?: object }} [opts]
 * @returns {string|null}
 */
export function resolveCategoryRoleForTopic(workspaceRoot, category, opts = {}) {
  const dir = String(category || "").trim().replace(/\\/g, "/");
  if (!dir || !workspaceRoot) {
    return inferTopicDisallowedRoleFromCategoryName(dir);
  }
  try {
    const model = resolveWorkspaceModel({
      workspaceRoot,
      engineRoot: opts.engineRoot,
      config: opts.contract || opts.config,
    });
    const hit = (model.categories || []).find((c) => c.directory === dir);
    if (hit?.role) return hit.role;
  } catch {
    /* model optional */
  }
  return inferTopicDisallowedRoleFromCategoryName(dir);
}

/**
 * Sanitize create_topic placement under a content category.
 * Rejects path traversal, multi-segment categories, absolute paths, escapes,
 * reserved planes (memory/.topmind), and non-content roles
 * (system / buffer / delivery / loose-stream — align with topic_classify parents).
 *
 * @param {object} opts
 * @param {string} opts.workspaceRoot
 * @param {string} opts.category
 * @param {string} opts.name
 * @param {Set<string>|string[]} [opts.allowedCategories] — when set, category must be in this set
 * @param {boolean} [opts.requireCategoryOnDisk=true] — category dir must exist under workspace
 * @param {string} [opts.engineRoot] — for role resolution via workspace model
 * @param {object} [opts.contract] — preloaded contract/config for role resolution
 * @param {object} [opts.config] — alias of contract
 * @param {boolean} [opts.skipRoleCheck=false] — tests only; product path always checks roles
 * @returns {{ category: string, name: string, titleBase: string, topicDirRel: string, topicFileRel: string, absDir: string, absFile: string, role?: string }}
 */
export function sanitizeTopicPlacement(opts = {}) {
  const workspaceRoot = opts.workspaceRoot;
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("sanitizeTopicPlacement requires workspaceRoot");
  }

  let category = String(opts.category || "").trim().replace(/\\/g, "/");
  let name = String(opts.name || "").trim().replace(/\\/g, "/");

  if (!category || !name) {
    throw new Error("create_topic requires category and name");
  }
  if (path.isAbsolute(category) || path.isAbsolute(name)) {
    throw new Error("create_topic: absolute paths not allowed");
  }
  if (category.includes("..") || name.includes("..")) {
    throw new Error("create_topic: path traversal not allowed");
  }
  // Category must be a single directory segment (e.g. 20-专题), never nested path
  if (category.includes("/")) {
    throw new Error("create_topic: category must be a single directory segment");
  }
  if (isReservedTopicCategory(category)) {
    throw new Error(`create_topic: reserved plane not allowed for content topics: ${category}`);
  }
  // Topic name: no path separators
  name = name.replace(/[\\/]/g, "-").replace(/\.\./g, "").slice(0, 80);
  if (!name || name.includes("..")) {
    throw new Error("create_topic: invalid topic name");
  }
  if (!/^\d{4}-.+/u.test(name)) {
    name = `${new Date().getFullYear()}-${name}`;
  }
  if (name.length < 6) {
    throw new Error("create_topic: topic name too short");
  }

  /** @type {Set<string>|null} */
  let allowed = null;
  if (opts.allowedCategories instanceof Set) {
    allowed = opts.allowedCategories;
  } else if (Array.isArray(opts.allowedCategories) && opts.allowedCategories.length) {
    allowed = new Set(opts.allowedCategories);
  }

  if (allowed) {
    if (!allowed.has(category)) {
      throw new Error(`create_topic: category not in workspace: ${category}`);
    }
  } else if (!isValidCategoryName(category)) {
    throw new Error(`create_topic: invalid category name: ${category}`);
  }

  // Role gate: never place content topics under system/buffer/delivery/loose-stream
  let resolvedRole = null;
  if (opts.skipRoleCheck !== true) {
    resolvedRole = resolveCategoryRoleForTopic(workspaceRoot, category, {
      engineRoot: opts.engineRoot,
      contract: opts.contract || opts.config,
    });
    if (isDisallowedTopicCategoryRole(resolvedRole)) {
      throw new Error(
        `create_topic: category role '${resolvedRole}' cannot host content topics: ${category}`,
      );
    }
  }

  const requireOnDisk = opts.requireCategoryOnDisk !== false;
  if (requireOnDisk) {
    const catAbs = path.resolve(workspaceRoot, category);
    if (!isPathInsideWorkspace(workspaceRoot, catAbs) || !fsSync.existsSync(catAbs) || !fsSync.statSync(catAbs).isDirectory()) {
      throw new Error(`create_topic: category directory missing: ${category}`);
    }
  }

  const topicDirRel = `${category}/${name}`;
  const topicFileRel = `${topicDirRel}/topic.md`;
  const absDir = path.resolve(workspaceRoot, topicDirRel);
  const absFile = path.resolve(workspaceRoot, topicFileRel);
  if (!isPathInsideWorkspace(workspaceRoot, absDir) || !isPathInsideWorkspace(workspaceRoot, absFile)) {
    throw new Error("create_topic: resolved path escapes workspace");
  }

  return {
    category,
    name,
    titleBase: name.replace(/^\d{4}-/u, ""),
    topicDirRel,
    topicFileRel,
    absDir,
    absFile,
    role: resolvedRole || undefined,
  };
}

/**
 * Normalize AI/user category string to a single safe segment (or "").
 * Strips multi-path and `..`; does not invent categories.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeCategorySegment(raw) {
  let category = String(raw || "").trim().replace(/\\/g, "/");
  if (!category || category.includes("..") || path.isAbsolute(category)) return "";
  const segs = category.split("/").filter((s) => s && s !== ".");
  if (segs.length !== 1) return "";
  category = segs[0];
  if (category.includes("..") || category.includes("\\") || path.isAbsolute(category)) return "";
  return category;
}
