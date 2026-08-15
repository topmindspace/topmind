// ── Line-windowed file read (Kernel, pure) ──────────────────────────────────
// Numbered slices + heading / around locators so mid-file spans are visible.
// Surfaces format the result for the model; this module does not I/O.

/**
 * @param {string} text
 * @param {{ offset?: number, limit?: number, maxLimit?: number }} [opts]
 */
export function sliceLineWindow(text, opts = {}) {
  const full = String(text ?? "");
  const lines = full.split("\n");
  const totalLines = lines.length;
  const start = Math.max(1, Math.floor(Number(opts.offset) || 1));
  const maxLimit = Math.max(1, Math.floor(Number(opts.maxLimit) || 5000));
  const rawLimit = opts.limit;
  const maxLines =
    rawLimit == null || rawLimit === ""
      ? totalLines
      : Math.max(1, Math.min(maxLimit, Math.floor(Number(rawLimit) || 200)));
  const from = start - 1;
  if (from >= totalLines) {
    return {
      content: "",
      offset: start,
      limit: maxLines,
      startLine: start,
      endLine: start - 1,
      totalLines,
      totalChars: full.length,
      truncated: false,
      empty: true,
    };
  }
  const slice = lines.slice(from, from + maxLines);
  const endLine = from + slice.length;
  return {
    content: slice.join("\n"),
    offset: start,
    limit: maxLines,
    startLine: start,
    endLine,
    totalLines,
    totalChars: full.length,
    truncated: endLine < totalLines,
    empty: false,
  };
}

/**
 * Prefix each line with a stable `N|` locator (1-based).
 * @param {string} text
 * @param {number} [startLine=1]
 */
export function numberLines(text, startLine = 1) {
  const lines = String(text ?? "").split("\n");
  const start = Math.max(1, Math.floor(Number(startLine) || 1));
  const width = String(start + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(start + i).padStart(width, " ")}|${line}`)
    .join("\n");
}

/**
 * Find a unique heading section (ATX #–######). Inclusive of the heading line
 * through the line before the next same-or-higher heading.
 * @param {string} text
 * @param {string} heading
 * @returns {{ ok: true, startLine: number, endLine: number } | { ok: false, reason: string, count: number }}
 */
export function findHeadingSpan(text, heading) {
  const needle = String(heading || "").trim();
  if (!needle) return { ok: false, reason: "empty-heading", count: 0 };
  const lines = String(text ?? "").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (!m) continue;
    const title = m[2].trim();
    if (title === needle || title.toLowerCase() === needle.toLowerCase()) {
      hits.push({ line: i + 1, level: m[1].length });
    }
  }
  if (hits.length !== 1) {
    return {
      ok: false,
      reason: hits.length === 0 ? "heading-not-found" : "heading-ambiguous",
      count: hits.length,
    };
  }
  let endLine = lines.length;
  for (let i = hits[0].line; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/u);
    if (m && m[1].length <= hits[0].level) {
      endLine = i;
      break;
    }
  }
  return { ok: true, startLine: hits[0].line, endLine };
}

/**
 * Center a line window on the first (or unique) occurrence of `query`.
 * @param {string} text
 * @param {string} query
 * @param {{ contextLines?: number }} [opts]
 */
export function findQueryAround(text, query, opts = {}) {
  const q = String(query || "");
  if (!q) return { ok: false, reason: "empty-query", count: 0, line: 0 };
  const lines = String(text ?? "").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(q)) hits.push(i + 1);
  }
  if (hits.length === 0) return { ok: false, reason: "query-not-found", count: 0, line: 0 };
  const line = hits[0];
  const radius = Math.max(0, Math.min(400, Math.floor(Number(opts.contextLines) || 40)));
  const startLine = Math.max(1, line - radius);
  const endLine = Math.min(lines.length, line + radius);
  return {
    ok: true,
    line,
    count: hits.length,
    startLine,
    endLine,
    unique: hits.length === 1,
  };
}

/**
 * Format a model-facing read window. `content` stays raw (compat);
 * `numbered` is what agents should copy from.
 *
 * @param {string} fullText
 * @param {{
 *   relativePath?: string,
 *   offset?: number,
 *   limit?: number,
 *   around?: string,
 *   heading?: string,
 *   contextLines?: number,
 *   maxLimit?: number,
 *   maxChars?: number,
 * }} [opts]
 */
export function formatReadWindow(fullText, opts = {}) {
  const full = String(fullText ?? "");
  const maxLimit = Math.max(1, Math.floor(Number(opts.maxLimit) || 5000));
  let offset = opts.offset;
  let limit = opts.limit;
  let locateNote = "";

  const heading = typeof opts.heading === "string" ? opts.heading.trim() : "";
  if (heading) {
    const span = findHeadingSpan(full, heading);
    if (!span.ok) {
      return {
        relativePath: opts.relativePath || "",
        content: "",
        numbered: "",
        offset: 1,
        limit: 0,
        startLine: 1,
        endLine: 0,
        totalLines: full.split("\n").length,
        totalChars: full.length,
        truncated: false,
        empty: true,
        locate: span.reason,
        note: span.reason === "heading-ambiguous"
          ? `heading matched ${span.count} times; pass around= or startLine to disambiguate`
          : `heading not found: ${heading}`,
      };
    }
    offset = span.startLine;
    if (limit == null || limit === "") {
      limit = span.endLine - span.startLine + 1;
    }
    locateNote = `heading ${JSON.stringify(heading)} → lines ${span.startLine}–${span.endLine}`;
  }

  const around = typeof opts.around === "string" ? opts.around : "";
  if (around && !heading) {
    const hit = findQueryAround(full, around, { contextLines: opts.contextLines });
    if (!hit.ok) {
      return {
        relativePath: opts.relativePath || "",
        content: "",
        numbered: "",
        offset: 1,
        limit: 0,
        startLine: 1,
        endLine: 0,
        totalLines: full.split("\n").length,
        totalChars: full.length,
        truncated: false,
        empty: true,
        locate: hit.reason,
        note: `around not found: ${JSON.stringify(around.slice(0, 80))}`,
      };
    }
    offset = hit.startLine;
    if (limit == null || limit === "") {
      limit = hit.endLine - hit.startLine + 1;
    }
    locateNote = `around line ${hit.line}${hit.unique ? "" : ` (${hit.count} hits; showing first)`}`;
  }

  const win = sliceLineWindow(full, { offset, limit, maxLimit });
  let content = win.content;
  let charTruncated = false;
  const maxChars = Math.max(1000, Math.floor(Number(opts.maxChars) || 80_000));
  if (content.length > maxChars) {
    const keep = content.slice(0, maxChars);
    const cut = keep.lastIndexOf("\n");
    content = cut > 200 ? keep.slice(0, cut) : keep;
    charTruncated = true;
    const keptLines = content.split("\n").length;
    win.endLine = win.startLine + keptLines - 1;
    win.truncated = true;
  }
  const numbered = content ? numberLines(content, win.startLine) : "";
  const continueHint = win.truncated
    ? `returned lines ${win.startLine}–${win.endLine} / ${win.totalLines} total; use larger offset or around= to continue`
    : `returned lines ${win.startLine}–${win.endLine} / ${win.totalLines} total`;
  const notes = [locateNote, continueHint, charTruncated ? "char budget trimmed at a line boundary" : ""]
    .filter(Boolean);
  return {
    relativePath: opts.relativePath || "",
    content,
    numbered,
    offset: win.offset,
    limit: win.limit,
    startLine: win.startLine,
    endLine: win.endLine,
    totalLines: win.totalLines,
    totalChars: win.totalChars,
    truncated: win.truncated,
    empty: win.empty,
    locate: locateNote || undefined,
    note: notes.join("; "),
  };
}
