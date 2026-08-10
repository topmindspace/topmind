/**
 * Desktop facade for engine `lib/workspace-model.mjs`.
 *
 * Do NOT static-import monorepo `../../lib/` — missing inside app.asar.
 * Load from resolved engine root (dev monorepo or packaged topmind-engine/).
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { getEngineRoot } from "./workspace-home.mjs";
import { defaultEngineCandidate } from "./engine-root.mjs";
import { isWorkspaceContext, resolveDataRoot } from "./path-model.mjs";

export { CATEGORY_PATTERN, VALID_ROLES } from "./category-pattern.mjs";

/**
 * Extract string paths from either a WorkspaceContext object or a plain path.
 * WorkspaceContext = { engineRoot: string, userWorkspaceRoot: string }.
 * Returns { workspaceRoot: string, engineRoot: string } suitable for engine APIs.
 */
function toRoots(wsOrCtx, optionsEngineRoot) {
  if (isWorkspaceContext(wsOrCtx)) {
    return {
      workspaceRoot: wsOrCtx.userWorkspaceRoot,
      engineRoot: optionsEngineRoot || wsOrCtx.engineRoot || engineRootNow(),
    };
  }
  return {
    workspaceRoot: typeof wsOrCtx === "string" ? wsOrCtx : resolveDataRoot(wsOrCtx),
    engineRoot: optionsEngineRoot || engineRootNow(),
  };
}

let cache = { root: null, mod: null, promise: null };

function engineRootNow() {
  return path.resolve(getEngineRoot() || defaultEngineCandidate());
}

/**
 * @returns {Promise<Record<string, Function>>} engine lib/workspace-model exports
 */
export async function loadWorkspaceModelLib() {
  const root = engineRootNow();
  if (cache.mod && cache.root === root) return cache.mod;
  if (cache.promise && cache.root === root) return cache.promise;
  cache.root = root;
  const href = pathToFileURL(path.join(root, "lib", "workspace-model.mjs")).href;
  cache.promise = import(href).then((mod) => {
    cache.mod = mod;
    cache.promise = null;
    return mod;
  });
  return cache.promise;
}

/** Drop cache (e.g. after setEngineRoot in tests). */
export function resetWorkspaceModelLibCache() {
  cache = { root: null, mod: null, promise: null };
}

export async function resolveWorkspaceModel(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.resolveWorkspaceModel({
    workspaceRoot: r.workspaceRoot,
    engineRoot: r.engineRoot,
    config: options.config,
    template: options.template,
    includeMissingRequired: options.includeMissingRequired,
  });
}

export async function ensureRequiredStructure(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.ensureRequiredStructure(r.workspaceRoot, {
    engineRoot: r.engineRoot,
    templateId: options.templateId,
    materializeExtensions: options.materializeExtensions,
  });
}

export async function addCategory(workspaceRoot, spec) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, spec.engineRoot);
  return wm.addCategory(r.workspaceRoot, {
    ...spec,
    engineRoot: r.engineRoot,
  });
}

export async function updateCategoryAttributes(workspaceRoot, slot, patch) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, patch.engineRoot);
  return wm.updateCategoryAttributes(r.workspaceRoot, slot, {
    ...patch,
    engineRoot: r.engineRoot,
  });
}

export async function renameCategory(workspaceRoot, spec) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, spec.engineRoot);
  return wm.renameCategory(r.workspaceRoot, {
    ...spec,
    engineRoot: r.engineRoot,
  });
}

export async function writeWorkspaceMap(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.writeWorkspaceMap(r.workspaceRoot, {
    engineRoot: r.engineRoot,
  });
}

export async function suggestNextSlot(workspaceRoot) {
  const model = await resolveWorkspaceModel(workspaceRoot);
  const wm = await loadWorkspaceModelLib();
  const occupied = model.categories.map((c) => c.slot);
  return wm.suggestNextSlot(occupied);
}

export async function resolveSystemRoot(workspaceRoot, role, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.resolveSystemRoot(r.workspaceRoot, role, {
    engineRoot: r.engineRoot,
    config: options.config,
    fallbackHyphen: options.fallbackHyphen,
    fallbackSpace: options.fallbackSpace,
  });
}

export async function resolveStreamTarget(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.resolveStreamTarget({
    workspaceRoot: r.workspaceRoot,
    engineRoot: r.engineRoot,
    config: options.config,
    date: options.date,
  });
}

export async function resolveMemoryPaths(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.resolveMemoryPaths({
    workspaceRoot: r.workspaceRoot,
    engineRoot: r.engineRoot,
    config: options.config,
  });
}

export async function ensureCoreProfile(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.ensureCoreProfile(r.workspaceRoot, {
    engineRoot: r.engineRoot,
    config: options.config,
  });
}

export async function findStreamCategory(workspaceRoot, options = {}) {
  const model = await resolveWorkspaceModel(workspaceRoot, options);
  const wm = await loadWorkspaceModelLib();
  return wm.findStreamCategory(model);
}

export async function listStreamPeriods(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.listStreamPeriods({
    workspaceRoot: r.workspaceRoot,
    engineRoot: r.engineRoot,
    config: options.config,
    limit: options.limit,
  });
}

export async function listStreamYears(workspaceRoot, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.listStreamYears({
    workspaceRoot: r.workspaceRoot,
    engineRoot: r.engineRoot,
    config: options.config,
  });
}

export async function archiveStreamYear(workspaceRoot, year, options = {}) {
  const wm = await loadWorkspaceModelLib();
  const r = toRoots(workspaceRoot, options.engineRoot);
  return wm.archiveStreamYear({
    workspaceRoot: r.workspaceRoot,
    engineRoot: r.engineRoot,
    config: options.config,
    year,
  });
}
