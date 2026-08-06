/**
 * Commit converted markdown (or original fallback) into workspace.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { inboxRoot, parseTopicId, archiveRoot } from "../path-model.mjs";
import { exists, writeText } from "../fs-utils.mjs";
import { injectFrontmatter } from "../frontmatter.mjs";
import { buildWritebackEvidence, timestampStamp } from "../writeback.mjs";
import { cleanCaptureTitle, sanitizeCaptureFilename } from "../fetch-article.mjs";
import { sp, now } from "../workspace-helpers.mjs";
import { invalidateNotesIndex } from "../notes-index.mjs";
import { kernelDurableWrite, kernelResolveIngestRoute } from "../kernel-api.mjs";
import { resolveDataRoot } from "../path-model.mjs";

/**
 * @param {object} opts
 * @param {string} opts.markdown
 * @param {string} [opts.title]
 * @param {string} opts.sourceName
 * @param {string} [opts.sourceAbs]
 * @param {string} opts.ingestKind
 * @param {string} opts.converter
 * @param {string[]} [opts.warnings]
 * @param {{ mode?: 'inbox'|'topic'|'stream', topicId?: string }} [opts.dest]
 * @param {boolean} [opts.keepOriginal]
 * @param {object} ctx - workspace ctx
 */
export async function commitMarkdownNote(opts, ctx) {
  const ws = ctx.workspaceRoot;
  const t = now();
  const cleaned = cleanCaptureTitle(opts.title || "", { maxLen: 160 });
  const stamp = timestampStamp();
  let base = sanitizeCaptureFilename(cleaned || "", `ingest-${stamp}`);
  let fn = `${base}.md`;

  const dest = opts.dest || { mode: "inbox" };
  let destPrefix;
  let topicMeta = null;
  let routeReason = "default-inbox";
  let routeConfidence = "medium";

  if (dest.mode === "topic" && dest.topicId) {
    const { category, topic } = parseTopicId(dest.topicId);
    destPrefix = `${category}/${topic}`;
    topicMeta = { category, topic };
    routeReason = "user-selected-topic";
    routeConfidence = "high";
  } else {
    // Kernel routing: inbox (default) or stream when dest.mode === stream
    const target = dest.mode === "stream" ? "stream" : "inbox";
    try {
      const route = await kernelResolveIngestRoute(
        {
          target,
          metadata: { title: cleaned || base },
        },
        ctx,
      );
      if (route.appendToPeriod && route.periodTarget?.periodRelPath) {
        // Stream append: write/append via durable path on period note
        destPrefix = path.dirname(route.periodTarget.periodRelPath).replace(/^\.$/, "") ||
          path.basename(inboxRoot(ws));
        fn = path.basename(route.periodTarget.periodRelPath);
        routeReason = "kernel-stream-period";
        routeConfidence = "high";
      } else if (route.targetPath) {
        const dataRoot = resolveDataRoot(ws);
        const rel = path.relative(dataRoot, route.targetPath).replace(/\\/g, "/");
        destPrefix = path.dirname(rel).replace(/^\.$/, "") || path.basename(inboxRoot(ws));
        fn = path.basename(rel);
        routeReason = "kernel-ingest-route";
        routeConfidence = "high";
      } else {
        destPrefix = path.basename(inboxRoot(ws));
      }
    } catch {
      destPrefix = path.basename(inboxRoot(ws));
    }
  }

  let destRel = destPrefix ? `${destPrefix}/${fn}` : fn;
  destRel = destRel.replace(/\/+/g, "/").replace(/^\//, "");
  let destAbs = await sp(ws, destRel);
  if (await exists(destAbs) && dest.mode !== "stream") {
    base = sanitizeCaptureFilename(cleaned ? `${cleaned}-${stamp}` : "", `ingest-${stamp}`);
    fn = `${base}.md`;
    destRel = destPrefix ? `${destPrefix}/${fn}` : fn;
    destAbs = await sp(ws, destRel);
  }

  await fs.mkdir(path.dirname(destAbs), { recursive: true });

  const fm = {
    title: cleaned || base,
    source_type: "external-capture",
    source: opts.sourceName || undefined,
    captured_at: t,
    ingest_kind: opts.ingestKind,
    ingest_converter: opts.converter,
    status: "todo",
    route_confidence: routeConfidence,
    route_reason: routeReason,
  };
  if (topicMeta) {
    fm.category = topicMeta.category;
    fm.topic = topicMeta.topic;
  }
  if (opts.warnings?.length) {
    fm.ingest_warnings = opts.warnings.slice(0, 12).join("; ").slice(0, 500);
  }

  let body = opts.markdown || "";
  if (dest.mode === "stream" && (await exists(destAbs))) {
    const prev = await fs.readFile(destAbs, "utf8").catch(() => "");
    body = `${prev.trimEnd()}\n\n---\n\n## ${cleaned || base}\n\n${body}\n`;
  }

  const md = injectFrontmatter(body, fm);
  await kernelDurableWrite(
    { relativePath: destRel, content: md },
    ctx,
    {
      actor: "user",
      confirmed: true,
      operation: (await exists(destAbs)) ? "update" : "create",
      frontmatter: fm,
    },
  );
  invalidateNotesIndex(destRel);

  let originalArchivePath;
  if (opts.keepOriginal && opts.sourceAbs) {
    originalArchivePath = await archiveOriginal(opts.sourceAbs, opts.sourceName, ws, t);
  }

  return {
    ...buildWritebackEvidence({
      operation: "create",
      targetPath: destRel,
      savedAt: t,
      affectedFiles: originalArchivePath ? [destRel, originalArchivePath] : [destRel],
    }),
    ok: true,
    path: destRel,
    originalArchivePath,
  };
}

/**
 * Copy original file into dest (conversion failed).
 */
export async function commitOriginalFallback(opts, ctx) {
  const ws = ctx.workspaceRoot;
  const t = now();
  const stamp = timestampStamp();
  const origName = opts.sourceName || path.basename(opts.sourceAbs || "file");
  const ext = path.extname(origName);
  const baseRaw = origName.slice(0, origName.length - ext.length) || "file";
  let base = sanitizeCaptureFilename(baseRaw, `file-${stamp}`);
  let fn = `${base}${ext || ""}`;

  const dest = opts.dest || { mode: "inbox" };
  let destPrefix;
  let topicMeta = null;
  if (dest.mode === "topic" && dest.topicId) {
    const { category, topic } = parseTopicId(dest.topicId);
    destPrefix = `${category}/${topic}`;
    topicMeta = { category, topic };
  } else {
    destPrefix = path.basename(inboxRoot(ws));
  }

  let destRel = `${destPrefix}/${fn}`;
  let destAbs = await sp(ws, destRel);
  if (await exists(destAbs)) {
    fn = `${base}-${stamp}${ext || ""}`;
    destRel = `${destPrefix}/${fn}`;
    destAbs = await sp(ws, destRel);
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.copyFile(opts.sourceAbs, destAbs);
  invalidateNotesIndex(destRel);

  // Sidecar note explaining failure (same basename .md if binary)
  let notePath;
  if (!/\.md$/iu.test(fn)) {
    const noteFn = `${path.basename(fn, ext)}-import-note.md`;
    notePath = `${destPrefix}/${noteFn}`;
    let noteAbs = await sp(ws, notePath);
    if (await exists(noteAbs)) {
      notePath = `${destPrefix}/${path.basename(fn, ext)}-import-note-${stamp}.md`;
      noteAbs = await sp(ws, notePath);
    }
    const fm = {
      title: cleanCaptureTitle(baseRaw, { maxLen: 160 }) || base,
      source_type: "external-capture",
      source: origName,
      captured_at: t,
      ingest_kind: opts.ingestKind || "binary",
      ingest_status: "failed",
      ingest_error: String(opts.error || "conversion failed").slice(0, 400),
      status: "todo",
      route_reason: topicMeta ? "user-selected-topic" : "default-inbox",
    };
    if (topicMeta) {
      fm.category = topicMeta.category;
      fm.topic = topicMeta.topic;
    }
    const body = [
      `# ${fm.title}`,
      "",
      `原件已导入：\`${fn}\``,
      "",
      `转换失败：${opts.error || "unknown"}`,
      "",
      "可安装 pandoc / markitdown 后在「知识加工」中重试，或手动整理。",
    ].join("\n");
    await kernelDurableWrite(
      { relativePath: notePath, content: injectFrontmatter(body, fm) },
      ctx,
      { actor: "user", confirmed: true, operation: "create", frontmatter: fm },
    );
    invalidateNotesIndex(notePath);
  }

  return {
    ...buildWritebackEvidence({
      operation: "create",
      targetPath: notePath || destRel,
      savedAt: t,
      affectedFiles: notePath ? [destRel, notePath] : [destRel],
    }),
    ok: true,
    path: notePath || destRel,
    originalPath: destRel,
    fallback: true,
  };
}

async function archiveOriginal(sourceAbs, sourceName, ws, savedAt) {
  try {
    const day = String(savedAt || now()).slice(0, 10);
    const archName = path.basename(archiveRoot(ws));
    const safe = sanitizeCaptureFilename(
      path.basename(sourceName || sourceAbs),
      "original",
    );
    const ext = path.extname(sourceName || sourceAbs);
    let rel = `${archName}/ingest-originals/${day}/${safe}${ext && !safe.endsWith(ext) ? ext : ""}`;
    // fix double ext
    if (ext && !rel.endsWith(ext)) rel = `${archName}/ingest-originals/${day}/${safe}${ext}`;
    let abs = await sp(ws, rel);
    if (await exists(abs)) {
      const stamp = timestampStamp();
      rel = `${archName}/ingest-originals/${day}/${safe}-${stamp}${ext}`;
      abs = await sp(ws, rel);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.copyFile(sourceAbs, abs);
    return rel;
  } catch {
    return undefined;
  }
}
