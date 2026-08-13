import fsSync, { promises as fs } from "node:fs";
import path from "node:path";
import { t } from "./i18n-strings.mjs";
import { loadTemplate, resolveCategoryMap, findCategoriesByRole, DEFAULT_TEMPLATE } from "../../lib/template-loader.mjs";
import {
  CATEGORY_PATTERN,
  discoverCategories as discoverCategoriesModel,
  discoverCategoryDirs,
  loadWorkspaceConfig as loadConfigFromModel,
  normalizeConfig,
  resolveWorkspaceModel,
  resolveSystemRoot,
  isValidCategoryName as isValidCategoryNameModel,
  parseCategoryDirName,
} from "../../lib/workspace-model.mjs";

// ── v4.x Template-Driven Category Model ──────────────────────────────────
// Prefer resolveWorkspaceModel() / lib/workspace-model.mjs for all new code.
// (Removed CATEGORY_DEFAULTS allowlist — custom slots are first-class.)

// ── Template & Workspace Config Loaders ───────────────────────────────────

/**
 * Load the workspace contract (topmind.yaml) from a workspace root.
 */
export function loadWorkspaceConfig(workspaceRoot) {
  return loadConfigFromModel(workspaceRoot);
}

/**
 * Load the category template for a workspace from topmind.yaml.
 *
 * @param {string} engineRoot
 * @param {string} workspaceRoot
 * @returns {{ templateId: string, categories: object, separator: string, connectorHints: object }}
 */
export function loadCategoryTemplate(engineRoot, workspaceRoot) {
  const config = normalizeConfig(loadWorkspaceConfig(workspaceRoot));
  const templateId = config.template || DEFAULT_TEMPLATE;
  const template = loadTemplate(engineRoot, templateId);
  return {
    templateId: template.templateId,
    categories: template.categories,
    separator: config.categorySeparator || template.separator || "-",
    connectorHints: template.connectorHints || {},
  };
}

/**
 * Build a resolved Map of category dirNames → definitions for the workspace.
 * @returns {Map<string, object>} keyed by resolved dirName (e.g., "00-Inbox")
 */
export function getCategoryMap(engineRoot, workspaceRoot) {
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot });
  const map = new Map();
  for (const cat of model.categories) {
    map.set(cat.directory, cat);
    // alias space/hyphen twin for lookup
    const parsed = parseCategoryDirName(cat.directory);
    if (parsed) {
      const altSep = parsed.separator === "-" ? " " : "-";
      const alt = `${parsed.slot}${altSep}${parsed.name}`;
      if (alt !== cat.directory) map.set(alt, { ...cat, _alias: true });
    }
  }
  return map;
}

/**
 * Dynamic category discovery: scan workspace root for {NN}[- ][Name] directories.
 * @returns {string[]} sorted category directory names
 */
export function discoverCategories(workspaceRoot, engineRoot) {
  return discoverCategoriesModel(workspaceRoot, engineRoot);
}

/**
 * Full resolved model (preferred over bare name lists).
 */
export function getWorkspaceModel(engineRoot, workspaceRoot) {
  return resolveWorkspaceModel({ workspaceRoot, engineRoot });
}

/**
 * Find the directory name for a category by role.
 */
export function findCategoryByRole(engineRoot, workspaceRoot, role) {
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot });
  const hit = model.categories.find((c) => c.ok && c.role === role);
  return hit ? hit.directory : null;
}

export function isValidCategoryName(name) {
  return isValidCategoryNameModel(name);
}

export { CATEGORY_PATTERN, discoverCategoryDirs, parseCategoryDirName, resolveWorkspaceModel };

// ── Engine Subdirs & Unsupported Roots ────────────────────────────────────

const ENGINE_SUBDIRS = ["skills", "utr"];

export const UNSUPPORTED_WORKSPACE_ROOTS = new Set([
  "knowledge", "writing", "productions", "books-archive",
  "projects", "references", "sources", "library",
]);

// ── Helpers ──────────────────────────────────────────────────────────────

function isWorkspaceContext(obj) {
  return obj && typeof obj === "object" && "engineRoot" in obj && "userWorkspaceRoot" in obj;
}

async function exists(targetPath) {
  try { await fs.access(targetPath); return true; } catch { return false; }
}

async function statSafe(targetPath) {
  try { return await fs.stat(targetPath); } catch { return null; }
}

// ── Workspace Root Resolution ────────────────────────────────────────────

export function engineRootOf(workspace) {
  return isWorkspaceContext(workspace) ? workspace.engineRoot : path.resolve(workspace);
}

export function resolveDataRoot(workspace) {
  if (isWorkspaceContext(workspace)) return workspace.userWorkspaceRoot;
  return path.join(path.resolve(workspace), "..", "topmind-workspace");
}

export function userWorkspaceRootOf(workspace) {
  return isWorkspaceContext(workspace) ? workspace.userWorkspaceRoot : resolveDataRoot(workspace);
}

export async function resolvetopmindRoot(candidatePath) {
  if (isWorkspaceContext(candidatePath)) return resolvetopmindRoot(candidatePath.engineRoot);
  const resolved = path.resolve(candidatePath);
  const allPresent = await Promise.all(ENGINE_SUBDIRS.map((dir) => exists(path.join(resolved, dir))));
  if (allPresent.every(Boolean)) return resolved;
  throw new Error(t("error.missingEngineSubdirs", { path: resolved, subdirs: ENGINE_SUBDIRS.join(", ") }));
}

export async function detecttopmindRoot(candidatePath) {
  const normalizedInput = String(candidatePath || "").trim();
  if (!normalizedInput) throw new Error(t("error.unresolvableWorkspacePath"));
  const resolvedInput = path.resolve(normalizedInput);
  const inputStats = await statSafe(resolvedInput);
  let currentPath = inputStats?.isDirectory() ? resolvedInput : path.dirname(resolvedInput);
  while (true) {
    const allPresent = await Promise.all(ENGINE_SUBDIRS.map((dir) => exists(path.join(currentPath, dir))));
    if (allPresent.every(Boolean)) return currentPath;
    const siblingEngine = path.join(path.dirname(currentPath), "topmind");
    const siblingHas = await Promise.all(ENGINE_SUBDIRS.map((dir) => exists(path.join(siblingEngine, dir))));
    if (siblingHas.every(Boolean)) return siblingEngine;
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) throw new Error(t("error.engineRootNotFound", { path: resolvedInput }));
    currentPath = parentPath;
  }
}

export async function detectUserWorkspaceRoot(candidatePath, options = {}) {
  if (isWorkspaceContext(candidatePath)) return path.resolve(candidatePath.userWorkspaceRoot);
  const normalizedInput = String(candidatePath || "").trim();
  if (!normalizedInput) throw new Error(t("error.unresolvableDataWorkspacePath"));
  const resolvedInput = path.resolve(normalizedInput);
  const inputStats = await statSafe(resolvedInput);
  let currentPath = inputStats?.isDirectory() ? resolvedInput : path.dirname(resolvedInput);
  const engineRoot = options.engineRoot ? await resolvetopmindRoot(options.engineRoot) : null;
  while (true) {
    const discovered = discoverCategories(currentPath, engineRoot);
    const hasInbox = discovered.some((d) => /^00[ -]/.test(d));
    const hasArchive = discovered.some((d) => /^99[ -]/.test(d));
    if (hasInbox && hasArchive) return currentPath;
    if (engineRoot) {
      const relativeToEngine = path.relative(engineRoot, currentPath);
      const isInsideEngine = relativeToEngine === "" || (!relativeToEngine.startsWith("..") && !path.isAbsolute(relativeToEngine));
      if (isInsideEngine) return resolveDataRoot(engineRoot);
    }
    const siblingData = path.join(path.dirname(currentPath), "topmind-workspace");
    if (fsSync.existsSync(siblingData)) {
      const sibDiscovered = discoverCategories(siblingData, engineRoot);
      if (sibDiscovered.length > 0 && sibDiscovered.some((d) => /^00[ -]/.test(d)) && sibDiscovered.some((d) => /^99[ -]/.test(d))) return siblingData;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) throw new Error(t("error.dataWorkspaceNotFound"));
    currentPath = parentPath;
  }
}

export async function resolveUtrWorkspaceContext(candidatePath = process.cwd(), options = {}) {
  const engineRoot = options.engineRoot ? await resolvetopmindRoot(options.engineRoot) : await detecttopmindRoot(candidatePath);
  const userWorkspaceRoot = options.userWorkspaceRoot ? await detectUserWorkspaceRoot(options.userWorkspaceRoot, { engineRoot }) : await detectUserWorkspaceRoot(candidatePath, { engineRoot });
  return { engineRoot, userWorkspaceRoot };
}

// ── Category+Topic Path Helpers (role-based, template-driven) ─────────────

export function categoryRoot(workspace, category) {
  return path.join(userWorkspaceRootOf(workspace), category);
}

export function topicRoot(workspace, category, topic) {
  return path.join(categoryRoot(workspace, category), topic);
}

export function topicFilePath(workspace, category, topic) {
  return path.join(topicRoot(workspace, category, topic), "topic.md");
}

function systemRootOpts(workspace) {
  const root = userWorkspaceRootOf(workspace);
  if (isWorkspaceContext(workspace)) {
    return { engineRoot: workspace.engineRoot, workspaceRoot: root };
  }
  return { workspaceRoot: root };
}

/** Global outputs directory — resolved by role:"delivery". */
export function globalOutputsRoot(workspace) {
  const root = userWorkspaceRootOf(workspace);
  const opts = systemRootOpts(workspace);
  return resolveSystemRoot(root, "delivery", {
    engineRoot: opts.engineRoot,
    fallbackHyphen: "88-输出",
    fallbackSpace: "88 输出",
  });
}

/** Resolve the user workspace categories root. */
export function userWorkspaceCategoriesRoot(workspace) {
  return userWorkspaceRootOf(workspace);
}

/** Create a workspace context object from engine and user roots. */
export function createWorkspaceContext({ engineRoot, userWorkspaceRoot }) {
  return { engineRoot: path.resolve(engineRoot), userWorkspaceRoot: path.resolve(userWorkspaceRoot) };
}

export function inboxRoot(workspace) {
  const root = userWorkspaceRootOf(workspace);
  const opts = systemRootOpts(workspace);
  return resolveSystemRoot(root, "buffer", {
    engineRoot: opts.engineRoot,
    fallbackHyphen: "00-收件箱",
    fallbackSpace: "00 收件箱",
  });
}

export function archiveRoot(workspace) {
  const root = userWorkspaceRootOf(workspace);
  const opts = systemRootOpts(workspace);
  return resolveSystemRoot(root, "system", {
    engineRoot: opts.engineRoot,
    fallbackHyphen: "99-归档",
    fallbackSpace: "99 归档",
  });
}

// ── Workspace path resolution ────────────────────────────────────────────

export function resolveWorkspacePath(workspace, relativePath) {
  const engineRoot = path.resolve(engineRootOf(workspace));
  const userWorkspaceRoot = path.resolve(userWorkspaceRootOf(workspace));
  const normalized = String(relativePath || "").replace(/\\/gu, "/");
  const head = normalized.split("/", 1)[0];

  const containedIn = (root, target) => {
    const rel = path.relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };

  let resolved;
  if (CATEGORY_PATTERN.test(head) || head === "99 归档" || head === "99-归档") {
    resolved = path.resolve(userWorkspaceRoot, normalized);
    if (!containedIn(userWorkspaceRoot, resolved)) {
      throw new Error("Traversal disallowed: path outside workspace root");
    }
    return resolved;
  }
  if (UNSUPPORTED_WORKSPACE_ROOTS.has(head)) {
    throw new Error(t("error.unsupportedWorkspaceRoot", { root: head }));
  }

  resolved = path.resolve(engineRoot, normalized);
  if (!containedIn(engineRoot, resolved)) {
    throw new Error("Traversal disallowed: path outside engine root");
  }
  return resolved;
}

// ── CLI context helpers (shared across all 5 tool entry points) ───────────

export function buildCliContext({ categoriesRoot, inboxRootPath, archiveRootPath }) {
  return {
    engineRoot: process.cwd(),
    userWorkspaceRoot: categoriesRoot,
    categoriesRoot,
    inboxRootPath,
    archiveRootPath,
  };
}

export function validateRequiredRoots(args) {
  const required = [
    ["categoriesRoot", "categories-root"],
    ["inboxRoot", "inbox-root"],
    ["archiveRoot", "archive-root"],
  ];
  for (const [key, flag] of required) {
    if (!args[key]) {
      throw new Error(t("error.missingRequiredFlag", { flag }));
    }
  }
  return {
    categoriesRoot: path.resolve(args.categoriesRoot),
    inboxRootPath: path.resolve(args.inboxRoot),
    archiveRootPath: path.resolve(args.archiveRoot),
  };
}

// re-export resolveCategoryMap for callers that still use template maps
export { resolveCategoryMap, findCategoriesByRole, DEFAULT_TEMPLATE, loadTemplate };
