/**
 * Stream feed soft-refresh stability — pure helpers (no React).
 * Soft updates must not force full-page loading or wipe expand state blindly.
 */

/** Soft reload should replace body only when content actually changed. */
export function shouldReplaceStreamBody(
  prevContent: string | null | undefined,
  nextContent: string | null | undefined,
): boolean {
  const a = prevContent == null ? null : String(prevContent);
  const b = nextContent == null ? null : String(nextContent);
  return a !== b;
}

/**
 * Soft file-changed / suggestion events must never flip full-page loading.
 * Boot path is the only place that sets loading true.
 */
export function isStreamSoftRefreshEvent(reason?: string | null): boolean {
  const r = String(reason || "").toLowerCase();
  if (!r) return true;
  return (
    r === "soft" ||
    r === "file-changed" ||
    r === "suggestions" ||
    r === "suggestions:refresh" ||
    r === "workspace:file-changed" ||
    r === "stream-append" ||
    r === "stream-compose" ||
    r === "reconcile" ||
    r === "organize" ||
    r === "silent"
  );
}

/**
 * Identity-only key for a stream card (heading + sortKey + preview slice).
 * Must NOT include array index — otherwise remapExpandedIndices fails when
 * a new entry is prepended (compose soft-reload) and expanded cards collapse.
 * Optional `index` arg is ignored (kept for call-site compatibility).
 */
export function streamEntryStableKey(
  entry: { heading?: string; sortKey?: string; preview?: string; body?: string },
  _index?: number,
): string {
  const h = String(entry.heading || "").trim();
  const s = String(entry.sortKey || "").trim();
  const p = String(entry.preview || entry.body || "")
    .trim()
    .slice(0, 48);
  return `${h}::${s}::${p}`;
}

/**
 * Remap expanded indices after a soft body replace so expand state survives
 * reorder when stable keys still match.
 */
export function remapExpandedIndices(
  prevKeys: string[],
  nextKeys: string[],
  expandedIdx: Iterable<number>,
): Set<number> {
  const expandedKeys = new Set<string>();
  for (const i of expandedIdx) {
    if (i >= 0 && i < prevKeys.length) expandedKeys.add(prevKeys[i]!);
  }
  const next = new Set<number>();
  nextKeys.forEach((k, i) => {
    if (expandedKeys.has(k)) next.add(i);
  });
  return next;
}

/**
 * Quiet AI strip should keep a reserved vertical slot so chip mount/unmount
 * does not shove the feed (layout jitter).
 */
export const STREAM_AI_STRIP_MIN_CLASS = "min-h-10";
