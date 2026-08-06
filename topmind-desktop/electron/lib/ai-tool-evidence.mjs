/**
 * Normalize AI tool write results into consistent path receipts for the model + UI.
 * Not a content truth store — projection of WorkspaceService writeback evidence.
 */

const PATH_KEYS = ["targetPath", "path", "newPath", "relativePath", "topicId"];

/**
 * @param {string} toolName
 * @param {unknown} result
 * @returns {Record<string, unknown>}
 */
export function normalizeWriteResult(toolName, result) {
  if (result == null) {
    return { ok: false, tool: toolName, error: "empty result" };
  }
  if (typeof result !== "object") {
    return { ok: true, tool: toolName, value: result };
  }
  const r = /** @type {Record<string, unknown>} */ (result);
  const targetPath =
    (typeof r.targetPath === "string" && r.targetPath) ||
    (typeof r.path === "string" && r.path) ||
    (typeof r.newPath === "string" && r.newPath) ||
    (typeof r.relativePath === "string" && r.relativePath) ||
    (typeof r.topicId === "string" && r.topicId) ||
    undefined;

  const operation =
    (typeof r.operation === "string" && r.operation) ||
    inferOperation(toolName);

  /** @type {Record<string, unknown>} */
  const out = {
    ...r,
    ok: r.ok !== false && r.error == null,
    tool: toolName,
    operation,
  };
  if (targetPath && !out.targetPath) out.targetPath = targetPath;
  if (Array.isArray(r.affectedFiles)) {
    out.affectedFiles = r.affectedFiles;
  } else if (targetPath) {
    out.affectedFiles = [targetPath, r.backupPath].filter(Boolean);
  }
  return out;
}

/**
 * Human + model-facing one-line summary for tool timeline cards.
 * @param {string} toolName
 * @param {unknown} output
 * @param {number} [max=240]
 */
export function summarizeToolOutput(toolName, output, max = 240) {
  try {
    if (output == null) return `${toolName}: (empty)`;
    if (typeof output === "string") {
      return output.replace(/\s+/gu, " ").trim().slice(0, max);
    }
    if (typeof output !== "object") return String(output).slice(0, max);

    const o = /** @type {Record<string, unknown>} */ (output);
    if (o.error) {
      return `${toolName} 失败: ${String(o.error).slice(0, max - 20)}`;
    }

    const path =
      pickStr(o, PATH_KEYS) ||
      (Array.isArray(o.affectedFiles) && typeof o.affectedFiles[0] === "string"
        ? o.affectedFiles[0]
        : null);

    const op = typeof o.operation === "string" ? o.operation : toolName;
    const bits = [op];
    if (path) bits.push(String(path));
    if (o.line != null) bits.push(`L${o.line}`);
    if (o.replacements != null) bits.push(`×${o.replacements}`);
    if (o.backupPath) bits.push("备份");
    if (o.archived === false && op === "edit") bits.push("无Archive");
    if (o.note && !path) bits.push(String(o.note).slice(0, 72));
    if (o.truncated) bits.push("截断");
    if (o.totalLines != null && o.endLine != null) {
      bits.push(`L${o.startLine || o.offset || 1}–${o.endLine}/${o.totalLines}`);
    }
    if (o.count != null && !path) bits.push(`${o.count}处`);
    if (Array.isArray(o.results) && o.results.length) bits.push(`${o.results.length}命中`);
    if (o.skills && Array.isArray(o.skills)) bits.push(`${o.skills.length} skills`);

    let s = bits.filter(Boolean).join(" · ");
    if (s.length < 8) {
      s = JSON.stringify(o).slice(0, max);
    }
    return s.slice(0, max);
  } catch {
    return `${toolName}: [result]`;
  }
}

function pickStr(obj, keys) {
  for (const k of keys) {
    if (typeof obj[k] === "string" && obj[k]) return obj[k];
  }
  return null;
}

function inferOperation(toolName) {
  const map = {
    capture_to_inbox: "capture",
    save_note: "save-note",
    save_file: "update",
    edit_file: "edit",
    create_topic: "create-topic",
    append_topic_memory: "append-memory",
    move_to_topic: "move",
    publish_to_outputs: "publish",
    delete_path: "delete",
    rename_path: "rename",
  };
  return map[toolName] || toolName;
}
