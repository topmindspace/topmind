/**
 * WorkspaceService — thin facade over modular ops.
 *
 * Modules (no Electron dep except this facade's shell/clipboard):
 *   lib/workspace-path-ops.mjs    — save/delete/rename/publish/note/topic/memory
 *   lib/workspace-inbox-ops.mjs   — inbox/import/move
 *   lib/workspace-archive-ops.mjs — archive/receipts/restore
 *   lib/workspace-scan-ops.mjs    — list/search/health + notes index
 *   lib/workspace-fetch-ops.mjs   — URL → markdown
 *   lib/notes-index.mjs           — cached metadata for sidebar views
 */
import { shell, clipboard } from "electron";
import { pathOps } from "./lib/workspace-path-ops.mjs";
import { createInboxOps } from "./lib/workspace-inbox-ops.mjs";
import { archiveOps } from "./lib/workspace-archive-ops.mjs";
import { scanOps } from "./lib/workspace-scan-ops.mjs";
import { fetchOps, buildFetchResult } from "./lib/workspace-fetch-ops.mjs";
import { extractArticle, cleanCaptureUrl } from "./lib/fetch-article.mjs";
import { fetchRenderedHtml } from "./lib/fetch-render.mjs";
import { S, sp } from "./lib/workspace-helpers.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { blockUnconfirmedHighImpact } from "./lib/suggestion-gate.mjs";
import { loadAppSettings } from "./settings.mjs";
import { createKernelAiProvider } from "./ai-provider-adapter.mjs";
import { logInfo } from "./lib/writeback.mjs";

const inboxOps = createInboxOps({
  // late-bound so batchMove can call the same moveToTopic implementation
  moveToTopic: (...args) => WorkspaceService.moveToTopic(...args),
});

export const WorkspaceService = {
  // ── Scan / navigate ──────────────────────────────────────────────────────
  listCategories: scanOps.listCategories,
  listTopics: scanOps.listTopics,
  listTopicFiles: scanOps.listTopicFiles,
  listWorkspaceDir: scanOps.listWorkspaceDir,
  getTopic: scanOps.getTopic,
  listOutputs: scanOps.listOutputs,
  listAllNotes: scanOps.listAllNotes,
  search: scanOps.search,
  grepWorkspace: scanOps.grepWorkspace,
  workspaceHealth: scanOps.workspaceHealth,

  // ── Path / content ───────────────────────────────────────────────────────
  duplicatePath: pathOps.duplicatePath,
  getFileMeta: pathOps.getFileMeta,
  updateFrontmatter: pathOps.updateFrontmatter,
  readPath: pathOps.readPath,
  readPathWindow: pathOps.readPathWindow,
  editPath: pathOps.editPath,
  savePath: pathOps.savePath,
  saveBinary: pathOps.saveBinary,
  deletePath: pathOps.deletePath,
  renamePath: pathOps.renamePath,
  publishPath: pathOps.publishPath,
  saveNote: pathOps.saveNote,
  createTopic: pathOps.createTopic,
  deleteTopic: pathOps.deleteTopic,
  renameTopic: pathOps.renameTopic,
  appendTopicMemory: pathOps.appendTopicMemory,
  appendCoreMemory: pathOps.appendCoreMemory,
  getStreamContext: pathOps.getStreamContext,
  listStreamPeriods: pathOps.listStreamPeriods,
  appendStreamEntry: pathOps.appendStreamEntry,
  ensureCoreProfile: pathOps.ensureCoreProfile,
  reconcileStreamPeriod: pathOps.reconcileStreamPeriod,

  /** Lifecycle / memory suggestions (no write until applySuggestion). */
  async generateSuggestions(p, ctx) {
    const { kernelGenerateSuggestions } = await import("./lib/kernel-api.mjs");
    // Create AI provider from settings (null when AI not configured).
    // Passed per-call into the kernel — no global singleton (multi-workspace safe).
    const settings = await loadAppSettings(
      ctx.workspaceStatePaths.settingsFilePath,
      ctx.workspaceRoot?.userWorkspaceRoot || "",
      { secretAdapter: ctx.secretAdapter },
    );
    const aiProvider = createKernelAiProvider(settings);
    if (aiProvider) logInfo("workspace", "generateSuggestions with AI provider");
    const force = p?.force === true;
    const items = await kernelGenerateSuggestions(ctx.workspaceRoot, ctx.engineRoot, aiProvider, {
      force,
    });
    return { ok: true, suggestions: items };
  },
  async applySuggestion({ suggestion, confirmed }, ctx) {
    const blocked = blockUnconfirmedHighImpact(suggestion, confirmed);
    if (blocked) return blocked;
    const { kernelApplySuggestion } = await import("./lib/kernel-api.mjs");
    // Create AI provider from settings for AI-powered suggestion apply
    // (e.g., stream_digest with real AI summary generation). Per-call only.
    const settings = await loadAppSettings(
      ctx.workspaceStatePaths.settingsFilePath,
      ctx.workspaceRoot?.userWorkspaceRoot || "",
      { secretAdapter: ctx.secretAdapter },
    );
    const aiProvider = createKernelAiProvider(settings);
    const result = await kernelApplySuggestion(ctx.workspaceRoot, suggestion, ctx.engineRoot, aiProvider);
    return { ok: true, ...result };
  },

  async listPendingWrites() {
    const { listPendingWrites } = await import("./lib/pending-writes.mjs");
    return { ok: true, pending: listPendingWrites() };
  },

  async confirmPendingWrite({ id }, ctx) {
    const { takePendingWrite } = await import("./lib/pending-writes.mjs");
    const entry = takePendingWrite(id);
    if (!entry) throw new Error("pending write not found or already handled");
    return pathOps.savePath(
      {
        relativePath: entry.relativePath,
        content: entry.content,
        actor: "ai",
        confirmed: true,
      },
      ctx,
    );
  },

  async rejectPendingWrite({ id }) {
    const { rejectPendingWrite } = await import("./lib/pending-writes.mjs");
    return { ok: rejectPendingWrite(id) };
  },

  // ── Inbox ────────────────────────────────────────────────────────────────
  listInbox: inboxOps.listInbox,
  ingestInbox: inboxOps.ingestInbox,
  /**
   * Import external file via knowledge ingest pipeline (convert → Markdown when possible).
   * Falls back to original copy on conversion failure.
   */
  async importFile(p, ctx) {
    const { IngestService } = await import("./ingest-service.mjs");
    return IngestService.importAndWait(
      {
        absolutePath: p?.absolutePath,
        targetTopicId: p?.targetTopicId,
      },
      ctx,
    );
  },
  /** Legacy binary/text copy without conversion (escape hatch / tests). */
  importFileRaw: inboxOps.importFile,
  batchMoveToTopic: inboxOps.batchMoveToTopic,
  moveToTopic: inboxOps.moveToTopic,

  // ── Archive ──────────────────────────────────────────────────────────────
  listArchive: archiveOps.listArchive,
  listTopicReceipts: archiveOps.listTopicReceipts,
  readTopicReceipt: archiveOps.readTopicReceipt,
  restoreTopicReceipt: archiveOps.restoreTopicReceipt,

  // ── Fetch ────────────────────────────────────────────────────────────────
  /**
   * Static fetch first; optional Chromium render for SPA shells.
   * @param {{ url: string, maxLen?: number, render?: boolean }} p
   */
  async fetchUrl(p, ctx) {
    const wantRender = p?.render === true || p?.render === "true" || p?.enhanced === true;
    if (!wantRender) {
      const staticResult = await fetchOps.fetchUrl(p, ctx);
      // Auto-upgrade once when body is empty SPA shell (opt-in path still available)
      if (staticResult.likelySpa && (staticResult.wordCount || 0) < 40) {
        staticResult.canEnhance = true;
      }
      return staticResult;
    }

    S(p?.url, "url", { maxLen: 4096 });
    const cleanedUrl = cleanCaptureUrl(p.url);
    const cap = Math.min(Math.max(Number(p.maxLen) || 40_000, 5_000), 200_000);
    try {
      const rendered = await fetchRenderedHtml(cleanedUrl, { timeoutMs: 20_000 });
      const article = extractArticle(rendered.html, {
        url: cleanCaptureUrl(rendered.finalUrl || cleanedUrl),
        maxLen: cap,
      });
      const result = buildFetchResult(article, {
        url: cleanCaptureUrl(rendered.finalUrl || cleanedUrl),
        maxLen: cap,
        rawBytes: Buffer.byteLength(rendered.html, "utf8"),
        methodOverride: "render",
      });
      result.enhanced = true;
      if (result.wordCount < 40) {
        result.warning = ei18n("ai.enhanceNoContent");
      } else if (!result.warning) {
        result.warning = undefined;
      }
      return result;
    } catch (e) {
      // Fall back to static fetch with original error noted
      const fallback = await fetchOps.fetchUrl({ url: p.url, maxLen: p.maxLen }, ctx);
      const reason = e instanceof Error ? e.message : String(e);
      fallback.warning = ei18n("ai.enhanceFail", { reason, warning: fallback.warning ? ` ${fallback.warning}` : "" });
      fallback.enhanced = false;
      fallback.canEnhance = true;
      return fallback;
    }
  },

  // ── Todo ──────────────────────────────────────────────────────────────
  async getTodoList(_p, ctx) {
    const { kernelReadTodoList } = await import("./lib/kernel-api.mjs");
    return kernelReadTodoList(ctx);
  },
  async addTodoItem(p, ctx) {
    const { kernelAddTodoItem } = await import("./lib/kernel-api.mjs");
    return kernelAddTodoItem(p, ctx);
  },
  async toggleTodoItem(p, ctx) {
    const { kernelToggleTodoItem } = await import("./lib/kernel-api.mjs");
    return kernelToggleTodoItem(p, ctx);
  },
  async updateTodoItem(p, ctx) {
    const { kernelUpdateTodoItem } = await import("./lib/kernel-api.mjs");
    return kernelUpdateTodoItem(p, ctx);
  },
  async setTodoDueDate(p, ctx) {
    const { kernelSetTodoDueDate } = await import("./lib/kernel-api.mjs");
    return kernelSetTodoDueDate(p, ctx);
  },
  async deleteTodoItem(p, ctx) {
    const { kernelDeleteTodoItem } = await import("./lib/kernel-api.mjs");
    return kernelDeleteTodoItem(p, ctx);
  },
  async clearCompletedTodos(_p, ctx) {
    const { kernelClearCompletedTodos } = await import("./lib/kernel-api.mjs");
    return kernelClearCompletedTodos(ctx);
  },
  async extractTodosFromStream(p, ctx) {
    const { kernelExtractTodosFromStream } = await import("./lib/kernel-api.mjs");
    return kernelExtractTodosFromStream(p, ctx);
  },
  async maintainTodos(p, ctx) {
    const { kernelMaintainTodos } = await import("./lib/kernel-api.mjs");
    return kernelMaintainTodos(p, ctx);
  },
  async getTodoHealth(_p, ctx) {
    const { kernelGetTodoHealth } = await import("./lib/kernel-api.mjs");
    return kernelGetTodoHealth({}, ctx);
  },
  async cleanupStaleTodos(_p, ctx) {
    const { kernelCleanupStaleTodos } = await import("./lib/kernel-api.mjs");
    return kernelCleanupStaleTodos({}, ctx);
  },
  async archiveStaleTodos(_p, ctx) {
    const { kernelArchiveStaleTodos } = await import("./lib/kernel-api.mjs");
    return kernelArchiveStaleTodos({}, ctx);
  },

  // ── AI Operations (unified engine) ───────────────────────────────────────
  async listOperationTypes(_p, ctx) {
    const { kernelListOperationTypes } = await import("./lib/kernel-api.mjs");
    return kernelListOperationTypes(ctx);
  },
  async runOperation(p, ctx) {
    const { kernelRunOperation } = await import("./lib/kernel-api.mjs");
    return kernelRunOperation(p, ctx);
  },
  async getOperationState(p, ctx) {
    const { kernelGetOperationState } = await import("./lib/kernel-api.mjs");
    return kernelGetOperationState(p, ctx);
  },
  async clearOperationState(p, ctx) {
    const { kernelClearOperationState } = await import("./lib/kernel-api.mjs");
    return kernelClearOperationState(p, ctx);
  },

  // ── Electron-only OS bridges (path-safe) ─────────────────────────────────
  async copyPath({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    const abs = await sp(ctx.workspaceRoot, relativePath);
    clipboard.writeText(abs);
    return { ok: true };
  },

  async revealFile({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    shell.showItemInFolder(await sp(ctx.workspaceRoot, relativePath));
    return { ok: true };
  },

  async openFile({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    const abs = await sp(ctx.workspaceRoot, relativePath);
    const err = await shell.openPath(abs);
    if (err) throw new Error(ei18n("workspace.openFileFail", { error: err }));
    return { ok: true };
  },
};
