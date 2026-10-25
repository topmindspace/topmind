/** Desktop context adapter over the shared Kernel review queue. */
import path from 'node:path';
import { resolveDataRoot, isWorkspaceContext } from './path-model.mjs';
import { loadKernelApi } from './kernel-api.mjs';
function rootOf(value) {
  if (isWorkspaceContext(value)) return value.userWorkspaceRoot;
  if (typeof value === 'string') return path.resolve(value);
  if (value) return resolveDataRoot(value);
  throw new Error('Pending writes require a workspace');
}
export function pendingWritesPath(root) { return path.join(rootOf(root), '.topmind/pending-writes.json'); }
export async function stashPendingWrite(options) { return (await loadKernelApi()).stashPendingWrite({ ...options, workspaceRoot: rootOf(options.workspaceRoot) }); }
export async function listPendingWrites(root) { return root ? (await loadKernelApi()).listPendingWrites(rootOf(root)) : []; }
export async function takePendingWrite(root, id) { return (await loadKernelApi()).takePendingWrite(rootOf(root), id); }
export async function rejectPendingWrite(root, id) { return (await loadKernelApi()).rejectPendingWrite(rootOf(root), id); }
export async function acceptPendingWrite(root, id) { return (await loadKernelApi()).acceptPendingWrite(rootOf(root), id); }
