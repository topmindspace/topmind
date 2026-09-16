/**
 * In-memory pending write queue for confirm-mode (保存前问我).
 * Not content truth — cleared on process restart.
 * When full, new stashes are rejected (not silently dropped) so the
 * surface can surface an error rather than losing a write.
 */

/** @type {Map<string, { id: string, relativePath: string, content: string, toolName?: string, createdAt: string }>} */
const pending = new Map();
const MAX_PENDING = 20;

export function stashPendingWrite({ relativePath, content, toolName }) {
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
  return entry;
}

export function listPendingWrites() {
  return [...pending.values()];
}

export function takePendingWrite(id) {
  const e = pending.get(id);
  if (e) pending.delete(id);
  return e || null;
}

export function rejectPendingWrite(id) {
  return pending.delete(id);
}
