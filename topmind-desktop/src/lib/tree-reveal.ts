/**
 * Sidebar tree reveal helpers — expand ancestors for the current selection
 * so the active file/topic is never buried under collapsed folders.
 */
import type { Selection } from "../types";

/** Node ids that should be expanded so `selection` is visible in the category tree. */
export function expandIdsForSelection(sel: Selection): string[] {
  switch (sel.kind) {
    case "inbox":
      return ["section/inbox"];
    case "outputs":
      return ["section/outputs"];
    case "archive":
      return ["section/archive"];
    case "category":
      return [`cat/${sel.category}`];
    case "topic": {
      const cat = sel.topicId.split("/")[0];
      return cat ? [`cat/${cat}`, sel.topicId] : [sel.topicId];
    }
    case "file": {
      const path = sel.path.replace(/\\/g, "/");
      const parts = path.split("/").filter(Boolean);
      if (parts.length === 0) return [];

      const root = parts[0];
      // Buffer / delivery / system — expand section + intermediate folders
      if (/^00([- ]|$)/u.test(root) || /inbox/iu.test(root)) {
        return ["section/inbox"];
      }
      if (/^88([- ]|$)/u.test(root) || /outputs?/iu.test(root)) {
        const ids = ["section/outputs"];
        // Nested: 88-Outputs/sub/file → folder/88-Outputs/sub
        for (let i = 1; i < parts.length - 1; i++) {
          ids.push(`folder/${parts.slice(0, i + 1).join("/")}`);
        }
        return ids;
      }
      if (/^99([- ]|$)/u.test(root) || /archive/iu.test(root)) {
        const ids = ["section/archive"];
        for (let i = 1; i < parts.length - 1; i++) {
          ids.push(`folder/${parts.slice(0, i + 1).join("/")}`);
        }
        return ids;
      }
      if (root === "memory") {
        const ids = ["section/memory"];
        for (let i = 1; i < parts.length - 1; i++) {
          ids.push(`folder/${parts.slice(0, i + 1).join("/")}`);
        }
        return ids;
      }

      // Prefer explicit topicId when present
      const topicId = sel.topicId || (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "");
      const cat = topicId ? topicId.split("/")[0] : parts[0];
      const ids: string[] = [];
      if (cat) ids.push(`cat/${cat}`);
      if (topicId) ids.push(topicId);
      // Nested under topic: Category/Topic/sub/file.md → folder/Category/Topic/sub
      if (parts.length > 3) {
        for (let i = 2; i < parts.length - 1; i++) {
          ids.push(`folder/${parts.slice(0, i + 1).join("/")}`);
        }
      }
      // Category loose note: Category/file.md
      if (parts.length === 2 && !sel.topicId) {
        return [`cat/${parts[0]}`];
      }
      return ids.length ? ids : [`cat/${parts[0]}`];
    }
    case "stream":
      return [];
    case "memory":
      return ["section/memory"];
    default:
      return [];
  }
}

/**
 * Default open folders for a fresh workspace (no saved expand state):
 * open all category roots + non-empty system sections so the tree is scannable.
 */
export function defaultExpandIds(
  treeRoots: { id: string; kind: string; children?: unknown[] }[],
): string[] {
  const ids: string[] = [];
  for (const n of treeRoots) {
    if (n.kind === "category") ids.push(n.id);
    if (n.kind === "group" && Array.isArray(n.children) && n.children.length > 0) {
      ids.push(n.id);
    }
  }
  return ids;
}

/** All expandable node ids (groups / categories / topics with children). */
export function collectExpandableIds(
  nodes: { id: string; kind: string; children?: { id: string; kind: string; children?: unknown[]; meta?: { fileCount?: number; lazy?: boolean } }[]; meta?: { fileCount?: number; lazy?: boolean } }[],
): string[] {
  const ids: string[] = [];
  const walk = (list: typeof nodes) => {
    for (const n of list) {
      const kids = n.children || [];
      const hasKids =
        kids.length > 0 ||
        (typeof n.meta?.fileCount === "number" && n.meta.fileCount > 0) ||
        Boolean(n.meta?.lazy);
      if (
        hasKids &&
        (n.kind === "group" || n.kind === "category" || n.kind === "topic")
      ) {
        ids.push(n.id);
      }
      if (kids.length) walk(kids as typeof nodes);
    }
  };
  walk(nodes);
  return ids;
}

/** Stable key for comparing selections (matches TreeView). */
export function selectionKey(sel: Selection | null | undefined): string {
  if (!sel) return "";
  switch (sel.kind) {
    case "stream":
      return "stream";
    case "inbox":
      return "inbox";
    case "outputs":
      return "outputs";
    case "archive":
      return "archive";
    case "category":
      return `category:${sel.category}`;
    case "topic":
      return `topic:${sel.topicId}`;
    case "file":
      return `file:${sel.path}`;
    case "connector":
      return `connector:${sel.id}`;
    default:
      return "";
  }
}

/** Recent file paths from navigation history (newest first, unique). */
export function recentFilePathsFromHistory(
  history: Selection[],
  historyIndex: number,
  limit = 12,
): string[] {
  const slice = history.slice(0, historyIndex + 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = slice.length - 1; i >= 0; i--) {
    const s = slice[i];
    if (s.kind !== "file") continue;
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    out.push(s.path);
    if (out.length >= limit) break;
  }
  return out;
}
