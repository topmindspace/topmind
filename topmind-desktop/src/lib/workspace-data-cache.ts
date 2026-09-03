/**
 * Short-TTL client cache for workspace list scans shared by Timeline / Tags / Kanban / Inbox / PrimaryNav badges.
 * Invalidates on workspace:file-changed (lazy subscription).
 * Projection honesty: total/returned ≠ full census when truncated — surface scannedTotal.
 */
import type { NoteMeta, Topic } from "../types";
import { api } from "../services/api";
// host is already in the main graph (Shell / Sidebar / stores). Static import
// avoids a useless dynamic-import warning and keeps cache invalidation sync.
import { onLocal } from "../plugins/host";

const NOTES_TTL_MS = 4500;
const TOPICS_TTL_MS = 8000;

type NotesHit = {
  at: number;
  limit: number;
  notes: NoteMeta[];
  total: number;
  returned?: number;
  scannedTotal?: number;
  truncated?: boolean;
  complete?: boolean;
};
type TopicGroup = { category: string; topics: Topic[] };
type TopicsHit = { at: number; includeSystem: boolean; groups: TopicGroup[] };

let notesCache: NotesHit | null = null;
let topicsCache: TopicsHit | null = null;
let listening = false;

function ensureInvalidationListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  onLocal("workspace:file-changed", () => {
    notesCache = null;
    topicsCache = null;
  });
}

let inFlightNotesPromise: Promise<{
  notes: NoteMeta[];
  total: number;
  returned?: number;
  scannedTotal?: number;
  truncated?: boolean;
  complete?: boolean;
}> | null = null;

let inFlightTopicsPromise: Promise<TopicGroup[]> | null = null;

export function invalidateWorkspaceDataCache() {
  notesCache = null;
  topicsCache = null;
}

/** Cached workspace.listAllNotes — reuses warm index and collapses concurrent calls. */
export async function getCachedAllNotes(
  limit = 500,
): Promise<{
  notes: NoteMeta[];
  total: number;
  returned?: number;
  scannedTotal?: number;
  truncated?: boolean;
  complete?: boolean;
}> {
  ensureInvalidationListener();
  const now = Date.now();
  if (notesCache && notesCache.limit >= limit && now - notesCache.at < NOTES_TTL_MS) {
    const notes = notesCache.notes.slice(0, limit);
    return {
      notes,
      total: notesCache.total,
      returned: notes.length,
      scannedTotal: notesCache.scannedTotal ?? notesCache.total,
      truncated: notesCache.truncated,
      complete: notesCache.complete,
    };
  }

  // Deduplicate concurrent in-flight requests (e.g. multiple tabs/badges mounting simultaneously)
  if (inFlightNotesPromise) return inFlightNotesPromise;

  inFlightNotesPromise = (async () => {
    try {
      const result = await api.ws.allNotes(limit);
      const total = result.total ?? (result.notes || []).length;
      notesCache = {
        at: Date.now(), // after fetch so TTL starts when data is ready
        limit,
        notes: result.notes || [],
        total,
        returned: result.returned ?? (result.notes || []).length,
        scannedTotal: result.scannedTotal ?? total,
        truncated: Boolean(result.truncated),
        complete: result.complete !== false && !result.truncated,
      };
      return {
        notes: notesCache.notes,
        total: notesCache.total,
        returned: notesCache.returned,
        scannedTotal: notesCache.scannedTotal,
        truncated: notesCache.truncated,
        complete: notesCache.complete,
      };
    } finally {
      inFlightNotesPromise = null;
    }
  })();

  return inFlightNotesPromise;
}

/** Cached category→topics for Inbox picker (N+1 collapse across open/close & in-flight dedupe). */
export async function getCachedTopicGroups(includeSystem = false): Promise<TopicGroup[]> {
  ensureInvalidationListener();
  const now = Date.now();
  if (
    topicsCache &&
    topicsCache.includeSystem === includeSystem &&
    now - topicsCache.at < TOPICS_TTL_MS
  ) {
    return topicsCache.groups;
  }

  if (inFlightTopicsPromise) return inFlightTopicsPromise;

  inFlightTopicsPromise = (async () => {
    try {
      const { categories } = await api.ws.categories();
      // Prefer role when present (workspace-model); fall back to NN prefix for older payloads
      const list = includeSystem
        ? categories
        : categories.filter((c) => {
            const role = (c as { role?: string }).role;
            if (role === "system" || role === "buffer" || role === "delivery") return false;
            if (role) return true;
            return !/^(00|88|99)[ -]/u.test(c.name);
          });
      const results = await Promise.all(
        list.map(async (c) => {
          const { topics: ts } = await api.ws.topics(c.name);
          return { category: c.name, topics: ts };
        }),
      );
      const groups = results.filter((g) => g.topics.length > 0);
      topicsCache = { at: Date.now(), includeSystem, groups };
      return groups;
    } finally {
      inFlightTopicsPromise = null;
    }
  })();

  return inFlightTopicsPromise;
}

/**
 * Derive recent topics from NoteMeta index — avoids N× listTopics (timeline/tags/kanban).
 */
export function deriveRecentTopicsFromNotes(
  notes: NoteMeta[],
  max = 6,
): { id: string; name: string; updatedAt: string; fileCount: number }[] {
  const map = new Map<
    string,
    { id: string; name: string; updatedAt: string; fileCount: number }
  >();
  for (const n of notes) {
    if (!n.category || !n.topic) continue;
    // Skip buffer/delivery/system trees by conventional NN prefix (notes index has no role field)
    if (/^(00|88|99)[ -]/u.test(n.category)) continue;
    const id = `${n.category}/${n.topic}`;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, {
        id,
        name: n.topic,
        updatedAt: n.mtime || new Date(0).toISOString(),
        fileCount: 1,
      });
    } else {
      prev.fileCount += 1;
      if (n.mtime && n.mtime > prev.updatedAt) prev.updatedAt = n.mtime;
    }
  }
  return [...map.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, max);
}

export function countTopicsFromNotes(notes: NoteMeta[]): number {
  const set = new Set<string>();
  for (const n of notes) {
    if (!n.category || !n.topic) continue;
    if (/^(00|88|99)[ -]/u.test(n.category)) continue;
    set.add(`${n.category}/${n.topic}`);
  }
  return set.size;
}
