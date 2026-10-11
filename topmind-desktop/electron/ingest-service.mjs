/**
 * IngestService — knowledge processing pipeline RPC facade.
 * Methods: enqueue | list | get | cancel | retry | pickFiles | pickFolder |
 *          toolsStatus | previewItems | openInstallHelp | installAnydoc | readClipboard | …
 */
import { dialog, shell, clipboard } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  configureIngestQueue,
  enqueueItem,
  listJobs,
  getJob,
  cancelJob,
  retryJob,
  restoreQueueFromDisk,
} from "./lib/ingest/queue.mjs";
import {
  processIngestJob,
  resolveIngestSettings,
  walkFiles,
  defaultIngestSettings,
  INGEST_MAX_FILE_BYTES_CAP,
} from "./lib/ingest/process-job.mjs";
import { detectIngestKind, isConvertibleKind, INGEST_FILE_EXTENSIONS } from "./lib/ingest/detect.mjs";
import {
  probeExternalTools,
  clearExternalToolsCache,
  isIngestToolKey,
} from "./lib/ingest/external-tools.mjs";
import { installAnydocSidecar } from "./lib/ingest/anydoc-sidecar.mjs";
import {
  readToolsDiskCache,
  writeToolsDiskCache,
  clearToolsDiskCache,
} from "./lib/ingest/tools-cache.mjs";
import { readClipboardPayload } from "./lib/ingest/clipboard-payload.mjs";
import { logInfo, logWarn } from "./lib/writeback.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";

let wired = false;

function ensureWired(ctx) {
  if (wired) return;
  configureIngestQueue({
    emit: (event, payload) => ctx?.emit?.(event, payload),
    processJob: processIngestJob,
    getContext: () => {
      // re-bound each pump via service methods that call ensureWired with live ctx
      return latestCtx;
    },
    concurrency: 1,
  });
  wired = true;
  void restoreQueueFromDisk().catch(() => {});
}

/** @type {object|null} */
let latestCtx = null;

function bindCtx(ctx) {
  latestCtx = ctx;
  ensureWired(ctx);
  const settings = resolveIngestSettings(ctx.appSettings);
  configureIngestQueue({
    emit: (event, payload) => ctx.emit?.(event, payload),
    processJob: processIngestJob,
    getContext: () => latestCtx,
    concurrency: settings.concurrency,
  });
}

export const IngestService = {
  async enqueue(params, ctx) {
    bindCtx(ctx);
    if (!ctx.workspaceRoot?.userWorkspaceRoot && !ctx.workspaceRoot) {
      throw new Error("No active workspace.");
    }
    const dest = params?.dest || {};
    const items = [];
    if (Array.isArray(params?.items)) {
      for (const it of params.items) {
        if (it?.absolutePath) items.push(it.absolutePath);
      }
    }
    if (params?.absolutePath) items.push(params.absolutePath);
    if (!items.length) throw new Error("items or absolutePath required");

    const settings = resolveIngestSettings(ctx.appSettings);
    const jobIds = [];
    for (const abs of items) {
      const st = await fs.stat(abs).catch(() => null);
      if (!st) {
        logWarn("ingest", "skip missing path", { abs });
        continue;
      }
      if (st.isDirectory()) {
        const files = await walkFiles(abs, settings.maxFolderFiles);
        if (files.length >= settings.maxFolderFiles) {
          logWarn("ingest", "folder capped", { abs, max: settings.maxFolderFiles });
        }
        for (const f of files) {
          const job = enqueueItem({ absolutePath: f }, dest, { name: path.basename(f) });
          jobIds.push(job.id);
        }
      } else if (st.isFile()) {
        const job = enqueueItem(
          { absolutePath: abs },
          dest,
          { name: path.basename(abs), size: st.size },
        );
        jobIds.push(job.id);
      }
    }
    logInfo("ingest", "enqueued", { count: jobIds.length });
    return { ok: true, jobIds, jobs: jobIds.map((id) => getJob(id)) };
  },

  async list(_p, ctx) {
    bindCtx(ctx);
    return { jobs: listJobs() };
  },

  async get({ jobId }, ctx) {
    bindCtx(ctx);
    const job = getJob(jobId);
    if (!job) throw new Error("job not found");
    return job;
  },

  async cancel({ jobId }, ctx) {
    bindCtx(ctx);
    const job = cancelJob(jobId);
    return { ok: Boolean(job), job };
  },

  async retry({ jobId }, ctx) {
    bindCtx(ctx);
    const job = retryJob(jobId);
    return { ok: Boolean(job), job };
  },

  async pickFiles(params, _ctx) {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: params?.filters || [
        {
          name: "Documents",
          extensions: INGEST_FILE_EXTENSIONS,
        },
        { name: "All", extensions: ["*"] },
      ],
    });
    if (result.canceled) return { paths: [] };
    return { paths: result.filePaths || [] };
  },

  async pickFolder(_p, _ctx) {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled) return { path: null };
    return { path: result.filePaths?.[0] || null };
  },

  /**
   * External tool status (anydoc / markitdown / pandoc).
   * - force=false: return disk cache if present (no PATH scan)
   * - no cache yet (first use): probe once and persist
   * - force=true: re-probe and overwrite cache
   */
  async toolsStatus(params, ctx) {
    bindCtx(ctx);
    const settings = resolveIngestSettings(ctx.appSettings);
    const defaults = defaultIngestSettings();
    const force = Boolean(params?.force);

    if (!force) {
      const disk = await readToolsDiskCache();
      if (disk) {
        return {
          ...disk,
          fromCache: true,
          settings,
          defaults,
        };
      }
    }

    if (force) {
      clearExternalToolsCache();
      await clearToolsDiskCache();
    }
    const tools = await probeExternalTools({ force: true });
    await writeToolsDiskCache(tools);
    return {
      ...tools,
      fromCache: false,
      settings,
      defaults,
    };
  },

  /**
   * Preview paths for staging UI (kind / size / convertible) without enqueue.
   * Expands directories up to maxFolderFiles; returns path references only.
   * @param {{ paths?: string[], absolutePath?: string }} params
   */
  async previewItems(params, ctx) {
    bindCtx(ctx);
    const settings = resolveIngestSettings(ctx.appSettings);
    const raw = [];
    if (Array.isArray(params?.paths)) raw.push(...params.paths.filter(Boolean));
    if (params?.absolutePath) raw.push(params.absolutePath);
    if (!raw.length) return { items: [], capped: false };

    const items = [];
    let capped = false;
    const maxBytes = settings.maxFileBytes;

    for (const abs0 of raw) {
      const abs = path.resolve(String(abs0).trim());
      const st = await fs.stat(abs).catch(() => null);
      if (!st) {
        items.push({
          absolutePath: abs,
          name: path.basename(abs),
          selected: false,
          warning: ei18n("ingest.fileNotFound"),
        });
        continue;
      }
      if (st.isDirectory()) {
        const files = await walkFiles(abs, settings.maxFolderFiles);
        if (files.length >= settings.maxFolderFiles) capped = true;
        for (const f of files) {
          const fst = await fs.stat(f).catch(() => null);
          const { kind } = await detectIngestKind(f);
          const size = fst?.size;
          const oversize = typeof size === "number" && size > maxBytes;
          items.push({
            absolutePath: f,
            name: path.basename(f),
            size,
            kind,
            convertible: isConvertibleKind(kind),
            selected: true,
            isDirectory: false,
            warning: oversize
              ? ei18n("ingest.overLimit", { limit: Math.round(maxBytes / 1e6) })
              : undefined,
          });
        }
      } else if (st.isFile()) {
        const { kind } = await detectIngestKind(abs);
        const oversize = st.size > maxBytes;
        items.push({
          absolutePath: abs,
          name: path.basename(abs),
          size: st.size,
          kind,
          convertible: isConvertibleKind(kind),
          selected: true,
          isDirectory: false,
          warning: oversize
            ? ei18n("ingest.overLimit", { limit: Math.round(maxBytes / 1e6) })
            : undefined,
        });
      }
    }

    return {
      items,
      capped,
      maxFolderFiles: settings.maxFolderFiles,
      maxFileBytes: maxBytes,
      maxFileBytesCap: INGEST_MAX_FILE_BYTES_CAP,
      settings,
    };
  },

  async openInstallHelp({ tool }, ctx) {
    // Prefer cached install docsUrl — avoid PATH probe on every help click
    const st = await IngestService.toolsStatus({ force: false }, ctx);
    const key = isIngestToolKey(tool) ? tool : "anydoc";
    const info = st[key];
    const url = info?.install?.docsUrl;
    if (url) {
      await shell.openExternal(url);
      return { ok: true, opened: url };
    }
    return { ok: false };
  },

  async copyInstallCommand({ tool, index }, ctx) {
    const st = await IngestService.toolsStatus({ force: false }, ctx);
    const key = isIngestToolKey(tool) ? tool : "anydoc";
    const commands = st[key]?.install?.commands || [];
    const preferred =
      typeof st[key]?.install?.preferredIndex === "number"
        ? st[key].install.preferredIndex
        : 0;
    const idx =
      typeof index === "number" && index >= 0 && index < commands.length ? index : preferred;
    const cmd = commands[idx] || commands[0] || "";
    if (cmd) clipboard.writeText(cmd);
    return { ok: Boolean(cmd), command: cmd, commands, index: idx };
  },

  /**
   * User-triggered anydoc sidecar install / upgrade into userData (not asar).
   * @param {{ spec?: string }} [params]
   */
  async installAnydoc(params, ctx) {
    bindCtx(ctx);
    try {
      const result = await installAnydocSidecar({
        spec: typeof params?.spec === "string" && params.spec.trim() ? params.spec.trim() : undefined,
      });
      clearExternalToolsCache();
      await clearToolsDiskCache();
      const tools = await probeExternalTools({ force: true });
      await writeToolsDiskCache(tools);
      return { ok: true, ...result, tools };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },

  /**
   * Read OS clipboard as capture payload (text / html / file paths).
   * File paths from Finder/Explorer copy are best-effort; paste event FileList is more reliable.
   */
  async readClipboard(_p, _ctx) {
    return readClipboardPayload();
  },

  /**
   * Enqueue clipboard file paths (and optionally ignore text).
   * @param {{ dest?: object, includeTextAsNote?: boolean }} params
   */
  async enqueueFromClipboard(params, ctx) {
    bindCtx(ctx);
    const payload = await readClipboardPayload();
    const dest = params?.dest || { mode: "inbox" };
    const jobIds = [];
    if (payload.filePaths?.length) {
      const r = await IngestService.enqueue(
        {
          items: payload.filePaths.map((absolutePath) => ({ absolutePath })),
          dest,
        },
        ctx,
      );
      jobIds.push(...(r.jobIds || []));
    }
    return {
      ok: true,
      jobIds,
      clipboard: payload,
      enqueued: jobIds.length,
    };
  },

  /**
   * Await a single file through the pipeline (compat for importFile).
   */
  async importAndWait({ absolutePath, targetTopicId }, ctx) {
    bindCtx(ctx);
    const dest = targetTopicId
      ? { mode: "topic", topicId: targetTopicId }
      : { mode: "inbox" };
    const { jobIds } = await IngestService.enqueue({ absolutePath, dest }, ctx);
    const id = jobIds[0];
    if (!id) throw new Error(ei18n("ingest.createFail"));
    // Poll until done (sync import path)
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const job = getJob(id);
      if (!job) throw new Error("job disappeared");
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
        if (job.status === "failed" && !job.result?.targetPath) {
          throw new Error(job.error || "import failed");
        }
        return {
          ok: true,
          path: job.result?.targetPath,
          jobId: id,
          converter: job.result?.converter,
          fallback: job.result?.fallback,
          warnings: job.result?.warnings,
        };
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error("import timed out");
  },
};
