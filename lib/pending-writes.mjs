/** Shared review queue. Legacy {items} files are accepted; write failures remain pending. */
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readWorkspaceState, writeWorkspaceState } from './workspace-state.mjs';
import { resolveWorkspacePath } from './model-core.mjs';
import { loadContract } from './contract-engine.mjs';
import { executeWrite, executeDelete, executeArchive } from './writeback-engine.mjs';

const FILE = 'pending-writes.json';
export const MAX_PENDING_WRITES = 20;
const MAX_REVIEW_RESULTS = 80;
function operationFor(entry) {
  return entry.operation || (entry.toolName === 'delete_path' ? 'delete' : 'write');
}
function validateEntry(entry) {
  return entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.relativePath === 'string' && typeof entry.content === 'string' && ['write','delete','archive'].includes(operationFor(entry));
}
function load(root) {
  const state = readWorkspaceState(root, FILE, { items: [] }, value => value && Array.isArray(value.items) && value.items.length <= MAX_PENDING_WRITES && value.items.every(validateEntry)
    && (value.reviews === undefined || (Array.isArray(value.reviews) && value.reviews.length <= MAX_REVIEW_RESULTS && value.reviews.every(review =>
      typeof review?.id === 'string' && ['accepted', 'rejected'].includes(review.status)
      && Array.isArray(review.paths) && review.paths.every(file => typeof file === 'string')))));
  for (const entry of state.items) resolveWorkspacePath(root, entry.relativePath);
  return { items: state.items, reviews: state.reviews || [] };
}
function save(root, state) {
  writeWorkspaceState(root, FILE, { version: 1, ...state, updatedAt: new Date().toISOString() });
}
function currentHash(root, relativePath) {
  const file = resolveWorkspacePath(root, relativePath).absolute;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4 * 1024 * 1024) return null;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,16);
}
export function listPendingWrites(root) { return root ? load(root).items.map(entry => ({ ...entry, operation: operationFor(entry) })) : []; }
export function getPendingWriteReviews(root, ids) {
  const { items, reviews } = load(root);
  return ids.map(id => items.some(item => item.id === id) ? { id, status: 'pending', paths: [] }
    : reviews.find(review => review.id === id) || { id, status: 'unknown', paths: [] });
}
export function stashPendingWrite({ workspaceRoot, relativePath, content = '', toolName = 'write', operation, expectedHash }) {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const entry = { id: `pw-${randomUUID()}`, relativePath: resolved.relativePath, content: String(content), toolName, operation: operation || (toolName === 'delete_path' ? 'delete' : 'write'), createdAt: new Date().toISOString() };
  if (!entry.relativePath || (entry.operation === 'write' && !entry.content) || !validateEntry(entry)) throw new Error('invalid-pending-write');
  const state = load(workspaceRoot);
  if (state.items.length >= MAX_PENDING_WRITES) throw new Error('pending-writes queue is full');
  const hash = expectedHash || currentHash(workspaceRoot, resolved.relativePath);
  if (hash) entry.expectedHash = hash;
  save(workspaceRoot, { ...state, items: [...state.items, entry] });
  return entry;
}
function finishReview(root, state, id, status, paths = []) {
  if (!state.items.some(entry => entry.id === id)) return false;
  save(root, {
    items: state.items.filter(entry => entry.id !== id),
    reviews: [...state.reviews.filter(review => review.id !== id), { id, status, paths }].slice(-MAX_REVIEW_RESULTS),
  });
  return true;
}
export function rejectPendingWrite(root, id) { return finishReview(root, load(root), id, 'rejected'); }
export function takePendingWrite(root, id) {
  const state = load(root);
  const entry = state.items.find(item => item.id === id);
  if (entry) save(root, { ...state, items: state.items.filter(item => item.id !== id) });
  return entry || null;
}
export function restorePendingWrite(root, entry) {
  if (!validateEntry(entry)) throw new Error('invalid-pending-write');
  resolveWorkspacePath(root, entry.relativePath);
  const state = load(root);
  const items = state.items.filter(item => item.id !== entry.id);
  if (items.length >= MAX_PENDING_WRITES) throw new Error('pending-writes queue is full');
  save(root, { ...state, items: [...items, entry] });
}
export function acceptPendingWrite(root, id) {
  const state = load(root);
  const entry = state.items.find(item => item.id === id);
  if (!entry) return { ok: false, error: 'pending-write-not-found' };
  if (entry.expectedHash && currentHash(root, entry.relativePath) !== entry.expectedHash) return { ok: false, error: 'pending-write-conflict', relativePath: entry.relativePath };
  const args = { targetPath: resolveWorkspacePath(root, entry.relativePath).absolute, workspaceRoot: root, contract: loadContract(root), actor: 'user', confirmed: true };
  const operation = operationFor(entry);
  const result = operation === 'delete' ? executeDelete(args) : operation === 'archive' ? executeArchive(args) : executeWrite({ ...args, content: entry.content, operation: 'update' });
  if (result?.wroteFiles === false || result?.wrote_files === false || result?.pending || result?.operation === 'skip') return { ok: false, error: result?.reason || 'write-failed', evidence: result };
  finishReview(root, load(root), id, 'accepted', [entry.relativePath]);
  return { ok: true, relativePath: entry.relativePath, evidence: result };
}
