/**
 * Shared helpers for WorkspaceService modules (no Electron dependency).
 */
import path from "node:path";
import { resolveDataRoot, archiveRoot } from "./path-model.mjs";
import { assertPathWithin } from "./path-safety.mjs";
import { listDir, statSafe } from "./fs-utils.mjs";
import { loadWorkspaceConfig, loadTemplateJson } from "./workspace-home.mjs";
import { resolveUnderRoot, toPosixPath } from "./platform.mjs";

export const S = (v, n, o = {}) => {
  if (typeof v !== "string" || (!o.allowEmpty && !v.trim())) throw new Error(`${n} required.`);
  if (o.maxLen && v.length > o.maxLen) throw new Error(`${n} too long.`);
};

export const T = (id) => {
  if (typeof id !== "string" || !id.includes("/")) throw new Error(`Invalid topicId: ${id}`);
};

export const now = () => new Date().toISOString();

/** Resolve workspace-relative path safely (accepts `\` or `/`; rejects `..`). */
export async function sp(ws, rel) {
  const root = resolveDataRoot(ws);
  const a = resolveUnderRoot(root, rel);
  await assertPathWithin(root, a, { allowMissing: true });
  return a;
}

export { toPosixPath };

/** List every file in a directory (all types — the filesystem is the truth). */
export async function lf(d) {
  const e = await listDir(d);
  const f = [];
  for (const x of e) {
    const s = await statSafe(path.join(d, x));
    if (s?.isFile()) f.push({ name: x, size: s.size, mtime: s.mtime.toISOString() });
  }
  return f;
}

/** Resolve dirName → category attributes (template + config extensions + FS). */
export async function resolveCategoryRoles(workspaceRoot) {
  const root = resolveDataRoot(workspaceRoot);
  try {
    const { resolveWorkspaceModel } = await import("./workspace-model-api.mjs");
    const model = await resolveWorkspaceModel(root);
    const map = new Map();
    for (const cat of model.categories) {
      map.set(cat.directory, cat);
    }
    return map;
  } catch {
    // Fallback: template-only map
    const config = await loadWorkspaceConfig(root);
    const templateId = config.workspace?.template || "stream";
    const template = loadTemplateJson(templateId);
    if (!template || !template.categories) return new Map();
    const sep = config.workspace?.category_separator || template.separator || "-";
    const map = new Map();
    for (const [slot, def] of Object.entries(template.categories)) {
      const hyphenName = `${slot}${sep}${def.name}`;
      const spaceName = `${slot} ${def.name}`;
      map.set(hyphenName, { slot, role: def.role, ...def, source: "fs+template" });
      if (spaceName !== hyphenName) {
        map.set(spaceName, { slot, role: def.role, ...def, source: "fs+template" });
      }
    }
    for (const [slot, ext] of Object.entries(config.categories?.extensions || {})) {
      if (!ext?.name) continue;
      const dir = `${slot}${sep}${ext.name}`;
      map.set(dir, {
        slot,
        name: ext.name,
        role: ext.role || "deep-work",
        specialBehavior: ext.specialBehavior,
        catchAll: ext.catchAll,
        referenceOnly: ext.referenceOnly,
        source: "fs+config",
      });
    }
    return map;
  }
}

/** Workspace-relative path under archive (e.g. 99-Archive/backups/trash/...). */
export function archiveRelativePath(workspaceContext, ...parts) {
  const archName = path.basename(archiveRoot(workspaceContext));
  return path.join(archName, ...parts).replace(/\\/gu, "/");
}

/**
 * Absolute path for trash under unified layout: {archive}/backups/trash/...
 * (same tree the Kernel writeback-engine uses for recoverable deletes).
 */
export function trashAbsolute(workspaceContext, ...parts) {
  return path.join(archiveRoot(workspaceContext), "backups", "trash", ...parts);
}

export function trashRelative(workspaceContext, ...parts) {
  return archiveRelativePath(workspaceContext, "backups", "trash", ...parts);
}


