// ── Unique-span surgical edit (Kernel, pure) ────────────────────────────────
// Exact match first, then conservative whitespace/newline normalize.
// Unique after normalize is required. Never fuzzy-best-guess.
// Used by Desktop pathOps.editPath and Obsidian preciseEditWorkspace.

/**
 * Strip editor-style `  12|` prefixes when the model copied a numbered read window.
 * Only strips when a majority of non-empty lines look numbered.
 * @param {string} text
 * @returns {string}
 */
export function stripCopiedLineNumbers(text) {
  const src = String(text ?? "");
  if (!src) return src;
  const lines = src.split("\n");
  const nonempty = lines.filter((l) => l.trim().length > 0);
  if (nonempty.length === 0) return src;
  const numbered = nonempty.filter((l) => /^\s*\d+\|/.test(l));
  if (numbered.length < Math.max(1, Math.ceil(nonempty.length * 0.6))) return src;
  return lines.map((l) => l.replace(/^\s*\d+\|/u, "")).join("\n");
}

/**
 * Conservative normalize: CRLF/CR → LF, drop trailing spaces/tabs per line.
 * Does NOT collapse internal spaces or rewrite punctuation.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatch(text) {
  return String(text ?? "")
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/[ \t]+$/gu, "");
}

/**
 * Build a normalized string plus orig-index map (normIndex → origIndex).
 * Trailing spaces/tabs before newline or EOS are skipped (not mapped).
 * @param {string} text
 */
function buildNormMap(text) {
  const s = String(text ?? "");
  const chars = [];
  const map = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\r") {
      chars.push("\n");
      map.push(i);
      i += s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (c === " " || c === "\t") {
      let j = i;
      while (j < s.length && (s[j] === " " || s[j] === "\t")) j += 1;
      const next = s[j];
      if (j >= s.length || next === "\n" || next === "\r") {
        i = j;
        continue;
      }
    }
    chars.push(c);
    map.push(i);
    i += 1;
  }
  return { norm: chars.join(""), map };
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {{ start: number, end: number }[]}
 */
export function findExactSpans(haystack, needle) {
  const spans = [];
  const h = String(haystack ?? "");
  const n = String(needle ?? "");
  if (!n) return spans;
  let from = 0;
  while (from <= h.length - n.length) {
    const i = h.indexOf(n, from);
    if (i < 0) break;
    spans.push({ start: i, end: i + n.length });
    from = i + Math.max(1, n.length);
  }
  return spans;
}

/**
 * Map a normalized [start, end) span back onto the original string.
 * @param {string} orig
 * @param {number[]} map
 * @param {number} normStart
 * @param {number} normEnd
 */
function origSpanFromNorm(orig, map, normStart, normEnd) {
  if (normEnd <= normStart || map.length === 0) return null;
  const lastNorm = Math.min(map.length - 1, normEnd - 1);
  const origStart = map[normStart];
  if (origStart == null) return null;
  const origLast = map[lastNorm];
  if (origLast == null) return null;
  let origEnd = origLast + 1;
  if (orig[origLast] === "\r" && orig[origEnd] === "\n") origEnd += 1;
  return { start: origStart, end: origEnd };
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {{ start: number, end: number }[]}
 */
export function findNormalizedSpans(haystack, needle) {
  const { norm, map } = buildNormMap(haystack);
  const nNeedle = buildNormMap(needle).norm;
  if (!nNeedle) return [];
  const hits = findExactSpans(norm, nNeedle);
  const out = [];
  for (const hit of hits) {
    const span = origSpanFromNorm(haystack, map, hit.start, hit.end);
    if (span) out.push(span);
  }
  return out;
}

/**
 * Restrict haystack to a line window and/or heading section.
 * @param {string} haystack
 * @param {{ startLine?: number, endLine?: number, heading?: string }} loc
 * @returns {{ ok: true, text: string, startOffset: number, startLine: number, endLine: number }
 *   | { ok: false, reason: string, diagnostic: string, count?: number }}
 */
export function resolveLocatorWindow(haystack, loc = {}) {
  const full = String(haystack ?? "");
  const lines = full.split("\n");
  const total = lines.length;
  let fromLine = 1;
  let toLine = total; // inclusive
  const heading = typeof loc.heading === "string" ? loc.heading.trim() : "";

  if (heading) {
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/u);
      if (!m) continue;
      const title = m[2].trim();
      if (title === heading || title.toLowerCase() === heading.toLowerCase()) {
        hits.push({ line: i + 1, level: m[1].length });
      }
    }
    if (hits.length === 0) {
      return {
        ok: false,
        reason: "heading-not-found",
        diagnostic: formatMismatchDiagnostic({
          reason: "no-match",
          haystack: full,
          needle: heading,
          path: "",
          extra: `heading not found: ${JSON.stringify(heading)}`,
        }),
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        reason: "heading-ambiguous",
        count: hits.length,
        diagnostic: formatMismatchDiagnostic({
          reason: "ambiguous",
          count: hits.length,
          haystack: full,
          needle: heading,
          path: "",
          extra: `heading matched ${hits.length} times; pass startLine/endLine to disambiguate`,
        }),
      };
    }
    fromLine = hits[0].line;
    toLine = total;
    for (let i = hits[0].line; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+/u);
      if (m && m[1].length <= hits[0].level) {
        toLine = i; // line i is the next same-or-higher heading (1-based = i)
        break;
      }
    }
  }

  const sl = Number(loc.startLine);
  const el = Number(loc.endLine);
  if (Number.isFinite(sl) && sl >= 1) fromLine = Math.max(fromLine, Math.floor(sl));
  if (Number.isFinite(el) && el >= 1) toLine = Math.min(toLine, Math.floor(el));
  if (fromLine > toLine || fromLine > total) {
    return {
      ok: false,
      reason: "locator-empty",
      diagnostic: formatMismatchDiagnostic({
        reason: "no-match",
        haystack: full,
        needle: "",
        path: "",
        extra: `line window ${fromLine}–${toLine} is empty (file has ${total} lines)`,
      }),
    };
  }

  let startOffset = 0;
  for (let i = 0; i < fromLine - 1; i++) startOffset += lines[i].length + 1;
  const slice = lines.slice(fromLine - 1, toLine).join("\n");
  return {
    ok: true,
    text: slice,
    startOffset,
    startLine: fromLine,
    endLine: Math.min(toLine, total),
  };
}

function firstSignificantLine(needle) {
  const lines = String(needle || "").split("\n");
  for (const line of lines) {
    const t = line.replace(/^\s*\d+\|/u, "").trim();
    if (t.length >= 4) return t;
  }
  return String(needle || "").trim().slice(0, 80);
}

/**
 * Nearby lines that share a prefix/substring with the needle — for retry.
 * @param {string} haystack
 * @param {string} query
 * @param {number} [radius]
 */
export function nearbyContext(haystack, query, radius = 2) {
  const lines = String(haystack ?? "").split("\n");
  const q = String(query || "").trim();
  if (!q) return [];
  const prefix = q.slice(0, Math.min(24, q.length));
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(q) || (prefix.length >= 8 && line.includes(prefix))) {
      const from = Math.max(0, i - radius);
      const to = Math.min(lines.length, i + radius + 1);
      const excerpt = lines
        .slice(from, to)
        .map((l, k) => `${from + k + 1}|${l}`)
        .join("\n");
      hits.push({ line: i + 1, excerpt });
      if (hits.length >= 3) break;
    }
  }
  return hits;
}

function fileEolLabel(text) {
  if (/\r\n/.test(text)) return "CRLF";
  if (/\r/.test(text)) return "CR";
  return "LF";
}

/**
 * Actionable mismatch text: needle preview + nearby/context (not only "not found").
 * @param {{ reason: string, haystack: string, needle: string, path?: string, count?: number, extra?: string }} p
 */
export function formatMismatchDiagnostic(p) {
  const reason = p.reason || "no-match";
  const path = p.path || "";
  const needle = String(p.needle ?? "");
  const haystack = String(p.haystack ?? "");
  const preview = needle.length > 220 ? `${needle.slice(0, 220)}…` : needle;
  const sig = firstSignificantLine(needle);
  const nearby = nearbyContext(haystack, sig);
  const parts = [];
  if (reason === "ambiguous") {
    parts.push(
      `oldText matched ${p.count ?? "?"} times; widen context for uniqueness or set replaceAll=true.${path ? ` Path: ${path}` : ""}`,
    );
  } else {
    parts.push(
      `oldText not found (exact + whitespace/newline normalize).${path ? ` Path: ${path}` : ""}`,
    );
  }
  if (p.extra) parts.push(p.extra);
  parts.push(`needlePreview: ${JSON.stringify(preview)}`);
  parts.push(`fileEOL: ${fileEolLabel(haystack)}`);
  if (nearby.length) {
    parts.push("nearby/context:");
    for (const h of nearby) parts.push(`  around line ${h.line}:\n${h.excerpt}`);
  } else {
    parts.push(
      "nearby/context: no similar line found; retry with read_file around=<unique phrase> or startLine/endLine/heading.",
    );
  }
  return parts.join("\n");
}

function applySpans(haystack, spans, newText) {
  // Replace from the end so earlier offsets stay valid.
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let next = haystack;
  for (const span of ordered) {
    next = next.slice(0, span.start) + newText + next.slice(span.end);
  }
  return next;
}

/**
 * Locate a unique span and apply newText. Never writes; caller owns writeback.
 *
 * @param {string} haystack
 * @param {{
 *   oldText: string,
 *   newText: string,
 *   replaceAll?: boolean,
 *   startLine?: number,
 *   endLine?: number,
 *   heading?: string,
 *   path?: string,
 * }} spec
 * @returns {{
 *   ok: true, next: string, replacements: number, mode: "exact"|"normalized",
 *   spans: { start: number, end: number }[]
 * } | {
 *   ok: false, reason: string, count: number, diagnostic: string, next: string
 * }}
 */
export function applyUniqueSpan(haystack, spec) {
  const full = String(haystack ?? "");
  const newText = spec?.newText == null ? "" : String(spec.newText);
  const replaceAll = Boolean(spec?.replaceAll);
  const path = spec?.path || "";
  let needle = stripCopiedLineNumbers(String(spec?.oldText ?? ""));
  if (!needle) {
    return {
      ok: false,
      reason: "empty-old",
      count: 0,
      diagnostic: "oldText is empty after stripping line-number prefixes.",
      next: full,
    };
  }

  const hasLocator =
    (typeof spec?.heading === "string" && spec.heading.trim()) ||
    (Number(spec?.startLine) >= 1) ||
    (Number(spec?.endLine) >= 1);

  let searchIn = full;
  let offset = 0;
  if (hasLocator) {
    const win = resolveLocatorWindow(full, spec);
    if (!win.ok) {
      return {
        ok: false,
        reason: win.reason,
        count: win.count || 0,
        diagnostic: win.diagnostic,
        next: full,
      };
    }
    searchIn = win.text;
    offset = win.startOffset;
  }

  const shift = (spans) => spans.map((s) => ({ start: s.start + offset, end: s.end + offset }));

  const exact = findExactSpans(searchIn, needle);
  if (exact.length === 1 || (replaceAll && exact.length > 0)) {
    const spans = shift(exact);
    return {
      ok: true,
      next: applySpans(full, spans, newText),
      replacements: spans.length,
      mode: "exact",
      spans,
    };
  }
  if (exact.length > 1 && !replaceAll) {
    return {
      ok: false,
      reason: "ambiguous",
      count: exact.length,
      diagnostic: formatMismatchDiagnostic({
        reason: "ambiguous",
        count: exact.length,
        haystack: searchIn,
        needle,
        path,
      }),
      next: full,
    };
  }

  const normalized = findNormalizedSpans(searchIn, needle);
  if (normalized.length === 1 || (replaceAll && normalized.length > 0)) {
    const spans = shift(normalized);
    return {
      ok: true,
      next: applySpans(full, spans, newText),
      replacements: spans.length,
      mode: "normalized",
      spans,
    };
  }
  if (normalized.length > 1 && !replaceAll) {
    return {
      ok: false,
      reason: "ambiguous",
      count: normalized.length,
      diagnostic: formatMismatchDiagnostic({
        reason: "ambiguous",
        count: normalized.length,
        haystack: searchIn,
        needle,
        path,
      }),
      next: full,
    };
  }

  return {
    ok: false,
    reason: "no-match",
    count: 0,
    diagnostic: formatMismatchDiagnostic({
      reason: "no-match",
      haystack: searchIn,
      needle,
      path,
    }),
    next: full,
  };
}
