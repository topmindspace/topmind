/**
 * Archive / receipts / restore ops — no Electron dependency.
 */
import path from "node:path";
import { archiveRoot, parseTopicId } from "./path-model.mjs";
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
};
