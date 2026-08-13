/**
 * Path / topic mutation ops — no Electron dependency (testable on Node).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  resolveDataRoot, outputsRoot, archiveRoot, parseTopicId, buildTopicId, CATEGORY_PATTERN,
} from "./path-model.mjs";
import { exists, readText, writeText, listDir, statSafe, readTextPreview } from "./fs-utils.mjs";
import {
  injectFrontmatter, splitMarkdownFrontmatter, stringifyYamlFrontmatter,
} from "./frontmatter.mjs";
import {
  buildWritebackEvidence, timestampStamp,
} from "./writeback.mjs";
import {
  S, T, sp, now, lf, trashAbsolute, trashRelative,
} from "./workspace-helpers.mjs";
import { invalidateNotesIndex } from "./notes-index.mjs";
import { kernelDurableWrite, kernelDurableDelete } from "./kernel-api.mjs";
import { t as i18n } from "./electron-i18n.mjs";

function bumpWorkspaceIndex(relativePath) {
  invalidateNotesIndex(relativePath);
}

/** Map Kernel surface evidence → legacy Desktop camelCase evidence shape. */
function asDesktopEvidence(ev, fallbackPath) {
  if (!ev || typeof ev !== "object") {
    return buildWritebackEvidence({
      operation: "update",
      targetPath: fallbackPath,
      savedAt: now(),
      wroteFiles: false,
    });
  }
  return {
    ...buildWritebackEvidence({
      operation: ev.operation || "update",
      targetPath: ev.targetPath || fallbackPath,
      savedAt: ev.savedAt || now(),
      backupPath: ev.backupPath,
      receiptPath: ev.receiptPath,
      writebackMode: ev.writebackMode || "auto",
      affectedFiles: ev.affectedFiles,
      wroteFiles: ev.wroteFiles !== false && !ev.pending,
      nextActions: ev.nextActions,
    }),
    protection: ev.protection,
    needsConfirm: Boolean(ev.needsConfirm || ev.pending),
    pending: Boolean(ev.pending),
    note: ev.note,
    // Preserve full body for confirm-mode pending stash (append_* / save / edit)
    previewContent:
      typeof ev.previewContent === "string"
        ? ev.previewContent
        : typeof ev.preview_content === "string"
          ? ev.preview_content
          : undefined,
  };
}

export const pathOps = {
  async duplicatePath({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    const oldFp = await sp(ctx.workspaceRoot, relativePath);
    const dir = relativePath.split("/").slice(0, -1).join("/");
    const ext = path.extname(relativePath);
    const base = path.basename(relativePath, ext);
    let attempt = 0;
    let newName = `${base}_copy${ext}`;
    let nextRel = dir ? `${dir}/${newName}` : newName;
    while (await exists(await sp(ctx.workspaceRoot, nextRel))) {
      attempt++;
      newName = `${base}_copy${attempt}${ext}`;
      nextRel = dir ? `${dir}/${newName}` : newName;
    }
    const nextFp = await sp(ctx.workspaceRoot, nextRel);
    const content = await fs.readFile(oldFp, "utf8").catch(() => null);
    if (content !== null && relativePath.endsWith(".md")) {
      await kernelDurableWrite(
        { relativePath: nextRel, content },
        ctx,
        { actor: "user", confirmed: true, operation: "create" },
      );
    } else if (content !== null) {
      await writeText(nextFp, content);
    } else {
      await fs.copyFile(oldFp, nextFp);
    }
    bumpWorkspaceIndex(nextRel);
    return {
      ...buildWritebackEvidence({
        operation: "create",
        targetPath: nextRel,
        savedAt: now(),
      }),
      ok: true,
      path: nextRel,
    };
  },

  async getFileMeta({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const preview = await readTextPreview(fp, 4096);
    const { data, body } = splitMarkdownFrontmatter(preview);
    const s = await statSafe(fp);
    return {
      frontmatter: data,
      bodyPreview: body.slice(0, 200),
      size: s?.size ?? 0,
      mtime: s?.mtime.toISOString() ?? null,
    };
  },

  async updateFrontmatter({ relativePath, fields, actor, confirmed }, ctx) {
    S(relativePath, "relativePath");
    if (!relativePath.endsWith(".md")) throw new Error(i18n("pathOps.frontmatterMdOnly"));
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error("fields object required.");
    }
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const old = await readText(fp);
    const { data, body } = splitMarkdownFrontmatter(old);
    const merged = { ...(data && typeof data === "object" ? data : {}) };
    for (const [key, value] of Object.entries(fields)) {
      if (!key || key.startsWith("_")) continue;
      if (value === null || value === undefined || value === "") {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    const next = Object.keys(merged).length > 0
      ? `---\n${stringifyYamlFrontmatter(merged)}\n---\n\n${body}`
      : body;
    if (next === old) {
      return buildWritebackEvidence({
        operation: "update",
        targetPath: relativePath,
        savedAt: now(),
        wroteFiles: false,
      });
    }
    if (typeof ctx.markIgnoredFileChanges === "function") {
      ctx.markIgnoredFileChanges([fp], 1500);
    }
    const writeActor = actor || ctx.writeActor || "user";
    const ev = await kernelDurableWrite(
      { relativePath, content: next },
      ctx,
      {
        actor: writeActor,
        confirmed: writeActor === "user" ? true : confirmed === true,
        operation: "update",
        frontmatter: merged,
        writebackMode: ctx.explicitWritebackMode,
      },
    );
    if (!ev.pending && !ev.needsConfirm) bumpWorkspaceIndex(relativePath);
    return asDesktopEvidence(ev, relativePath);
  },

  async readPath({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    return readText(await sp(ctx.workspaceRoot, relativePath));
  },

  /**
   * Line-windowed read for agent tools (offset/limit are 1-based line start + count).
   * Full file still available via readPath / offset=1 without limit.
   */
  async readPathWindow({ relativePath, offset = 1, limit }, ctx) {
    S(relativePath, "relativePath");
    const full = await readText(await sp(ctx.workspaceRoot, relativePath));
    const lines = full.split("\n");
    const totalLines = lines.length;
    const start = Math.max(1, Math.floor(Number(offset) || 1));
    const maxLines = limit == null || limit === ""
      ? totalLines
      : Math.max(1, Math.min(5000, Math.floor(Number(limit)) || 200));
    const from = start - 1;
    if (from >= totalLines) {
      return {
        relativePath,
        content: "",
        offset: start,
        limit: maxLines,
        totalLines,
        totalChars: full.length,
        truncated: false,
        empty: true,
        note: i18n("pathOps.offsetBeyondEnd", { start, total: totalLines }),
      };
    }
    const slice = lines.slice(from, from + maxLines);
    const content = slice.join("\n");
    const endLine = from + slice.length;
    const truncated = endLine < totalLines;
    return {
      relativePath,
      content,
      offset: start,
      limit: maxLines,
      startLine: start,
      endLine,
      totalLines,
      totalChars: full.length,
      truncated,
      empty: false,
      note: truncated
        ? i18n("pathOps.returnedLinesContinue", { start, end: endLine, total: totalLines })
        : i18n("pathOps.returnedLines", { start, end: endLine, total: totalLines }),
    };
  },

  /**
   * Surgical text edit via Kernel writeback (actor defaults user; AI tools pass actor:"ai").
   */
  async editPath({ relativePath, oldText, newText, replaceAll = false, actor, confirmed }, ctx) {
    S(relativePath, "relativePath");
    if (!relativePath.endsWith(".md")) throw new Error(i18n("pathOps.editMdOnly"));
    S(oldText, "oldText", { allowEmpty: false, maxLen: 500_000 });
    if (typeof newText !== "string") throw new Error(i18n("pathOps.newTextNotString"));
    if (newText.length > 5_000_000) throw new Error(i18n("pathOps.newTextTooLong"));
    if (oldText === newText) {
      return {
        ...buildWritebackEvidence({
          operation: "edit",
          targetPath: relativePath,
          savedAt: now(),
          wroteFiles: false,
        }),
        ok: true,
        replacements: 0,
        note: i18n("pathOps.sameTextNoWrite"),
      };
    }

    const fp = await sp(ctx.workspaceRoot, relativePath);
    const old = await fs.readFile(fp, "utf8").catch(() => null);
    if (old === null) throw new Error(i18n("pathOps.fileNotExist", { path: relativePath }));

    const count = old.split(oldText).length - 1;
    if (count === 0) {
      throw new Error(
        i18n("pathOps.oldTextNoMatch", { path: relativePath }),
      );
    }
    if (count > 1 && !replaceAll) {
      throw new Error(
        i18n("pathOps.oldTextMultiMatch", { count, path: relativePath }),
      );
    }

    const next = replaceAll
      ? old.split(oldText).join(newText)
      : old.replace(oldText, newText);
    if (next === old) {
      return {
        ...buildWritebackEvidence({
          operation: "edit",
          targetPath: relativePath,
          savedAt: now(),
          wroteFiles: false,
        }),
        ok: true,
        replacements: 0,
        note: i18n("pathOps.contentUnchanged"),
      };
    }

    if (typeof ctx.markIgnoredFileChanges === "function") {
      ctx.markIgnoredFileChanges([fp], 1500);
    }
    // Surgical edit still hits protection gate; backup/receipt only if high-impact (locked) per writeback-engine.
    const writeActor = actor || ctx.writeActor || "user";
    const ev = await kernelDurableWrite(
      { relativePath, content: next },
      ctx,
      {
        actor: writeActor,
        confirmed: writeActor === "user" ? true : confirmed === true,
        operation: "edit",
        writebackMode: ctx.explicitWritebackMode,
      },
    );
    if (ev.pending || ev.needsConfirm) {
      return { ...asDesktopEvidence(ev, relativePath), ok: false, replacements: 0 };
    }
    bumpWorkspaceIndex(relativePath);
    const replacements = replaceAll ? count : 1;
    // Truncate snippets for UI diff display (avoid huge payloads)
    const MAX_SNIPPET = 300;
    const oldSnippet = oldText.length > MAX_SNIPPET
      ? `${oldText.slice(0, MAX_SNIPPET)}…`
      : oldText;
    const newSnippet = newText.length > MAX_SNIPPET
      ? `${newText.slice(0, MAX_SNIPPET)}…`
      : newText;
    return {
      ...asDesktopEvidence(ev, relativePath),
      ok: true,
      replacements,
      charsDelta: next.length - old.length,
      archived: false,
      note: i18n("pathOps.replacedCount", { count: replacements }),
      oldSnippet,
      newSnippet,
    };
  },

  async savePath({ relativePath, content, actor, confirmed, skipBackup: explicitSkipBackup }, ctx) {
    S(relativePath, "relativePath");
    const relNorm = String(relativePath).replace(/\\/gu, "/");
    const isMd = relNorm.endsWith(".md");
    const isHtml = relNorm.endsWith(".html") || relNorm.endsWith(".htm");
    // Markdown notes always; HTML only as 写出来 delivery export (under outputs root).
    if (!isMd && !isHtml) throw new Error(i18n("pathOps.saveMdOrHtml"));
    if (isHtml) {
      const outRoot = outputsRoot(ctx.workspaceRoot);
      const outName = path.basename(outRoot);
      if (!relNorm.startsWith(`${outName}/`) && relNorm !== outName) {
        throw new Error(i18n("pathOps.htmlOutputsOnly"));
      }
    }
    S(content, "content", { allowEmpty: true, maxLen: 5_000_000 });
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const old = await fs.readFile(fp, "utf8").catch(() => null);
    if (typeof ctx.markIgnoredFileChanges === "function") {
      ctx.markIgnoredFileChanges([fp], 1500);
    }
    const writeActor = actor || ctx.writeActor || "user";
    const isUserSave = writeActor === "user";
    const ev = await kernelDurableWrite(
      { relativePath, content },
      ctx,
      {
        actor: writeActor,
        confirmed: isUserSave ? true : confirmed === true,
        operation: old === null ? "create" : "update",
        isCreate: old === null,
        // Gate owns high-impact backup/receipt (locked overwrite only).
        // Explicit skipBackup only when caller forces skip (escape hatch).
        ...(explicitSkipBackup === true ? { skipBackup: true, skipReceipt: true } : {}),
        writebackMode: ctx.explicitWritebackMode,
      },
    );
    if (!ev.pending && !ev.needsConfirm) {
      bumpWorkspaceIndex(relativePath);
    }
    return asDesktopEvidence(ev, relativePath);
  },

  /**
   * Write a binary asset next to notes (images/… only by convention).
   * Routes through Kernel writeback-engine protection gate so locked files
   * are not overwritten by AI without permission. Binary content bypasses
   * the string-only executeWrite but still checks evaluateWritePermission.
   * No Archive checkpoint (binary assets; reversible via trash on delete).
   * @param {{ relativePath: string, base64: string, contentType?: string, actor?: string }} p
   */
  async saveBinary({ relativePath, base64, contentType, actor }, ctx) {
    S(relativePath, "relativePath");
    const rel = String(relativePath).replace(/\\/gu, "/");
    // Safety: only allow under images/ segments or known media extensions
    const ext = path.extname(rel).toLowerCase();
    const okExt = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bin"]);
    if (!okExt.has(ext)) throw new Error("saveBinary: unsupported extension");
    if (rel.includes("..") || path.isAbsolute(rel)) throw new Error("saveBinary: invalid path");
    const b64 = String(base64 || "");
    if (!b64 || b64.length > 12_000_000) throw new Error("saveBinary: empty or too large");
    const buf = Buffer.from(b64, "base64");
    if (!buf.length || buf.length > 8_000_000) throw new Error("saveBinary: size limit");
    const fp = await sp(ctx.workspaceRoot, rel);

    // Protection gate: evaluate write permission before touching the file.
    // Binary assets go through the same gate as markdown — locked files
    // cannot be overwritten by AI, and high-impact overwrites get backed up.
    const writeActor = actor || ctx.writeActor || "user";
    const { loadKernelApi } = await import("./kernel-api.mjs");
    const kernel = await loadKernelApi();
    const workspaceRoot = ctx.workspaceRoot?.userWorkspaceRoot || ctx.workspaceRoot;
    const contract = kernel.loadContract(workspaceRoot);
    const fileExists = await exists(fp);
    let frontmatter = undefined;
    if (fileExists) {
      // Binary files have no frontmatter; peek existing protection from contract defaults
      frontmatter = {};
    }
    const permission = kernel.evaluateWritePermission({
      contract,
      targetPath: fp,
      workspaceRoot,
      role: "deep-work",
      frontmatter,
      actor: writeActor,
    });
    if (!permission.allowed) {
      throw new Error(`saveBinary write denied: ${permission.reason}`);
    }

    // High-impact backup: if overwriting a locked file, back up first
    if (fileExists && permission.protection === "locked") {
      const { writePathCheckpoint } = await import("./writeback.mjs");
      const existingBuf = await fs.readFile(fp);
      await writePathCheckpoint(
        { workspaceRoot },
        {
          savedAt: now(),
          content: existingBuf.toString("base64"),
          relativePath: rel,
          keep: 3,
        },
      );
    }

    // Binary assets intentionally bypass Kernel writeback-engine (text-oriented:
    // atomic tmp+rename, frontmatter, receipt). Protection is handled above via
    // evaluateWritePermission + writePathCheckpoint backup for locked overwrites.
    await fs.mkdir(path.dirname(fp), { recursive: true });
    if (typeof ctx.markIgnoredFileChanges === "function") {
      ctx.markIgnoredFileChanges([fp], 1500);
    }
    await fs.writeFile(fp, buf);
    bumpWorkspaceIndex(rel);
    const t = now();
    return buildWritebackEvidence({
      operation: "create",
      targetPath: rel,
      savedAt: t,
      note: contentType ? `binary ${contentType}` : "binary asset",
    });
  },

  async deletePath({ relativePath, actor, confirmed, permanent }, ctx) {
    S(relativePath, "relativePath");
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const writeActor = actor || ctx.writeActor || "user";
    const isPermanent = permanent === true;
    /** @type {string[]} */
    let mediaTrashed = [];

    const { loadKernelApi } = await import("./kernel-api.mjs");
    const kernel = await loadKernelApi();
    const workspaceRoot = ctx.workspaceRoot?.userWorkspaceRoot || ctx.workspaceRoot;
    const contract = kernel.loadContract(workspaceRoot);

    if (relativePath.endsWith(".md")) {
      const old = await fs.readFile(fp, "utf8").catch(() => null);
      if (old !== null) {
        const fm = kernel.peekFrontmatter(old);
        const perm = kernel.evaluateWritePermission({
          contract,
          targetPath: fp,
          workspaceRoot,
          frontmatter: fm,
          actor: writeActor,
        });
        const recoverable =
          !isPermanent &&
          kernel.isRecoverableLifecycle({
            protection: perm.protection,
            relativePath,
          });
        try {
          const { trashNoteMedia } = await import("./workspace-note-media.mjs");
          const media = await trashNoteMedia(
            { noteRelativePath: relativePath, markdown: old, toTrash: recoverable },
            ctx,
          );
          mediaTrashed = media.trashed || [];
        } catch {
          /* non-fatal */
        }
      }
      const ev = await kernelDurableDelete(
        { relativePath },
        ctx,
        {
          actor: writeActor,
          confirmed: confirmed === true || writeActor === "user",
          permanent: isPermanent,
        },
      );
      if (ev.pending || ev.needsConfirm) {
        return { ...asDesktopEvidence(ev, relativePath), ok: false, mediaTrashed: 0 };
      }
      bumpWorkspaceIndex(relativePath);
      return {
        ...asDesktopEvidence(ev, relativePath),
        ok: true,
        mediaTrashed: mediaTrashed.length,
        affectedFiles: [...(ev.affectedFiles || [relativePath]), ...mediaTrashed],
        note:
          isPermanent
            ? i18n("pathOps.permanentlyDeleted")
            : mediaTrashed.length > 0
              ? i18n("pathOps.deletedWithMedia", { count: mediaTrashed.length })
              : i18n("pathOps.deleted"),
      };
    }

    // Non-md: trash only when locked (binary assets have no topic.md / memory role).
    const t = now();
    let backup;
    const perm = kernel.evaluateWritePermission({
      contract,
      targetPath: fp,
      workspaceRoot,
      frontmatter: {},
      actor: writeActor,
    });
    const recoverable =
      !isPermanent &&
      kernel.isRecoverableLifecycle({
        protection: perm.protection,
        relativePath,
      });
    if (recoverable && (await statSafe(fp))) {
      const dirParts = relativePath.split("/").slice(0, -1);
      const stamped = `${timestampStamp()}__${path.basename(relativePath)}`;
      const dest = trashAbsolute(ctx.workspaceRoot, ...dirParts, stamped);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(fp, dest).catch(() => {});
      backup = trashRelative(ctx.workspaceRoot, ...dirParts, stamped);
    }
    await fs.unlink(fp).catch(() => {});
    bumpWorkspaceIndex(relativePath);
    return {
      ...buildWritebackEvidence({
        operation: "delete",
        targetPath: relativePath,
        savedAt: t,
        backupPath: backup,
        affectedFiles: [relativePath],
      }),
      ok: true,
    };
  },

  async renamePath({ relativePath, newName }, ctx) {
    S(relativePath, "relativePath"); S(newName, "newName");
    if (/[\\/]/u.test(newName)) throw new Error(i18n("pathOps.newNameNoSeparator"));
    const dir = relativePath.split("/").slice(0, -1).join("/");
    let finalName = newName;
    // Ensure .md extension preserved when renaming markdown notes
    if (relativePath.endsWith(".md") && !finalName.endsWith(".md")) {
      finalName = `${finalName}.md`;
    }
    const nextRel = dir ? `${dir}/${finalName}` : finalName;
    const oldFp = await sp(ctx.workspaceRoot, relativePath);
    const nextFp = await sp(ctx.workspaceRoot, nextRel);
    if (await statSafe(nextFp)) throw new Error(i18n("pathOps.targetExists", { path: nextRel }));
    const t = now();
    const c = await fs.readFile(oldFp, "utf8").catch(() => null);
    // No backup for rename — content is preserved at the new path (no data loss risk).
    // Backup only needed for operations that destroy or overwrite content.

    let mediaRenamed = null;
    let bodyOut = c;
    if (relativePath.endsWith(".md") && c !== null) {
      const oldStem = path.basename(relativePath, ".md");
      const newStem = path.basename(finalName, ".md");
      if (oldStem !== newStem) {
        const { renameNoteMediaSlug } = await import("./workspace-note-media.mjs");
        const r = await renameNoteMediaSlug(
          {
            noteDir: dir,
            oldStem,
            newStem,
            markdown: c,
          },
          ctx,
        );
        bodyOut = r.markdown;
        mediaRenamed = r.renamedDir;
        // Write rewritten body via Kernel gate, then remove old file
        await kernelDurableWrite(
          { relativePath: nextRel, content: bodyOut },
          ctx,
          { actor: "user", confirmed: true, operation: "create" },
        );
        await fs.unlink(oldFp).catch(() => {});
      } else {
        await fs.rename(oldFp, nextFp);
      }
    } else {
      await fs.rename(oldFp, nextFp);
    }

    bumpWorkspaceIndex(relativePath);
    bumpWorkspaceIndex(nextRel);
    const affected = [relativePath, nextRel];
    if (mediaRenamed) affected.push(mediaRenamed);
    return {
      ...buildWritebackEvidence({
        operation: "rename",
        targetPath: nextRel,
        savedAt: t,
        affectedFiles: affected,
      }),
      ok: true,
      path: nextRel,
      mediaRenamed: mediaRenamed || undefined,
      note: mediaRenamed
        ? i18n("pathOps.renamedWithMedia", { dir: mediaRenamed })
        : undefined,
    };
  },

  /**
   * Publish = copy delivery snapshot into 88-Outputs (original note stays).
   * Copies note-local images/ so relative markdown keeps working under Outputs.
   */
  async publishPath({ relativePath }, ctx) {
    S(relativePath, "relativePath");
    if (!relativePath.endsWith(".md")) throw new Error(i18n("pathOps.publishMdOnly"));
    const src = await sp(ctx.workspaceRoot, relativePath);
    const c = await readText(src);
    const parts = relativePath.split("/");
    const category = parts[0];
    const topic = parts.length >= 3 ? parts[1] : null;
    const base = path.basename(relativePath).replace(/\.md$/u, "");
    const ds = new Date().toISOString().slice(0, 10);
    const outName = `${ds}-${base}.md`;
    const outRoot = outputsRoot(ctx.workspaceRoot);
    const outputsName = path.basename(outRoot);
    const dest = path.join(outRoot, outName);
    const t = now();
    const old = await fs.readFile(dest, "utf8").catch(() => null);
    // No backup for publish — original note stays in workspace; output is a copy.
    // Old output overwrite is low-risk (source is always available for re-publish).

    // Copy media into 88-Outputs/images/{slug}/ (relative paths unchanged)
    const { transferNoteMedia } = await import("./workspace-note-media.mjs");
    const media = await transferNoteMedia(
      {
        noteRelativePath: relativePath,
        destNoteDir: outputsName,
        markdown: c,
        mode: "copy",
      },
      ctx,
    );

    const fm = {
      published_at: t,
      source_path: relativePath,
    };
    if (category && CATEGORY_PATTERN.test(category)) fm.category = category;
    if (topic) fm.topic = topic;
    const targetPath = `${outputsName}/${outName}`;
    await kernelDurableWrite(
      { relativePath: targetPath, content: injectFrontmatter(c, fm) },
      ctx,
      { actor: "user", confirmed: true, operation: "create", frontmatter: fm },
    );
    bumpWorkspaceIndex(targetPath);
    const affected = [relativePath, targetPath, ...media.movedDirs, ...media.movedFiles];
    return {
      ...buildWritebackEvidence({
        operation: "publish",
        targetPath,
        savedAt: t,
        affectedFiles: affected,
      }),
      ok: true,
      path: targetPath,
      mediaCopied: media.count,
      note:
        media.count > 0
          ? i18n("pathOps.publishedWithMedia", { count: media.count })
          : i18n("pathOps.published"),
    };
  },

  async saveNote({ topicId, filename, content, sourceType, actor, confirmed, skipBackup: explicitSkipBackup }, ctx) {
    T(topicId); S(filename, "filename");
    const { category, topic } = parseTopicId(topicId);
    const relativePath = `${category}/${topic}/${filename}`;
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const t = now();
    const old = await fs.readFile(fp, "utf8").catch(() => null);
    // Create: set captured_at. Update: preserve original captured_at, set updated_at.
    const prevFm = old ? (splitMarkdownFrontmatter(old).data || {}) : {};
    const fm = {
      title: filename.replace(/\.md$/u, ""),
      source_type: sourceType || prevFm.source_type || "user-original",
      category,
      topic,
    };
    if (old === null) {
      fm.captured_at = t;
    } else {
      if (prevFm.captured_at) fm.captured_at = prevFm.captured_at;
      else fm.captured_at = t;
      fm.updated_at = t;
    }
    const writeActor = actor || ctx.writeActor || (sourceType === "ai-derived" ? "ai" : "user");
    const isUserSave = writeActor === "user";
    const ev = await kernelDurableWrite(
      { relativePath, content: injectFrontmatter(content, fm) },
      ctx,
      {
        actor: writeActor,
        confirmed: isUserSave ? true : confirmed === true,
        operation: old === null ? "create" : "update",
        frontmatter: fm,
        // Gate owns high-impact backup/receipt; explicit skip only when forced.
        ...(explicitSkipBackup === true ? { skipBackup: true, skipReceipt: true } : {}),
        writebackMode: ctx.explicitWritebackMode,
      },
    );
    if (!ev.pending && !ev.needsConfirm) bumpWorkspaceIndex(relativePath);
    return asDesktopEvidence(ev, relativePath);
  },

  async createTopic({ category, name, actor, confirmed }, ctx) {
    S(category, "category"); S(name, "name");
    if (!/^\d{4}-.+/u.test(name)) throw new Error(i18n("pathOps.topicNameYearPrefix"));

    // Respect confirm gate from workspace contract (not app-settings fork)
    const { resolveWorkspaceWritebackMode } = await import("./kernel-api.mjs");
    const writebackMode = await resolveWorkspaceWritebackMode(ctx, {
      writebackMode: ctx.explicitWritebackMode,
    });
    if (writebackMode === "confirm" && !confirmed && actor === "ai") {
      const topicId = buildTopicId(category, name);
      return {
        ok: false,
        needsConfirm: true,
        pending: true,
        topicId,
        targetPath: topicId,
        previewContent: i18n("pathOps.aboutToCreateTopic", { topicId: `${category}/${name}` }),
        operation: "create-topic",
      };
    }

    const dir = await sp(ctx.workspaceRoot, `${category}/${name}`);
    const stat = await statSafe(dir);
    if (stat) throw new Error(i18n("pathOps.topicExists", { topicId: `${category}/${name}` }));
    await fs.mkdir(dir, { recursive: true });
    const topicId = buildTopicId(category, name);
    bumpWorkspaceIndex(`${category}/${name}`);
    return { ok: true, topicId };
  },

  async deleteTopic({ topicId }, ctx) {
    T(topicId);
    const { category, topic } = parseTopicId(topicId);
    const dir = await sp(ctx.workspaceRoot, `${category}/${topic}`);
    const t = now();
    let backup;
    if ((await statSafe(dir))?.isDirectory()) {
      const stamped = `${timestampStamp()}__${topic}`;
      // Unified: topic trash under backups/trash/
      const dest = trashAbsolute(ctx.workspaceRoot, category, stamped);
      await fs.cp(dir, dest, { recursive: true }).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      backup = trashRelative(ctx.workspaceRoot, category, stamped);
    }
    bumpWorkspaceIndex(`${category}/${topic}`);
    return {
      ...buildWritebackEvidence({
        operation: "delete-topic",
        targetPath: `${category}/${topic}`,
        savedAt: t,
        backupPath: backup,
      }),
      ok: true,
    };
  },

  /**
   * Rename a topic directory. Updates frontmatter `topic` field in all .md
   * files inside. No backup (rename preserves content; old dir name is gone).
   */
  async renameTopic({ topicId, newName }, ctx) {
    T(topicId);
    S(newName, "newName");
    if (/[\\/]/u.test(newName)) throw new Error(i18n("pathOps.topicNameNoSeparator"));
    const { category, topic: oldTopic } = parseTopicId(topicId);
    if (!category || !oldTopic) throw new Error(i18n("pathOps.invalidTopicId", { topicId }));
    const trimmed = newName.trim();
    if (trimmed === oldTopic) throw new Error(i18n("pathOps.sameName"));
    const oldDir = await sp(ctx.workspaceRoot, `${category}/${oldTopic}`);
    const newDir = await sp(ctx.workspaceRoot, `${category}/${trimmed}`);
    if (await statSafe(newDir)) throw new Error(i18n("pathOps.targetExists", { path: `${category}/${trimmed}` }));
    const t = now();

    // Read all .md files before rename so we can update frontmatter after
    const oldDirAbs = oldDir;
    let mdFiles = [];
    try {
      const entries = await fs.readdir(oldDirAbs, { withFileTypes: true });
      mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
    } catch {
      /* dir may not exist if already moved */
    }

    // Rename the directory (FS rename — not a content write)
    await fs.rename(oldDir, newDir);

    // Durable .md frontmatter/body updates must go through Kernel writeback
    // (same gate as renameCategory → executeWrite), not raw fs.writeFile.
    // Backup/receipt only when high-impact (locked) per writeback-engine.
    const writeGateOpts = {
      actor: "user",
      confirmed: true,
      operation: "update",
    };
    let updatedCount = 0;
    const affected = [`${category}/${oldTopic}`, `${category}/${trimmed}`];

    for (const fn of mdFiles) {
      const rel = `${category}/${trimmed}/${fn}`;
      const fp = path.join(newDir, fn);
      try {
        const raw = await readText(fp);
        const { data, body } = splitMarkdownFrontmatter(raw);
        const nextData = { ...(data && typeof data === "object" ? data : {}) };
        let bodyOut = body;
        let dirty = false;

        if (nextData.topic !== trimmed) {
          nextData.topic = trimmed;
          dirty = true;
        }
        // topic.md: keep title + H1 in sync with the new topic name
        if (fn === "topic.md") {
          if (nextData.title === oldTopic || nextData.title === undefined) {
            nextData.title = trimmed;
            dirty = true;
          }
          if (bodyOut.trimStart().startsWith(`# ${oldTopic}`)) {
            bodyOut = bodyOut.replace(`# ${oldTopic}`, `# ${trimmed}`);
            dirty = true;
          }
        }

        if (!dirty) continue;
        const updated = Object.keys(nextData).length > 0
          ? `---\n${stringifyYamlFrontmatter(nextData)}\n---\n\n${bodyOut}`
          : bodyOut;
        if (updated === raw) continue;
        await kernelDurableWrite(
          { relativePath: rel, content: updated },
          ctx,
          writeGateOpts,
        );
        updatedCount++;
        affected.push(rel);
      } catch {
        /* non-fatal — frontmatter update is best-effort */
      }
    }

    const newTopicId = buildTopicId(category, trimmed);
    bumpWorkspaceIndex(`${category}/${oldTopic}`);
    bumpWorkspaceIndex(`${category}/${trimmed}`);
    return {
      ...buildWritebackEvidence({
        operation: "rename-topic",
        targetPath: `${category}/${trimmed}`,
        savedAt: t,
        affectedFiles: affected,
      }),
      ok: true,
      topicId: newTopicId,
      note: i18n("pathOps.topicRenamed", { count: updatedCount }),
    };
  },

  async appendTopicMemory({ topicId, entry, source, actor, confirmed }, ctx) {
    T(topicId);
    S(entry, "entry", { maxLen: 100_000 });
    const { category, topic } = parseTopicId(topicId);
    const relativePath = `${category}/${topic}/topic.md`;
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const stamp = now();
    const sourceLine = source && String(source).trim() ? `\n\n_Source: ${String(source).trim()}_` : "";
    const newEntry = `\n### ${stamp}\n\n${entry.trim()}${sourceLine}\n`;
    const blockHeader = "## Stable Memory";

    let old = await fs.readFile(fp, "utf8").catch(() => null);
    if (old === null) {
      await fs.mkdir(path.dirname(fp), { recursive: true });
      old = injectFrontmatter(
        `# ${topic}\n\n${blockHeader}\n\n(待补充)\n\n## Working Notes\n\n(待补充)\n`,
        { title: topic, category, topic, status: "active" },
      );
    }

    const { data, body } = splitMarkdownFrontmatter(old);
    let newBody = body;
    if (newBody.includes(blockHeader)) {
      newBody = newBody.replace(blockHeader, `${blockHeader}${newEntry}`);
    } else {
      newBody = `${newBody.trimEnd()}\n\n${blockHeader}${newEntry}\n`;
    }
    const next = injectFrontmatter(newBody, { ...data, updated_at: stamp });
    const writeActor = actor || ctx.writeActor || "user";
    const ev = await kernelDurableWrite(
      { relativePath, content: next },
      ctx,
      {
        actor: writeActor,
        confirmed: writeActor === "user" ? true : confirmed === true,
        operation: "update",
        writebackMode: ctx.explicitWritebackMode,
      },
    );
    if (!ev.pending && !ev.needsConfirm) bumpWorkspaceIndex(relativePath);
    return asDesktopEvidence({ ...ev, operation: "append-memory" }, relativePath);
  },

  /**
   * Stream / memory context for UI pins and capture defaults.
   * When the current period file doesn't exist on disk, fall back to the
   * newest existing period so the UI never shows an empty/error state.
   */
  async getStreamContext(_p, ctx) {
    const wmApi = await import("./workspace-model-api.mjs");
    const stream = await wmApi.resolveStreamTarget(ctx.workspaceRoot);
    const memory = await wmApi.resolveMemoryPaths(ctx.workspaceRoot);

    // Check if the current period file exists; if not, find the latest existing one.
    let periodRelPath = stream.periodRelPath;
    let periodFileName = stream.periodFileName;
    let periodTitle = stream.title;
    if (periodRelPath) {
      const fp = path.join(resolveDataRoot(ctx.workspaceRoot), periodRelPath);
      const exists = await fs.access(fp).then(() => true).catch(() => false);
      if (!exists) {
        try {
          const periods = await wmApi.listStreamPeriods(ctx.workspaceRoot, { limit: 1 });
          if (periods && periods.length > 0) {
            periodRelPath = periods[0].relPath;
            periodFileName = periods[0].fileName;
            periodTitle = periods[0].title || periodTitle;
          }
        } catch {
          /* keep current period path even if file doesn't exist */
        }
      }
    }

    return {
      packing: stream.packing,
      packingLabel: stream.packing, // client maps label
      appendHeading: stream.appendHeading,
      streamCategory: stream.streamCategory
        ? {
            directory: stream.streamCategory.directory,
            role: stream.streamCategory.role,
            name: stream.streamCategory.name,
          }
        : null,
      periodRelPath,
      periodFileName,
      periodTitle,
      memory: {
        dir: memory.memoryDirRel,
        profileFile: memory.profileFile,
        profileRelPath: memory.profileRelPath,
        files: memory.files || [],
      },
    };
  },

  /**
   * List all period notes in the stream category (for "整理过往" UI).
   * Returns sorted (newest first) list with reconciled flag.
   */
  async listStreamPeriods(_p, ctx) {
    const wmApi = await import("./workspace-model-api.mjs");
    return wmApi.listStreamPeriods(ctx.workspaceRoot, { limit: 50 });
  },

  /**
   * List all year directories in the stream category for year navigation.
   * Returns sorted (newest first) list of { year, periodCount, archived }.
   */
  async listStreamYears(_p, ctx) {
    const wmApi = await import("./workspace-model-api.mjs");
    return wmApi.listStreamYears(ctx.workspaceRoot);
  },

  /**
   * Archive a complete year of stream period notes to 99-归档/stream-archive/{year}/.
   * Only allows archiving years before the current calendar year.
   */
  async archiveStreamYear({ year }, ctx) {
    S(year, "year");
    const yearStr = String(year).trim();
    if (!/^\d{4}$/.test(yearStr)) throw new Error("Invalid year format");
    const wmApi = await import("./workspace-model-api.mjs");
    const result = await wmApi.archiveStreamYear(ctx.workspaceRoot, yearStr);
    if (!result.ok) {
      const reasonMap = {
        "current-or-future-year": i18n("pathOps.archiveCurrentOrFuture"),
        "year-dir-not-found": i18n("pathOps.archiveYearNotFound"),
        "no-period-files": i18n("pathOps.archiveNoPeriodFiles"),
        "already-archived": i18n("pathOps.archiveAlreadyArchived"),
        "no-stream-category": i18n("pathOps.archiveNoStreamCategory"),
        "no-archive-category": i18n("pathOps.archiveNoArchiveCategory"),
      };
      const msg = reasonMap[result.reason] || result.reason || i18n("pathOps.archiveFailed");
      throw new Error(msg);
    }
    return {
      ok: true,
      ...result,
      userMessage: i18n("pathOps.archiveDone", { year: yearStr, count: result.movedCount, path: result.archivePath }),
    };
  },

  /**
   * Append a comment-like continuation under a stream/note entry (Wave S2).
   * Same Markdown file; marker <!-- topmind:append ... --> for activity window parents.
   * Uses Kernel appendToStreamEntry only (no monorepo-relative lib import).
   */
  async appendStreamEntry({ relativePath, heading, content, parentRel }, ctx) {
    S(relativePath, "relativePath");
    S(content, "content", { maxLen: 50_000 });
    const rel = String(relativePath).replace(/\\/g, "/");
    const text = String(content || "").trim();
    if (!text) throw new Error(i18n("pathOps.appendContentEmpty"));
    const fp = await sp(ctx.workspaceRoot, rel);
    const old = await fs.readFile(fp, "utf8").catch(() => null);
    if (old === null) throw new Error(i18n("pathOps.fileNotExist", { path: rel }));

    const { loadKernelApi, kernelDurableWrite } = await import("./kernel-api.mjs");
    const kernel = await loadKernelApi();
    if (typeof kernel.appendToStreamEntry !== "function") {
      throw new Error("Kernel appendToStreamEntry unavailable");
    }
    const next = kernel.appendToStreamEntry(old, {
      heading: heading ? String(heading) : undefined,
      content: text,
      parentRel: parentRel ? String(parentRel) : undefined,
      date: new Date(),
    });
    if (next === old) {
      throw new Error(i18n("pathOps.appendNoChange"));
    }

    const ev = await kernelDurableWrite(
      { relativePath: rel, content: next },
      ctx,
      {
        actor: "user",
        operation: "update",
      },
    );
    if (!ev.pending && !ev.needsConfirm) bumpWorkspaceIndex(rel);
    return asDesktopEvidence(
      {
        ...ev,
        operation: "append-entry",
        userMessage: i18n("pathOps.appendedToStream"),
      },
      rel,
    );
  },

  /**
   * Ensure core profile exists; return paths.
   */
  async ensureCoreProfile(_p, ctx) {
    const wmApi = await import("./workspace-model-api.mjs");
    const ensured = await wmApi.ensureCoreProfile(ctx.workspaceRoot);
    return {
      ok: Boolean(ensured.ok),
      created: Boolean(ensured.created),
      profileRelPath: ensured.profileRelPath,
      memoryDirRel: ensured.memoryDirRel,
      profileFile: ensured.profileFile,
      files: ensured.files || [],
      reason: ensured.reason,
    };
  },

  /**
   * Append to 我的情况 (core profile).
   */
  async appendCoreMemory({ entry, section, source, actor, confirmed }, ctx) {
    S(entry, "entry", { maxLen: 100_000 });
    const wmApi = await import("./workspace-model-api.mjs");
    const ensured = await wmApi.ensureCoreProfile(ctx.workspaceRoot);
    if (!ensured.ok || !ensured.profileRelPath) {
      throw new Error(i18n("pathOps.coreMemoryPathFail"));
    }
    const relativePath = ensured.profileRelPath;
    const fp = await sp(ctx.workspaceRoot, relativePath);
    const stamp = now();
    const day = stamp.slice(0, 10);
    const sectionTitle = section && String(section).trim() ? String(section).trim() : "偏好";
    const header = `## ${sectionTitle}`;
    const line = `- [${day}] ${entry.trim()}${source ? `（来源：${source}）` : ""}`;

    let old = await fs.readFile(fp, "utf8").catch(() => null);
    if (old === null) {
      await fs.mkdir(path.dirname(fp), { recursive: true });
      old = "";
    }
    const { data, body } = splitMarkdownFrontmatter(old || "");
    let newBody = (body || "").trimEnd();
    if (!newBody) {
      newBody = `# 我的情况\n\n## 偏好\n\n## 当前目标\n\n## 关键的人与协作\n\n## 进行中的事\n`;
    }
    if (newBody.includes(header)) {
      const idx = newBody.indexOf(header);
      const after = idx + header.length;
      const rest = newBody.slice(after);
      const nextH = rest.search(/\n## /u);
      if (nextH === -1) newBody = `${newBody}\n${line}\n`;
      else {
        const insertAt = after + nextH;
        newBody = `${newBody.slice(0, insertAt).replace(/\s+$/u, "")}\n${line}\n${newBody.slice(insertAt)}`;
      }
    } else {
      newBody = `${newBody}\n\n${header}\n${line}\n`;
    }
    const next = injectFrontmatter(newBody, {
      ...data,
      title: data?.title || "我的情况",
      type: "core-memory",
      updated_at: stamp,
    });
    const writeActor = actor || ctx.writeActor || "user";
    const ev = await kernelDurableWrite(
      { relativePath, content: next },
      ctx,
      {
        actor: writeActor,
        confirmed: writeActor === "user" ? true : confirmed === true,
        operation: "update",
        role: "memory",
        writebackMode: ctx.explicitWritebackMode,
      },
    );
    if (!ev.pending && !ev.needsConfirm) bumpWorkspaceIndex(relativePath);
    return {
      ...asDesktopEvidence({ ...ev, operation: "append-profile" }, relativePath),
      userMessage: i18n("pathOps.coreMemoryUpdated", { section: sectionTitle }),
      section: sectionTitle,
    };
  },

  /**
   * Deterministic 整理本周 on current period note (or explicit path).
   * @param {{ relativePath?: string, dryRun?: boolean, apply?: boolean }} p
   */
  async reconcileStreamPeriod({ relativePath, dryRun, apply } = {}, ctx) {
    const wmApi = await import("./workspace-model-api.mjs");
    const wm = await wmApi.loadWorkspaceModelLib();
    const stream = await wmApi.resolveStreamTarget(ctx.workspaceRoot);
    let rel = relativePath && String(relativePath).trim()
      ? String(relativePath).trim()
      : stream.periodRelPath;
    if (!rel) {
      // atom packing: no single period file
      return {
        ok: false,
        reason: "no-period-note",
        packing: stream.packing,
        message: stream.packing === "atom"
          ? i18n("pathOps.reconcileAtomPacking")
          : i18n("pathOps.reconcileNoPeriod"),
      };
    }
    const fp = await sp(ctx.workspaceRoot, rel);
    const old = await fs.readFile(fp, "utf8").catch(() => null);
    if (old === null) {
      return {
        ok: false,
        reason: "missing",
        path: rel,
        packing: stream.packing,
        message: i18n("pathOps.reconcilePeriodMissing", { path: rel }),
      };
    }
    const { data, body } = splitMarkdownFrontmatter(old);
    let reconciled;
    if (typeof wm.reconcilePeriodBody === "function") {
      reconciled = wm.reconcilePeriodBody(body || "", { packing: stream.packing });
    } else {
      const { pathToFileURL } = await import("node:url");
      const { getEngineRoot } = await import("./workspace-home.mjs");
      const { defaultEngineCandidate } = await import("./engine-root.mjs");
      const engineRoot = getEngineRoot() || defaultEngineCandidate();
      const periodMod = await import(
        pathToFileURL(path.join(engineRoot, "lib", "stream-period.mjs")).href
      );
      reconciled = periodMod.reconcilePeriodBody(body || "", { packing: stream.packing });
    }

    const stamp = now();
    const shouldWrite = apply === true || (apply !== false && dryRun !== true);
    const nextContent = injectFrontmatter(reconciled.body, {
      ...data,
      type: data?.type || "stream-period",
      stream_packing: stream.packing,
      updated_at: stamp,
      ...(shouldWrite && reconciled.changed ? { reconciled_at: stamp } : {}),
    });

    let evidence = null;
    if (shouldWrite && reconciled.changed) {
      evidence = await kernelDurableWrite(
        { relativePath: rel, content: nextContent },
        ctx,
        {
          actor: "user",
          confirmed: true,
          operation: "update",
        },
      );
      if (!evidence.pending && !evidence.needsConfirm) {
        bumpWorkspaceIndex(rel);
      }
    }

    return {
      ok: true,
      path: rel,
      packing: stream.packing,
      changed: Boolean(reconciled.changed),
      changes: reconciled.changes || [],
      candidates: reconciled.candidates || { core: [], topics: [] },
      dryRun: !shouldWrite,
      applied: Boolean(shouldWrite && reconciled.changed && evidence && !evidence.pending),
      ...(shouldWrite && reconciled.changed && evidence
        ? asDesktopEvidence({ ...evidence, operation: "reconcile-stream" }, rel)
        : {}),
      userMessage: reconciled.changed
        ? shouldWrite
          ? i18n("pathOps.reconcileApplied", { count: (reconciled.changes || []).length })
          : i18n("pathOps.reconcilePreview", { count: (reconciled.changes || []).length })
        : i18n("pathOps.reconcileClean"),
    };
  },
};

// re-export helpers used by sibling modules that need listDir of topic files
export { lf, sp, S, T, now };
