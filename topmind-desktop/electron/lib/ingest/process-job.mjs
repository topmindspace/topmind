/**
 * Process a single ingest job: detect → convert → commit.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { detectIngestKind, isConvertibleKind } from "./detect.mjs";
import { convertToMarkdown } from "./convert/registry.mjs";
import { commitMarkdownNote, commitOriginalFallback } from "./commit.mjs";
import { DEFAULT_PREFERRED_CONVERTER, normalizePreferredConverter } from "./convert-policy.mjs";

/** Soft default for auto-convert; PPT with images often exceeds 25MB. */
export const INGEST_MAX_FILE_BYTES_DEFAULT = 80_000_000;
/** Hard ceiling (settings + resolve). */
export const INGEST_MAX_FILE_BYTES_CAP = 200_000_000;

export function defaultIngestSettings() {
  return {
    enabled: true,
    keepOriginal: false,
    maxFileBytes: INGEST_MAX_FILE_BYTES_DEFAULT,
    maxFolderFiles: 200,
    concurrency: 1,
    defaultDest: "inbox",
    preferExternalConverters: true,
    preferredConverter: DEFAULT_PREFERRED_CONVERTER,
    autoConvert: true,
    confirmBeforeConvert: false,
    skipConfirmForSingleMd: true,
    openQueueOnEnqueue: false,
  };
}

export function resolveIngestSettings(appSettings) {
  const d = defaultIngestSettings();
  const s = appSettings?.ingest;
  if (!s || typeof s !== "object") return d;
  return {
    enabled: s.enabled !== false,
    keepOriginal: s.keepOriginal === true,
    maxFileBytes:
      typeof s.maxFileBytes === "number" && s.maxFileBytes > 0
        ? Math.min(s.maxFileBytes, INGEST_MAX_FILE_BYTES_CAP)
        : d.maxFileBytes,
    maxFolderFiles:
      typeof s.maxFolderFiles === "number" && s.maxFolderFiles > 0
        ? Math.min(s.maxFolderFiles, 2000)
        : d.maxFolderFiles,
    concurrency:
      typeof s.concurrency === "number" && s.concurrency >= 1
        ? Math.min(s.concurrency, 4)
        : d.concurrency,
    defaultDest: s.defaultDest === "topic" ? "topic" : "inbox",
    preferredConverter: normalizePreferredConverter(
      s.preferredConverter,
      s.preferExternalConverters !== false,
    ),
    preferExternalConverters:
      normalizePreferredConverter(s.preferredConverter, s.preferExternalConverters !== false) !==
      "builtin",
    autoConvert: s.autoConvert !== false,
    confirmBeforeConvert: s.confirmBeforeConvert === true,
    skipConfirmForSingleMd: s.skipConfirmForSingleMd !== false,
    openQueueOnEnqueue: s.openQueueOnEnqueue === true,
  };
}

/**
 * @param {import('./queue.mjs').IngestJob} job
 * @param {object} ctx
 */
export async function processIngestJob(job, ctx) {
  const settings = resolveIngestSettings(ctx.appSettings);
  // Normalize Windows paths (drag-drop / Explorer may use mixed separators)
  const abs = path.resolve(String(job.source.path || "").trim());
  job.source.path = abs;

  const st = await fs.stat(abs).catch((e) => {
    job.error = `无法读取文件: ${e instanceof Error ? e.message : String(e)}`;
    return null;
  });
  if (!st || !st.isFile()) {
    const err = job.error || "无法读取文件（不存在或不是文件）";
    job.error = err;
    job.status = "failed";
    throw new Error(err);
  }
  job.source.size = st.size;
  job.progress = 15;

  const { kind } = await detectIngestKind(abs);
  job.source.kind = kind;
  job.progress = 25;

  const dest = job.dest || { mode: "inbox" };
  const preferExternal = settings.preferExternalConverters;
  const preferredConverter = settings.preferredConverter;
  const autoConvert = settings.autoConvert !== false;
  const limitMb = Math.round(settings.maxFileBytes / 1e6);
  const sizeMb = Math.round((st.size / 1e6) * 10) / 10;
  const oversize = st.size > settings.maxFileBytes;

  // Oversize: still import original (user keeps the file) — do not hard-fail as "转换失败"
  if (oversize) {
    const err = `文件 ${sizeMb}MB 超过转换上限 ${limitMb}MB（设置 → 知识加工可调高，最高 ${Math.round(INGEST_MAX_FILE_BYTES_CAP / 1e6)}MB）`;
    job.progress = 40;
    try {
      const r = await commitOriginalFallback(
        {
          sourceAbs: abs,
          sourceName: job.source.name,
          ingestKind: kind,
          error: err,
          dest,
        },
        ctx,
      );
      job.result = {
        targetPath: r.path,
        title: job.source.name,
        converter: "copy",
        fallback: true,
        warnings: [err, "原件已导入，未自动转 Markdown"],
      };
      job.error = err;
      job.status = "done";
      job.progress = 100;
      return;
    } catch (e2) {
      job.status = "failed";
      job.error = `${err}；原件导入也失败: ${e2 instanceof Error ? e2.message : String(e2)}`;
      job.progress = 100;
      throw new Error(job.error);
    }
  }

  if (!autoConvert || !isConvertibleKind(kind)) {
    const r = await commitOriginalFallback(
      {
        sourceAbs: abs,
        sourceName: job.source.name,
        ingestKind: kind,
        error: autoConvert ? "类型不支持自动转换" : "已关闭自动转换",
        dest,
      },
      ctx,
    );
    job.result = {
      targetPath: r.path,
      title: job.source.name,
      converter: "copy",
      fallback: true,
      warnings: ["原件导入（未转 Markdown）"],
    };
    job.progress = 100;
    return;
  }

  try {
    job.progress = 40;
    const converted = await convertToMarkdown({
      kind,
      absPath: abs,
      preferExternal,
      preferredConverter,
    });
    job.progress = 75;
    const r = await commitMarkdownNote(
      {
        markdown: converted.markdown,
        title: converted.title || job.source.name,
        sourceName: job.source.name,
        sourceAbs: abs,
        ingestKind: kind,
        converter: converted.converter,
        warnings: converted.warnings,
        dest,
        keepOriginal: settings.keepOriginal,
      },
      ctx,
    );
    job.result = {
      targetPath: r.path,
      title: converted.title || job.source.name,
      converter: converted.converter,
      warnings: converted.warnings,
      originalArchivePath: r.originalArchivePath,
    };
    job.progress = 100;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    job.progress = 80;
    job.error = errMsg;
    try {
      const r = await commitOriginalFallback(
        {
          sourceAbs: abs,
          sourceName: job.source.name,
          ingestKind: kind,
          error: errMsg,
          dest,
        },
        ctx,
      );
      job.result = {
        targetPath: r.path,
        title: job.source.name,
        converter: "fallback",
        fallback: true,
        warnings: [errMsg],
      };
      // Still mark done with fallback rather than failed — user has the file
      job.status = "done";
      job.progress = 100;
    } catch (e2) {
      // Fallback also failed — hard fail with message
      const fb = e2 instanceof Error ? e2.message : String(e2);
      job.status = "failed";
      job.error = `${errMsg}；原件导入也失败: ${fb}`;
      job.progress = 100;
      throw new Error(job.error);
    }
  }
}

/**
 * Expand folder to file paths (recursive, capped).
 * @param {string} dirPath
 * @param {number} maxFiles
 * @returns {Promise<string[]>}
 */
export async function walkFiles(dirPath, maxFiles = 200) {
  const out = [];
  async function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      const name = ent.name;
      if (name.startsWith(".") || name === "node_modules" || name === "__MACOSX") continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  await walk(dirPath);
  return out;
}
