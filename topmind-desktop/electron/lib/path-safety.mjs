import { realpath } from "node:fs/promises";
import path from "node:path";

function isPathInside(basePath, targetPath) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/**
 * Assert that targetPath lives inside basePath (or any of basePath if array).
 * Handles symlinks via realpath resolution.
 */
export async function assertPathWithin(basePath, targetPath, options = {}) {
  const { allowMissing = false } = options;
  const basePaths = Array.isArray(basePath) ? basePath : [basePath];
  if (basePaths.length === 0) {
    throw new Error("assertPathWithin needs at least one basePath.");
  }

  const realBases = await Promise.all(basePaths.map((entry) => realpath(entry)));
  let realTargetPath;

  try {
    realTargetPath = await realpath(targetPath);
  } catch (error) {
    if (!allowMissing || error?.code !== "ENOENT") {
      throw error;
    }

    // Walk up to find an existing ancestor, then resolve the rest
    let existingAncestor = path.resolve(targetPath);
    let previousAncestor = null;
    while (existingAncestor !== previousAncestor) {
      try {
        const realAncestorPath = await realpath(existingAncestor);
        realTargetPath = path.resolve(realAncestorPath, path.relative(existingAncestor, targetPath));
        break;
      } catch (ancestorError) {
        if (ancestorError?.code !== "ENOENT") {
          throw ancestorError;
        }
        previousAncestor = existingAncestor;
        existingAncestor = path.dirname(existingAncestor);
      }
    }

    if (!realTargetPath) {
      throw error;
    }
  }

  if (!realBases.some((base) => isPathInside(base, realTargetPath))) {
    throw new Error(`Path outside allowed workspace boundary: ${targetPath}`);
  }

  return realTargetPath;
}
