/**
 * In-workspace home — pure content rules.
 * The React canvas calls this; tests import the same function.
 * Actions only open flows that already exist. No sample notes, no sixth concept,
 * no suggestion-confirm list.
 */
import type { Selection } from "../../types";

export type HomePeriodSnap = {
  relPath: string;
  title?: string | null;
  fileName?: string | null;
  mtime?: string | null;
};

export type HomeItemSnap = {
  name: string;
  relativePath: string;
  mtime?: string | null;
};

export type HomeCategorySnap = {
  name?: string | null;
  role?: string | null;
  hidden?: boolean;
};

export type HomeStreamContext = {
  /** Computed packing path. Counts only when this path is also in `periods`. */
  periodRelPath?: string | null;
  periodTitle?: string | null;
  periodFileName?: string | null;
};

export type HomeWorkspaceSnapshot = {
  /** Explicit display name. Empty falls back to the root folder name. */
  name?: string | null;
  root?: string | null;
  /** Raw `getStreamContext` result. A path absent from `periods` is not a file. */
  streamContext?: HomeStreamContext | null;
  /**
   * `listStreamPeriods` rows. Filename order is the period order (newest name first),
   * the same order Stream uses. mtime does not reorder them.
   */
  periods?: HomePeriodSnap[] | null;
  inbox?: { count?: number; items?: HomeItemSnap[] } | null;
  outputs?: { count?: number; items?: HomeItemSnap[] } | null;
  categories?: HomeCategorySnap[] | null;
};

export const HOME_ACTION_IDS = [
  "capture",
  "stream",
  "inbox",
  "outputs",
  "memory",
  "topics",
] as const;

export type HomeActionId = (typeof HOME_ACTION_IDS)[number];

export type HomeAction = {
  id: HomeActionId;
  /** Omitted for capture (opens the existing 记一下 overlay) and for 专题 when there is no single category. */
  target?: Selection;
};

export type HomeTopicEntry = {
  name: string;
  target: Selection;
};

export type HomePeriodInfo = {
  present: boolean;
  title: string | null;
  relPath: string | null;
  fileName: string | null;
  source: "current" | "latest" | "none";
};

export type HomeSummary = {
  identity: { name: string; root: string };
  actions: HomeAction[];
  period: HomePeriodInfo;
  inbox: { count: number; items: HomeItemSnap[] };
  outputs: { count: number; items: HomeItemSnap[] };
  topics: HomeTopicEntry[];
  /** No period, nothing in Inbox or 交付, and no topic category. */
  empty: boolean;
};

const TOPIC_SKIP_ROLES = new Set(["buffer", "delivery", "system", "loose-stream"]);

/** Folder name of a workspace root — the recognizable identity when no other name is set. */
export function workspaceDisplayName(root: string | null | undefined, explicitName?: string | null): string {
  const named = String(explicitName || "").trim();
  if (named) return named;
  const norm = String(root || "").replace(/\\/g, "/").replace(/\/+$/u, "");
  if (!norm) return "";
  const base = norm.split("/").pop() || "";
  return base;
}

function normRel(value: string | null | undefined): string {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//u, "");
}

function fileNameOf(period: HomePeriodSnap): string {
  const named = String(period.fileName || "").trim();
  if (named) return named;
  const rel = normRel(period.relPath);
  return rel.split("/").pop() || rel;
}

/** Same order as listStreamPeriods: filename descending, then path. */
function filenameNewest(periods: readonly HomePeriodSnap[]): HomePeriodSnap | null {
  const list = periods.filter((period) => period && normRel(period.relPath));
  if (list.length === 0) return null;
  return [...list].sort(
    (a, b) => fileNameOf(b).localeCompare(fileNameOf(a)) || normRel(b.relPath).localeCompare(normRel(a.relPath)),
  )[0];
}

const NO_PERIOD: HomePeriodInfo = {
  present: false,
  title: null,
  relPath: null,
  fileName: null,
  source: "none",
};

/**
 * Current packing path only when that file is in the listed periods.
 * Otherwise the filename-newest listed note. A computed path with an empty list is absent.
 */
function periodInfo(snapshot: HomeWorkspaceSnapshot): HomePeriodInfo {
  const periods = Array.isArray(snapshot.periods) ? snapshot.periods : [];
  const wanted = normRel(snapshot.streamContext?.periodRelPath);
  if (wanted) {
    const listed = periods.find((period) => normRel(period?.relPath) === wanted);
    if (listed) {
      const title =
        String(snapshot.streamContext?.periodTitle || "").trim() ||
        String(listed.title || "").trim() ||
        fileNameOf(listed) ||
        null;
      return {
        present: true,
        title,
        relPath: normRel(listed.relPath),
        fileName: listed.fileName || fileNameOf(listed) || null,
        source: "current",
      };
    }
  }
  const newest = filenameNewest(periods);
  if (!newest) return NO_PERIOD;
  const title = String(newest.title || "").trim() || fileNameOf(newest) || null;
  return {
    present: true,
    title,
    relPath: normRel(newest.relPath),
    fileName: newest.fileName || fileNameOf(newest) || null,
    source: "latest",
  };
}

function topicEntries(categories: HomeCategorySnap[] | null | undefined): HomeTopicEntry[] {
  const out: HomeTopicEntry[] = [];
  for (const category of categories || []) {
    if (!category || category.hidden) continue;
    if (TOPIC_SKIP_ROLES.has(String(category.role || ""))) continue;
    const name = String(category.name || "").trim();
    if (!name) continue;
    out.push({ name, target: { kind: "category", category: name } });
  }
  return out;
}

function itemBlock(block: { count?: number; items?: HomeItemSnap[] } | null | undefined): {
  count: number;
  items: HomeItemSnap[];
} {
  const items = Array.isArray(block?.items) ? block.items.filter((item) => item && item.relativePath) : [];
  const count = typeof block?.count === "number" && Number.isFinite(block.count) ? block.count : items.length;
  return { count, items };
}

/** Identity, the six existing actions, and live info echoed from the snapshot. */
export function summarizeWorkspaceHome(snapshot: HomeWorkspaceSnapshot): HomeSummary {
  const root = String(snapshot.root || "");
  const topics = topicEntries(snapshot.categories);
  const period = periodInfo(snapshot);
  const inbox = itemBlock(snapshot.inbox);
  const outputs = itemBlock(snapshot.outputs);
  const topicsAction: HomeAction = { id: "topics" };
  if (topics.length === 1) topicsAction.target = topics[0].target;
  return {
    identity: {
      name: workspaceDisplayName(root, snapshot.name),
      root,
    },
    actions: [
      { id: "capture" },
      { id: "stream", target: { kind: "stream" } },
      { id: "inbox", target: { kind: "inbox" } },
      { id: "outputs", target: { kind: "outputs" } },
      { id: "memory", target: { kind: "memory" } },
      topicsAction,
    ],
    period,
    inbox,
    outputs,
    topics,
    empty: !period.present && inbox.count === 0 && outputs.count === 0 && topics.length === 0,
  };
}
