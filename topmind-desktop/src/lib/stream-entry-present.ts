/**
 * Stream feed presentation helpers — pure, unit-testable.
 *
 * Goals:
 * - Day cohesion: moments + nested appends, not one heavy card per bullet
 * - Expand only when content is truly truncated
 * - Article-like sections: title + summary affordance
 */

import {
  countStreamAppends,
  extractBodyTimestamp,
  isDayLikeHeading,
  STRUCTURAL_HEADINGS,
  type StreamEntry,
} from "./stream-period-parse";

export type StreamEntryKind = "moment" | "append" | "article" | "prose";

/** Soft length budget before expand is offered (CJK-friendly chars). */
export const STREAM_EXPAND_CHAR_BUDGET = 220;
/** Soft line budget (non-empty lines) before expand. */
export const STREAM_EXPAND_LINE_BUDGET = 4;

export type StreamFeedRow = {
  entry: StreamEntry & { index: number };
  kind: StreamEntryKind;
  /** Nested appends under a moment (not shown as sibling cards) */
  appends: Array<StreamEntry & { index: number }>;
};

/**
 * Classify a stream entry for feed rendering.
 * - moment: time-stamped or list bullet under a day
 * - append: #### 续 / topmind:append follow-up
 * - article: named ## section (not day) → title + summary card
 * - prose: multi-line free text under day / structural
 */
export function classifyStreamEntry(
  entry: Pick<StreamEntry, "heading" | "body" | "preview" | "isAppend">,
): StreamEntryKind {
  if (entry.isAppend) return "append";
  const h = String(entry.heading || "").trim();
  const body = String(entry.body || "");

  // Named non-day ## sections → article card (title = heading)
  if (h && !isDayLikeHeading(h) && !STRUCTURAL_HEADINGS.has(h)) {
    return "article";
  }

  const hasListLead = /^\s*[-*+]\s+\S/mu.test(body) || /^\s*\d+\.\s+\S/mu.test(body);
  const time = extractBodyTimestamp(body);
  const lines = body.split("\n").filter((l) => l.trim());

  if (hasListLead || time) {
    // Long multi-paragraph under a bullet still "moment" for day list
    return "moment";
  }

  // Free text: short → prose; long multi-block → treat as article-like for summary UI
  if (lines.length >= 3 || body.length > STREAM_EXPAND_CHAR_BUDGET) {
    return body.length > STREAM_EXPAND_CHAR_BUDGET * 1.4 ? "article" : "prose";
  }
  return "prose";
}

/**
 * Whether the feed should offer expand/collapse for this entry body.
 * Short content → false (always show full). Long / multi-append → true.
 */
export function streamEntryNeedsExpand(
  entry: Pick<StreamEntry, "body" | "rest" | "preview" | "isAppend">,
  opts?: { nestedAppendCount?: number },
): boolean {
  const body = String(entry.body || "").trim();
  if (!body) return false;

  const nested = Math.max(0, opts?.nestedAppendCount ?? 0);
  const appendCount = countStreamAppends(body) + nested;

  // Nested appends under a moment: expand only if more than one peek or long
  if (appendCount > 1) return true;

  const lines = body.split("\n").filter((l) => l.trim());
  // Single short line / two short lines → never expand control
  if (lines.length <= 2 && body.length <= STREAM_EXPAND_CHAR_BUDGET) {
    // If rest is empty and no multi-blank, full show
    if (!String(entry.rest || "").trim() && appendCount <= 1) return false;
  }

  if (lines.length > STREAM_EXPAND_LINE_BUDGET) return true;
  if (body.length > STREAM_EXPAND_CHAR_BUDGET) return true;
  // Multi-paragraph body
  if (/\n\s*\n/u.test(body) && body.length > 120) return true;
  // Explicit rest after first line and still long
  if (String(entry.rest || "").trim().length > 80) return true;

  return false;
}

/**
 * Group flat day entries into feed rows: moments collect following appends;
 * articles stand alone.
 */
export function groupDayFeedRows(
  entries: Array<StreamEntry & { index: number }>,
): StreamFeedRow[] {
  const rows: StreamFeedRow[] = [];
  let open: StreamFeedRow | null = null;

  const flush = () => {
    if (open) {
      rows.push(open);
      open = null;
    }
  };

  for (const entry of entries) {
    const kind = classifyStreamEntry(entry);
    if (kind === "append") {
      if (open && (open.kind === "moment" || open.kind === "prose")) {
        open.appends.push(entry);
      } else {
        // Orphan append — still show as quiet row
        rows.push({ entry, kind: "append", appends: [] });
      }
      continue;
    }
    flush();
    open = { entry, kind, appends: [] };
  }
  flush();
  return rows;
}

/** Title for article card — prefer ## heading, else first line of preview. */
export function streamArticleTitle(
  entry: Pick<StreamEntry, "heading" | "preview" | "body">,
): string {
  const h = String(entry.heading || "").trim();
  if (h && !isDayLikeHeading(h) && !STRUCTURAL_HEADINGS.has(h)) return h;
  const p = String(entry.preview || "").trim();
  if (p) return p.slice(0, 80);
  const first = String(entry.body || "").split("\n").find((l) => l.trim());
  return (first || "").replace(/^\s*#+\s*/u, "").trim().slice(0, 80) || "…";
}

/** One-line summary for article card (not the title line). */
export function streamArticleSummary(
  entry: Pick<StreamEntry, "heading" | "preview" | "body" | "rest">,
  maxLen = 120,
): string {
  const title = streamArticleTitle(entry);
  let text = String(entry.rest || entry.body || entry.preview || "")
    .replace(/^\s*#+\s*.+$/mu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.startsWith(title)) text = text.slice(title.length).trim();
  if (!text) text = String(entry.preview || "").trim();
  if (text === title) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
