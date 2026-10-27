/**
 * Desktop-native AI tool set (full agent surface).
 *
 * Product boundary: map to WorkspaceService — never require UTR, never spawn
 * extra Electron windows/processes. All I/O stays in the main process.
 *
 * Write tools respect writebackMode (graded confirm, 2026-09-17c):
 * - auto → write tools execute immediately (subject to protection)
 * - confirm（删除/归档前问我）→ content create/update/edit land immediately;
 *   only delete/archive return pending → stash → AiPanel accept/reject
 */
import { jsonSchema, tool } from "ai";
import path from "node:path";
import fs from "node:fs";
import { WorkspaceService } from "./workspace-service.mjs";
import { logError } from "./lib/writeback.mjs";
import { createBatchCollector } from "./lib/batch-evidence.mjs";
import { normalizeWriteResult } from "./lib/ai-tool-evidence.mjs";
import { resolveDataRoot } from "./lib/path-model.mjs";
import { buildAgentToolCatalog, AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "./lib/ai-tool-names.mjs";
import { digestToolResult } from "./lib/tool-result-digest.mjs";
import { resolvePromptLocale } from "./ai-prompts.mjs";
import { allowsJsonWriteBody } from "./lib/pi-fenced-fs.mjs";
import { loadKernelApi } from "./lib/kernel-api.mjs";

// Re-export for backward compatibility (existing imports from ai-tools.mjs)
export { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE };

function summarizeForModel(value, max = 6000) {
  try {
    return digestToolResult(value, { maxChars: max });
  } catch {
    /* fall through to simple clamp */
  }
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value, null, 0);
    if (s.length <= max) return value;
    if (typeof value === "string") return `${s.slice(0, max)}…(truncated)`;
    return { truncated: true, preview: s.slice(0, max) };
  } catch {
    return value;
  }
}

/**
 * @param {object} ctx RPC context (workspaceRoot, appSettings, …)
 * @returns {Promise<Record<string, unknown>>} AI SDK ToolSet
 */
export async function buildDesktopAiTools(ctx) {
  try {
    // Workspace topmind.yaml is truth; per-call explicit only (never app-settings fork)
    const { resolveWorkspaceWritebackMode } = await import("./lib/kernel-api.mjs");
    const writebackMode = await resolveWorkspaceWritebackMode(ctx, {
      writebackMode: ctx.explicitWritebackMode,
    });
    // Always expose write tools; confirm mode requires confirmed:true via write gate pending
    const allowWrite = true;
    const needsUserConfirm = writebackMode === "confirm";
    const batch = createBatchCollector(writebackMode);
    // Expose collector so AiService can return batch summary after stream.
    ctx._batchCollector = batch;
    const tools = {};

    /** Per-turn read cache — avoids re-reading the same file/search within a single agent loop.
     *  Invalidated on any write (edit/save/delete/move) to prevent stale reads. */
    const readCache = new Map();
    const makeCacheKey = (toolName, args) => `${toolName}:${JSON.stringify(args ?? {})}`;

    /** Wrap a read-only tool with session-level caching. */
    const wrapRead = (fn) => async (args) => {
      const key = makeCacheKey(fn.name || "anon", args);
      if (readCache.has(key)) return readCache.get(key);
      const result = await fn(args);
      // Only cache successful non-error results under 20KB to avoid memory bloat
      if (result && !result.error) {
        try {
          const size = typeof result === "string" ? result.length : JSON.stringify(result).length;
          if (size < 20000) readCache.set(key, result);
        } catch { /* skip uncacheable */ }
      }
      return result;
    };

    /**
     * AI write opts — graded-confirm leniency (2026-09-22):
     * Content create/update/edit always `confirmed: true` (they land immediately
     * under graded confirm; forcing false only invites accidental pending).
     * Lifecycle (delete/archive/rename) stays `confirmed: false` when
     * writebackMode=confirm so the gate can stash for user accept.
     */
    const LIFECYCLE_TOOLS = new Set(["delete_path", "rename_path"]);
    /** Destructive memory maintenance — never auto-confirm from the tool layer. */
    const CONFIRM_REQUIRED_TOOLS = new Set(["compact_core_memory_history"]);
    const aiWriteOpts = (toolName) => ({
      actor: "ai",
      confirmed: CONFIRM_REQUIRED_TOOLS.has(toolName)
        ? false
        : LIFECYCLE_TOOLS.has(toolName)
          ? !needsUserConfirm
          : true,
    });

    /** Body-payload tools: sanitize thinking/JSON dumps before Kernel writeback. */
    const BODY_SANITIZE_TOOLS = new Set([
      "save_file", "save_note", "edit_file", "capture_to_inbox",
      "append_topic_memory", "append_core_memory", "update_core_memory",
    ]);
    /** Loaded via kernel-api (pack-safe — never static-import monorepo ../../lib). */
    const kernelApi = await loadKernelApi();
    const sanitizeAiWriteBody = kernelApi.sanitizeAiWriteBody;

    /**
     * Strip thinking/meta and block JSON/thinking dumps on write payloads.
     * Covers content/newText/entry so memory append/update cannot land dumps.
     */
    const sanitizeWriteArgs = (toolName, args) => {
      if (!BODY_SANITIZE_TOOLS.has(toolName) || typeof sanitizeAiWriteBody !== "function") return null;
      const pathHint = String(args?.relativePath || args?.topicId || args?.filename || "");
      const allowJson = allowsJsonWriteBody(pathHint) || allowsJsonWriteBody(String(args?.filename || ""));
      const blocked = (reason) => ({
        ok: false,
        tool: toolName,
        operation: toolName,
        error: `write-blocked:${reason}`,
        note: promptLocale === "en"
          ? "Write blocked: payload looked like AI thinking/JSON dump. Reply with the real body only."
          : "写入已拦截：正文像 AI 思考过程/JSON dump。请只输出正文再写入。",
      });
      for (const field of ["newText", "content", "entry"]) {
        if (args?.[field] == null) continue;
        const r = sanitizeAiWriteBody(args[field], { allowJson });
        if (!r.ok) return blocked(r.reason);
        if (r.text !== args[field]) args[field] = r.text;
      }
      return null;
    };

    const promptLocale = resolvePromptLocale(ctx.appSettings?.ui?.locale);
    const catalog = buildAgentToolCatalog({ host: "desktop", locale: promptLocale });
    const sharedTool = (name) => ({ description: catalog[name].description, inputSchema: jsonSchema(catalog[name].inputSchema) });
    /** Tool catalog language follows host UI locale (same as system prompt). */
    const writeCopy = promptLocale === "en"
      ? {
          pendingStashed: "Ask before delete/archive: the op is pending. Accept or reject it in the AI workspace Suggest pane.",
          pendingNoBody: "Ask before delete/archive: confirmation required, but the body was not cached (retry with save_file).",
          pendingDelete: "Ask before delete/archive: file deletion requires user confirmation; deletion was blocked.",
          writeFailed: "Write failed; adjust parameters and retry.",
        }
      : {
          pendingStashed: "删除/归档前问我：操作已挂起，请在 AI 工作区建议 pane 中接受或拒绝",
          pendingNoBody: "删除/归档前问我：需确认，但未能缓存正文（请重试 save_file 全量写入）",
          pendingDelete: "删除/归档前问我：删除操作已拦截，需用户确认或手动操作",
          writeFailed: "写入失败；可调整参数后重试",
        };

    /**
     * Memory-plane fence: generic file tools must not raw-rewrite
     * memory/profile|periodic|topics|todo. Pure rules live in
     * Kernel `agent-tool-policy.mjs` (checked against every path arg, ledgers/ allowed).
     */
    const memoryFence = (toolName, args) => kernelApi.memoryFence(toolName, args, {
      workspaceRoot: typeof ctx.workspaceRoot === "string" ? ctx.workspaceRoot : ctx.workspaceRoot?.userWorkspaceRoot,
      blocked: promptLocale === "en"
        ? "memory/ is gated (except memory/ledgers/). Use append_core_memory / update_core_memory / retire_core_memory / append_topic_memory / add_todo / toggle_todo instead of generic file writes."
        : "memory/ 受保护（memory/ledgers/ 除外）。请使用 append_core_memory / update_core_memory / retire_core_memory / append_topic_memory / add_todo / toggle_todo，不要用通用写文件工具改记忆平面。",
    });

    const wrapWrite = (toolName, fn) => async (args) => {
      // Invalidate read cache on any write — prevents stale reads after edit/save
      readCache.clear();
      const fence = memoryFence(toolName, args);
      if (fence) return fence;
      const blocked = sanitizeWriteArgs(toolName, args);
      if (blocked) return blocked;
      try {
        const raw = await fn({ ...args, ...aiWriteOpts(toolName) });
        const result = normalizeWriteResult(toolName, raw);
        // Content writes land immediately (graded confirm). Notify renderer so
        // open editors / stream / tree refresh immediately, with AI attribution.
        if (result?.ok && !result.pending && !result.needsConfirm && !result.error) {
          const changed =
            result.targetPath ||
            result.path ||
            args.relativePath ||
            raw?.targetPath ||
            (toolName === "append_topic_memory" && args.topicId
              ? `${String(args.topicId).replace(/\\/g, "/")}/topic.md`
              : null) ||
            (toolName === "add_todo" || toolName === "toggle_todo" || toolName === "update_todo" || toolName === "set_todo_due" || toolName === "delete_todo"
              ? raw?.targetPath || "memory/todo.md"
              : null) ||
            (toolName === "append_stream_entry"
              ? raw?.targetPath || args.relativePath
              : null);
          try {
            ctx.emit?.("workspace:file-changed", {
              relativePath: changed || undefined,
              source: `ai:${toolName}`,
            });
          } catch { /* emit is best-effort */ }
        }
        if (raw?.needsConfirm || raw?.pending) {
          result.needsConfirm = true;
          result.pending = true;
          result.ok = false;
          let rel =
            args.relativePath ||
            raw.targetPath ||
            raw.path ||
            (args.topicId && args.filename
              ? `${String(args.topicId).replace(/\\/g, "/")}/${args.filename}`
              : null);
          // Prefer full body from gate (append_*/save_file set previewContent on pending)
          let content =
            (typeof raw.previewContent === "string" && raw.previewContent) ||
            (typeof args.content === "string" && args.content) ||
            "";
          // edit_file: materialize full next body so accept can savePath
          if (!content && args.oldText != null && args.newText != null && rel) {
            try {
              const current = await WorkspaceService.readPath({ relativePath: rel }, ctx);
              const text = String(current || "");
              const { loadKernelApi } = await import("./lib/kernel-api.mjs");
              const kernel = await loadKernelApi();
              const applied = kernel.applyUniqueSpan(text, {
                oldText: args.oldText,
                newText: args.newText,
                replaceAll: Boolean(args.replaceAll),
                startLine: args.startLine,
                endLine: args.endLine,
                heading: args.heading,
                path: rel,
              });
              if (applied.ok) content = applied.next;
            } catch {
              /* leave empty */
            }
          }
          // append_core_memory without path: use profile path from result
          if (!rel && toolName === "append_core_memory" && raw.targetPath) {
            rel = String(raw.targetPath);
          }
          if (!rel && toolName === "append_topic_memory" && args.topicId) {
            rel = `${String(args.topicId).replace(/\\/g, "/")}/topic.md`;
          }
          if (rel && (content || toolName === "delete_path")) {
            try {
              const { stashPendingWrite } = await import("./lib/pending-writes.mjs");
              const stashed = await stashPendingWrite({
                relativePath: rel,
                content,
                toolName,
                workspaceRoot: ctx.workspaceRoot,
              });
              result.pendingId = stashed.id;
            } catch (stashErr) {
              // Never claim pending without an id — the UI cannot accept/reject
              // a body that was never stored.
              result.ok = false;
              result.note = `pending stash failed: ${stashErr instanceof Error ? stashErr.message : String(stashErr)}`;
              return result;
            }
          }
          result.note =
            result.note ||
            (toolName === "delete_path"
              ? writeCopy.pendingDelete
              : (result.pendingId ? writeCopy.pendingStashed : writeCopy.pendingNoBody));
          result.previewContent = content || raw.previewContent;
          result.relativePath = rel;
        }
        batch.record(toolName, result);
        return result;
      } catch (err) {
        const message = err?.message || String(err);
        logError("ai-tools", `write tool ${toolName} failed`, { error: message });
        let hint = undefined;
        try {
          const { buildRetryHint } = await import("./lib/tool-retry-hints.mjs");
          hint = buildRetryHint(toolName, message, {
            relativePath: args?.relativePath,
            args,
            locale: promptLocale,
          });
        } catch { /* hint is best-effort */ }
        if (!hint && toolName === "edit_file") {
          const isNoMatch = message.includes("未能找到") || message.includes("no-match") || message.includes("not found");
          const isAmbiguous = message.includes("多处") || message.includes("ambiguous");
          const isHashStale = message.includes("expectedHash") || message.includes("hashMismatch") || message.includes("已被修改");
          if (isHashStale) {
            hint = promptLocale === "en"
              ? `Edit refused: file changed since your last read. Call read_file({ relativePath: "${args?.relativePath || ""}", around: "keyword", limit: 80 }) to refresh contentHash and oldText, then retry edit_file with the new contentHash.`
              : `编辑被拒绝：文件在你上次读取后已被修改。请先调用 read_file({ relativePath: "${args?.relativePath || ""}", around: "关键词", limit: 80 }) 刷新 contentHash 与 oldText，再用新的 contentHash 重试 edit_file。`;
          } else if (isNoMatch) {
            hint = promptLocale === "en"
              ? `Edit failed: oldText was not found in the file. First call read_file({ relativePath: "${args?.relativePath || ""}", around: "keyword", offset: 1, limit: 100 }) to read the exact text and line numbers, then retry edit_file with actual lines or specify startLine/endLine.`
              : `编辑失败：未在文件中匹配到 oldText。建议先调用 read_file({ relativePath: "${args?.relativePath || ""}", around: "关键词", offset: 1, limit: 100 }) 查看带有行号的最新真实内容，重新复制精确的 oldText（可多带前后1-2行以确保唯一），或传入 startLine/endLine 缩小范围重试。`;
          } else if (isAmbiguous) {
            hint = promptLocale === "en"
              ? `Edit failed: oldText matched multiple times in the file. Add 1-2 surrounding lines to oldText to make it unique, or specify startLine/endLine or heading, or set replaceAll: true if you want to replace all occurrences.`
              : `编辑失败：oldText 在文件中命中多处。建议在 oldText 中多包含前后 1~2 行上下文以保证唯一性，或传入 startLine/endLine 或 heading 限定范围，若确实需要全部替换可设置 replaceAll: true。`;
          }
        } else if (!hint && (toolName === "save_file" || toolName === "save_note")) {
          if (message.includes("workspace") || message.includes("outside")) {
            hint = promptLocale === "en"
              ? "Write failed: path is outside the workspace fence. Use a workspace-relative path."
              : "写入失败：路径在工作区围栏之外。请使用工作区相对路径。";
          }
        }
        return {
          ok: false,
          tool: toolName,
          operation: toolName,
          error: message,
          note: writeCopy.writeFailed,
          ...(hint ? { hint } : {}),
        };
      }
    };

    // ── Skills runtime (progressive disclosure) ──────────────────────────
    const skillsOn = ctx.appSettings?.ai?.skillsEnabled !== false;
    if (skillsOn) {
      const {
        listSkillCatalog,
        loadSkillBody,
        loadSkillResource,
        setConfiguredExtraSkillsRoots,
        resolveExtraSkillsRoots,
      } = await import("./lib/skills-runtime.mjs");
      const enabledIds = ctx.appSettings?.ai?.enabledSkillIds || null;
      const engineRoot = ctx.workspaceRoot?.engineRoot || ctx.engineRoot;
      setConfiguredExtraSkillsRoots(ctx.appSettings?.ai?.extraSkillsRoots || []);
      const extraRoots = resolveExtraSkillsRoots();

      tools.list_skills = tool({
        ...sharedTool("list_skills"),
        async execute() {
          const catalog = listSkillCatalog({ engineRoot, enabledIds, extraRoots });
          return summarizeForModel({
            skills: catalog.map((s) => ({
              id: s.id,
              actionCategory: s.actionCategory,
              entrypoint: s.entrypoint,
              description: s.description,
            })),
            count: catalog.length,
          });
        },
      });

      tools.load_skill = tool({
        ...sharedTool("load_skill"),
        async execute({ skillId }) {
          const body = loadSkillBody(skillId, { engineRoot, maxChars: 14000, extraRoots });
          return summarizeForModel({
            id: body.id,
            actionCategory: body.actionCategory,
            description: body.description,
            content: body.raw || body.body,
            truncated: body.truncated,
            hint: "按 Activation checklist / Workflow 使用工作区工具；需要 shared 时 load_skill_resource",
          }, 16000);
        },
      });

      tools.load_skill_resource = tool({
        ...sharedTool("load_skill_resource"),
        async execute({ path: rel, skillId }) {
          const res = loadSkillResource(rel, { engineRoot, maxChars: 12000, extraRoots, skillId });
          return summarizeForModel(res, 14000);
        },
      });
    }

    tools.render_article = tool({
      ...sharedTool("render_article"),
      async execute({ sourcePath, platform, theme }) {
        try {
          const { prepareArticle } = await import("./writing/article-renderer.mjs");
          const markdown = await WorkspaceService.readPath({ relativePath: sourcePath }, ctx);
          const delivery = await prepareArticle({ sourcePath, markdown, platform, theme }, async relativePath => {
            const image = await WorkspaceService.readBinary({ relativePath }, ctx);
            return `data:${image.contentType};base64,${image.base64}`;
          });
          return { ok: true, ...delivery };
        } catch (err) { return { ok: false, error: err?.message || String(err) }; }
      },
    });
    tools.list_categories = tool({
      ...sharedTool("list_categories"),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listCategories({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取工作区类别失败。" };
        }
      },
    });

    tools.workspace_overview = tool({
      ...sharedTool("workspace_overview"),
      execute: wrapRead(async function workspace_overview() {
        try {
          const [cats, inbox, outputs, streamCtx] = await Promise.all([
            WorkspaceService.listCategories({}, ctx).catch(() => ({ categories: [] })),
            WorkspaceService.listInbox({}, ctx).catch(() => ({ items: [] })),
            WorkspaceService.listOutputs({}, ctx).catch(() => ({ items: [] })),
            WorkspaceService.getStreamContext({}, ctx).catch(() => null),
          ]);
          // Count topics per category — async to avoid blocking main process
          const root = resolveDataRoot(ctx.workspaceRoot);
          const catList = await Promise.all((cats?.categories || []).map(async (c) => {
            let topicCount = 0;
            try {
              const catDir = path.join(root, c.directory);
              const stat = await fs.promises.stat(catDir);
              if (stat.isDirectory()) {
                const entries = await fs.promises.readdir(catDir, { withFileTypes: true });
                topicCount = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
              }
            } catch { /* ignore */ }
            return {
              directory: c.directory,
              role: c.role,
              specialBehavior: c.specialBehavior,
              topicCount,
            };
          }));
          const inboxItems = Array.isArray(inbox?.items) ? inbox.items : [];
          const outputItems = Array.isArray(outputs?.items) ? outputs.items : [];
          return summarizeForModel({
            categories: catList,
            inboxCount: inboxItems.length,
            inboxItems: inboxItems.slice(0, 5).map((i) => ({ name: i.name || i.filename, path: i.relativePath })),
            outputCount: outputItems.length,
            streamPeriod: streamCtx?.periodRelPath || null,
            streamPeriodTitle: streamCtx?.periodTitle || null,
            streamPacking: streamCtx?.packing || null,
          });
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取工作区全貌概览失败。" };
        }
      }),
    });

    tools.list_topics = tool({
      ...sharedTool("list_topics"),
      async execute({ category }) {
        try {
          return summarizeForModel(await WorkspaceService.listTopics({ category }, ctx));
        } catch (err) {
          return { ok: false, category, error: err?.message || String(err), hint: "无法列出专题，请使用 workspace_overview 确认类别目录是否存在。" };
        }
      },
    });

    tools.list_topic_files = tool({
      ...sharedTool("list_topic_files"),
      async execute({ topicId }) {
        try {
          return summarizeForModel(await WorkspaceService.listTopicFiles({ topicId }, ctx));
        } catch (err) {
          return { ok: false, topicId, error: err?.message || String(err), hint: "无法列出专题文件，请确认专题 ID 格式为 类别/专题名（如 20-专题/2026-主题）。" };
        }
      },
    });

    tools.get_topic = tool({
      ...sharedTool("get_topic"),
      async execute({ topicId }) {
        try {
          return summarizeForModel(await WorkspaceService.getTopic({ topicId }, ctx));
        } catch (err) {
          return { ok: false, topicId, error: err?.message || String(err), hint: "获取专题失败，请检查专题 ID 是否准确。" };
        }
      },
    });

    tools.read_file = tool({
      ...sharedTool("read_file"),
      execute: wrapRead(async function read_file({ relativePath, offset, limit, around, heading }) {
        const hasExplicitLimit = limit != null && limit !== "";
        const hasLocate = Boolean(around) || Boolean(heading);
        try {
          const win = await WorkspaceService.readPathWindow({
            relativePath,
            offset: offset ?? 1,
            limit: hasExplicitLimit ? limit : (hasLocate ? undefined : 400),
            around: around || undefined,
            heading: heading || undefined,
          }, ctx);
          const payload = {
            ...win,
            content: win.numbered || win.content,
          };
          // Prefer line-boundary trim over a mid-paragraph 14k slice.
          return summarizeForModel(payload, 48_000);
        } catch (err) {
          const msg = err?.message || String(err);
          return {
            ok: false,
            relativePath,
            error: msg,
            hint: msg.includes("ENOENT") || msg.includes("not found") || msg.includes("不存在")
              ? "文件不存在。请使用 search 搜索关键词或用 list_topics / workspace_overview 确认文件确切相对路径。"
              : "读取失败，请检查路径参数后重试。",
          };
        }
      }),
    });

    tools.list_files = tool({
      ...sharedTool("list_files"),
      execute: wrapRead(async function list_files({ relativePath, includeSystem } = {}) {
        try {
          return summarizeForModel(
            await WorkspaceService.listFiles({ relativePath: relativePath || "", includeSystem: Boolean(includeSystem) }, ctx),
            16000,
          );
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "列出目录失败，请确认路径在工作区内。" };
        }
      }),
    });

    tools.glob_files = tool({
      ...sharedTool("glob_files"),
      execute: wrapRead(async function glob_files({ pattern, scope, maxResults, includeArchive }) {
        try {
          return summarizeForModel(
            await WorkspaceService.globFiles({
              pattern,
              scope: scope || "",
              maxResults,
              includeArchive: Boolean(includeArchive),
            }, ctx),
            14000,
          );
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "glob 搜索失败，请检查 pattern（支持 * ** ?）。" };
        }
      }),
    });

    tools.stat_path = tool({
      ...sharedTool("stat_path"),
      execute: wrapRead(async function stat_path({ relativePath }) {
        try {
          return await WorkspaceService.statPath({ relativePath }, ctx);
        } catch (err) {
          return { ok: false, relativePath, error: err?.message || String(err) };
        }
      }),
    });

    tools.search = tool({
      ...sharedTool("search"),
      execute: wrapRead(async function search({ query, scope, maxResults, regex, includeArchive, context }) {
        try {
          return summarizeForModel(
            await WorkspaceService.grepWorkspace({
              pattern: query,
              scope: scope || "",
              maxResults,
              regex: Boolean(regex),
              includeArchive: Boolean(includeArchive),
              context,
            }, ctx),
            12000,
          );
        } catch (err) {
          const msg = err?.message || String(err);
          return {
            ok: false,
            query,
            error: msg,
            hint: regex
              ? "正则表达式可能非法或执行出错。建议将 regex 设为 false 使用普通纯文本关键词搜索。"
              : "搜索执行失败，请检查 scope 或 query 参数。",
          };
        }
      }),
    });

    tools.list_inbox = tool({
      ...sharedTool("list_inbox"),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listInbox({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取 Inbox 列表失败。" };
        }
      },
    });

    tools.list_outputs = tool({
      ...sharedTool("list_outputs"),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listOutputs({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取交付物列表失败。" };
        }
      },
    });

    tools.web_search = tool({
      ...sharedTool("web_search"),
      async execute({ query, limit }) {
        try {
          const { webSearch } = await import("./lib/web-search.mjs");
          return summarizeForModel(await webSearch({ query, limit }), 6000);
        } catch (err) {
          return {
            ok: false,
            error: err?.message || String(err),
            hint: "搜索失败。检查网络后重试；也可用 fetch_url 直接抓取已知页面。",
          };
        }
      },
    });

    tools.fetch_url = tool({
      ...sharedTool("fetch_url"),
      async execute({ url, maxLen, render }) {
        try {
          return summarizeForModel(
            await WorkspaceService.fetchUrl({ url, maxLen, render: Boolean(render) }, ctx),
            14000,
          );
        } catch (err) {
          const msg = err?.message || String(err);
          return {
            ok: false,
            url,
            error: msg,
            hint: "网页抓取失败。请确认 URL 为有效的 http(s) 地址，且目标网站可正常访问。若是动态渲染页面可尝试 render: true。",
          };
        }
      },
    });

    tools.capture_url = tool({
      ...sharedTool("capture_url"),
      execute: wrapWrite("capture_url", async ({ url, title, note, forceInbox, forceAtom, render, actor, confirmed }) => {
        try {
          const fetched = await WorkspaceService.fetchUrl({ url, render: Boolean(render) }, ctx);
          const body = fetched?.text || fetched?.markdown || "";
          if (!body || body.trim().length < 20) {
            return {
              ok: false,
              url,
              error: "page body empty or too short",
              hint: "抓取到的正文过短，可能被反爬或 SPA 空壳。可先 fetch_url 加 render:true 确认内容，或换来源。",
            };
          }
          const useTitle = String(title || fetched.title || "").trim();
          const prefix = note ? `${String(note).trim()}\n\n` : "";
          const header = `> 来源：${fetched.canonical || url}\n${useTitle ? `> 标题：${useTitle}\n` : ""}\n`;
          return await WorkspaceService.ingestInbox(
            {
              content: `${header}\n${prefix}${body}`.trim(),
              title: useTitle || undefined,
              source: fetched.canonical || url,
              sourceType: "web-capture",
              dest: forceInbox
                ? { mode: "inbox" }
                : { mode: "stream", forceAtom: Boolean(forceAtom) },
              actor: actor || "ai",
              confirmed,
            },
            ctx,
          );
        } catch (err) {
          return {
            ok: false,
            url,
            error: err?.message || String(err),
            hint: "抓取入库失败。确认 URL 有效且可访问；SPA 页面可设 render:true。",
          };
        }
      }),
    });

    tools.workspace_health = tool({
      ...sharedTool("workspace_health"),
      execute: wrapRead(async function workspace_health() {
        try {
          return summarizeForModel(await WorkspaceService.workspaceHealth({}, ctx), 10000);
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "工作区巡检执行失败。" };
        }
      }),
    });

    tools.list_todos = tool({
      ...sharedTool("list_todos"),
      execute: wrapRead(async function list_todos({ completed, limit } = {}) {
        try {
          return summarizeForModel(
            await WorkspaceService.listTodos({ completed: Boolean(completed), limit }, ctx),
            12000,
          );
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "读取个人待办失败。" };
        }
      }),
    });

    tools.list_recent_memories = tool({
      ...sharedTool("list_recent_memories"),
      execute: wrapRead(async function list_recent_memories({ layer, limit } = {}) {
        try {
          const max = Math.min(Math.max(Number(limit) || 12, 1), 40);
          const wanted = ["profile", "periodic", "topic"].includes(String(layer)) ? String(layer) : "all";
          const ctxInfo = await WorkspaceService.getStreamContext({}, ctx).catch(() => null);
          const memDir = ctxInfo?.memory?.dir || "memory";
          const profileRel =
            ctxInfo?.memory?.profileRelPath || `${memDir}/profile.md`;

          /** Collect .md files under a memory subdir (skip todo.md — own tool). */
          const collectMd = async (relDir, depth = 0) => {
            if (depth > 3) return [];
            const listing = await WorkspaceService.listFiles({ relativePath: relDir }, ctx).catch(() => null);
            if (!listing?.ok) return [];
            const out = [];
            for (const e of listing.entries || []) {
              const childRel = e.relativePath;
              if (e.type === "dir") {
                out.push(...(await collectMd(childRel, depth + 1)));
                continue;
              }
              const name = String(e.name || "").toLowerCase();
              if (!name.endsWith(".md") || name === "todo.md") continue;
              try {
                const markdown = await WorkspaceService.readPath({ relativePath: childRel }, ctx);
                out.push({ path: childRel, markdown: String(markdown || ""), mtime: e.mtime || "" });
              } catch {
                /* skip unreadable */
              }
            }
            return out;
          };

          let profile = null;
          try {
            const raw = await WorkspaceService.readPath({ relativePath: profileRel }, ctx);
            if (raw) profile = { path: profileRel, markdown: String(raw) };
          } catch {
            profile = null;
          }
          const [periodic, topics] = await Promise.all([
            collectMd(`${memDir}/periodic`),
            collectMd(`${memDir}/topics`),
          ]);

          const assemble = kernelApi.assembleMemoryFeed;
          let items = typeof assemble === "function"
            ? assemble({ profile, periodic, topics })
            : [];
          if (wanted !== "all") {
            items = items.filter((it) => it.kind === wanted);
          }
          // Newest first: periodic/topic paths carry dates; fall back to input order.
          const mtimeByPath = new Map();
          for (const f of [...periodic, ...(profile ? [profile] : []), ...topics]) {
            if (f?.path) mtimeByPath.set(f.path, f.mtime || "");
          }
          items = items
            .map((it) => ({ ...it, _mtime: mtimeByPath.get(it.path) || "" }))
            .sort((a, b) => String(b._mtime).localeCompare(String(a._mtime)))
            .slice(0, max)
            .map(({ _mtime, body, ...rest }) => ({
              ...rest,
              // Keep body short — the preview is what the model needs for Q&A.
              preview: String(rest.preview || body || "").slice(0, 240),
            }));
          return {
            ok: true,
            layer: wanted,
            count: items.length,
            items,
            hint: promptLocale === "en"
              ? "Read-only. To change a profile fact use update/append/retire_core_memory."
              : "只读。要改画像事实请用 update/append/retire_core_memory。",
          };
        } catch (err) {
          return {
            ok: false,
            error: err?.message || String(err),
            hint: promptLocale === "en"
              ? "Failed to list memories. Check the workspace is open."
              : "读取记忆失败，请确认工作区已打开。",
          };
        }
      }),
    });

    tools.list_recent_stream = tool({
      ...sharedTool("list_recent_stream"),
      execute: wrapRead(async function list_recent_stream({ limit, periods } = {}) {
        try {
          const max = Math.min(Math.max(Number(limit) || 12, 1), 40);
          const periodCount = Math.min(Math.max(Number(periods) || 2, 1), 4);
          // Prefer kernel period listing; fall back to stream context.
          let periodPaths = [];
          try {
            const wm = await import("./lib/workspace-model-api.mjs");
            const found = await wm.listStreamPeriods(ctx.workspaceRoot, { limit: periodCount });
            periodPaths = (found || []).map((p) => p.relPath).filter(Boolean);
          } catch {
            periodPaths = [];
          }
          if (!periodPaths.length) {
            const sc = await WorkspaceService.getStreamContext({}, ctx).catch(() => null);
            if (sc?.periodRelPath) periodPaths = [sc.periodRelPath];
          }
          const entries = [];
          for (const rel of periodPaths.slice(0, periodCount)) {
            let md = "";
            try {
              md = String(await WorkspaceService.readPath({ relativePath: rel }, ctx) || "");
            } catch {
              continue;
            }
            // Section scan aligned with product chrome: date/day headings vs named
            // article headings; `#### 续` / <!-- topmind:append --> count as
            // continuations of the previous entry, never a new one.
            const isAppendChrome = (s) =>
              /^<!--\s*topmind:append\b/iu.test(s.trim()) ||
              /^#{2,4}\s*续(?=\s|[·•.]|$)/u.test(s.trim());
            const isDateHeading = (s) =>
              /(?:\d{4}[-–/年]\s*\d{1,2}|周[一二三四五六日天]|星期[一二三四五六日天]|今天|昨天|上午|下午|晚上)/u.test(s);
            const lines = md.split("\n");
            let section = "";
            let sectionKind = "day";
            let buf = [];
            let appends = 0;
            const flush = () => {
              const text = buf
                .filter((l) => !isAppendChrome(l))
                .join("\n")
                .trim();
              if (text && entries.length < max * 2) {
                entries.push({
                  period: rel,
                  section,
                  kind: sectionKind,
                  appends,
                  preview: text.slice(0, 220),
                });
              }
              buf = [];
              appends = 0;
            };
            for (const line of lines) {
              if (/^#{2,3}\s+\S/u.test(line)) {
                flush();
                section = line.replace(/^#+\s*/, "").trim();
                sectionKind = isDateHeading(section) ? "day" : "article";
                continue;
              }
              if (isAppendChrome(line)) {
                appends += 1;
                continue;
              }
              if (line.trim()) buf.push(line);
            }
            flush();
          }
          // Newest first is already the period-file order (latest period first).
          return {
            ok: true,
            periods: periodPaths.slice(0, periodCount),
            count: Math.min(entries.length, max),
            entries: entries.slice(0, max),
            hint: promptLocale === "en"
              ? "Stream entries (period notes). kind=day is a date section, kind=article a named ## block; appends = follow-up count. To add a comment use append_stream_entry."
              : "动态条目（周期本）。kind=day 为日期段，kind=article 为命名 ## 块；appends=续写数。要对某条续写用 append_stream_entry。",
          };
        } catch (err) {
          return {
            ok: false,
            error: err?.message || String(err),
            hint: promptLocale === "en" ? "Failed to list stream entries." : "读取动态失败。",
          };
        }
      }),
    });

    tools.list_pending_writes = tool({
      ...sharedTool("list_pending_writes"),
      execute: wrapRead(async function list_pending_writes() {
        try {
          return summarizeForModel(await WorkspaceService.listPendingWrites({}, ctx), 8000);
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      }),
    });

    if (allowWrite) {
      tools.capture_to_inbox = tool({
        ...sharedTool("capture_to_inbox"),
        execute: wrapWrite("capture_to_inbox", ({ content, title, source, sourceType, forceInbox, forceAtom, actor, confirmed }) =>
          WorkspaceService.ingestInbox(
            {
              content,
              title,
              source,
              sourceType: sourceType || "user-original",
              dest: forceInbox
                ? { mode: "inbox" }
                : { mode: "stream", forceAtom: Boolean(forceAtom) },
              actor: actor || "ai",
              confirmed,
            },
            ctx,
          )),
      });

      tools.save_note = tool({
        ...sharedTool("save_note"),
        execute: wrapWrite("save_note", ({ topicId, filename, content, sourceType, actor, confirmed }) =>
          WorkspaceService.saveNote(
            { topicId, filename, content, sourceType, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.save_file = tool({
        ...sharedTool("save_file"),
        execute: wrapWrite("save_file", ({ relativePath, content, actor, confirmed }) =>
          WorkspaceService.savePath(
            { relativePath, content, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.edit_file = tool({
        ...sharedTool("edit_file"),
        execute: wrapWrite("edit_file", ({
          relativePath, oldText, newText, replaceAll, startLine, endLine, heading, expectedHash, actor, confirmed,
        }) =>
          WorkspaceService.editPath(
            {
              relativePath,
              oldText,
              newText,
              replaceAll: Boolean(replaceAll),
              startLine,
              endLine,
              heading,
              expectedHash,
              actor: actor || "ai",
              confirmed,
            },
            ctx,
          )),
      });

      tools.create_topic = tool({
        ...sharedTool("create_topic"),
        execute: wrapWrite("create_topic", async ({ category, name, actor, confirmed }) => {
          const r = await WorkspaceService.createTopic({ category, name, actor, confirmed }, ctx);
          return { ...r, targetPath: r.topicId, operation: "create-topic" };
        }),
      });

      tools.append_topic_memory = tool({
        ...sharedTool("append_topic_memory"),
        execute: wrapWrite("append_topic_memory", ({ topicId, entry, source, actor, confirmed }) =>
          WorkspaceService.appendTopicMemory(
            { topicId, entry, source, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.append_core_memory = tool({
        ...sharedTool("append_core_memory"),
        execute: wrapWrite("append_core_memory", ({ entry, section, source, actor, confirmed }) =>
          WorkspaceService.appendCoreMemory(
            { entry, section, source, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.retire_core_memory = tool({
        ...sharedTool("retire_core_memory"),
        execute: wrapWrite("retire_core_memory", ({ match, section, reason, actor, confirmed }) =>
          WorkspaceService.retireCoreMemory(
            { match, section, reason, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.update_core_memory = tool({
        ...sharedTool("update_core_memory"),
        execute: wrapWrite("update_core_memory", ({ match, content, actor, confirmed }) =>
          WorkspaceService.updateCoreMemory(
            { match, content, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.restore_core_memory = tool({
        ...sharedTool("restore_core_memory"),
        execute: wrapWrite("restore_core_memory", ({ match, section, actor, confirmed }) =>
          WorkspaceService.restoreCoreMemory(
            { match, section, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.compact_core_memory_history = tool({
        ...sharedTool("compact_core_memory_history"),
        execute: wrapWrite("compact_core_memory_history", ({ actor, confirmed }) =>
          WorkspaceService.compactCoreMemoryHistory(
            { actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.reconcile_week = tool({
        ...sharedTool("reconcile_week"),
        execute: wrapWrite("reconcile_week", ({ dryRun, relativePath, actor, confirmed }) =>
          WorkspaceService.reconcileStreamPeriod(
            { dryRun: Boolean(dryRun), apply: !dryRun, relativePath, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.move_to_topic = tool({
        ...sharedTool("move_to_topic"),
        execute: wrapWrite("move_to_topic", ({ relativePath, inboxRelativePath, targetTopicId, actor, confirmed }) =>
          WorkspaceService.moveToTopic({ relativePath, inboxRelativePath, targetTopicId, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.publish_to_outputs = tool({
        ...sharedTool("publish_to_outputs"),
        execute: wrapWrite("publish_to_outputs", ({ relativePath, actor, confirmed }) =>
          WorkspaceService.publishPath({ relativePath, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.delete_path = tool({
        ...sharedTool("delete_path"),
        execute: wrapWrite("delete_path", async ({ relativePath, actor, confirmed }) => {
          const r = await WorkspaceService.deletePath({ relativePath, actor: actor || "ai", confirmed }, ctx);
          const reversible = Boolean(r?.backupPath);
          return {
            ...r,
            targetPath: relativePath,
            operation: "delete-path",
            reversible,
            note:
              r?.note
              || (reversible
                ? (promptLocale === "en"
                  ? "Deleted with trash copy (locked/core — recoverable from Archive)."
                  : "已删除（锁定/核心笔记，Archive trash 可恢复）")
                : (promptLocale === "en"
                  ? "Deleted ordinary open note (no trash copy)."
                  : "已删除（普通开放笔记，无 trash 副本）")),
          };
        }),
      });

      tools.rename_path = tool({
        ...sharedTool("rename_path"),
        execute: wrapWrite("rename_path", async ({ relativePath, newName, actor, confirmed }) => {
          const r = await WorkspaceService.renamePath({ relativePath, newName, actor: actor || "ai", confirmed }, ctx);
          return { ...r, operation: "rename-path" };
        }),
      });

      tools.create_dir = tool({
        ...sharedTool("create_dir"),
        execute: wrapWrite("create_dir", ({ relativePath, actor, confirmed }) =>
          WorkspaceService.createDir({ relativePath, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.copy_file = tool({
        ...sharedTool("copy_file"),
        execute: wrapWrite("copy_file", ({ relativePath, destRelativePath, overwrite, actor, confirmed }) =>
          WorkspaceService.copyFileTo({
            relativePath,
            destRelativePath,
            overwrite,
            actor: actor || "ai",
            confirmed,
          }, ctx)),
      });

      tools.add_todo = tool({
        ...sharedTool("add_todo"),
        execute: wrapWrite("add_todo", ({ text, items, dueDate, actor, confirmed }) => {
          const list = Array.isArray(items) && items.length > 0 ? items : (text ? [text] : []);
          const normalized = list.map((t) => (dueDate && !t.includes("📅") ? `${t} 📅 ${dueDate}` : t));
          return WorkspaceService.addTodos(
            { items: normalized, actor: actor || "ai", confirmed },
            ctx,
          );
        }),
      });

      tools.toggle_todo = tool({
        ...sharedTool("toggle_todo"),
        execute: wrapWrite("toggle_todo", ({ idOrText, completed, actor, confirmed }) =>
          WorkspaceService.toggleTodo(
            { idOrText, completed, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.update_todo = tool({
        ...sharedTool("update_todo"),
        execute: wrapWrite("update_todo", ({ idOrText, newText, dueDate, actor, confirmed }) =>
          WorkspaceService.updateTodo(
            { idOrText, text: newText, dueDate: dueDate ?? undefined, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.set_todo_due = tool({
        ...sharedTool("set_todo_due"),
        execute: wrapWrite("set_todo_due", ({ idOrText, dueDate, actor, confirmed }) =>
          WorkspaceService.setTodoDue(
            { idOrText, dueDate: dueDate || null, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.delete_todo = tool({
        ...sharedTool("delete_todo"),
        execute: wrapWrite("delete_todo", ({ idOrText, actor, confirmed }) =>
          WorkspaceService.deleteTodo(
            { idOrText, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.append_stream_entry = tool({
        ...sharedTool("append_stream_entry"),
        execute: wrapWrite("append_stream_entry", ({ relativePath, heading, content, startLine, endLine, anchorText, actor, confirmed }) =>
          WorkspaceService.appendStreamEntry(
            {
              relativePath,
              heading,
              content,
              startLine,
              endLine,
              anchorText,
              actor: actor || "ai",
              confirmed,
            },
            ctx,
          )),
      });
    }

    tools.request_clarification = tool({
      ...sharedTool("request_clarification"),
      execute: async ({ question, choices }) => ({ ok: true, needsUser: true, question: String(question).trim(), choices }),
    });
    return tools;
  } catch (err) {
    logError("ai-tools", "buildDesktopAiTools failed", { error: err?.message || String(err) });
    return {};
  }
}

/** Exported for tests — names of tools that exist when write is allowed. */
// Constants moved to ./lib/ai-tool-names.mjs (re-exported above for backward compat)
