/** Types for lib/memory-feed.mjs (memory-plane browse projection). */

export type MemoryFeedKind = "profile" | "periodic" | "topic";
export type MemoryFeedLayer = "all" | MemoryFeedKind;

export interface MemoryFeedItem {
  id: string;
  kind: MemoryFeedKind;
  path: string;
  title: string;
  preview: string;
  body: string;
  heading?: string;
}

export interface MemoryFeedSource {
  profile: { path: string; markdown: string } | null;
  periodic: Array<{ path: string; markdown: string }>;
  topics: Array<{ path: string; markdown: string }>;
}

export const MEMORY_FEED_KINDS: readonly MemoryFeedKind[];

export function isMemoryFeedLayer(v: unknown): v is MemoryFeedLayer;
export function filterMemoryFeedByLayer(
  items: MemoryFeedItem[] | null | undefined,
  layer: MemoryFeedLayer,
): MemoryFeedItem[];
export function assembleMemoryFeed(
  source: MemoryFeedSource | null | undefined,
): MemoryFeedItem[];
