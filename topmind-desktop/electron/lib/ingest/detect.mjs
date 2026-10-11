/**
 * Detect ingest kind from path + magic bytes.
 *
 * Strong signatures (PDF / RTF / OLE / identifiable ZIP) override a wrong or
 * missing extension. CSV has no marker — extension or an explicit format only.
 *
 * @typedef {'markdown'|'text'|'html'|'doc'|'docx'|'pdf'|'xls'|'xlsx'|'csv'|'ppt'|'pptx'|'odt'|'ods'|'odp'|'rtf'|'epub'|'eml'|'msg'|'ole'|'binary'|'unknown'} IngestKind
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { CONVERTIBLE_KINDS } from "./convert-policy.mjs";

/** @type {Record<string, IngestKind>} */
const EXT_MAP = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".txt": "text",
  ".text": "text",
  ".html": "html",
  ".htm": "html",
  ".doc": "doc",
  ".docx": "docx",
  ".docm": "docx",
  ".pdf": "pdf",
  ".xls": "xls",
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
  ".xlsb": "xlsx",
  ".csv": "csv",
  ".tsv": "csv",
  ".ppt": "ppt",
  ".pps": "ppt",
  ".pot": "ppt",
  ".pptx": "pptx",
  ".pptm": "pptx",
  ".ppsx": "pptx",
  ".ppsm": "pptx",
  ".odt": "odt",
  ".ods": "ods",
  ".odp": "odp",
  ".rtf": "rtf",
  ".epub": "epub",
  ".eml": "eml",
  ".msg": "msg",
};

/** File-picker / Hub list — keep in sync with EXT_MAP. */
export const INGEST_FILE_EXTENSIONS = [
  "md",
  "markdown",
  "txt",
  "html",
  "htm",
  "doc",
  "docx",
  "docm",
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "csv",
  "tsv",
  "pdf",
  "eml",
  "msg",
];

const OLE_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function hasUtf16le(buf, ascii) {
  return buf.includes(Buffer.from(ascii, "utf16le"));
}

/**
 * @param {Buffer} buf
 * @returns {IngestKind|null}
 */
export function detectKindFromBytes(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "pdf";
  }
  let off = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) off = 3;
  if (buf.length >= off + 5 && buf.subarray(off, off + 5).toString("ascii") === "{\\rtf") {
    return "rtf";
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE_SIG)) {
    return sniffOle(buf);
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    return sniffZip(buf);
  }
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "From") {
    return "eml";
  }
  return null;
}

function sniffOle(buf) {
  if (hasUtf16le(buf, "WordDocument")) return "doc";
  if (hasUtf16le(buf, "Workbook") || hasUtf16le(buf, "Book")) return "xls";
  if (hasUtf16le(buf, "PowerPoint Document") || hasUtf16le(buf, "PowerPoint")) return "ppt";
  return "ole";
}

function sniffZip(buf) {
  const ascii = buf.toString("latin1");
  if (ascii.includes("application/vnd.oasis.opendocument.text")) return "odt";
  if (ascii.includes("application/vnd.oasis.opendocument.spreadsheet")) return "ods";
  if (ascii.includes("application/vnd.oasis.opendocument.presentation")) return "odp";
  if (ascii.includes("application/epub+zip")) return "epub";
  if (ascii.includes("wordprocessingml") || ascii.includes("word/document.xml")) return "docx";
  if (ascii.includes("spreadsheetml") || /xl\/workbook/u.test(ascii)) return "xlsx";
  if (ascii.includes("presentationml") || ascii.includes("ppt/slides")) return "pptx";
  return null;
}

/**
 * @param {string} filePath
 * @returns {Promise<{ kind: IngestKind, ext: string, name: string }>}
 */
export async function detectIngestKind(filePath) {
  const name = path.basename(filePath || "");
  const ext = path.extname(name).toLowerCase();
  let kind = EXT_MAP[ext] || "unknown";

  try {
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fh.read(buf, 0, 65536, 0);
      const head = buf.subarray(0, bytesRead);
      const magic = detectKindFromBytes(head);
      if (magic) {
        // Strong signatures win over a missing or wrong extension.
        // Identifiable ZIP/OLE/PDF/RTF replace a conflicting weak kind
        // (text/markdown/html/unknown/binary). Matching office ext is kept
        // when ZIP sniff fails (generic PK).
        if (kind === "unknown" || !ext) {
          kind = magic;
        } else if (magic === "pdf" || magic === "rtf" || magic === "ole") {
          kind = magic;
        } else if (magic === "eml" && (kind === "unknown" || kind === "text" || kind === "binary")) {
          kind = magic;
        } else if (
          (magic === "docx" ||
            magic === "xlsx" ||
            magic === "pptx" ||
            magic === "odt" ||
            magic === "ods" ||
            magic === "odp" ||
            magic === "epub" ||
            magic === "doc" ||
            magic === "xls" ||
            magic === "ppt") &&
          kind !== magic &&
          (kind === "text" || kind === "markdown" || kind === "html" || kind === "binary" || kind === "csv")
        ) {
          kind = magic;
        } else if (
          magic &&
          kind !== magic &&
          (kind === "text" || kind === "markdown" || kind === "unknown")
        ) {
          kind = magic;
        }
      } else if ((kind === "unknown" || !ext) && head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) {
        kind = "binary";
      }
    } finally {
      await fh.close();
    }
  } catch {
    /* keep kind from ext */
  }

  if (kind === "unknown") kind = "binary";
  return { kind, ext, name };
}

/** Kinds that anydoc / optional host tools / builtin JS can try to turn into Markdown. */
export function isConvertibleKind(kind) {
  return CONVERTIBLE_KINDS.includes(kind);
}
