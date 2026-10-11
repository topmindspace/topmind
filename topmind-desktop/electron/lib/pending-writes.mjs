/**
 * Pending write queue for graded confirm (删除/归档前问我) lifecycle ops.
 *
 * Durable system plane: `{workspace}/.topmind/pending-writes.json`.
 * Restart must not silently drop stashes the user still needs to accept/reject
 * (2026-09-17d deferred Y1). Not content truth — deletable/rebuildable.
 * When full, new stashes are rejected (not silently dropped).
 */

import fs from "node:fs";
import path from "node:path";
import { resolveDataRoot, isWorkspaceContext } from "./path-model.mjs";

const MAX_PENDING = 20;

/**
 * @param {string|object} wsOrCtx
 * @returns {string|null}
 */
function workspaceRootOf(wsOrCtx) {
  if (!wsOrCtx) return null;
  if (isWorkspaceContext(wsOrCtx)) return wsOrCtx.userWorkspaceRoot;
  // Raw path string is the workspace root itself — do NOT run resolveDataRoot
  // (that resolves the app data home for ctx-shaped objects).
  if (typeof wsOrCtx === "string") return path.resolve(wsOrCtx);
  try {
    return resolveDataRoot(wsOrCtx);
  } catch {
    return null;
  }
}

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function pendingWritesPath(workspaceRoot) {
  return path.join(workspaceRoot, ".topmind", "pending-writes.json");
}

/**
 * @param {string} workspaceRoot
 * @returns {Map<string, object>}
 */
function loadPending(workspaceRoot) {
  const abs = pendingWritesPath(workspaceRoot);
  /** @type {Map<string, object>} */
  const map = new Map();
  try {
    if (!fs.existsSync(abs)) return map;
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    const list = Array.isArray(raw?.items) ? raw.items : [];
    for (const e of list) {
      if (e && typeof e.id === "string" && e.relativePath && typeof e.content === "string") {
        map.set(e.id, {
          id: e.id,
          relativePath: String(e.relativePath).replace(/\\/g, "/"),
          content: String(e.content),
          toolName: e.toolName ? String(e.toolName) : undefined,
          createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
        });
      }
    }
  } catch {
    /* corrupt system-plane file → start empty (fail closed on loss, not crash) */
  }
  return map;
}

/**
 * @param {string} workspaceRoot
 * @param {Map<string, object>} map
 */
function savePending(workspaceRoot, map) {
  const abs = pendingWritesPath(workspaceRoot);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const payload = {
      items: [...map.values()].slice(0, MAX_PENDING),
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, abs);
  } catch (err) {
    // Surface on console so silent system-plane failures are not invisible.
    console.error("[pending-writes] persist failed", abs, err instanceof Error ? err.message : err);
  }
}

/**
 * @param {{ relativePath: string, content: string, toolName?: string, workspaceRoot: string|object }} p
 */
export function stashPendingWrite({ relativePath, content, toolName, workspaceRoot }) {
  const root = workspaceRootOf(workspaceRoot);
  if (!root) throw new Error("stashPendingWrite requires workspaceRoot");
  const pending = loadPending(root);
  if (pending.size >= MAX_PENDING) {
    throw new Error(`Pending write queue full (${MAX_PENDING}). Approve or reject existing writes first.`);
  }
  const id = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    relativePath: String(relativePath || "").replace(/\\/g, "/"),
    content: String(content ?? ""),
    toolName: toolName || "write",
    createdAt: new Date().toISOString(),
  };
  if (!entry.relativePath || !entry.content) {
    throw new Error("stashPendingWrite requires relativePath and content");
  }
  pending.set(id, entry);
  savePending(root, pending);
  return entry;
}

/**
 * @param {string|object} workspaceRoot
 */
export function listPendingWrites(workspaceRoot) {
  const root = workspaceRootOf(workspaceRoot);
  if (!root) return [];
  return [...loadPending(root).values()];
}

/**
 * @param {string|object} workspaceRoot
 * @param {string} id
 */
export function takePendingWrite(workspaceRoot, id) {
  const root = workspaceRootOf(workspaceRoot);
  if (!root) return null;
  const pending = loadPending(root);
  const e = pending.get(id);
  if (e) {
    pending.delete(id);
    savePending(root, pending);
  }
  return e || null;
}

/**
 * @param {string|object} workspaceRoot
 * @param {string} id
 */
export function rejectPendingWrite(workspaceRoot, id) {
  const root = workspaceRootOf(workspaceRoot);
  if (!root) return false;
  const pending = loadPending(root);
  const ok = pending.delete(id);
  if (ok) savePending(root, pending);
  return ok;
}
