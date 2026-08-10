/**
 * In-memory pending write queue for confirm-mode (保存前问我).
 * Not content truth — cleared on process restart.
 */

/** @type {Map<string, { id: string, relativePath: string, content: string, toolName?: string, createdAt: string }>} */
const pending = new Map();

export function stashPendingWrite({ relativePath, content, toolName }) {
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
  // Cap queue
  if (pending.size > 20) {
    const first = pending.keys().next().value;
    if (first) pending.delete(first);
  }
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
