/**
 * Detect ingest kind from path + optional magic bytes.
 * @typedef {'markdown'|'text'|'html'|'docx'|'pdf'|'xlsx'|'csv'|'pptx'|'eml'|'msg'|'binary'|'unknown'} IngestKind
 */

import path from "node:path";
import { promises as fs } from "node:fs";

/** @type {Record<string, IngestKind>} */
const EXT_MAP = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".txt": "text",
  ".text": "text",
  ".html": "html",
  ".htm": "html",
  ".docx": "docx",
  ".pdf": "pdf",
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
  ".csv": "csv",
  ".tsv": "csv",
  ".pptx": "pptx",
  ".eml": "eml",
  ".msg": "msg",
};

/**
 * @param {string} filePath
 * @returns {Promise<{ kind: IngestKind, ext: string, name: string }>}
 */
export async function detectIngestKind(filePath) {
  const name = path.basename(filePath || "");
  const ext = path.extname(name).toLowerCase();
  let kind = EXT_MAP[ext] || "unknown";

  // Magic-byte overrides when extension is missing / wrong
  if (kind === "unknown" || !ext) {
    try {
      const fh = await fs.open(filePath, "r");
      try {
        const buf = Buffer.alloc(8);
        const { bytesRead } = await fh.read(buf, 0, 8, 0);
        const head = buf.slice(0, bytesRead);
        if (head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
          kind = "pdf";
        } else if (head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) {
          // ZIP container — could be docx/xlsx/pptx; keep ext-based if present
          if (kind === "unknown") kind = "binary";
        } else if (head.length >= 4 && head.toString("ascii", 0, 4) === "From") {
          kind = "eml";
        }
      } finally {
        await fh.close();
      }
    } catch {
      /* keep kind from ext */
    }
  }

  if (kind === "unknown") kind = "binary";
  return { kind, ext, name };
}

/** Kinds that pure-JS or external converters can try to turn into Markdown. */
export function isConvertibleKind(kind) {
  return [
    "markdown",
    "text",
    "html",
    "docx",
    "pdf",
    "xlsx",
    "csv",
    "pptx",
    "eml",
  ].includes(kind);
}
