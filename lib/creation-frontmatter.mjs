/** Strict creation frontmatter parse shared by identity reads and the write gate. */
import { parse as parseYaml } from "./yaml-bridge.mjs";

/** Parse only a complete YAML header; never silently rewrite malformed YAML. */
export function parseCreationFrontmatter(markdown) {
  const bom = markdown.startsWith("\ufeff") ? "\ufeff" : "";
  const text = markdown.slice(bom.length);
  const open = /^---[ \t]*(\r?\n)/u.exec(text);
  if (!open) return { exists: false, valid: true, fields: {}, bom, eol: "\n", insertOffset: null };
  const close = /(\r?\n)---[ \t]*(?=\r?\n|$)/gu.exec(text.slice(open[0].length));
  if (!close) return { exists: true, valid: false, fields: null, bom, reason: "unclosed" };
  const insertOffset = bom.length + open[0].length + close.index + close[1].length;
  const header = text.slice(open[0].length, open[0].length + close.index);
  try {
    const fields = header.trim() ? parseYaml(header) : {};
    if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
        (Object.getPrototypeOf(fields) !== Object.prototype && Object.getPrototypeOf(fields) !== null)) {
      return { exists: true, valid: false, fields: null, bom, reason: "not-mapping" };
    }
    return { exists: true, valid: true, fields, bom, eol: open[1], insertOffset };
  } catch {
    return { exists: true, valid: false, fields: null, bom, reason: "invalid-yaml" };
  }
}
