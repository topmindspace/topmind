/**
 * Conversion policy — which engine to try, in what order.
 * Pure functions: no spawn / fs / Electron. Tests drive these directly.
 */

/** User-facing preference values (settings.ingest.preferredConverter). */
export const PREFERRED_CONVERTER_VALUES = Object.freeze([
  "auto",
  "anydoc",
  "markitdown",
  "pandoc",
  "builtin",
]);

export const DEFAULT_PREFERRED_CONVERTER = "auto";

/**
 * Formats anydoc owns (https://github.com/firecrawl/anydoc).
 * HTML / EML / markdown / text stay on dedicated converters.
 */
export const ANYDOC_KINDS = new Set([
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "pdf",
  "ole",
]);

/** markitdown typically handles these well (needs [all] for Office). */
export const MARKITDOWN_KINDS = new Set([
  "docx",
  "pdf",
  "xlsx",
  "xls",
  "csv",
  "pptx",
  "ppt",
  "html",
  "msg",
]);

/** pandoc typically handles these. */
export const PANDOC_KINDS = new Set([
  "docx",
  "html",
  "pptx",
  "markdown",
  "text",
  "odt",
  "ods",
  "odp",
  "epub",
  "rtf",
  "doc",
]);

/** Pure-JS fallbacks bundled with Desktop (re-pack required to change). */
export const BUILTIN_KINDS = new Set([
  "markdown",
  "text",
  "html",
  "docx",
  "pdf",
  "xlsx",
  "csv",
  "pptx",
  "eml",
]);

/** Kinds we will attempt to turn into Markdown (missing engine → original-fallback). */
export const CONVERTIBLE_KINDS = Object.freeze([
  "markdown",
  "text",
  "html",
  "doc",
  "docx",
  "pdf",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "eml",
  "ole",
]);

export function isConvertibleKind(kind) {
  return CONVERTIBLE_KINDS.includes(kind);
}

/**
 * @param {unknown} value
 * @param {boolean} [preferExternal]
 * @returns {"auto"|"anydoc"|"markitdown"|"pandoc"|"builtin"}
 */
export function normalizePreferredConverter(value, preferExternal) {
  if (typeof value === "string" && PREFERRED_CONVERTER_VALUES.includes(value)) {
    return value;
  }
  if (preferExternal === false) return "builtin";
  return DEFAULT_PREFERRED_CONVERTER;
}

/**
 * Ordered engines that can handle `kind`. Availability is applied by the runner.
 *
 * auto: anydoc first for formats it owns; HTML/EML/md/txt stay dedicated.
 * Explicit preference is tried first when that engine owns the kind, then the rest.
 * preferExternal=false or preference=builtin → builtin only (or empty).
 *
 * @param {{
 *   kind: string,
 *   preference?: string,
 *   preferExternal?: boolean,
 * }} opts
 * @returns {Array<"anydoc"|"markitdown"|"pandoc"|"builtin">}
 */
export function resolveConverterChain(opts) {
  const kind = String(opts?.kind || "");
  const preferExternal = opts?.preferExternal !== false;
  const preference = normalizePreferredConverter(opts?.preference, preferExternal);

  if (!preferExternal || preference === "builtin") {
    return BUILTIN_KINDS.has(kind) ? ["builtin"] : [];
  }

  // Passthrough kinds: don't send .md/.txt through anydoc/markitdown on auto.
  if (kind === "markdown" || kind === "text") {
    if (preference === "auto" || preference === "anydoc") return ["builtin"];
    const capable = [];
    if (preference === "pandoc" && PANDOC_KINDS.has(kind)) capable.push("pandoc");
    if (preference === "markitdown" && MARKITDOWN_KINDS.has(kind)) capable.push("markitdown");
    capable.push("builtin");
    return capable;
  }

  const capable = [];
  if (ANYDOC_KINDS.has(kind)) capable.push("anydoc");
  if (MARKITDOWN_KINDS.has(kind)) capable.push("markitdown");
  if (PANDOC_KINDS.has(kind)) capable.push("pandoc");
  if (BUILTIN_KINDS.has(kind)) capable.push("builtin");

  if (preference === "auto" || !capable.includes(preference)) return capable;
  return [preference, ...capable.filter((e) => e !== preference)];
}

/**
 * Skip engines the probe said are missing. builtin is always present.
 * @param {string[]} chain
 * @param {{ anydoc?: boolean, markitdown?: boolean, pandoc?: boolean }} available
 */
export function filterAvailableEngines(chain, available) {
  return (chain || []).filter((e) => e === "builtin" || Boolean(available?.[e]));
}

/**
 * anydoc --format value.
 *
 * Detected `kind` (magic bytes / detectIngestKind) always wins over the file
 * extension. A `.docx` name on RTF or PDF bytes must not yield `docx` — that
 * forces anydoc to parse the file as OOXML and fail (malformed zip) even
 * though no --format or --format rtf/pdf would succeed.
 *
 * CSV has no content marker: name it when kind or extension says csv/tsv.
 * Other kinds: return the kind's anydoc format, or null (omit --format and
 * let anydoc sniff bytes).
 *
 * @param {string} kind
 * @param {string} [ext] extension without dot
 * @returns {string|null}
 */
export function anydocFormatForKind(kind, ext) {
  const fromKind = {
    doc: "doc",
    docx: "docx",
    ppt: "ppt",
    pptx: "pptx",
    xls: "xlsx",
    xlsx: "xlsx",
    odt: "odt",
    ods: "ods",
    odp: "odp",
    rtf: "rtf",
    epub: "epub",
    csv: "csv",
    pdf: "pdf",
  };
  if (kind && fromKind[kind]) return fromKind[kind];

  const e = String(ext || "")
    .replace(/^\./u, "")
    .toLowerCase();
  // Signature-less CSV only — never take Office/PDF/RTF from a possibly wrong ext.
  if (e === "csv" || e === "tsv") return "csv";
  return null;
}

/**
 * Classify anydoc CLI / stderr into a named conversion error (not a silent empty note).
 * @param {string} detail
 * @returns {{ code: string, message: string }}
 */
export function classifyAnydocFailure(detail) {
  const raw = String(detail || "").replace(/\s+/gu, " ").trim();
  const clipped = raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
  const d = raw.toLowerCase();
  if (/encrypt|password|protected/iu.test(d)) {
    return { code: "encrypted", message: `anydoc: encrypted — ${clipped || "password protected"}` };
  }
  if (/unsupported|image-only|image only|scanned|no text/iu.test(d)) {
    return { code: "unsupported", message: `anydoc: unsupported — ${clipped || "format or image-only PDF"}` };
  }
  if (/malformed|structurally/iu.test(d)) {
    return { code: "malformed", message: `anydoc: malformed — ${clipped}` };
  }
  if (/resource.?limit|decompression|nesting|node count/iu.test(d)) {
    return { code: "resourceLimit", message: `anydoc: resourceLimit — ${clipped}` };
  }
  if (/missing.?part/iu.test(d)) {
    return { code: "missingPart", message: `anydoc: missingPart — ${clipped}` };
  }
  if (/empty|输出为空/iu.test(d)) {
    return { code: "empty", message: `anydoc: empty — ${clipped || "no markdown"}` };
  }
  if (/enoent|not found|eacces|eperm|could not be read|\bio\b/iu.test(d)) {
    return { code: "io", message: `anydoc: io — ${clipped}` };
  }
  return { code: "failed", message: clipped ? `anydoc: ${clipped}` : "anydoc: conversion failed" };
}
