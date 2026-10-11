/**
 * Archive / receipts / restore ops — no Electron dependency.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  archiveRoot,
  parseTopicId,
  absWorkspaceRoot,
} from "./path-model.mjs";
import { exists, readText, writeText, listDir, statSafe } from "./fs-utils.mjs";
import {
  buildWritebackEvidence,
} from "./writeback.mjs";
import { S, sp, now } from "./workspace-helpers.mjs";
import { invalidateNotesIndex } from "./notes-index.mjs";
import { listArchiveEnhanced } from "./workspace-list-ops.mjs";
import { kernelDurableWrite } from "./kernel-api.mjs";

export const archiveOps = {
  /**
   * Archive listing. recursiveFlat (default true) for ArchiveView;
   * pass recursiveFlat:false + subPath for sidebar tree.
   */
  async listArchive(p = {}, ctx) {
    const recursiveFlat = p.recursiveFlat !== false && !p.subPath;
    return listArchiveEnhanced(
      {
        subPath: p.subPath || "",
        filter: p.filter || "all",
        recursiveFlat,
        limit: p.limit || 500,
      },
      ctx,
    );
  },

  async listTopicReceipts({ topicRelativePath, limit = 50 }, ctx) {
    S(topicRelativePath, "topicRelativePath");
    const { category, topic } = parseTopicId(topicRelativePath);
    if (!category || !topic) return { receipts: [] };
    const dir = path.join(archiveRoot(ctx.workspaceRoot), "backups", category, topic);
    if (!(await exists(dir))) return { receipts: [] };
    const entries = (await listDir(dir)).sort().reverse().slice(0, limit);
    const receipts = [];
    for (const e of entries) {
      const s = await statSafe(path.join(dir, e));
      if (s?.isFile()) receipts.push({ name: e, size: s.size, mtime: s.mtime.toISOString() });
    }
    return { receipts };
  },

  async readTopicReceipt({ archiveRelativePath }, ctx) {
    S(archiveRelativePath, "archiveRelativePath");
    return readText(await sp(ctx.workspaceRoot, archiveRelativePath));
  },

  async restoreTopicReceipt({ archiveRelativePath, targetRelativePath }, ctx) {
    S(archiveRelativePath, "archiveRelativePath"); S(targetRelativePath, "targetRelativePath");
    const src = await sp(ctx.workspaceRoot, archiveRelativePath);
    const t = now();
    // Kernel gate owns backup/receipt (locked overwrite only). Open restore
    // does not invent a pre-restore copy under 99-归档/backups.
    const content = await readText(src);
    const ev = await kernelDurableWrite(
      { relativePath: targetRelativePath, content },
      ctx,
      { actor: "user", confirmed: true, operation: "restore" },
    );
    invalidateNotesIndex(targetRelativePath);
    return {
      ...buildWritebackEvidence({
        operation: "restore",
        targetPath: targetRelativePath,
        savedAt: t,
        backupPath: ev.backupPath,
        receiptPath: ev.receiptPath,
        affectedFiles: [archiveRelativePath, targetRelativePath],
      }),
      ok: true,
      path: targetRelativePath,
    };
  },

  /**
   * List recent trash items under `{system}/backups/trash/` for restore UI.
   * Paths are workspace-relative (sp() compatible).
   * @param {{ limit?: number }} [p]
   */
  async listTrashItems({ limit = 30 } = {}, ctx) {
    const dataRoot = absWorkspaceRoot(ctx.workspaceRoot);
    const root = archiveRoot(ctx.workspaceRoot);
    const trashDir = path.join(root, "backups", "trash");
    if (!(await exists(trashDir))) return { items: [] };

    /** @type {{ trashRelativePath: string, originalRelativePath: string, name: string, size: number, mtime: string }[]} */
    const items = [];
    async function walk(abs, rel, depth) {
      if (items.length >= limit * 4 || depth > 6) return;
      let dirents;
      try {
        dirents = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of dirents) {
        const childAbs = path.join(abs, d.name);
        const childRel = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) {
          await walk(childAbs, childRel, depth + 1);
          continue;
        }
        if (!d.isFile()) continue;
        const st = await statSafe(childAbs);
        if (!st) continue;
        const m = d.name.match(/^\d{8}T\d{9}Z__(.+)$/u) || d.name.match(/^\d+__(.+)$/u);
        if (!m) continue;
        const originalName = m[1];
        const originalRel = rel ? `${rel}/${originalName}` : originalName;
        const trashRel = path.relative(dataRoot, childAbs).split(path.sep).join("/");
        items.push({
          trashRelativePath: trashRel,
          originalRelativePath: originalRel,
          name: originalName,
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      }
    }
    await walk(trashDir, "", 0);
    items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return { items: items.slice(0, limit) };
  },

  /**
   * Restore one trash file to its original relative path (overwrite if present).
   * @param {{ trashRelativePath: string, targetRelativePath?: string }} p
   */
  async restoreTrashItem({ trashRelativePath, targetRelativePath }, ctx) {
    S(trashRelativePath, "trashRelativePath");
    const src = await sp(ctx.workspaceRoot, trashRelativePath);
    const content = await readText(src);
    let target = targetRelativePath;
    if (!target) {
      const norm = String(trashRelativePath).replace(/\\/g, "/");
      const marker = "backups/trash/";
      const idx = norm.indexOf(marker);
      if (idx < 0) throw new Error(`Not a trash path: ${trashRelativePath}`);
      const under = norm.slice(idx + marker.length);
      const parts = under.split("/");
      const base = parts.pop() || "";
      const m = base.match(/^\d{8}T\d{9}Z__(.+)$/u) || base.match(/^\d+__(.+)$/u);
      if (!m) throw new Error(`Cannot derive original path from trash item: ${trashRelativePath}`);
      target = [...parts, m[1]].join("/");
    }
    const t = now();
    const ev = await kernelDurableWrite(
      { relativePath: target, content },
      ctx,
      { actor: "user", confirmed: true, operation: "restore" },
    );
    invalidateNotesIndex(target);
    return {
      ...buildWritebackEvidence({
        operation: "restore",
        targetPath: target,
        savedAt: t,
        backupPath: ev.backupPath,
        receiptPath: ev.receiptPath,
        affectedFiles: [trashRelativePath, target],
      }),
      ok: true,
      path: target,
      restoredFrom: trashRelativePath,
    };
  },
};
