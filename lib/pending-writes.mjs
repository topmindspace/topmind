/** Shared review queue. Legacy {items} files are accepted; write failures remain pending. */
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readWorkspaceState, writeWorkspaceState } from './workspace-state.mjs';
import { resolveWorkspacePath } from './model-core.mjs';
import { loadContract } from './contract-engine.mjs';
import { executeWrite, executeDelete, executeArchive } from './writeback-engine.mjs';

const FILE = 'pending-writes.json';
export const MAX_PENDING_WRITES = 20;
function operationFor(entry) {
  return entry.operation || (entry.toolName === 'delete_path' ? 'delete' : 'write');
}
function validateEntry(entry) {
  return entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.relativePath === 'string' && typeof entry.content === 'string' && ['write','delete','archive'].includes(operationFor(entry));
}
function load(root) {
  const state = readWorkspaceState(root, FILE, { items: [] }, value => value && Array.isArray(value.items) && value.items.length <= MAX_PENDING_WRITES && value.items.every(validateEntry));
  for (const entry of state.items) resolveWorkspacePath(root, entry.relativePath);
  return state.items;
}
function save(root, items) {
  writeWorkspaceState(root, FILE, { version: 1, items, updatedAt: new Date().toISOString() });
}
function currentHash(root, relativePath) {
  const file = resolveWorkspacePath(root, relativePath).absolute;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4 * 1024 * 1024) return null;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,16);
}
export function listPendingWrites(root) { return root ? load(root).map(entry => ({ ...entry, operation: operationFor(entry) })) : []; }
export function stashPendingWrite({ workspaceRoot, relativePath, content = '', toolName = 'write', operation, expectedHash }) {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const entry = { id: `pw-${randomUUID()}`, relativePath: resolved.relativePath, content: String(content), toolName, operation: operation || (toolName === 'delete_path' ? 'delete' : 'write'), createdAt: new Date().toISOString() };
  if (!entry.relativePath || (entry.operation === 'write' && !entry.content) || !validateEntry(entry)) throw new Error('invalid-pending-write');
  const items = load(workspaceRoot);
  if (items.length >= MAX_PENDING_WRITES) throw new Error('pending-writes queue is full');
  const hash = expectedHash || currentHash(workspaceRoot, resolved.relativePath);
  if (hash) entry.expectedHash = hash;
  save(workspaceRoot, [...items, entry]);
  return entry;
}
export function rejectPendingWrite(root, id) {
  const items = load(root);
  if (!items.some(entry => entry.id === id)) return false;
  save(root, items.filter(entry => entry.id !== id));
  return true;
}
export function takePendingWrite(root, id) {
  const entry = load(root).find(item => item.id === id);
  if (entry) rejectPendingWrite(root, id);
  return entry || null;
}
export function restorePendingWrite(root, entry) {
  if (!validateEntry(entry)) throw new Error('invalid-pending-write');
  resolveWorkspacePath(root, entry.relativePath);
  const items = load(root).filter(item => item.id !== entry.id);
  if (items.length >= MAX_PENDING_WRITES) throw new Error('pending-writes queue is full');
  save(root, [...items, entry]);
}
export function acceptPendingWrite(root, id) {
  const entry = load(root).find(item => item.id === id);
  if (!entry) return { ok: false, error: 'pending-write-not-found' };
  if (entry.expectedHash && currentHash(root, entry.relativePath) !== entry.expectedHash) return { ok: false, error: 'pending-write-conflict', relativePath: entry.relativePath };
  const args = { targetPath: resolveWorkspacePath(root, entry.relativePath).absolute, workspaceRoot: root, contract: loadContract(root), actor: 'user', confirmed: true };
  const operation = operationFor(entry);
  const result = operation === 'delete' ? executeDelete(args) : operation === 'archive' ? executeArchive(args) : executeWrite({ ...args, content: entry.content, operation: 'update' });
  if (result?.wroteFiles === false || result?.wrote_files === false || result?.pending || result?.operation === 'skip') return { ok: false, error: result?.reason || 'write-failed', evidence: result };
  rejectPendingWrite(root, id);
  return { ok: true, relativePath: entry.relativePath, evidence: result };
}
