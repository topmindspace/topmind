import { promises as fs, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { exists } from "./fs-utils.mjs";
import { loadWorkspaceConfigSync, loadTemplateJson } from "./workspace-home.mjs";
// Local binding required — re-export alone does not define CATEGORY_PATTERN here.
import { CATEGORY_PATTERN } from "./category-pattern.mjs";

/**
 * v4 workspace path model — legacy v2.x paths stripped.
 *
 * Three path concerns (do not confuse with each other):
 * - engine root: monorepo / packaged engine (skills/ + topmind-desktop/ OR templates/)
 * - user workspace root: content truth — any dir with {NN-Name}/ categories
 *     default path only: ~/topmind/topmind-workspace (override: topmind_USER_WORKSPACE)
 * - Desktop runtime state: ~/topmind/topmind-desktop/ (settings, logs; override: topmind_DESKTOP_HOME)
 * Engine repo root must NEVER hold user notes; defaults live under the home directory.
 *
 * Product boundary: Desktop must launch without UTR. Skills pack is independent.
 */

/**
 * Classic monorepo engine requires skills/ + topmind-desktop/.
 * Packaged portable engine requires templates/ (see engine-root.mjs).
 * UTR is intentionally optional in both modes.
 */
const ENGINE_REQUIRED_SUBDIRS = ["skills", "topmind-desktop"];

export { ENGINE_REQUIRED_SUBDIRS };

export { CATEGORY_PATTERN };

export function isWorkspaceContext(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && typeof value.engineRoot === "string"
    && typeof value.userWorkspaceRoot === "string";
}

export function createWorkspaceContext({ engineRoot, userWorkspaceRoot }) {
  if (!engineRoot) throw new Error("Missing engine root.");
  if (!userWorkspaceRoot) throw new Error("Missing user workspace root.");
  return { engineRoot: path.resolve(engineRoot), userWorkspaceRoot: path.resolve(userWorkspaceRoot) };
}

export function engineRootOf(workspace) {
  return isWorkspaceContext(workspace) ? workspace.engineRoot : path.resolve(workspace);
}

export function resolveDataRoot(workspace) {
  if (isWorkspaceContext(workspace)) return workspace.userWorkspaceRoot;
  return path.join(path.resolve(workspace), "..", "topmind-workspace");
}

export async function resolvetopmindRoot(candidatePath) {
  if (isWorkspaceContext(candidatePath)) return resolvetopmindRoot(candidatePath.engineRoot);
  const resolved = path.resolve(candidatePath);

  // Classic monorepo layout
  const hasSkills = await exists(path.join(resolved, "skills"));
  const hasDesktop = await exists(path.join(resolved, "topmind-desktop"));
  if (hasSkills && hasDesktop) return resolved;

  // Portable / packaged: templates/ is the minimum (lib/ optional for loaders)
  const hasTemplates = await exists(path.join(resolved, "templates"));
  if (hasTemplates) return resolved;

  throw new Error(
    `Invalid engine root: ${resolved}. Expected monorepo (skills/ + topmind-desktop/) or portable engine (templates/). UTR optional.`,
  );
}

/** Whether optional UTR substrate is present beside the engine root. */
export function hasOptionalUtr(engineRoot) {
  try {
    const root = isWorkspaceContext(engineRoot) ? engineRoot.engineRoot : engineRoot;
    return existsSync(path.join(path.resolve(root), "utr"));
  } catch {
    return false;
  }
}

/**
 * True when this path looks like an engine/monorepo root (not a random folder).
 * Used to scope monorepo-adjacent `topmind-workspace` sibling jumps.
 */
async function looksLikeEngineRoot(rootPath) {
  try {
    const entries = await fs.readdir(rootPath);
    const set = new Set(entries);
    // Classic monorepo or portable pack
    if (set.has("skills") && set.has("topmind-desktop")) return true;
    if (set.has("templates") && (set.has("lib") || set.has("skills") || set.has("utr"))) return true;
    return false;
  } catch {
    return false;
  }
}

export async function detectUserWorkspaceRoot(candidatePath, options = {}) {
  if (isWorkspaceContext(candidatePath)) return path.resolve(candidatePath.userWorkspaceRoot);
  const normalized = String(candidatePath || "").trim();
  if (!normalized) throw new Error("No workspace path provided.");
  const resolvedInput = path.resolve(normalized);
  const stat = await fs.stat(resolvedInput).catch(() => null);
  let currentPath = stat?.isDirectory() ? resolvedInput : path.dirname(resolvedInput);
  const startPath = currentPath;
  const engineRoot = options.engineRoot ? await resolvetopmindRoot(options.engineRoot) : null;
  while (true) {
    if (await hasUserWorkspaceShape(currentPath)) return currentPath;
    if (engineRoot) {
      const relative = path.relative(engineRoot, currentPath);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        return resolveDataRoot(engineRoot);
      }
    }
    // Monorepo adjacency: only jump to sibling topmind-workspace when *this*
    // directory is an engine/monorepo root (or engineRoot option anchors us).
    // Never jump from a random empty folder just because a leftover sibling
    // `topmind-workspace` exists under /tmp (or any shared parent).
    if (await looksLikeEngineRoot(currentPath)) {
      const siblingData = path.join(path.dirname(currentPath), "topmind-workspace");
      if (await hasUserWorkspaceShape(siblingData)) return siblingData;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) throw new Error(`Could not locate topmind workspace from ${resolvedInput}.`);
    currentPath = parentPath;
  }
}

async function hasUserWorkspaceShape(rootPath) {
  try {
    const entries = await fs.readdir(rootPath);
    return entries.some((e) => CATEGORY_PATTERN.test(e));
  } catch {
    return false;
  }
}

export async function resolveWorkspaceContext(candidatePath, options = {}) {
  if (isWorkspaceContext(candidatePath)) {
    const engineRoot = await resolvetopmindRoot(candidatePath.engineRoot);
    const userWorkspaceRoot = await detectUserWorkspaceRoot(candidatePath.userWorkspaceRoot, { engineRoot });
    return createWorkspaceContext({ engineRoot, userWorkspaceRoot });
  }
  const engineRoot = options.engineRoot
    ? await resolvetopmindRoot(options.engineRoot)
    : await detecttopmindRoot(candidatePath);
  const userWorkspaceRoot = await detectUserWorkspaceRoot(candidatePath, { engineRoot });
  return createWorkspaceContext({ engineRoot, userWorkspaceRoot });
}

async function detecttopmindRoot(candidatePath) {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) throw new Error("No path provided.");
  const resolvedInput = path.resolve(normalized);
  const stat = await fs.stat(resolvedInput).catch(() => null);
  let currentPath = stat?.isDirectory() ? resolvedInput : path.dirname(resolvedInput);
  while (true) {
    const allPresent = await Promise.all(
      ENGINE_REQUIRED_SUBDIRS.map((dir) => exists(path.join(currentPath, dir)))
    );
    if (allPresent.every(Boolean)) return currentPath;
    const siblingEngine = path.join(path.dirname(currentPath), "topmind");
    const siblingHasEngine = await Promise.all(
      ENGINE_REQUIRED_SUBDIRS.map((dir) => exists(path.join(siblingEngine, dir)))
    );
    if (siblingHasEngine.every(Boolean)) return siblingEngine;
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) throw new Error(`Could not locate topmind engine root from ${resolvedInput}.`);
    currentPath = parentPath;
  }
}

export function workspaceAllowedRoots(workspace) {
  return [engineRootOf(workspace), resolveDataRoot(workspace)];
}

/** Resolve a workspace directory by template/config role (buffer/delivery/system).
 *  Merge order: on-disk match by role (template + extensions + overrides) → hardcoded fallback. */
function resolveDirByRole(workspace, role, fallbackHyphen, fallbackSpace) {
  const root = resolveDataRoot(workspace);
  try {
    const config = loadWorkspaceConfigSync(root);
    const templateId = config.template || "knowledge-management";
    const template = loadTemplateJson(templateId);
    const sep = config.categorySeparator || template?.separator || "-";

    /** @type {Map<string, { role: string, slot: string, name: string }>} */
    const roleByDir = new Map();

    if (template?.categories) {
      for (const [slot, def] of Object.entries(template.categories)) {
        const dir = `${slot}${sep}${def.name}`;
        roleByDir.set(dir, { role: def.role, slot, name: def.name });
        const space = `${slot} ${def.name}`;
        if (space !== dir) roleByDir.set(space, { role: def.role, slot, name: def.name });
      }
    }
    for (const [slot, ext] of Object.entries(config.categoryExtensions || {})) {
      if (!ext?.name) continue;
      const r = ext.role || "deep-work";
      const dir = `${slot}${sep}${ext.name}`;
      roleByDir.set(dir, { role: r, slot, name: ext.name });
    }
    for (const [slot, over] of Object.entries(config.categoryOverrides || {})) {
      if (!over?.role) continue;
      // Apply role override to any known dir with this slot
      for (const [dir, meta] of roleByDir) {
        if (meta.slot === slot) roleByDir.set(dir, { ...meta, role: over.role });
      }
    }

    // Prefer actual on-disk category with matching role
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || !CATEGORY_PATTERN.test(e.name)) continue;
        const meta = roleByDir.get(e.name);
        const slot = e.name.slice(0, 2);
        const over = config.categoryOverrides?.[slot];
        const ext = config.categoryExtensions?.[slot];
        const resolvedRole = over?.role || ext?.role || meta?.role;
        if (resolvedRole === role) return path.join(root, e.name);
      }
    } catch { /* ignore */ }

    // Expected path from template/extensions even if missing
    for (const [dir, meta] of roleByDir) {
      if (meta.role === role && existsSync(path.join(root, dir))) {
        return path.join(root, dir);
      }
    }
    for (const [dir, meta] of roleByDir) {
      if (meta.role === role) return path.join(root, dir);
    }
  } catch { /* fall through */ }
  if (existsSync(path.join(root, fallbackHyphen))) return path.join(root, fallbackHyphen);
  return path.join(root, fallbackSpace);
}

export function inboxRoot(workspace) {
  return resolveDirByRole(workspace, "buffer", "00-收件箱", "00 收件箱");
}

export function archiveRoot(workspace) {
  return resolveDirByRole(workspace, "system", "99-归档", "99 归档");
}

export function outputsRoot(workspace) {
  return resolveDirByRole(workspace, "delivery", "88-输出", "88 输出");
}

export function categoryRoot(workspace, category) {
  return path.join(resolveDataRoot(workspace), category);
}

export function topicRoot(workspace, category, topic) {
  return path.join(categoryRoot(workspace, category), topic);
}

/** Resolve "Category/Topic" topicId into { category, topic } parts. */
export function parseTopicId(topicId) {
  if (typeof topicId !== "string" || !topicId) return { category: null, topic: null };
  const slash = topicId.indexOf("/");
  if (slash === -1) return { category: null, topic: null };
  return { category: topicId.slice(0, slash), topic: topicId.slice(slash + 1) || null };
}

/** Build topicId from category + topic. */
export function buildTopicId(category, topic) {
  return `${category}/${topic}`;
}

/** Workspace watch roots for file system watcher. */
export function workspaceWatchRoots(workspace) {
  const dataRoot = resolveDataRoot(workspace);
  try {
    const entries = readdirSync(dataRoot, { withFileTypes: true });
    const subdirs = entries
      .filter((e) => e.isDirectory() && CATEGORY_PATTERN.test(e.name))
      .map((e) => path.join(dataRoot, e.name));
    return subdirs.length > 0 ? subdirs.concat([dataRoot]) : [dataRoot];
  } catch {
    return [dataRoot];
  }
}

/** Convert an absolute path inside the workspace into a workspace-relative path.
 * Always returns POSIX separators (`/`) so renderer / receipts stay OS-agnostic. */
export function toWorkspaceRelativePath(workspace, absolutePath) {
  const dataRoot = resolveDataRoot(workspace);
  return path.relative(dataRoot, path.resolve(absolutePath)).split(path.sep).join("/");
}
