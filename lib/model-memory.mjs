// ── topmind Workspace Model · Memory ───────────────────────────────────────
// Memory-plane paths (我的情况 / profile) resolution + seeding.
// Split from workspace-model facade — import via workspace-model.mjs.

import fsSync from "node:fs";
import path from "node:path";
import { resolveWorkspaceModel } from "./model-core.mjs";
import { normalizeMemoryConfig, seedCoreProfileMarkdown } from "./stream-period.mjs";
import { ensureMemoryPlane } from "./memory-engine.mjs";
import { executeWrite } from "./writeback-engine.mjs";

/**
 * Resolve core memory ("我的情况") path. Prefer config.memory.dir; default "memory".
 *
 * Single truth with memory-engine.resolveMemoryDir: both use contract dir ||
 * "memory". The legacy stream-category fallback forked the semantic plane
 * (one host seeded under 10-动态/, another under memory/) — removed.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.config]
 * @returns {{
 *   memoryDirRel: string|null,
 *   memoryDirAbs: string|null,
 *   profileFile: string,
 *   profileRelPath: string|null,
 *   profileAbsPath: string|null,
 *   category: object|null,
 * }}
 */
export function resolveMemoryPaths(options = {}) {
  const model = resolveWorkspaceModel({
    workspaceRoot: options.workspaceRoot,
    engineRoot: options.engineRoot,
    config: options.config,
  });
  const mem = normalizeMemoryConfig(model.memory || model.config?.memory);
  const root = model.workspaceRoot;
  // Same default as memory-engine: contract dir, else "memory". Never stream.
  let dirRel = mem.dir || "memory";
  let category = null;

  if (dirRel) {
    // If dir looks like a category directory name, attach category meta
    category = model.categories.find((c) => c.directory === dirRel) || null;
  }

  const dirAbs = path.join(root, dirRel);
  const profileRel = path.join(dirRel, mem.profileFile);
  return {
    memoryDirRel: dirRel,
    memoryDirAbs: dirAbs,
    profileFile: mem.profileFile,
    profileRelPath: profileRel,
    profileAbsPath: path.join(root, profileRel),
    files: mem.files || [],
    category,
  };
}

/**
 * Ensure core profile file exists (optional create). Returns paths + created flag.
 * @param {string} workspaceRoot
 * @param {object} [options]
 */
export function ensureCoreProfile(workspaceRoot, options = {}) {
  ensureMemoryPlane(workspaceRoot);
  const paths = resolveMemoryPaths({
    workspaceRoot,
    engineRoot: options.engineRoot,
    config: options.config,
  });
  if (!paths.profileAbsPath || !paths.memoryDirAbs) {
    return { ...paths, created: false, ok: false, reason: "no-memory-dir" };
  }
  if (!fsSync.existsSync(paths.memoryDirAbs)) {
    fsSync.mkdirSync(paths.memoryDirAbs, { recursive: true });
  }
  let created = false;
  if (!fsSync.existsSync(paths.profileAbsPath)) {
    const title = paths.profileFile.replace(/\.md$/iu, "") || "我的情况";
    // Durable content write through writeback-engine (no parallel raw seed)
    executeWrite({
      targetPath: paths.profileAbsPath,
      content: seedCoreProfileMarkdown(title),
      workspaceRoot,
      contract: options.config,
      operation: "create",
      actor: "user",
      confirmed: true,
      role: "memory",
    });
    created = true;
  }
  return { ...paths, created, ok: true };
}
