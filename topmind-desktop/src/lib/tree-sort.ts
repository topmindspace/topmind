/**
 * Sidebar tree sort helpers (category mode).
 *
 * Structural top-level layout is fixed (not affected by user sort mode):
 *   section/inbox → categories (NN/slot order) → section/outputs → section/archive
 * Sort mode (mtime / name) only reorders topic / file siblings under each parent.
 *
 * Uses the i18n instance directly for locale-aware sort option labels.
 */
import i18n from "../locales";
import type { TreeNode } from "../plugins/types";

export type TreeSortMode = "mtime-desc" | "mtime-asc" | "name-asc" | "name-desc";

export function getTreeSortOptions(): { id: TreeSortMode; label: string }[] {
  return [
    { id: "mtime-desc", label: i18n.t("workspace:sort.mtimeDesc") },
    { id: "mtime-asc", label: i18n.t("workspace:sort.mtimeAsc") },
    { id: "name-asc", label: i18n.t("workspace:sort.nameAsc") },
    { id: "name-desc", label: i18n.t("workspace:sort.nameDesc") },
  ];
}

export const DEFAULT_TREE_SORT: TreeSortMode = "mtime-desc";

/** Fixed top-level band for workspace sections (lower = higher in tree). */
function sectionBand(node: TreeNode): number | null {
  if (node.id === "section/inbox") return 0;
  if (node.kind === "category") return 1;
  if (node.id === "section/outputs") return 2;
  if (node.id === "section/archive") return 3;
  if (node.kind === "group") return 4;
  return null;
}

function mtimeOf(node: TreeNode): number {
  const raw = node.meta?.mtime;
  if (typeof raw === "string" && raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function labelKey(node: TreeNode): string {
  return String(node.label || node.id || "").toLocaleLowerCase();
}

/** Category NN / slot key — always ascending regardless of sort mode. */
function categoryKey(node: TreeNode): string {
  const slot = node.meta?.slot;
  if (typeof slot === "string" && slot) return slot.padStart(4, "0");
  if (typeof slot === "number" && Number.isFinite(slot)) return String(slot).padStart(4, "0");
  const fromId = String(node.id || "").replace(/^cat\//u, "");
  const m = /^(\d{1,3})/u.exec(fromId) || /^(\d{1,3})/u.exec(String(node.label || ""));
  if (m) return m[1].padStart(4, "0");
  return fromId || labelKey(node);
}

function contentCompare(a: TreeNode, b: TreeNode, mode: TreeSortMode): number {
  switch (mode) {
    case "mtime-asc":
      return mtimeOf(a) - mtimeOf(b) || labelKey(a).localeCompare(labelKey(b), undefined, { numeric: true });
    case "name-asc":
      return labelKey(a).localeCompare(labelKey(b), undefined, { numeric: true });
    case "name-desc":
      return labelKey(b).localeCompare(labelKey(a), undefined, { numeric: true });
    case "mtime-desc":
    default:
      return mtimeOf(b) - mtimeOf(a) || labelKey(a).localeCompare(labelKey(b), undefined, { numeric: true });
  }
}

/** Stable sort of sibling nodes (does not recurse). */
export function sortTreeSiblings(nodes: TreeNode[], mode: TreeSortMode): TreeNode[] {
  if (!nodes?.length) return nodes || [];
  const copy = [...nodes];
  copy.sort((a, b) => {
    const ba = sectionBand(a);
    const bb = sectionBand(b);
    // Top-level structural mix (inbox / categories / outputs / archive)
    if (ba != null && bb != null && (ba !== 1 || bb !== 1)) {
      if (ba !== bb) return ba - bb;
    }
    // Categories always NN/slot order among themselves
    if (a.kind === "category" && b.kind === "category") {
      return categoryKey(a).localeCompare(categoryKey(b), undefined, { numeric: true });
    }
    // Two groups with same band (shouldn't happen) — stable by id
    if (a.kind === "group" && b.kind === "group") {
      return String(a.id).localeCompare(String(b.id));
    }
    // Topic / file / other content: user sort mode
    return contentCompare(a, b, mode);
  });
  return copy;
}

/** Deep-sort: sort each level's children for display. */
export function sortTreeDeep(nodes: TreeNode[], mode: TreeSortMode): TreeNode[] {
  return sortTreeSiblings(nodes, mode).map((n) => {
    if (!n.children?.length) return n;
    return { ...n, children: sortTreeDeep(n.children, mode) };
  });
}

export function isTreeSortMode(v: unknown): v is TreeSortMode {
  return (
    v === "mtime-desc" ||
    v === "mtime-asc" ||
    v === "name-asc" ||
    v === "name-desc"
  );
}
