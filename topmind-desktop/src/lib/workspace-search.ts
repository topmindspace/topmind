import type { SearchResponse, SearchResult } from "../types";

export type SearchBucket = "stream" | "memory" | "inbox" | "outputs" | "archive" | "topic" | "other";
export const SEARCH_BUCKET_ORDER: SearchBucket[] = ["stream", "memory", "inbox", "topic", "outputs", "archive", "other"];

/** Presentation only; custom workspace categories remain searchable. */
export function searchBucket(relativePath: string): SearchBucket {
  const p = relativePath.replace(/\\/g, "/");
  if (p.startsWith("memory/") || p.includes("/memory/")) return "memory";
  if (/(^|\/)(00-|收件箱|inbox)/iu.test(p)) return "inbox";
  if (/(^|\/)(88-|输出|outputs)/iu.test(p)) return "outputs";
  if (/(^|\/)(99-|归档|archive)/iu.test(p)) return "archive";
  if (/(动态|stream|period|weekly|daily|monthly)/iu.test(p)) return "stream";
  return p.split("/").filter(Boolean).length >= 2 ? "topic" : "other";
}

/** Keyboard indexes and rendered rows must share this exact order. O(n). */
export function groupSearchResults(results: SearchResult[], filter: SearchBucket | "all") {
  const buckets = new Map<SearchBucket, SearchResult[]>();
  for (const result of results) {
    const bucket = searchBucket(result.relativePath);
    if (filter !== "all" && filter !== bucket) continue;
    const items = buckets.get(bucket) ?? [];
    if (!buckets.has(bucket)) buckets.set(bucket, items);
    items.push(result);
  }
  let flatIdx = 0;
  return SEARCH_BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
    bucket,
    items: buckets.get(bucket)!.map((r) => ({ r, flatIdx: flatIdx++ })),
  }));
}

export interface WorkspaceSearchState {
  results: SearchResult[];
  truncated: boolean;
  note: string | null;
  loading: boolean;
  error: boolean;
}
export const EMPTY_SEARCH: WorkspaceSearchState = {
  results: [], truncated: false, note: null, loading: false, error: false,
};

/** Owns one debounce/request lifetime. Cleanup also invalidates in-flight IPC. */
export function startWorkspaceSearch(
  query: string,
  search: (query: string) => Promise<SearchResponse>,
  publish: (state: WorkspaceSearchState) => void,
) {
  let disposed = false;
  const q = query.trim();
  publish({ ...EMPTY_SEARCH, loading: Boolean(q) });
  const timer = q ? setTimeout(async () => {
    try {
      const response = await search(q);
      if (disposed) return;
      publish({
        results: response.results || [],
        truncated: Boolean(response.truncated),
        note: typeof response.note === "string" ? response.note : null,
        loading: false,
        error: false,
      });
    } catch {
      if (!disposed) publish({ ...EMPTY_SEARCH, error: true });
    }
  }, 180) : null;
  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
  };
}
