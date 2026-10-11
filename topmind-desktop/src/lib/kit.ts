/**
 * Small shared UI helpers — merged single module (footprint discipline).
 * cn · formatBytes · PRODUCT · scheduleFlash · tree-path pure helpers.
 */
import { clsx, type ClassValue } from 'clsx';
import type { TreeNode } from "../plugins/types";

/** className concatenation utility powered by clsx */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Human-readable byte size for Tools & Logs and lists. */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Public product URLs — single source for About / update UI.
 * Keep in sync with electron/lib/update-check.mjs DEFAULT_REPO.
 */
export const PRODUCT = {
  name: "topmind",
  repoSlug: "topmindspace/topmind",
  repoUrl: "https://github.com/topmindspace/topmind",
  releasesUrl: "https://github.com/topmindspace/topmind/releases",
} as const;

/** Tiny helper for auto-clearing status lines in settings panels. */
export function scheduleFlash(
  setMsg: (v: string | null) => void,
  message: string,
  ms = 4000,
): ReturnType<typeof setTimeout> {
  setMsg(message);
  return setTimeout(() => setMsg(null), ms);
}

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
