/**
 * Read clipboard as capture payload: text, html, file paths.
 * Platform nuances:
 *  - macOS: public.file-url / NSFilenamesPboardType
 *  - Windows: text + path-looking lines; file drops via renderer paste event preferred
 *  - Linux: text + file:// URIs in text
 */
import { clipboard } from "electron";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";

/**
 * @returns {Promise<{
 *   text: string,
 *   html: string,
 *   filePaths: string[],
 *   formats: string[],
 *   kind: 'empty'|'text'|'html'|'files'|'mixed'
 * }>}
 */
export async function readClipboardPayload() {
  let formats = [];
  try {
    formats = clipboard.availableFormats() || [];
  } catch {
    formats = [];
  }

  let text = "";
  try {
    text = String(clipboard.readText() || "").trim();
  } catch {
    text = "";
  }

  let html = "";
  try {
    html = String(clipboard.readHTML() || "").trim();
  } catch {
    html = "";
  }
  // Ignore empty HTML shells
  if (html && /^<meta[^>]*>\s*$/iu.test(html)) html = "";

  const filePaths = await collectFilePaths(formats, text);

  let kind = "empty";
  if (filePaths.length && (text || html)) kind = "mixed";
  else if (filePaths.length) kind = "files";
  else if (html && html.length > 40 && /<[a-z][\s\S]*>/iu.test(html)) kind = "html";
  else if (text) kind = "text";

  return { text, html, filePaths, formats, kind };
}

/**
 * @param {string[]} formats
 * @param {string} text
 */
async function collectFilePaths(formats, text) {
  /** @type {string[]} */
  const out = [];
  const push = (p) => {
    const n = normalizePath(p);
    if (n && !out.includes(n)) out.push(n);
  };

  // 1) public.file-url (macOS single / multi sometimes)
  if (formats.some((f) => /file-url|public\.file/iu.test(f))) {
    try {
      const raw = clipboard.read("public.file-url");
      if (raw) {
        for (const line of String(raw).split(/[\r\n]+/u)) {
          const t = line.trim();
          if (t.startsWith("file:")) {
            try {
              push(fileURLToPath(t));
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 2) NSFilenamesPboardType (macOS multi-file from Finder)
  try {
    const buf = clipboard.readBuffer("NSFilenamesPboardType");
    if (buf?.length) {
      for (const p of parseNsFilenamesPlist(buf)) push(p);
    }
  } catch {
    /* ignore */
  }

  // 2b) Windows FileNameW / FileName (best-effort; paste event is more reliable)
  if (process.platform === "win32") {
    for (const fmt of ["FileNameW", "FileName", "CF_HDROP"]) {
      try {
        if (!formats.some((f) => f.toLowerCase() === fmt.toLowerCase()) && fmt !== "FileNameW") {
          continue;
        }
        const buf = clipboard.readBuffer(fmt);
        if (!buf?.length) continue;
        if (fmt === "FileNameW") {
          // UTF-16LE null-terminated path(s)
          const text = buf.toString("utf16le").replace(/\u0000+$/gu, "");
          for (const part of text.split("\u0000")) {
            if (part && /^[A-Za-z]:\\/u.test(part)) push(part);
          }
        } else {
          const text = buf.toString("utf8");
          for (const part of text.split(/\0/u)) {
            if (part && (part.startsWith("/") || /^[A-Za-z]:\\/u.test(part))) push(part);
          }
        }
      } catch {
        /* ignore format */
      }
    }
  }

  // 3) text as file:// or absolute existing paths (one per line)
  if (text) {
    for (const line of text.split(/\r?\n/u)) {
      const t = line.trim().replace(/^['"]|['"]$/gu, "");
      if (!t) continue;
      if (t.startsWith("file:")) {
        try {
          push(fileURLToPath(t));
        } catch {
          /* ignore */
        }
      } else if (path.isAbsolute(t) && existsSync(t)) {
        push(t);
      }
    }
  }

  // Keep only existing files/dirs (cap)
  const verified = [];
  for (const p of out.slice(0, 50)) {
    try {
      const st = await fs.stat(p);
      if (st.isFile() || st.isDirectory()) verified.push(p);
    } catch {
      /* skip */
    }
  }
  return verified;
}

function normalizePath(p) {
  if (!p || typeof p !== "string") return "";
  let s = p.trim();
  if (!s) return "";
  // Unescape common encodings
  try {
    if (s.includes("%")) s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  return path.normalize(s);
}

/** Best-effort parse of NSFilenamesPboardType (XML plist or binary with path strings). */
function parseNsFilenamesPlist(buf) {
  const text = buf.toString("utf8");
  /** @type {string[]} */
  const paths = [];
  if (text.includes("<string>") || text.includes("plist")) {
    const re = /<string>([^<]+)<\/string>/gu;
    let m;
    while ((m = re.exec(text)) !== null) {
      const s = m[1].trim();
      if (s.startsWith("/") || /^[A-Za-z]:\\/u.test(s)) paths.push(s);
    }
    return paths;
  }
  // Binary plist: extract absolute path-like ASCII/UTF-8 runs
  const re2 = /(?:\/[\w .@+\-()[\]]+){2,}/gu;
  const ascii = buf.toString("binary");
  let m2;
  while ((m2 = re2.exec(ascii)) !== null) {
    const s = m2[0];
    if (s.length >= 4 && s.length < 512) paths.push(s);
  }
  return paths;
}
