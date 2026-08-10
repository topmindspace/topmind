// ── topmind YAML Writer (Shared Utility) ───────────────────────────────────
// Centralized YAML serialization for frontmatter, receipts, and contract files.
// Handles string escaping, arrays, nested objects, and special characters.

/**
 * Escape string for YAML output (handle quotes and special chars).
 * @param {string} str
 * @returns {string}
 */
export function escapeYamlString(str) {
  if (str === null || str === undefined) return '""';
  const s = String(str);
  // If string contains special chars, wrap in quotes and escape
  if (/[:#\n"'\[\]{}&*!|>"%@`\-]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Serialize a simple key-value pair to YAML line.
 * @param {string} key
 * @param {unknown} value
 * @param {number} [indent=0]
 * @returns {string}
 */
export function yamlLine(key, value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (value === null || value === undefined) {
    return `${prefix}${key}:`;
  }
  if (typeof value === "boolean") {
    return `${prefix}${key}: ${value}`;
  }
  if (typeof value === "number") {
    return `${prefix}${key}: ${value}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}${key}: []`;
    }
    return `${prefix}${key}:`;
  }
  if (typeof value === "object") {
    return `${prefix}${key}:`;
  }
  return `${prefix}${key}: ${escapeYamlString(value)}`;
}

/**
 * Serialize an array of strings to YAML lines.
 * @param {string} key
 * @param {string[]} items
 * @param {number} [indent=0]
 * @returns {string[]}
 */
export function yamlArray(key, items, indent = 0) {
  const prefix = " ".repeat(indent);
  if (!items || items.length === 0) {
    return [`${prefix}${key}: []`];
  }
  const lines = [`${prefix}${key}:`];
  for (const item of items) {
    lines.push(`${prefix}  - ${escapeYamlString(item)}`);
  }
  return lines;
}

/**
 * Serialize a nested object to YAML lines.
 * @param {string} key
 * @param {object} obj
 * @param {number} [indent=0]
 * @returns {string[]}
 */
export function yamlObject(key, obj, indent = 0) {
  const prefix = " ".repeat(indent);
  const lines = [`${prefix}${key}:`];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      lines.push(...yamlArray(k, v, indent + 2));
    } else if (typeof v === "object" && v !== null) {
      lines.push(...yamlObject(k, v, indent + 2));
    } else {
      lines.push(yamlLine(k, v, indent + 2));
    }
  }
  return lines;
}

/**
 * Build YAML frontmatter block.
 * @param {object} fields - frontmatter fields
 * @returns {string} frontmatter block (---\n...\n---\n)
 */
export function buildFrontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(...yamlArray(key, value));
    } else if (typeof value === "object" && value !== null) {
      lines.push(...yamlObject(key, value));
    } else {
      lines.push(yamlLine(key, value));
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/**
 * Build YAML receipt content.
 * @param {object} evidence - write evidence
 * @returns {string} YAML content
 */
export function buildReceipt(evidence) {
  const lines = [];
  lines.push(yamlLine("operation", evidence.operation));
  lines.push(yamlLine("writeback_mode", evidence.writeback_mode));
  lines.push(yamlLine("target_path", evidence.target_path));
  lines.push(...yamlArray("affected_files", evidence.affected_files));
  lines.push(yamlLine("wrote_files", evidence.wrote_files));
  lines.push(yamlLine("receipt_path", evidence.receipt_path));
  if (evidence.backup_path) {
    lines.push(yamlLine("backup_path", evidence.backup_path));
  }
  if (evidence.revision_path) {
    lines.push(yamlLine("revision_path", evidence.revision_path));
  }
  lines.push(yamlLine("protection", evidence.protection));
  lines.push(yamlLine("saved_at", evidence.saved_at));
  if (evidence.next_actions && evidence.next_actions.length > 0) {
    lines.push(...yamlArray("next_actions", evidence.next_actions));
  }
  return lines.join("\n") + "\n";
}
