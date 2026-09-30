/**
 * Tool-result digest — keep the signal, drop the bulk.
 *
 * Large tool payloads (long read_file windows, big listings, verbose JSON)
 * eat the context budget and bury the one line the model needs. This module
 * applies structure-aware compression:
 * - strings: head + tail + a middle-marker (keep both ends of file reads)
 * - arrays: first/last N items + count
 * - objects: keep scalar/short fields, clamp long strings, drop null noise
 *
 * Pure transforms — no I/O. The caller decides the budget.
 */

/** Default clamp for any single string field. */
const DEFAULT_STR_MAX = 2400;

/**
 * Compress a string with head+tail retention (file reads keep line-numbered
 * head and the critical tail where edits usually land).
 * @param {string} s
 * @param {number} max
 */
export function digestString(s, max = DEFAULT_STR_MAX) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.55);
  const tail = Math.floor(max * 0.3);
  return `${t.slice(0, head)}\n…(省略 ${t.length - head - tail} 字符)…\n${t.slice(-tail)}`;
}

/**
 * @param {unknown[]} arr
 * @param {{ maxItems?: number, strMax?: number }} [opts]
 */
function digestArray(arr, opts = {}) {
  const maxItems = Math.max(2, Math.min(Number(opts.maxItems) || 12, 60));
  const strMax = opts.strMax ?? DEFAULT_STR_MAX;
  if (arr.length <= maxItems) return arr.map((x) => digestValue(x, { strMax, depth: 2 }));
  const headN = Math.ceil(maxItems / 2);
  const tailN = maxItems - headN;
  return [
    ...arr.slice(0, headN).map((x) => digestValue(x, { strMax, depth: 2 })),
    `…(省略 ${arr.length - maxItems} 项)…`,
    ...arr.slice(-tailN).map((x) => digestValue(x, { strMax, depth: 2 })),
  ];
}

/**
 * @param {Record<string, unknown>} obj
 * @param {{ strMax?: number, depth?: number }} opts
 */
function digestObject(obj, opts = {}) {
  const strMax = opts.strMax ?? DEFAULT_STR_MAX;
  const depth = opts.depth ?? 3;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    // Drop pure noise fields that bloat every listing.
    if (v == null && !["error", "ok", "note"].includes(k)) continue;
    out[k] = digestValue(v, { strMax, depth: depth - 1 });
  }
  return out;
}

/**
 * @param {unknown} v
 * @param {{ strMax?: number, depth?: number }} [opts]
 */
export function digestValue(v, opts = {}) {
  const strMax = opts.strMax ?? DEFAULT_STR_MAX;
  const depth = opts.depth ?? 3;
  if (v == null) return v;
  if (typeof v === "string") return digestString(v, strMax);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    if (depth <= 0) return `[${v.length} items]`;
    return digestArray(v, { strMax, depth: depth - 1 });
  }
  if (typeof v === "object") {
    if (depth <= 0) return "[object]";
    return digestObject(/** @type {Record<string, unknown>} */ (v), { strMax, depth: depth - 1 });
  }
  return v;
}

/**
 * Entry point: compress a tool result to fit `maxChars` (approx).
 * Preserves `ok` / `error` / `hint` / `relativePath` at the top level so the
 * model still sees the verdict and the recovery path.
 *
 * @param {unknown} result
 * @param {{ maxChars?: number, strMax?: number }} [opts]
 * @returns {unknown}
 */
export function digestToolResult(result, opts = {}) {
  const maxChars = Math.max(400, Math.min(Number(opts.maxChars) || 6000, 60_000));
  const strMax = opts.strMax ?? DEFAULT_STR_MAX;
  if (result == null) return result;
  if (typeof result === "string") return digestString(result, maxChars);
  let out = digestValue(result, { strMax, depth: 4 });
  // Shrink further if the serialized form is still over budget.
  try {
    let s = JSON.stringify(out);
    if (s && s.length > maxChars) {
      out = digestValue(out, { strMax: Math.floor(strMax / 2), depth: 3 });
      s = JSON.stringify(out);
      if (s && s.length > maxChars) {
        out = digestValue(out, { strMax: Math.floor(strMax / 4), depth: 2 });
        s = JSON.stringify(out);
        if (s && s.length > maxChars && typeof out === "object" && out) {
          // Last resort: keep verdict fields + truncated preview.
          const o = /** @type {Record<string, unknown>} */ (out);
          return {
            ok: o.ok,
            error: o.error,
            hint: o.hint,
            relativePath: o.relativePath,
            targetPath: o.targetPath,
            truncated: true,
            preview: s.slice(0, Math.floor(maxChars * 0.7)),
          };
        }
      }
    }
  } catch { /* unserializable — return as-is */ }
  return out;
}
