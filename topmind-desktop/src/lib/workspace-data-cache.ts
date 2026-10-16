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
let notesEpoch = 0;
let topicsEpoch = 0;

function ensureInvalidationListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  onLocal("workspace:file-changed", () => {
    invalidateWorkspaceDataCache();
  });
}

type NotesPayload = {
  notes: NoteMeta[];
  total: number;
  returned?: number;
  scannedTotal?: number;
  truncated?: boolean;
  complete?: boolean;
};

type NotesReader = (limit: number) => Promise<{
  notes?: NoteMeta[];
  total?: number;
  returned?: number;
  scannedTotal?: number;
  truncated?: boolean;
  complete?: boolean;
}>;

let readAllNotes: NotesReader = (limit) => api.ws.allNotes(limit);
let readCategories = () => api.ws.categories();
let readTopics = (name: string) => api.ws.topics(name);

/** Identical in-flight note reads share one call. A larger limit covers a smaller one. */
const inFlightNotes = new Map<number, Promise<NotesHit>>();
/** Identical topic reads (same includeSystem) share one call. */
const inFlightTopics = new Map<boolean, Promise<TopicGroup[]>>();

export function invalidateWorkspaceDataCache() {
  notesEpoch += 1;
  topicsEpoch += 1;
  notesCache = null;
  topicsCache = null;
}

/**
 * Tests replace the IPC readers. Production uses `api.ws`.
 * Pass null to restore the real readers.
 */
export function bindWorkspaceReadersForTests(
  readers: {
    allNotes?: NotesReader;
    categories?: typeof readCategories;
    topics?: typeof readTopics;
  } | null,
) {
  readAllNotes = readers?.allNotes ?? ((limit) => api.ws.allNotes(limit));
  readCategories = readers?.categories ?? (() => api.ws.categories());
  readTopics = readers?.topics ?? ((name) => api.ws.topics(name));
  invalidateWorkspaceDataCache();
  inFlightNotes.clear();
  inFlightTopics.clear();
}

function payloadFromHit(hit: NotesHit, limit: number): NotesPayload {
  const notes = hit.notes.slice(0, limit);
  return {
    notes,
    total: hit.total,
    returned: notes.length,
    scannedTotal: hit.scannedTotal ?? hit.total,
    truncated: hit.truncated,
    complete: hit.complete,
  };
}

function hitFromResult(
  result: Awaited<ReturnType<NotesReader>>,
  limit: number,
): NotesHit {
  const notes = result.notes || [];
  const total = result.total ?? notes.length;
  return {
    at: Date.now(),
    limit,
    notes,
    total,
    returned: result.returned ?? notes.length,
    scannedTotal: result.scannedTotal ?? total,
    truncated: Boolean(result.truncated),
    complete: result.complete !== false && !result.truncated,
  };
}

function coveringNotesFlight(limit: number): Promise<NotesHit> | null {
  let bestLimit = Infinity;
  let best: Promise<NotesHit> | null = null;
  for (const [inflightLimit, flight] of inFlightNotes) {
    if (inflightLimit >= limit && inflightLimit < bestLimit) {
      bestLimit = inflightLimit;
      best = flight;
    }
  }
  return best;
}

/** Cached workspace.listAllNotes — reuses warm index and collapses identical concurrent calls. */
export async function getCachedAllNotes(limit = 500): Promise<NotesPayload> {
  ensureInvalidationListener();
  const now = Date.now();
  if (notesCache && notesCache.limit >= limit && now - notesCache.at < NOTES_TTL_MS) {
    return payloadFromHit(notesCache, limit);
  }

  const exact = inFlightNotes.get(limit);
  if (exact) return exact.then((hit) => payloadFromHit(hit, limit));
  const covered = coveringNotesFlight(limit);
  if (covered) return covered.then((hit) => payloadFromHit(hit, limit));

  const epoch = notesEpoch;
  let flight!: Promise<NotesHit>;
  flight = (async () => {
    try {
      const hit = hitFromResult(await readAllNotes(limit), limit);
      if (epoch === notesEpoch && (!notesCache || notesCache.limit <= limit)) {
        notesCache = hit;
      }
      return hit;
    } finally {
      if (inFlightNotes.get(limit) === flight) inFlightNotes.delete(limit);
    }
  })();
  inFlightNotes.set(limit, flight);
  return flight.then((hit) => payloadFromHit(hit, limit));
}

/** Cached category→topics. Identical includeSystem reads share one in-flight call. */
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

  const existing = inFlightTopics.get(includeSystem);
  if (existing) return existing;

  const epoch = topicsEpoch;
  let flight!: Promise<TopicGroup[]>;
  flight = (async () => {
    try {
      const { categories } = await readCategories();
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
          const { topics: ts } = await readTopics(c.name);
          return { category: c.name, topics: ts };
        }),
      );
      const groups = results.filter((g) => g.topics.length > 0);
      if (epoch === topicsEpoch) {
        topicsCache = { at: Date.now(), includeSystem, groups };
      }
      return groups;
    } finally {
      if (inFlightTopics.get(includeSystem) === flight) inFlightTopics.delete(includeSystem);
    }
  })();
  inFlightTopics.set(includeSystem, flight);
  return flight;
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
