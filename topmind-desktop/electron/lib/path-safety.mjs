import { promises as fsp, realpathSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";

/**
 * Resolve absPath the same way Kernel `realpathBestEffort` does:
 * follow existing components via realpath; when a component is missing,
 * keep walking parents; when a missing component is a dangling symlink,
 * resolve the link target (which may itself be missing) so a workspace
 * link cannot smuggle writes/reads outside the fence.
 *
 * Mirrors `lib/model-core.mjs` realpathBestEffort — keep semantics in sync.
 */
function realpathBestEffortSync(absPath) {
  let current = path.resolve(absPath);
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length > 0 ? path.join(real, ...tail.reverse()) : real;
    } catch {
      try {
        const st = lstatSync(current);
        if (st.isSymbolicLink()) {
          const link = readlinkSync(current);
          const linkAbs = path.resolve(path.dirname(current), link);
          const resolvedLink = realpathBestEffortSync(linkAbs);
          return tail.length > 0
            ? path.join(resolvedLink, ...tail.reverse())
            : resolvedLink;
        }
      } catch {
        /* lstat failed — component does not exist at all */
      }
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(absPath);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Whether resolved target sits strictly inside base (or equal — Desktop
 * historically allowed `rel === ""` for the root itself).
 * `..` parent hops are rejected; in-root names like `..foo` are allowed
 * (same rule as Kernel isPathInsideWorkspace).
 */
function isPathInside(basePath, targetPath) {
  const relativePath = path.relative(basePath, targetPath);
  if (relativePath === "") return true;
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const posix = relativePath.replace(/\\/g, "/");
  return posix !== ".." && !posix.startsWith("../");
}

/**
 * True when absPath is a symlink whose real target sits outside workspaceRoot.
 * Dangling links count as escaping. Mirrors lib/vault-walk.mjs.
 * @param {string} workspaceRoot
 * @param {string} absPath
 * @returns {boolean}
 */
export function isEscapingSymlinkSync(workspaceRoot, absPath) {
  let st;
  try {
    st = lstatSync(absPath);
  } catch {
    return false;
  }
  if (!st.isSymbolicLink()) return false;
  let realTarget;
  try {
    realTarget = realpathSync(absPath);
  } catch {
    return true;
  }
  let realRoot;
  try {
    realRoot = realpathSync(workspaceRoot);
  } catch {
    realRoot = path.resolve(workspaceRoot);
  }
  return !isPathInside(realRoot, realTarget) && path.resolve(realTarget) !== path.resolve(realRoot);
}

/**
 * True when an existing path resolves outside the workspace, including a path
 * reached through an intermediate symlink. Missing paths return false.
 * Mirrors lib/vault-walk.mjs.
 * @param {string} workspaceRoot
 * @param {string} absPath
 * @returns {boolean}
 */
export function resolvesOutsideVaultSync(workspaceRoot, absPath) {
  if (!workspaceRoot || !absPath) return false;
  let realTarget;
  try {
    realTarget = realpathSync(absPath);
  } catch {
    return false;
  }
  let realRoot;
  try {
    realRoot = realpathSync(workspaceRoot);
  } catch {
    realRoot = path.resolve(workspaceRoot);
  }
  if (path.resolve(realTarget) === path.resolve(realRoot)) return false;
  return !isPathInside(realRoot, realTarget);
}

/**
 * Assert that targetPath lives inside basePath (or any of basePath if array).
 * Handles live and dangling symlinks via realpathBestEffort (Kernel-aligned).
 */
export async function assertPathWithin(basePath, targetPath, options = {}) {
  const { allowMissing = false } = options;
  const basePaths = Array.isArray(basePath) ? basePath : [basePath];
  if (basePaths.length === 0) {
    throw new Error("assertPathWithin needs at least one basePath.");
  }

  // Prefer async realpath on bases; fall back is unnecessary for existing roots.
  const realBases = await Promise.all(
    basePaths.map(async (entry) => {
      try {
        return await fsp.realpath(entry);
      } catch {
        // Base may not exist yet (first ensure) — best-effort resolve.
        return realpathBestEffortSync(entry);
      }
    }),
  );

  let realTargetPath;
  try {
    realTargetPath = await fsp.realpath(targetPath);
  } catch (error) {
    if (!allowMissing || error?.code !== "ENOENT") {
      throw error;
    }
    // Missing path (create) or dangling symlink: resolve through the link
    // target so a workspace symlink cannot redirect outside the fence.
    realTargetPath = realpathBestEffortSync(targetPath);
  }

  if (!realTargetPath || !realBases.some((base) => isPathInside(base, realTargetPath))) {
    throw new Error(`Path outside allowed workspace boundary: ${targetPath}`);
  }

  return realTargetPath;
}

/** Exported for tests — Kernel-aligned strict containment (root itself is outside). */
export function isPathStrictlyInside(basePath, targetPath) {
  const relativePath = path.relative(basePath, targetPath);
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const posix = relativePath.replace(/\\/g, "/");
  return posix !== ".." && !posix.startsWith("../");
}
