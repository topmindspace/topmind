/**
 * List / search / health scan ops — no Electron dependency.
 */
import path from "node:path";
import {
  resolveDataRoot, inboxRoot, archiveRoot, outputsRoot, categoryRoot,
  parseTopicId, buildTopicId, CATEGORY_PATTERN,
} from "./path-model.mjs";
import { exists, readText, listDir, statSafe, readTextPreview } from "./fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./frontmatter.mjs";
import { S, T, sp, lf, resolveCategoryRoles } from "./workspace-helpers.mjs";
import { getNotesIndex } from "./notes-index.mjs";
import {
  listTopicFilesEnhanced,
  listOutputsEnhanced,
  listWorkspaceDir,
} from "./workspace-list-ops.mjs";
import { normalizeFileFilterMode } from "./file-filter.mjs";

/** Light frontmatter title peek for list UIs (not a content store). */
async function peekMdTitle(absPath) {
  if (!/\.md$/iu.test(absPath)) return null;
  try {
    const head = await readTextPreview(absPath, 4096);
    const { data } = splitMarkdownFrontmatter(head);
    const t = data?.title != null ? String(data.title).trim() : "";
    return t || null;
  } catch {
    return null;
  }
}

/** Common binary extensions — used as a cheap hint for agent list/stat. */
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
  ".mp3", ".wav", ".m4a", ".ogg", ".flac",
  ".mp4", ".mov", ".webm", ".mkv", ".avi",
  ".ttf", ".otf", ".woff", ".woff2",
  ".exe", ".dll", ".so", ".dylib", ".bin",
]);

function binaryHint(name) {
  const ext = String(name || "").includes(".")
    ? `.${String(name).split(".").pop().toLowerCase()}`
    : "";
  return { ext: ext || undefined, isBinaryExt: BINARY_EXT.has(ext) };
}

export const scanOps = {
  async listCategories(_p, ctx) {
    const root = resolveDataRoot(ctx.workspaceRoot);
    try {
      const { resolveWorkspaceModel } = await import("./workspace-model-api.mjs");
      const model = await resolveWorkspaceModel(root);
      const includeHidden = _p?.includeHidden === true;
      const categories = model.categories
        .filter((c) => c.ok)
        .filter((c) => includeHidden || !c.hidden)
        .map((c) => ({
          name: c.directory,
          directory: c.directory,
          slot: c.slot,
          role: c.role || "deep-work",
          specialBehavior: c.specialBehavior,
          catchAll: c.catchAll,
          referenceOnly: c.referenceOnly,
          required: c.required,
          hidden: c.hidden || false,
          source: c.source,
        }));
      return {
        categories,
        rootPath: root,
        templateId: model.templateId,
        separator: model.separator,
      };
    } catch {
      const entries = await listDir(root);
      const roleMap = await resolveCategoryRoles(ctx.workspaceRoot);
      const categories = [];
      for (const e of entries) {
        if (!CATEGORY_PATTERN.test(e)) continue;
        const s = await statSafe(path.join(root, e));
        if (s?.isDirectory()) {
          const def = roleMap.get(e) || {};
          categories.push({
            name: e,
            directory: e,
            slot: def.slot || e.slice(0, 2),
            role: def.role || "deep-work",
            specialBehavior: def.specialBehavior,
            source: def.source || "fs-only",
          });
        }
      }
      return { categories, rootPath: root };
    }
  },

  async listTopics({ category }, ctx) {
    S(category, "category");
    const cRoot = categoryRoot(ctx.workspaceRoot, category);
    const entries = await listDir(cRoot);
    const topics = [], looseNotes = [];
    for (const e of entries) {
      const abs = path.join(cRoot, e);
      const s = await statSafe(abs);
      if (s?.isDirectory()) {
        const subEntries = await listDir(abs);
        let fileCount = 0;
        for (const sub of subEntries) {
          const subStat = await statSafe(path.join(abs, sub));
          if (subStat?.isFile()) fileCount++;
        }
        topics.push({
          id: buildTopicId(category, e),
          name: e,
          fileCount,
          files: [],
          mtime: s.mtime.toISOString(),
        });
      } else if (s?.isFile()) {
        looseNotes.push({
          name: e,
          relativePath: `${category}/${e}`,
          mtime: s.mtime.toISOString(),
        });
      }
    }
    return { category, topics, looseNotes };
  },

  /**
   * List topic directory (files + subdirs). Supports nested `subPath`.
   * `filter`: default | markdown | all (from settings.ui.fileFilter).
   */
  async listTopicFiles({ topicId, subPath = "", filter }, ctx) {
    T(topicId);
    const mode = normalizeFileFilterMode(filter ?? ctx?.fileFilterMode ?? "default");
    return listTopicFilesEnhanced({ topicId, subPath, filter: mode }, ctx);
  },

  /** List any workspace-relative directory (one level). */
  async listWorkspaceDir({ relativePath, filter }, ctx) {
    S(relativePath, "relativePath");
    const mode = normalizeFileFilterMode(filter ?? ctx?.fileFilterMode ?? "default");
    return listWorkspaceDir({ relativePath, filter: mode }, ctx);
  },

  async getTopic({ topicId }, ctx) {
    T(topicId);
    const { category, topic } = parseTopicId(topicId);
    const dir = await sp(ctx.workspaceRoot, `${category}/${topic}`);
    if (!(await exists(dir))) throw new Error(`专题不存在: ${topicId}`);
    const raw = await lf(dir);
    const files = [];
    for (const f of raw) {
      const abs = path.join(dir, f.name);
      const title = await peekMdTitle(abs);
      files.push({ ...f, title });
    }
    return { topicId, topicName: topic, files, category };
  },

  /**
   * Outputs listing. Default recursiveFlat for main view; tree uses entries.
   * @param {{ subPath?: string, filter?: string, recursiveFlat?: boolean, limit?: number }} p
   */
  async listOutputs(p = {}, ctx) {
    const mode = normalizeFileFilterMode(p.filter ?? ctx?.fileFilterMode ?? "default");
    // Main OutputsView wants full recursive file list; tree uses recursiveFlat:false
    const recursiveFlat = p.recursiveFlat !== false && !p.subPath;
    return listOutputsEnhanced(
      {
        subPath: p.subPath || "",
        filter: mode,
        recursiveFlat,
        limit: p.limit || 500,
      },
      ctx,
    );
  },

  /**
   * Cached metadata walk for Timeline/Tags/Kanban.
   * Uses notes-index; force=true bypasses TTL.
   */
  async listAllNotes({ limit = 500, force = false }, ctx) {
    return getNotesIndex(ctx.workspaceRoot, { limit, force });
  },

  /**
   * Keyword search (compat). Defaults: skip system archive, cap 40 hits.
   * Prefer line-level grepWorkspace for agent tooling.
   */
  async search({ query, scope, maxResults = 40, includeArchive = false }, ctx) {
    return scanOps.grepWorkspace({
      pattern: query,
      scope,
      maxResults,
      includeArchive,
      regex: false,
      context: 0,
    }, ctx);
  },

  /**
   * Controlled read-only grep over workspace text files.
   * - No shell / no external process
   * - Default skip role:system archive tree
   * - Optional scope: category or topic path prefix
   * - Keyword (default) or simple regex (size-capped, no flags abuse)
   */
  async grepWorkspace({
    pattern,
    scope = "",
    maxResults = 40,
    includeArchive = false,
    regex = false,
    context = 0,
    caseSensitive = false,
  }, ctx) {
    S(pattern, "pattern", { maxLen: 200 });
    const root = resolveDataRoot(ctx.workspaceRoot);
    const archName = path.basename(archiveRoot(ctx.workspaceRoot));
    const maxHits = Math.max(1, Math.min(80, Math.floor(Number(maxResults)) || 40));
    const ctxLines = Math.max(0, Math.min(2, Math.floor(Number(context)) || 0));

    let scopeRel = typeof scope === "string" ? scope.trim().replace(/^\/+|\/+$/gu, "") : "";
    if (scopeRel.includes("..")) throw new Error("scope 不可包含 ..");
    // Normalize accidental leading workspace name
    if (scopeRel.startsWith(archName) && !includeArchive) {
      return { results: [], count: 0, note: "scope 指向 Archive 且默认排除；设 includeArchive 才可搜" };
    }

    /** @type {RegExp|null} */
    let re = null;
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    if (regex) {
      try {
        // Cap complexity: no multi-line, length already limited
        re = new RegExp(pattern, caseSensitive ? "u" : "iu");
      } catch (err) {
        throw new Error(`无效正则: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const results = [];
    let filesScanned = 0;
    let truncated = false;

    const walk = async (dir) => {
      if (results.length >= maxHits) {
        truncated = true;
        return;
      }
      let entries;
      try { entries = await listDir(dir); } catch { return; }
      for (const e of entries) {
        if (results.length >= maxHits) {
          truncated = true;
          return;
        }
        if (e.startsWith(".")) continue;
        const f = path.join(dir, e);
        const s = await statSafe(f);
        if (s?.isDirectory()) {
          if (!includeArchive && e === archName && dir === root) continue;
          // Skip common noise dirs
          if (e === "node_modules" || e === ".git" || e === ".obsidian") continue;
          await walk(f);
        } else if (/\.(md|markdown|mdx|txt)$/iu.test(e)) {
          const rel = path.relative(root, f).replace(/\\/gu, "/");
          if (scopeRel && !(rel === scopeRel || rel.startsWith(`${scopeRel}/`))) continue;

          filesScanned += 1;
          let content;
          try {
            content = await readText(f);
          } catch {
            continue;
          }
          // Skip huge files for agent grep (protect memory)
          if (content.length > 800_000) continue;

          const lines = content.split(/\r?\n/u);
          const nameHay = caseSensitive ? `${rel}\n${e}` : `${rel}\n${e}`.toLowerCase();
          let nameHit = false;
          if (re) {
            nameHit = re.test(nameHay);
            re.lastIndex = 0;
          } else {
            nameHit = nameHay.includes(needle);
          }

          let lineHits = 0;
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxHits) {
              truncated = true;
              break;
            }
            const line = lines[i];
            let hit = false;
            if (re) {
              hit = re.test(line);
              re.lastIndex = 0;
            } else {
              hit = (caseSensitive ? line : line.toLowerCase()).includes(needle);
            }
            if (!hit) continue;

            lineHits += 1;
            const lineNo = i + 1;
            let preview = line.trim().slice(0, 200);
            if (ctxLines > 0) {
              const from = Math.max(0, i - ctxLines);
              const to = Math.min(lines.length, i + ctxLines + 1);
              preview = lines.slice(from, to).map((l, idx) => {
                const n = from + idx + 1;
                const mark = n === lineNo ? ">" : " ";
                return `${mark}${n}|${l.slice(0, 160)}`;
              }).join("\n");
            }
            results.push({
              relativePath: rel,
              line: lineNo,
              preview,
              nameMatch: false,
            });
          }

          // Filename-only match with no line hit: still surface once
          if (nameHit && lineHits === 0 && results.length < maxHits) {
            results.push({
              relativePath: rel,
              line: 1,
              preview: lines[0]?.slice(0, 150) || "(filename match)",
              nameMatch: true,
            });
          }
        }
      }
    };

    const startDir = scopeRel
      ? path.join(root, ...scopeRel.split("/"))
      : root;
    if (scopeRel) {
      const st = await statSafe(startDir);
      if (!st) {
        return { results: [], count: 0, filesScanned: 0, note: `scope 不存在: ${scopeRel}` };
      }
    }
    await walk(startDir).catch(() => {});

    return {
      results,
      count: results.length,
      filesScanned,
      truncated,
      scope: scopeRel || null,
      includeArchive: Boolean(includeArchive),
      note: truncated
        ? `已截断至 ${maxHits} 条；可缩小 scope 或换更具体关键词`
        : results.length === 0
          ? "无匹配"
          : `命中 ${results.length} 处`,
    };
  },

  async workspaceHealth(_p, ctx) {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const issues = [];
    const checks = {};

    const ensureDir = async (label, abs) => {
      const ok = await exists(abs);
      checks[label] = { ok, path: abs };
      if (!ok) {
        issues.push({
          severity: "error",
          code: `missing-${label}`,
          message: `缺少 ${label} 目录`,
          path: abs,
        });
      }
      return ok;
    };

    await ensureDir("inbox", inboxRoot(ctx.workspaceRoot));
    await ensureDir("outputs", outputsRoot(ctx.workspaceRoot));
    await ensureDir("archive", archiveRoot(ctx.workspaceRoot));

    // Contract health — single Kernel inspect (same source as UTR/Obsidian).
    try {
      const { kernelInspectContract } = await import("./kernel-api.mjs");
      const inspection = await kernelInspectContract(ctx.workspaceRoot);
      checks.contract = {
        ok: inspection?.status === "ok" || inspection?.ok === true,
        status: inspection?.status || (inspection?.ok ? "ok" : "unknown"),
      };
      const cStatus = checks.contract.status;
      if (cStatus !== "ok") {
        issues.push({
          severity: cStatus === "corrupt" || cStatus === "unrepairable" ? "error" : "warning",
          code: `contract-${cStatus}`,
          message: `工作区契约状态：${cStatus}`,
          path: "topmind.yaml",
        });
      }
    } catch (err) {
      checks.contract = { ok: false, status: "unavailable", error: err?.message || String(err) };
      issues.push({
        severity: "warning",
        code: "contract-unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    let categoryCount = 0;
    let topicCount = 0;
    let looseNoteCount = 0;
    let inboxCount = 0;
    let outputsCount = 0;
    try {
      const entries = await listDir(root);
      const roleMap = await resolveCategoryRoles(ctx.workspaceRoot);
      for (const e of entries) {
        if (!CATEGORY_PATTERN.test(e)) continue;
        const abs = path.join(root, e);
        const s = await statSafe(abs);
        if (!s?.isDirectory()) continue;
        categoryCount += 1;
        const role = (roleMap.get(e) || {}).role;
        if (role === "buffer" || role === "delivery" || role === "system") continue;
        for (const sub of await listDir(abs)) {
          const subStat = await statSafe(path.join(abs, sub));
          if (subStat?.isDirectory()) topicCount += 1;
          else if (subStat?.isFile() && /\.md$/iu.test(sub)) looseNoteCount += 1;
        }
      }
      // Light inbox / outputs counts for loop routing (no deep archive walk)
      const inboxDir = inboxRoot(ctx.workspaceRoot);
      if (await exists(inboxDir)) {
        for (const e of await listDir(inboxDir)) {
          if (e.startsWith(".")) continue;
          const st = await statSafe(path.join(inboxDir, e));
          if (st?.isFile() && /\.md$/iu.test(e)) inboxCount += 1;
        }
      }
      const outDir = outputsRoot(ctx.workspaceRoot);
      if (await exists(outDir)) {
        for (const e of await listDir(outDir)) {
          if (e.startsWith(".")) continue;
          const st = await statSafe(path.join(outDir, e));
          if (st?.isFile()) outputsCount += 1;
        }
      }
      if (inboxCount >= 8) {
        issues.push({
          severity: "info",
          code: "inbox-backlog",
          message: `Inbox 有 ${inboxCount} 条待整理，建议 organize`,
          path: path.basename(inboxDir),
        });
      }

      // Out-of-convention top-level entries
      for (const e of entries) {
        if (e.startsWith(".")) continue;
        if (e === "topmind.yaml" || e === "topmind.yml") continue;
        if (e === "memory") continue;
        if (CATEGORY_PATTERN.test(e)) continue;
        issues.push({
          severity: "warning",
          code: "out-of-convention",
          message: `工作区根存在规约外条目：${e}`,
          path: e,
        });
      }
    } catch (err) {
      issues.push({
        severity: "error",
        code: "scan-failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (await exists(path.join(root, ".DS_Store"))) {
      issues.push({
        severity: "warning",
        code: "workspace-junk-ds-store",
        message: "工作区根存在 .DS_Store，可安全删除",
        path: path.join(root, ".DS_Store"),
      });
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    return {
      ok: errorCount === 0,
      source: "desktop-native",
      summary: {
        categoryCount,
        topicCount,
        looseNoteCount,
        inboxCount,
        outputsCount,
        errorCount,
        warningCount: issues.filter((i) => i.severity === "warning").length,
      },
      checks,
      issues,
    };
  },

  async workspaceStats(p, ctx) {
    const { collectWorkspaceStats } = await import("./workspace-stats.mjs");
    return collectWorkspaceStats(resolveDataRoot(ctx.workspaceRoot), {
      includeArchive: p?.includeArchive !== false,
    });
  },

  async workspaceDuplicates(p, ctx) {
    const { findDuplicateFiles } = await import("./workspace-duplicates.mjs");
    return findDuplicateFiles(resolveDataRoot(ctx.workspaceRoot), p || {});
  },

  async cleanupPreview(_p, ctx) {
    const { scanCleanupCandidates } = await import("./workspace-cleanup.mjs");
    return scanCleanupCandidates(resolveDataRoot(ctx.workspaceRoot));
  },

  async cleanupApply(p, ctx) {
    const { applyCleanup } = await import("./workspace-cleanup.mjs");
    return applyCleanup(
      { ...p, workspaceRoot: resolveDataRoot(ctx.workspaceRoot) },
      ctx,
    );
  },

  /**
   * Agent-facing directory listing (all planes: content, memory/, .topmind/).
   * Returns name / type / size / mtime — not the UI tree filter.
   * @param {{ relativePath?: string, includeSystem?: boolean }} p
   */

  async listFiles(p, ctx) {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const rel = String(p?.relativePath || "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
    const abs = rel ? path.join(root, rel) : root;
    if (!(await exists(abs))) {
      return { ok: false, relativePath: rel, error: "not-found", entries: [] };
    }
    const st = await statSafe(abs);
    if (!st?.isDirectory()) {
      return { ok: false, relativePath: rel, error: "not-a-directory", entries: [] };
    }
    const includeSystem = p?.includeSystem === true;
    const names = await listDir(abs).catch(() => []);
    /** @type {Array<object>} */
    const entries = [];
    for (const name of names) {
      if (!includeSystem && (name === ".git" || name === "node_modules" || name === ".obsidian" || name === ".DS_Store")) {
        continue;
      }
      if (!includeSystem && name.startsWith(".") && name !== ".topmind") continue;
      const childAbs = path.join(abs, name);
      const cs = await statSafe(childAbs);
      if (!cs) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const hint = binaryHint(name);
      entries.push({
        name,
        type: cs.isDirectory() ? "dir" : "file",
        size: cs.isDirectory() ? 0 : cs.size,
        mtime: cs.mtime.toISOString(),
        relativePath: childRel,
        ...(cs.isDirectory() ? {} : hint),
      });
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { ok: true, relativePath: rel, entries, count: entries.length };
  },

  /**
   * Glob file search across the workspace (fenced walk, no shell).
   * Default skips 99-归档/Archive + junk dirs. Readable across all planes.
   * @param {{ pattern: string, scope?: string, maxResults?: number, includeArchive?: boolean }} p
   */
  async globFiles(p, ctx) {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const pattern = String(p?.pattern || "").trim();
    if (!pattern) return { ok: false, error: "pattern-required", matches: [] };
    const scope = String(p?.scope || "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
    const maxResults = Math.max(1, Math.min(500, Number(p?.maxResults) || 100));
    const includeArchive = p?.includeArchive === true;
    const re = globToRegExp(pattern);
    const start = scope ? path.join(root, scope) : root;
    if (!(await exists(start))) {
      return { ok: false, error: "scope-not-found", scope, matches: [] };
    }
    /** @type {Array<object>} */
    const matches = [];
    const skipDir = new Set([".git", "node_modules", ".obsidian", ".trash"]);
    /** @param {string} dir */
    const walk = async (dir) => {
      if (matches.length >= maxResults) return;
      const names = await listDir(dir).catch(() => []);
      for (const name of names) {
        if (matches.length >= maxResults) break;
        const abs = path.join(dir, name);
        const st = await statSafe(abs);
        if (!st) continue;
        const rel = path.relative(root, abs).replace(/\\/gu, "/");
        if (st.isDirectory()) {
          if (skipDir.has(name)) continue;
          if (!includeArchive && /(^|\/)99[ -]/u.test(rel)) continue;
          if (name === ".topmind") continue; // system plane — list explicitly via list_files
          await walk(abs);
          continue;
        }
        if (!st.isFile()) continue;
        if (!includeArchive && /(^|\/)99[ -]/u.test(rel)) continue;
        const scopedRel = scope ? rel.slice(scope.length + 1) || name : rel;
        if (re.test(rel) || re.test(scopedRel) || re.test(name)) {
          matches.push({
            name,
            relativePath: rel,
            size: st.size,
            mtime: st.mtime.toISOString(),
            ...binaryHint(name),
          });
        }
      }
    };
    await walk(start);
    return {
      ok: true,
      pattern,
      scope,
      matches,
      count: matches.length,
      truncated: matches.length >= maxResults,
    };
  },

  /**
   * Stat a single workspace path (type / size / mtime).
   * @param {{ relativePath: string }} p
   */
  async statPath(p, ctx) {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const rel = String(p?.relativePath || "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
    if (!rel) return { ok: false, error: "path-required" };
    const abs = path.join(root, rel);
    const st = await statSafe(abs);
    if (!st) return { ok: false, relativePath: rel, error: "not-found" };
    const hint = st.isFile() ? binaryHint(path.basename(rel)) : {};
    return {
      ok: true,
      relativePath: rel,
      type: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other",
      size: st.isDirectory() ? 0 : st.size,
      mtime: st.mtime.toISOString(),
      birthtime: st.birthtime.toISOString(),
      ...hint,
    };
  },
};

/** Convert a simple glob (`*` `**` `?`) to RegExp against posix-relative paths. */
function globToRegExp(pattern) {
  let p = String(pattern || "").replace(/\\/gu, "/");
  const basenameOnly = !p.includes("/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+.^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  const flags = "u";
  return basenameOnly
    ? new RegExp(`(?:^|/)${re}$`, flags)
    : new RegExp(`^${re}$`, flags);
}
