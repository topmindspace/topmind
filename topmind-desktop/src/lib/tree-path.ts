/**
 * Resolve a workspace-relative path from a tree node (file / topic / category / folder).
 * Used by TreeView context actions (copy path, reveal in folder).
 */
import type { TreeNode } from "../plugins/types";

export function pathOfTreeNode(node: TreeNode): string | null {
  if (node.selection?.kind === "file") return node.selection.path;
  if (node.selection?.kind === "topic") return node.selection.topicId;
  if (node.selection?.kind === "category") return node.selection.category;
  if (node.kind === "category" && node.id.startsWith("cat/")) return node.id.slice(4);
  if (node.kind === "folder") {
    if (typeof node.meta?.lazyPath === "string") return node.meta.lazyPath;
    if (node.id.startsWith("folder/")) return node.id.slice("folder/".length);
  }
  return null;
}
