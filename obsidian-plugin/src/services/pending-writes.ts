/**
 * In-memory pending write queue for confirm-mode (保存前问我).
 * Not content truth — cleared when the plugin unloads.
 */

export interface PendingWrite {
  id: string;
  relativePath: string;
  content: string;
  toolName?: string;
  createdAt: string;
}

const pending = new Map<string, PendingWrite>();

export function stashPendingWrite(opts: {
  relativePath: string;
  content: string;
  toolName?: string;
}): PendingWrite {
  const id = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: PendingWrite = {
    id,
    relativePath: String(opts.relativePath || "").replace(/\\/g, "/"),
    content: String(opts.content ?? ""),
    toolName: opts.toolName || "write",
    createdAt: new Date().toISOString(),
  };
  if (!entry.relativePath || !entry.content) {
    throw new Error("stashPendingWrite requires relativePath and content");
  }
  pending.set(id, entry);
  if (pending.size > 20) {
    const first = pending.keys().next().value;
    if (first) pending.delete(first);
  }
  return entry;
}

export function listPendingWrites(): PendingWrite[] {
  return [...pending.values()];
}

export function takePendingWrite(id: string): PendingWrite | null {
  const e = pending.get(id);
  if (e) pending.delete(id);
  return e || null;
}

export function rejectPendingWrite(id: string): boolean {
  return pending.delete(id);
}

/** Put an entry back (accept failed after take). Keeps the original id. */
export function restorePendingWrite(entry: PendingWrite): void {
  if (!entry?.id || !entry.relativePath) return;
  pending.set(entry.id, entry);
}

/** Test-only: drop the in-memory queue. */
export function clearPendingWrites(): void {
  pending.clear();
}
