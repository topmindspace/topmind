/**
 * Collect write receipts during a single AI agent turn.
 * Not a content truth store — session-scoped projection for UI summary.
 *
 * - auto: surface only when multi-file (≥2 distinct paths)
 * - confirm（保存前问我）: write tools still run → pending queue; batch path
 *   receipts stay empty here (UI uses ActionBar for pending writes)
 */

const EVIDENCE_KEYS = [
  "operation", "targetPath", "backupPath", "affectedFiles", "savedAt", "path", "newPath", "ok",
];

export function createBatchCollector(writebackMode) {
  const mode = writebackMode || "auto";
  /** @type {Array<Record<string, unknown>>} */
  const items = [];
  return {
    // confirm: still "active" for API shape, but record skips multi-file batch UI
    // (pending writes use ActionBar)
    active: true,
    mode,
    items,
    record(toolName, result) {
      // Multi-file path receipt only for auto (confirm uses pending strip)
      if (mode === "confirm" || !result || typeof result !== "object") return;
      const entry = { tool: toolName };
      for (const k of EVIDENCE_KEYS) {
        if (result[k] !== undefined) entry[k] = result[k];
      }
      if (entry.targetPath || entry.path || entry.newPath || entry.backupPath) {
        items.push(entry);
      }
    },
    summary() {
      if (items.length === 0) return null;
      const paths = [];
      const backups = [];
      for (const it of items) {
        const p = it.targetPath || it.path || it.newPath;
        if (p && !paths.includes(p)) paths.push(String(p));
        if (it.backupPath && !backups.includes(it.backupPath)) backups.push(String(it.backupPath));
      }
      // Only surface for multi-path writes
      if (paths.length < 2) return null;
      return {
        writebackMode: mode,
        writeCount: items.length,
        targetPaths: paths,
        backupPaths: backups,
        items,
        message: `本轮多文件写回 ${items.length} 处 · 目标 ${paths.length} · 备份 ${backups.length}`,
      };
    },
  };
}
