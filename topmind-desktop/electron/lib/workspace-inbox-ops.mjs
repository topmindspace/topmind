/**
 * Inbox / import / move ops — no Electron dependency.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { inboxRoot, parseTopicId, topicRoot, categoryRoot } from "./path-model.mjs";
import { exists, readText, writeText, listDir, statSafe } from "./fs-utils.mjs";
// statSafe used by moveToTopic media-aware path
import { injectFrontmatter, splitMarkdownFrontmatter } from "./frontmatter.mjs";
import {
  buildWritebackEvidence, timestampStamp,
} from "./writeback.mjs";
import {
  S, T, sp, now, lf,
} from "./workspace-helpers.mjs";
import { invalidateNotesIndex } from "./notes-index.mjs";
import { cleanCaptureTitle, sanitizeCaptureFilename } from "./fetch-article.mjs";
import { transferNoteMedia } from "./workspace-note-media.mjs";
import { kernelDurableWrite } from "./kernel-api.mjs";
import { localizeMarkdownImages, clipImageSlug } from "./clip-images.mjs";
import { CLIP_DEST_MODES } from "./clip-dest-modes.mjs";
import { t as i18n } from "./electron-i18n.mjs";

function bumpWorkspaceIndex(relativePath) {
  invalidateNotesIndex(relativePath);
}

/**
 * Localize remote images in markdown content when source is a URL.
 * Downloads images to {targetDir}/images/{slug}/ and rewrites markdown paths.
 * Returns updated content (or original if no localization needed).
 * @param {string} content - markdown content
 * @param {string} source - source URL (for resolving relative image URLs)
 * @param {string} targetRelPath - workspace-relative target note path (e.g., '00-收件箱/note.md')
 * @param {string} workspaceRoot - workspace root absolute path
 * @returns {Promise<{ content: string, imagesDownloaded: number }>}
 */
async function localizeImagesForCapture(content, source, targetRelPath, workspaceRoot) {
  if (!source || !/^https?:\/\//iu.test(source)) {
    return { content, imagesDownloaded: 0 };
  }
  if (!/!\[[^\]]*\]\(/u.test(content)) {
    return { content, imagesDownloaded: 0 };
  }
  try {
    const slug = clipImageSlug(source);
    const targetDir = path.dirname(targetRelPath);
    const imagesDirAbs = path.join(workspaceRoot, targetDir, "images", slug);
    const relPrefix = `images/${slug}`;
    const loc = await localizeMarkdownImages(content, {
      imagesDirAbs,
      relPrefix,
      baseUrl: source,
      referer: source,
    });
    return { content: loc.markdown, imagesDownloaded: loc.downloaded };
  } catch {
    return { content, imagesDownloaded: 0 };
  }
}

/** Allow-list optional capture metadata (clip / fetchUrl) into note frontmatter. */
function sanitizeCaptureFrontmatter(extra) {
  if (!extra || typeof extra !== "object") return {};
  const out = {};
  const str = (k, max = 200) => {
    if (extra[k] == null || extra[k] === "") return;
    out[k] = String(extra[k]).slice(0, max);
  };
  const num = (k) => {
    if (extra[k] == null || extra[k] === "") return;
    const n = Number(extra[k]);
    if (Number.isFinite(n)) out[k] = Math.round(n);
  };
  const bool = (k) => {
    if (extra[k] === true || extra[k] === false) out[k] = extra[k];
  };
  str("fetch_method", 40);
  num("word_count");
  bool("fetch_truncated");
  str("author", 200);
  str("site_name", 200);
  str("canonical", 4096);
  str("published", 80);
  str("clip_template", 64);
  str("clip_channel", 40);
  num("images_localized");
  str("topic", 200);
  str("category", 120);
  return out;
}

/** Peek frontmatter of a small markdown head (for inbox list badges). */
async function peekInboxMeta(absPath) {
  try {
    const fh = await fs.open(absPath, "r");
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      const head = buf.slice(0, bytesRead).toString("utf8");
      const { data } = splitMarkdownFrontmatter(head);
      return {
        source_type: data?.source_type ? String(data.source_type) : null,
        source: data?.source ? String(data.source) : null,
        title: data?.title ? String(data.title) : null,
      };
    } finally {
      await fh.close();
    }
  } catch {
    return { source_type: null, source: null, title: null };
  }
}

export function createInboxOps(moveSelfRef) {
  return {
    async listInbox(_p, ctx) {
      const dir = inboxRoot(ctx.workspaceRoot);
      const inboxName = path.basename(dir);
      const entries = await listDir(dir);
      const files = [], folders = [];
      for (const e of entries) {
        const abs = path.join(dir, e);
        const s = await statSafe(abs);
        if (s?.isFile()) {
          const meta = /\.md$/iu.test(e) ? await peekInboxMeta(abs) : { source_type: null, source: null, title: null };
          files.push({
            name: e,
            relativePath: `${inboxName}/${e}`,
            size: s.size,
            mtime: s.mtime.toISOString(),
            source_type: meta.source_type,
            source: meta.source,
            title: meta.title,
          });
        } else if (s?.isDirectory()) {
          const sub = await lf(path.join(dir, e));
          folders.push({ name: e, fileCount: sub.length, files: sub });
        }
      }
      // Newest first for capture-first inbox
      files.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
      return { files, folders, inboxName };
    },

    /**
     * Capture write: stream period note (default for quick capture), Inbox,
     * topic, or category root when dest provided.
     * @param {{
     *   content: string,
     *   title?: string,
     *   sourceType?: string,
     *   source?: string,
     *   frontmatter?: object,
     *   dest?: { mode?: 'inbox'|'topic'|'category'|'stream', topicId?: string, category?: string, forceAtom?: boolean },
     * }} p
     */
    async ingestInbox({ content, title, sourceType, source, frontmatter, dest, actor, confirmed }, ctx) {
      S(content, "content", { allowEmpty: true, maxLen: 2_000_000 });
      const stamp = timestampStamp();
      const cleaned = cleanCaptureTitle(title || "", { maxLen: 160 });
      const t = now();

      const mode = CLIP_DEST_MODES.includes(dest?.mode) ? dest.mode : "stream";

      // ── Period stream append (每周一本 / 每天一页 …) ─────────────────────
      if ((mode === "stream" || mode === "category") && !dest?.forceAtom) {
        try {
          const wmApi = await import("./workspace-model-api.mjs");
          const wm = await wmApi.loadWorkspaceModelLib();
          const streamTarget = await wmApi.resolveStreamTarget(ctx.workspaceRoot);
          let cat = streamTarget.streamCategory;
          if (mode === "category" && dest?.category) {
            const model = await wmApi.resolveWorkspaceModel(ctx.workspaceRoot);
            cat = model.categories.find((c) => c.directory === dest.category) || cat;
          }
          const packing = streamTarget.packing;
          if (
            cat &&
            wm.shouldAppendToPeriodNote(cat, packing) &&
            streamTarget.periodAbsPath
          ) {
            const { pathToFileURL } = await import("node:url");
            const { getEngineRoot } = await import("./workspace-home.mjs");
            const { defaultEngineCandidate } = await import("./engine-root.mjs");
            const engineRoot = getEngineRoot() || defaultEngineCandidate();
            const periodMod = await import(
              pathToFileURL(path.join(engineRoot, "lib", "stream-period.mjs")).href
            );

            const fp = streamTarget.periodAbsPath;
            await fs.mkdir(path.dirname(fp), { recursive: true });
            let existing = "";
            let existed = false;
            if (await exists(fp)) {
              existed = true;
              existing = await readText(fp);
            }
            const { data: prevFm, body: prevBody } = splitMarkdownFrontmatter(existing || "");
            let newBody = periodMod.appendToPeriodBody(prevBody || "", {
              content: String(content || "").trim() || cleaned,
              title: cleaned,
              packing,
              appendHeading: streamTarget.appendHeading,
            });
            const fm = {
              ...(prevFm && typeof prevFm === "object" ? prevFm : {}),
              title: streamTarget.title || cleaned || i18n("inbox.streamTitleFallback"),
              category: cat.directory,
              type: "stream-period",
              stream_packing: packing,
              source_type: sourceType || prevFm?.source_type || "user-original",
              updated_at: t,
              captured_at: prevFm?.captured_at || t,
              ...sanitizeCaptureFrontmatter(frontmatter),
            };
            if (source && String(source).trim()) fm.source = String(source).trim();
            const targetPath =
              streamTarget.periodRelPath || `${cat.directory}/${streamTarget.periodFileName}`;
            // Localize remote images when source is a URL (Desktop fetch URL path)
            const imgResult = await localizeImagesForCapture(
              newBody, source, targetPath, ctx.workspaceRoot,
            );
            newBody = imgResult.content;
            const md = injectFrontmatter(newBody, fm);
            const writeActor = actor || (sourceType === "ai-derived" ? "ai" : "user");
            const isConfirmed = confirmed !== undefined ? Boolean(confirmed) : (writeActor === "user");
            const ev = await kernelDurableWrite(
              { relativePath: targetPath, content: md },
              ctx,
              {
                actor: writeActor,
                confirmed: isConfirmed,
                operation: existed ? "update" : "create",
                writebackMode: ctx.explicitWritebackMode,
              },
            );
            if (ev.pending || ev.needsConfirm) {
              return {
                ...buildWritebackEvidence({
                  operation: existed ? "update" : "create",
                  targetPath,
                  savedAt: t,
                  wroteFiles: false,
                }),
                ok: false,
                needsConfirm: true,
                pending: true,
                path: targetPath,
                targetPath,
                previewContent: md,
                dest: "stream",
              };
            }
            bumpWorkspaceIndex(targetPath);
            return {
              ...buildWritebackEvidence({
                operation: existed ? "update" : "create",
                targetPath,
                savedAt: t,
                backupPath: ev.backupPath,
                receiptPath: ev.receiptPath,
                wroteFiles: true,
              }),
              ok: true,
              path: targetPath,
              dest: "stream",
              appended: true,
              streamPacking: packing,
              userMessage: i18n("inbox.recordedTo", { label: periodMod.packingLabel(packing) }),
            };
          }
        } catch {
          // fall through to atom / inbox write
        }
      }

      let base = sanitizeCaptureFilename(cleaned || "", `capture-${stamp}`);
      let fn = `${base}.md`;

      /** @type {string} dirAbs */
      let dirAbs;
      /** @type {string} relative dir prefix for targetPath */
      let relDir;
      /** @type {Record<string, string>} */
      const destFm = {};

      const writeMode =
        mode === "stream" ? "inbox" : mode === "topic" || mode === "category" ? mode : "inbox";
      if (writeMode === "topic" && dest?.topicId) {
        T(dest.topicId);
        const { category, topic } = parseTopicId(dest.topicId);
        if (!category || !topic) throw new Error("invalid topicId");
        dirAbs = topicRoot(ctx.workspaceRoot, category, topic);
        await fs.mkdir(dirAbs, { recursive: true });
        relDir = `${category}/${topic}`;
        destFm.category = category;
        destFm.topic = topic;
      } else if (writeMode === "category" && dest?.category) {
        S(dest.category, "category");
        dirAbs = categoryRoot(ctx.workspaceRoot, dest.category);
        await fs.mkdir(dirAbs, { recursive: true });
        relDir = dest.category;
        destFm.category = dest.category;
      } else {
        dirAbs = inboxRoot(ctx.workspaceRoot);
        relDir = path.basename(dirAbs);
      }

      let fp = path.join(dirAbs, fn);
      if (await exists(fp)) {
        base = sanitizeCaptureFilename(cleaned ? `${cleaned}-${stamp}` : "", `capture-${stamp}`);
        fn = `${base}.md`;
        fp = path.join(dirAbs, fn);
      }
      const targetPath = `${relDir}/${fn}`;
      const fm = {
        title: cleaned || base,
        source_type: sourceType || "external-capture",
        captured_at: t,
        ...sanitizeCaptureFrontmatter(frontmatter),
        ...destFm,
      };
      if (source && String(source).trim()) fm.source = String(source).trim();
      // Localize remote images when source is a URL (Desktop fetch URL path)
      const imgResult = await localizeImagesForCapture(
        content, source, targetPath, ctx.workspaceRoot,
      );
      content = imgResult.content;
      const md = injectFrontmatter(content, fm);
      const writeActor = actor || (sourceType === "ai-derived" ? "ai" : "user");
      const isConfirmed = confirmed !== undefined ? Boolean(confirmed) : (writeActor === "user");
      const ev = await kernelDurableWrite(
        { relativePath: targetPath, content: md },
        ctx,
        {
          actor: writeActor,
          confirmed: isConfirmed,
          operation: "create",
          writebackMode: ctx.explicitWritebackMode,
        },
      );
      if (ev.pending || ev.needsConfirm) {
        return {
          ...buildWritebackEvidence({
            operation: "create",
            targetPath,
            savedAt: t,
            wroteFiles: false,
          }),
          ok: false,
          needsConfirm: true,
          pending: true,
          path: targetPath,
          targetPath,
          previewContent: md,
          dest: writeMode,
        };
      }
      bumpWorkspaceIndex(targetPath);
      return {
        ...buildWritebackEvidence({
          operation: "create",
          targetPath,
          savedAt: t,
          backupPath: ev.backupPath,
          receiptPath: ev.receiptPath,
        }),
        ok: true,
        path: targetPath,
        dest: writeMode,
      };
    },

    async importFile({ absolutePath, targetTopicId }, ctx) {
      S(absolutePath, "absolutePath", { maxLen: 4096 });
      const st = await fs.stat(absolutePath).catch(() => null);
      if (!st || !st.isFile()) throw new Error(i18n("inbox.fileReadFail"));
      // Align with ingest default (80MB); legacy import path has no settings patch
      const maxBytes = 80_000_000;
      if (st.size > maxBytes) {
        const mb = Math.round((st.size / 1e6) * 10) / 10;
        throw new Error(
          i18n("inbox.fileOverLimit", { mb, max: Math.round(maxBytes / 1e6) }),
        );
      }
      const origName = path.basename(absolutePath);
      const isText = /\.(md|markdown|mdx|txt)$/iu.test(origName);

      let destPrefix, topicMeta = null;
      if (targetTopicId) {
        T(targetTopicId);
        const { category, topic } = parseTopicId(targetTopicId);
        destPrefix = `${category}/${topic}`;
        topicMeta = { category, topic };
      } else {
        destPrefix = path.basename(inboxRoot(ctx.workspaceRoot));
      }
      await fs.mkdir(path.dirname(await sp(ctx.workspaceRoot, `${destPrefix}/x`)), { recursive: true });

      const ext = isText ? ".md" : path.extname(origName);
      const base = origName.slice(0, origName.length - path.extname(origName).length);
      let fn = `${base}${ext}`;
      let destRel = `${destPrefix}/${fn}`;
      if (await statSafe(await sp(ctx.workspaceRoot, destRel))) {
        fn = `${base}-${timestampStamp()}${ext}`;
        destRel = `${destPrefix}/${fn}`;
      }
      const destAbs = await sp(ctx.workspaceRoot, destRel);

      if (isText) {
        const raw = await readText(absolutePath);
        const fm = {
          title: base,
          source_type: "external-capture",
          source: origName,
          captured_at: now(),
        };
        if (topicMeta) {
          fm.category = topicMeta.category;
          fm.topic = topicMeta.topic;
        }
        await kernelDurableWrite(
          { relativePath: destRel, content: injectFrontmatter(raw, fm) },
          ctx,
          { actor: "user", confirmed: true, operation: "create", frontmatter: fm },
        );
      } else {
        await fs.copyFile(absolutePath, destAbs);
      }
      bumpWorkspaceIndex(destRel);
      return { ok: true, path: destRel };
    },

    async batchMoveToTopic({ paths, targetTopicId }, ctx) {
      if (!Array.isArray(paths) || paths.length === 0) throw new Error("paths array required.");
      T(targetTopicId);
      const results = [];
      const evidences = [];
      for (const p of paths) {
        try {
          const r = await moveSelfRef.moveToTopic(
            { inboxRelativePath: String(p), targetTopicId },
            ctx,
          );
          results.push({ path: p, ok: true, newPath: r?.newPath || r?.path });
          if (r?.targetPath || r?.backupPath) evidences.push(r);
        } catch (err) {
          results.push({ path: p, ok: false, error: err?.message || String(err) });
        }
      }
      return {
        ok: results.every((r) => r.ok),
        moved: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
        // Batch writeback summary for multi-file UI
        batchEvidence: evidences,
        writebackMode: "auto",
      };
    },

    /**
     * Move a note into a topic, including local media (images/{slug}/).
     * Accepts `relativePath` (any note) or legacy `inboxRelativePath`.
     */
    async moveToTopic({ inboxRelativePath, relativePath, targetTopicId, actor, confirmed }, ctx) {
      const srcRel = String(relativePath || inboxRelativePath || "").replace(/\\/gu, "/");
      S(srcRel, "relativePath");
      T(targetTopicId);
      if (!srcRel.endsWith(".md")) throw new Error(i18n("inbox.moveToTopicMdOnly"));
      const { category, topic } = parseTopicId(targetTopicId);
      if (!category || !topic) throw new Error("invalid topicId");

      const src = await sp(ctx.workspaceRoot, srcRel);
      const st = await statSafe(src);
      if (!st?.isFile()) throw new Error(i18n("inbox.moveToTopicFileNotExist", { path: srcRel }));

      // No-op if already in target topic root
      const destDirRel = `${category}/${topic}`;
      const srcDir = srcRel.includes("/") ? srcRel.split("/").slice(0, -1).join("/") : "";
      if (srcDir === destDirRel) {
        return {
          ...buildWritebackEvidence({
            operation: "move",
            targetPath: srcRel,
            savedAt: now(),
            wroteFiles: false,
          }),
          ok: true,
          newPath: srcRel,
          path: srcRel,
          mediaMoved: 0,
          note: i18n("inbox.alreadyInTopic"),
        };
      }

      const fn = path.basename(srcRel);
      const ext = path.extname(fn);
      const base = path.basename(fn, ext);
      let targetFileName = fn;
      let dest = await sp(ctx.workspaceRoot, `${destDirRel}/${targetFileName}`);
      let attempt = 0;
      while (await exists(dest)) {
        attempt++;
        targetFileName = `${base}_copy${attempt}${ext}`;
        dest = await sp(ctx.workspaceRoot, `${destDirRel}/${targetFileName}`);
      }

      const t = now();
      const c = await readText(src);
      const newPath = `${destDirRel}/${targetFileName}`;

      // Media first (same relative images/… under dest note dir)
      const media = await transferNoteMedia(
        {
          noteRelativePath: srcRel,
          destNoteDir: destDirRel,
          markdown: c,
          mode: "move",
        },
        ctx,
      );

      await fs.mkdir(path.dirname(dest), { recursive: true });
      const movedBody = injectFrontmatter(c, { category, topic });
      const writeActor = actor || "user";
      const isConfirmed = confirmed !== undefined ? Boolean(confirmed) : (writeActor === "user");
      const writeEv = await kernelDurableWrite(
        { relativePath: newPath, content: movedBody },
        ctx,
        {
          actor: writeActor,
          confirmed: isConfirmed,
          operation: "create",
          writebackMode: ctx.explicitWritebackMode,
        },
      );
      if (writeEv.pending || writeEv.needsConfirm) {
        return {
          ...buildWritebackEvidence({
            operation: "move",
            targetPath: newPath,
            savedAt: t,
            wroteFiles: false,
          }),
          ok: false,
          needsConfirm: true,
          pending: true,
          newPath,
          path: newPath,
          targetPath: newPath,
          sourcePath: srcRel,
          previewContent: movedBody,
        };
      }
      // Source removal after confirmed gate write of dest.
      await fs.unlink(src).catch(() => {});
      void writeEv;

      // Clean empty images/ parent under source if vacated
      if (srcDir) {
        const imagesParent = await sp(ctx.workspaceRoot, `${srcDir}/images`);
        try {
          const left = await fs.readdir(imagesParent);
          if (left.length === 0) await fs.rmdir(imagesParent).catch(() => {});
        } catch {
          /* ignore */
        }
      }

      bumpWorkspaceIndex(srcRel);
      bumpWorkspaceIndex(newPath);
      const affected = [
        srcRel,
        newPath,
        ...media.movedDirs,
        ...media.movedFiles,
      ];
      return {
        ...buildWritebackEvidence({
          operation: "move",
          targetPath: newPath,
          savedAt: t,
          affectedFiles: affected,
        }),
        ok: true,
        newPath,
        path: newPath,
        mediaMoved: media.count,
        mediaDirs: media.movedDirs,
        mediaFiles: media.movedFiles,
        note:
          media.count > 0
            ? i18n("inbox.movedWithMedia", { count: media.count })
            : i18n("inbox.moved"),
      };
    },
  };
}
