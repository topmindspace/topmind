import { parse as parseYaml, stringify as stringifyYaml } from "../../lib/yaml-bridge.mjs";

function asData(header) {
  if (!header.trim()) return {};
  const parsed = parseYaml(header);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frontmatter must be a YAML mapping");
  }
  // Keep the historical scalar-string shape for UTR callers while preserving
  // arrays and maps as structured values instead of flattening them into lines.
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [
    key,
    value != null && typeof value === "object" ? value : value == null ? "" : String(value),
  ]));
}

export function parseFrontmatter(text) {
  const source = String(text ?? "");
  const leading = source.match(/^\s*/u)?.[0] || "";
  const content = source.slice(leading.length);
  const open = /^---[ \t]*(\r?\n)/u.exec(content);
  if (!open) return { data: {}, body: source, leading, hasFrontmatter: false };
  const close = /(\r?\n)---[ \t]*(?=\r?\n|$)/gu.exec(content.slice(open[0].length));
  if (!close) throw new Error("Unclosed YAML frontmatter");
  const headerStart = leading.length + open[0].length;
  const headerEnd = headerStart + close.index;
  const closingStart = headerEnd + close[1].length;
  const closingLine = /^---[ \t]*(\r?\n|$)/u.exec(source.slice(closingStart));
  if (!closingLine) throw new Error("Invalid YAML frontmatter closing fence");
  const header = source.slice(headerStart, headerEnd);
  const bodyStart = closingStart + closingLine[0].length;
  return {
    data: asData(header),
    body: source.slice(bodyStart),
    leading,
    hasFrontmatter: true,
    headerStart,
    headerEnd,
    insertOffset: closingStart,
    bodyStart,
    eol: open[1],
  };
}

/** Replace only the body of an existing valid frontmatter note. */
export function replaceFrontmatterBody(text, body) {
  const source = String(text ?? "");
  const parsed = parseFrontmatter(source);
  if (!parsed.hasFrontmatter) throw new Error("Cannot replace body without valid frontmatter");
  return source.slice(0, parsed.bodyStart) + String(body ?? "");
}

export function stringifyFrontmatter({ data = {}, body = "", leading = "" } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Frontmatter data must be a YAML mapping");
  }
  const header = Object.keys(data).length ? stringifyYaml(data).trimEnd() + "\n" : "";
  return `${leading}---\n${header}---\n${String(body ?? "")}`;
}

function commentSuffix(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && char === "\\") { escaped = true; continue; }
    if (quote && char === quote) { quote = null; continue; }
    if (!quote && (char === '"' || char === "'")) { quote = char; continue; }
    if (!quote && char === "#" && (i === 0 || /\s/u.test(line[i - 1]))) {
      let start = i;
      while (start > 0 && /[ \t]/u.test(line[start - 1])) start--;
      return line.slice(start);
    }
  }
  return "";
}

function checkedFieldResult(next, key, value) {
  const parsed = parseFrontmatter(next);
  if (parsed.data[key] !== String(value)) {
    throw new Error(`Frontmatter field could not be safely updated: ${key}`);
  }
  return next;
}

/** Change one simple top-level scalar without reserializing unrelated YAML. */
export function setFrontmatterField(text, key, value) {
  if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/u.test(key)) {
    throw new Error("Frontmatter field name must be a simple YAML key");
  }
  if (value == null || typeof value === "object" || /[\r\n]/u.test(String(value))) {
    throw new Error("Frontmatter field value must be a single-line scalar");
  }
  const source = String(text ?? "");
  const parsed = parseFrontmatter(source);
  if (!parsed.hasFrontmatter) {
    return checkedFieldResult(stringifyFrontmatter({ data: { [key]: value }, body: source }), key, value);
  }
  const header = source.slice(parsed.headerStart, parsed.headerEnd);
  const serialized = stringifyYaml({ [key]: value }).trimEnd();
  const keyLine = new RegExp(`^${key}[ \\t]*:.*$`, "gmu");
  const matches = [...header.matchAll(keyLine)];
  if (Object.hasOwn(parsed.data, key)) {
    if (typeof parsed.data[key] === "object" || matches.length !== 1) {
      throw new Error(`Cannot safely replace complex frontmatter field: ${key}`);
    }
    const match = matches[0];
    const oldLine = match[0].replace(/\r$/u, "");
    const suffix = commentSuffix(oldLine.slice(oldLine.indexOf(":") + 1));
    const replacement = serialized + suffix + (match[0].endsWith("\r") ? "\r" : "");
    const start = parsed.headerStart + match.index;
    return checkedFieldResult(source.slice(0, start) + replacement + source.slice(start + match[0].length), key, value);
  }
  if (matches.length) throw new Error(`Ambiguous frontmatter field: ${key}`);
  return checkedFieldResult(source.slice(0, parsed.insertOffset) + serialized + parsed.eol + source.slice(parsed.insertOffset), key, value);
}

export function touchUpdatedFrontmatter(text, timestamp = new Date().toISOString()) {
  const parsed = parseFrontmatter(text);
  const key = Object.hasOwn(parsed.data, "updated") ? "updated" : "updated_at";
  return setFrontmatterField(text, key, timestamp);
}
