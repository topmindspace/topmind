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
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "./lib/ai-tool-names.mjs";
import { resolvePromptLocale } from "./ai-prompts.mjs";
import { allowsJsonWriteBody } from "./lib/pi-fenced-fs.mjs";
import { loadKernelApi } from "./lib/kernel-api.mjs";

// Re-export for backward compatibility (existing imports from ai-tools.mjs)
export { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE };

function strProp(description) {
  return { type: "string", description };
}

function summarizeForModel(value, max = 6000) {
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
    const aiWriteOpts = (toolName) => ({
      actor: "ai",
      confirmed: LIFECYCLE_TOOLS.has(toolName) ? !needsUserConfirm : true,
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
    /** Tool catalog language follows host UI locale (same as system prompt). */
    const d = (zh, en) => (promptLocale === "en" ? en : zh);
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

    const wrapWrite = (toolName, fn) => async (args) => {
      // Invalidate read cache on any write — prevents stale reads after edit/save
      readCache.clear();
      const blocked = sanitizeWriteArgs(toolName, args);
      if (blocked) return blocked;
      try {
        const raw = await fn({ ...args, ...aiWriteOpts(toolName) });
        const result = normalizeWriteResult(toolName, raw);
        // Content writes land immediately (graded confirm). Notify renderer so
        // open editors / stream / tree refresh — intentional writes are
        // watcher-ignored (markIgnoredFileChanges) and would otherwise stay stale.
        if (result?.ok && !result.pending && !result.needsConfirm && !result.error) {
          const changed =
            result.targetPath ||
            result.path ||
            args.relativePath ||
            raw?.targetPath ||
            (toolName === "append_topic_memory" && args.topicId
              ? `${String(args.topicId).replace(/\\/g, "/")}/topic.md`
              : null) ||
            (toolName === "add_todo" || toolName === "toggle_todo"
              ? raw?.targetPath || "memory/todo.md"
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
          if (rel && content) {
            try {
              const { stashPendingWrite } = await import("./lib/pending-writes.mjs");
              const stashed = stashPendingWrite({
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
        if (toolName === "edit_file") {
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
        } else if (toolName === "save_file" || toolName === "save_note") {
          // locked is editable under graded model (task-scoped snapshot).
          // Do NOT tell the agent to unlock or switch modes — that was the
          // retired "locked + AI auto = deny" policy.
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
      } = await import("./lib/skills-runtime.mjs");
      const enabledIds = ctx.appSettings?.ai?.enabledSkillIds || null;
      const engineRoot = ctx.workspaceRoot?.engineRoot || ctx.engineRoot;
      const extraRoots = ctx.appSettings?.ai?.extraSkillsRoots || [];
      setConfiguredExtraSkillsRoots(extraRoots);

      tools.list_skills = tool({
        description: d(
          "列出可用 skills（id + 简述）。路由起点；动手前 load_skill 激活全文。",
          "List available skills (id + short description). Start here for routing; load_skill before acting.",
        ),
        inputSchema: jsonSchema({ type: "object", properties: {} }),
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
        description: d(
          "激活 skill 全文（Activation）。skillId 如 topmind-capture / topmind。执行流程前调用。",
          "Activate a skill body. skillId examples: topmind-capture / topmind. Call before following a workflow.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            skillId: strProp(
              d("skill id，如 topmind-capture、topmind、topmind-organize", "skill id, e.g. topmind-capture, topmind, topmind-organize"),
            ),
          },
          required: ["skillId"],
        }),
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
        description: d(
          "加载 skill 资源（Resources）：shared/*.md 或 skill references/*。路径相对 skills 根，如 shared/project-model-brief.md。",
          "Load a skill resource: shared/*.md or skill references/*. Path is relative to the skills root, e.g. shared/project-model-brief.md.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            path: strProp(
              d("相对 skills 根路径，如 shared/capability-degradation.md", "Path under the skills root, e.g. shared/capability-degradation.md"),
            ),
          },
          required: ["path"],
        }),
        async execute({ path: rel }) {
          const res = loadSkillResource(rel, { engineRoot, maxChars: 12000, extraRoots });
          return summarizeForModel(res, 14000);
        },
      });
    }

    tools.list_categories = tool({
      description: d(
        "列出工作区类别（directory/slot/role/specialBehavior）。系统提示词已内联概览时无需调用。",
        "List workspace categories (directory/slot/role/specialBehavior). Skip if the system prompt already inlines an overview.",
      ),
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listCategories({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取工作区类别失败。" };
        }
      },
    });

    tools.workspace_overview = tool({
      description: d(
        "一次性获取工作区全貌：类别列表(含专题数) + Inbox 待处理数 + 最近动态周期本 + 交付数。减少多次 list_* 调用。系统提示词已内联部分概览，此工具获取更完整实时数据。",
        "One-shot workspace overview: categories (with topic counts) + Inbox count + current stream period + outputs count. Prefer this over many list_* calls.",
      ),
      inputSchema: jsonSchema({ type: "object", properties: {} }),
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
      description: d("列出某类别下的专题与单篇笔记。", "List topics and loose notes under a category."),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          category: strProp(d("类别目录名，如 20-研究", "Category directory name, e.g. 20-研究")),
        },
        required: ["category"],
      }),
      async execute({ category }) {
        try {
          return summarizeForModel(await WorkspaceService.listTopics({ category }, ctx));
        } catch (err) {
          return { ok: false, category, error: err?.message || String(err), hint: "无法列出专题，请使用 workspace_overview 确认类别目录是否存在。" };
        }
      },
    });

    tools.list_topic_files = tool({
      description: d("列出专题目录下的文件（不含内容）。", "List files under a topic directory (names only)."),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
        },
        required: ["topicId"],
      }),
      async execute({ topicId }) {
        try {
          return summarizeForModel(await WorkspaceService.listTopicFiles({ topicId }, ctx));
        } catch (err) {
          return { ok: false, topicId, error: err?.message || String(err), hint: "无法列出专题文件，请确认专题 ID 格式为 类别/专题名（如 20-专题/2026-主题）。" };
        }
      },
    });

    tools.get_topic = tool({
      description: d(
        "获取专题概览（文件列表 + 元信息）。organize/write 常用。",
        "Get a topic overview (file list + metadata). Common for organize/write.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
        },
        required: ["topicId"],
      }),
      async execute({ topicId }) {
        try {
          return summarizeForModel(await WorkspaceService.getTopic({ topicId }, ctx));
        } catch (err) {
          return { ok: false, topicId, error: err?.message || String(err), hint: "获取专题失败，请检查专题 ID 是否准确。" };
        }
      },
    });

    tools.read_file = tool({
      description: d(
        "读取工作区相对路径的 Markdown/文本。返回带行号的 numbered 窗口（N|正文）+ contentHash（传给 edit_file 的 expectedHash）。长文用 around= 关键词或 heading= 跳到中间，勿一次吞全文。edit_file 可把行号当 startLine/endLine。",
        "Read a workspace-relative markdown/text file. Returns a numbered window (N|body) + contentHash (pass to edit_file expectedHash). For long files use around= or heading= instead of swallowing the whole file. edit_file accepts the same line numbers as startLine/endLine.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          relativePath: strProp(d("工作区相对路径", "Workspace-relative path")),
          offset: {
            type: "number",
            description: d("起始行号（1-based，默认 1）", "Start line (1-based, default 1)"),
          },
          limit: {
            type: "number",
            description: d("返回行数（默认 400；最大 2000）", "Lines to return (default 400; max 2000)"),
          },
          around: strProp(d("跳到包含该短语的行，返回其前后窗口（中段编辑首选）", "Jump to the line containing this phrase and return a window (preferred for mid-file edits)")),
          heading: strProp(d("跳到该 Markdown 标题所在节（须唯一）", "Jump to the unique markdown heading section")),
        },
        required: ["relativePath"],
      }),
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
      description: d(
        "列出工作区目录（name/type/size/mtime/ext）。path 空=工作区根；memory/ 与 .topmind/ 可读。",
        "List a workspace directory (name/type/size/mtime/ext). Empty path = workspace root; memory/ and .topmind/ are readable.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          relativePath: strProp(d("目录相对路径；空=根", "Directory relative path; empty = root")),
          includeSystem: { type: "boolean", description: d("true 时含隐藏/系统条目", "true includes hidden/system entries") },
        },
      }),
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
      description: d(
        "按 glob 模式找工作区文件（无 shell）。默认跳过 99-归档。支持 * ** ?。返回 relativePath/size/mtime。",
        "Find workspace files by glob (no shell). Skips 99-Archive by default. Supports * ** ?. Returns relativePath/size/mtime.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          pattern: strProp(d("glob 模式，如 **/*.md 或 20-专题/**/*.md", "Glob pattern, e.g. **/*.md or 20-专题/**/*.md")),
          scope: strProp(d("可选：限定目录前缀", "Optional directory prefix")),
          maxResults: {
            type: "number",
            description: d("最多返回条数（默认 100，上限 500）", "Max matches (default 100, cap 500)"),
          },
          includeArchive: {
            type: "boolean",
            description: d("true 才搜索 99-归档（默认 false）", "true includes 99-Archive (default false)"),
          },
        },
        required: ["pattern"],
      }),
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
      description: d(
        "查看工作区路径元信息（type/size/mtime/ext/isBinaryExt）。不读正文。",
        "Stat a workspace path (type/size/mtime/ext/isBinaryExt). Does not read content.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          relativePath: strProp(d("工作区相对路径", "Workspace-relative path")),
        },
        required: ["relativePath"],
      }),
      execute: wrapRead(async function stat_path({ relativePath }) {
        try {
          return await WorkspaceService.statPath({ relativePath }, ctx);
        } catch (err) {
          return { ok: false, relativePath, error: err?.message || String(err) };
        }
      }),
    });

    tools.search = tool({
      description: d(
        "只读搜索工作区 Markdown/文本（受控 grep，无 shell）。默认跳过 99-Archive。可 scope 到类别或专题路径。返回 relativePath + line + preview。",
        "Read-only workspace markdown/text search (controlled grep, no shell). Skips 99-Archive by default. Optional scope prefix. Returns relativePath + line + preview.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          query: strProp(d("关键词；regex=true 时为正则", "Keyword; regex when regex=true")),
          scope: strProp(d("可选：类别或专题路径前缀，如 20-研究 或 20-研究/2026-示例", "Optional category/topic path prefix")),
          maxResults: {
            type: "number",
            description: d("最多命中条数（默认 40，上限 80）", "Max hits (default 40, cap 80)"),
          },
          regex: {
            type: "boolean",
            description: d("true 时按正则匹配（默认 false，普通关键词）", "true = regex match (default false)"),
          },
          includeArchive: {
            type: "boolean",
            description: d("true 才搜索 Archive（默认 false）", "true includes Archive (default false)"),
          },
          context: {
            type: "number",
            description: d("命中行前后上下文行数 0–2（默认 0）", "Context lines around hits 0–2 (default 0)"),
          },
        },
        required: ["query"],
      }),
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
      description: d(
        "列出 Inbox 中的待分类材料。capture/organize 常用。",
        "List unfiled Inbox materials. Common for capture/organize.",
      ),
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listInbox({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取 Inbox 列表失败。" };
        }
      },
    });

    tools.list_outputs = tool({
      description: d("列出 88-Outputs 交付物。", "List delivery artifacts under 88-Outputs."),
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listOutputs({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取交付物列表失败。" };
        }
      },
    });

    tools.fetch_url = tool({
      description: d(
        "抓取网页正文并转为 Markdown。默认静态 HTTP+Readability；render=true 时用隐藏 Chromium 渲染 SPA。返回 truncated/likelySpa/canEnhance/warning。",
        "Fetch a web page and convert to Markdown. Default static HTTP+Readability; render=true uses hidden Chromium for SPA shells. Returns truncated/likelySpa/canEnhance/warning.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          url: strProp("http(s) URL"),
          maxLen: {
            type: "number",
            description: d("正文提取上限字符（默认 40000，长文可到 200000）", "Max body chars (default 40000; long docs up to 200000)"),
          },
          render: {
            type: "boolean",
            description: d("true 时启用增强渲染（SPA 空壳页）", "true enables enhanced rendering for SPA shells"),
          },
        },
        required: ["url"],
      }),
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

    tools.workspace_health = tool({
      description: d(
        "工作区健康巡检（结构 + 契约 inspectContract + counts）。返回 JSON：{ ok, checks, summary, issues }。容量/重复/清理走 Desktop「工具与日志」面板（⌘⇧L），不进默认 AI 工具。",
        "Workspace health check (structure + inspectContract + counts). Returns { ok, checks, summary, issues }. Capacity/dedupe/cleanup live in the Tools & Logs panel (⌘⇧L), not this tool.",
      ),
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      execute: wrapRead(async function workspace_health() {
        try {
          return summarizeForModel(await WorkspaceService.workspaceHealth({}, ctx), 10000);
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "工作区巡检执行失败。" };
        }
      }),
    });

    tools.list_todos = tool({
      description: d(
        "列出个人待办清单（memory/todo.md）。返回活跃任务与统计；completed=true 时返回全部（含已完成）。",
        "List the personal todo list (memory/todo.md). Returns open tasks + stats; completed=true includes finished items.",
      ),
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          completed: {
            type: "boolean",
            description: d("true 时包含已完成项；默认 false（只返回未完成项）", "true includes completed items (default false)"),
          },
          limit: {
            type: "number",
            description: d("最多返回条数（默认 50）", "Max items (default 50)"),
          },
        },
      }),
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

    if (allowWrite) {
      tools.capture_to_inbox = tool({
        description: d(
          "记一下：默认追加到动态周期本（每周一本）；forceInbox=true 时进 Inbox；forceAtom=true 时单开文件。",
          "Capture: append to the current stream period note by default; forceInbox=true routes to Inbox; forceAtom=true creates a standalone file.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            content: strProp(d("正文 Markdown", "Markdown body")),
            title: strProp(d("可选标题", "Optional title")),
            source: strProp(d("可选出处 URL/说明", "Optional source URL/note")),
            sourceType: strProp(d("可选 source_type，默认 user-original", "Optional source_type, default user-original")),
            forceInbox: { type: "boolean", description: d("true → Inbox", "true → Inbox") },
            forceAtom: { type: "boolean", description: d("true → 不追加周期本，单开文件", "true → standalone file, not period note") },
          },
          required: ["content"],
        }),
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
        description: d(
          "在专题下新建或更新笔记的便捷入口（等价于 save_file 到 {topicId}/{filename}）。多数场景请直接用 save_file 指定完整相对路径。",
          "Convenience create/update under a topic (same as save_file to {topicId}/{filename}). Prefer save_file with a full relative path in most cases.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
            filename: strProp(d("文件名，如 note.md", "Filename, e.g. note.md")),
            content: strProp(d("正文", "Body content")),
            sourceType: strProp(d("可选 source_type", "Optional source_type")),
          },
          required: ["topicId", "filename", "content"],
        }),
        execute: wrapWrite("save_note", ({ topicId, filename, content, sourceType, actor, confirmed }) =>
          WorkspaceService.saveNote(
            { topicId, filename, content, sourceType, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.save_file = tool({
        description: d(
          "统一写入入口：新建或整文件覆盖工作区相对路径 .md（经写闸）。多段重写/结构调整/新建首选；locked 可编辑（任务内首写快照一次）。小改用 edit_file。",
          "Primary write entry: create or fully overwrite a workspace-relative .md via the write gate. Prefer for multi-section rewrites, structural edits, and new files. Locked notes are editable (one pre-write snapshot per task). Use edit_file for small spans.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(
              d("工作区相对路径", "Workspace-relative path"),
            ),
            content: strProp(d("完整文件内容", "Full file content")),
          },
          required: ["relativePath", "content"],
        }),
        execute: wrapWrite("save_file", ({ relativePath, content, actor, confirmed }) =>
          WorkspaceService.savePath(
            { relativePath, content, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.edit_file = tool({
        description: d(
          "精确局部修改 .md：oldText→newText。匹配阶梯：唯一精确 → 换行/行尾空白归一 → 行级宽松（空行/列表标记/加粗）。多处命中则拒绝（或 replaceAll）。可用 startLine/endLine/heading 限定范围（行号过期时会自动外扩重试）。推荐传 expectedHash（read_file/edit_file 返回的 contentHash）做乐观并发校验。成功返回 postEditWindow + 新 contentHash，多步编辑请用它们，勿沿用更早 read 的行号。失败返回 nearby/context。不写 99-Archive；整文件覆盖用 save_file。",
          "Precise span edit on .md: oldText→newText. Match ladder: unique exact → newline/trailing-ws normalize → relaxed line (blank/list/bold). Multiple hits are rejected (or use replaceAll). Optional startLine/endLine/heading scope (auto-widens if stale). Prefer expectedHash from read_file/edit_file for optimistic concurrency. Success returns postEditWindow + new contentHash — reuse those for multi-step edits. Failure returns nearby/context. Never writes 99-Archive; full overwrite uses save_file.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(d("工作区相对路径", "Workspace-relative path")),
            oldText: strProp(
              d(
                "要替换的原文片段（建议含前后几行；可从 numbered 窗口复制，行号前缀会被剥掉）",
                "Exact span to replace (include a few surrounding lines; strip N| prefixes from numbered windows)",
              ),
            ),
            newText: strProp(d("替换后的文本（可为更长或更短）", "Replacement text (may be longer or shorter)")),
            replaceAll: {
              type: "boolean",
              description: d("true 时替换全部匹配；默认 false（必须唯一）", "true replaces all matches (default false — must be unique)"),
            },
            startLine: {
              type: "number",
              description: d("可选：限定匹配的起始行（1-based；过期时自动外扩）", "Optional start line (1-based; auto-widens if stale)"),
            },
            endLine: {
              type: "number",
              description: d("可选：限定匹配的结束行（含；过期时自动外扩）", "Optional inclusive end line (auto-widens if stale)"),
            },
            heading: strProp(d("可选：限定在该 Markdown 标题节内匹配（须唯一）", "Optional unique markdown heading scope")),
            expectedHash: strProp(
              d(
                "可选：最近 read_file/edit_file 返回的 contentHash；文件被外部修改时拒绝并提示重读",
                "Optional contentHash from the latest read_file/edit_file; rejects if the file changed externally",
              ),
            ),
          },
          required: ["relativePath", "oldText", "newText"],
        }),
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
        description: d(
          "在指定类别下创建新专题（名称须 YYYY-主题）。",
          "Create a new topic under a category (name must be YYYY-theme).",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            category: strProp(d("类别目录名", "Category directory name")),
            name: strProp(d("专题名，如 2026-示例研究", "Topic name, e.g. 2026-sample-research")),
          },
          required: ["category", "name"],
        }),
        execute: wrapWrite("create_topic", async ({ category, name, actor, confirmed }) => {
          const r = await WorkspaceService.createTopic({ category, name, actor, confirmed }, ctx);
          return { ...r, targetPath: r.topicId, operation: "create-topic" };
        }),
      });

      tools.append_topic_memory = tool({
        description: d(
          "向专题 topic.md 的 Stable Memory 段追加稳定结论（memory skill）。",
          "Append a stable conclusion to the topic.md Stable Memory section (memory skill).",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
            entry: strProp(d("要追加的记忆内容", "Memory entry to append")),
            source: strProp(d("可选来源说明", "Optional source note")),
          },
          required: ["topicId", "entry"],
        }),
        execute: wrapWrite("append_topic_memory", ({ topicId, entry, source, actor, confirmed }) =>
          WorkspaceService.appendTopicMemory(
            { topicId, entry, source, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.append_core_memory = tool({
        description: d(
          "更新「我的情况」（核心记忆）。仅用户明确要记住偏好/目标/关系时使用。",
          "Update core memory (about me). Use only when the user explicitly wants a preference/goal/relationship remembered.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            entry: strProp(d("要追加的稳定信息", "Stable fact to append")),
            section: strProp(d("段落：偏好 / 当前目标 / 关键的人与协作 / 进行中的事", "Section: preferences / current goals / key people / in progress")),
            source: strProp(d("可选来源", "Optional source")),
          },
          required: ["entry"],
        }),
        execute: wrapWrite("append_core_memory", ({ entry, section, source, actor, confirmed }) =>
          WorkspaceService.appendCoreMemory(
            { entry, section, source, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.retire_core_memory = tool({
        description: d(
          "归档「我的情况」中的过期事实：将其从当前活跃段落安全转移至「## 历史记录」，带归档日期标记，不删除原内容。仅在用户明确表示某目标已完成、偏好已过时或不再成立时调用。",
          "Retire a stale fact from core memory: move it from the active section into ## 历史记录 with a dated marker — never delete the original. Call only when the user says a goal finished or a preference no longer holds.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            match: strProp(d("要归档的事实原文关键词或片段（需能唯一或清晰匹配）", "Keywords/span of the fact to retire (must match clearly)")),
            section: strProp(d("可选：限定所在的活跃段落（如 当前目标 / 进行中的事 / 偏好）", "Optional active section scope")),
            reason: strProp(d("可选：归档原因说明", "Optional reason")),
          },
          required: ["match"],
        }),
        execute: wrapWrite("retire_core_memory", ({ match, section, reason, actor, confirmed }) =>
          WorkspaceService.retireCoreMemory(
            { match, section, reason, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.update_core_memory = tool({
        description: d(
          "原位更新「我的情况」中的事实：用新的表述替换旧的事实行（保持原段落结构，自动带日期）。仅在用户明确纠正或更新现有偏好、目标等事实时调用。",
          "Update a core-memory fact in place: replace the old fact line (section structure kept, date stamped). Call only when the user explicitly corrects or updates a preference/goal.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            match: strProp(d("要修正的旧事实片段（需匹配）", "Old fact span to match")),
            content: strProp(d("更新后的新事实内容", "Updated fact content")),
          },
          required: ["match", "content"],
        }),
        execute: wrapWrite("update_core_memory", ({ match, content, actor, confirmed }) =>
          WorkspaceService.updateCoreMemory(
            { match, content, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.reconcile_week = tool({
        description: d(
          "确定性整理本周动态周期本（合并完成状态、去重）。返回 changes 与候选（我的情况/专题），不自动写核心记忆。",
          "Deterministic tidy of the current stream period (merge completions, dedupe). Returns changes + candidates (memory/topics); never auto-writes core memory.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            dryRun: { type: "boolean", description: d("true=仅预览", "true = preview only") },
            relativePath: strProp(d("可选指定文件；默认当前周期本", "Optional file; defaults to the current period note")),
          },
        }),
        execute: wrapWrite("reconcile_week", ({ dryRun, relativePath, actor, confirmed }) =>
          WorkspaceService.reconcileStreamPeriod(
            { dryRun: Boolean(dryRun), apply: !dryRun, relativePath, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.move_to_topic = tool({
        description: d(
          "把笔记移入专题（organize）。写闸提交后才会移动 images/{slug}/ 关联资源；相对 Markdown 路径保持不变。可用 relativePath（任意 .md）或 inboxRelativePath。",
          "Move a note into a topic (organize). images/{slug}/ assets move only after the write gate commits; relative markdown refs stay intact. Use relativePath (any .md) or inboxRelativePath.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(d("工作区相对路径（优先；任意位置的 .md）", "Workspace-relative path (preferred; any .md)")),
            inboxRelativePath: strProp(d("兼容：Inbox 内相对路径", "Compat: path relative to Inbox")),
            targetTopicId: strProp(d("目标专题 ID：类别/专题名", "Target topic id: category/topic")),
          },
          required: ["targetTopicId"],
        }),
        execute: wrapWrite("move_to_topic", ({ relativePath, inboxRelativePath, targetTopicId, actor, confirmed }) =>
          WorkspaceService.moveToTopic({ relativePath, inboxRelativePath, targetTopicId, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.publish_to_outputs = tool({
        description: d(
          "发布交付副本到 88-Outputs（write 交付）。原文保留；关联 images/ 会在写闸提交后复制到 Outputs。不是移动。",
          "Publish a delivery snapshot into 88-Outputs. Original note stays; associated images/ are copied after the write gate commits. This is a copy, not a move.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(
              d("要发布的工作区相对路径（.md）", "Workspace-relative .md path to publish"),
            ),
          },
          required: ["relativePath"],
        }),
        execute: wrapWrite("publish_to_outputs", ({ relativePath, actor, confirmed }) =>
          WorkspaceService.publishPath({ relativePath, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.delete_path = tool({
        description: d(
          "删除工作区文件。锁定/核心笔记（memory、topic.md、交付）会移入 99-Archive trash（可恢复）；普通开放笔记直接删除、无备份。删除 .md 时一并处理关联 images/{slug}/。仅在用户明确要求删除时使用。",
          "Delete a workspace file. Locked/core notes (memory, topic.md, delivery) move to 99-Archive trash (recoverable); ordinary open notes are unlinked with no trash. Associated images/{slug}/ are handled after the write gate commits. Use only when the user explicitly asked to delete.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(
              d("工作区相对路径，如 00-Inbox/foo.md", "Workspace-relative path, e.g. 00-Inbox/foo.md"),
            ),
          },
          required: ["relativePath"],
        }),
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
        description: d(
          "重命名工作区内的文件（同目录改名；经写闸）。.md 重命名时会同步 images/{旧stem}/→images/{新stem}/ 并改写正文引用。跨目录请用 move_to_topic。",
          "Rename a file in place (same directory; via write gate). Renaming .md also renames images/{oldStem}/ → images/{newStem}/ and rewrites body refs. Use move_to_topic for cross-directory moves.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(d("原相对路径", "Original relative path")),
            newName: strProp(d("新文件名（不含路径，如 note-v2.md）", "New filename only, e.g. note-v2.md")),
          },
          required: ["relativePath", "newName"],
        }),
        execute: wrapWrite("rename_path", async ({ relativePath, newName, actor, confirmed }) => {
          const r = await WorkspaceService.renamePath({ relativePath, newName, actor: actor || "ai", confirmed }, ctx);
          return { ...r, operation: "rename-path" };
        }),
      });

      tools.create_dir = tool({
        description: d(
          "创建工作区目录（递归，幂等）。经写闸评估保护。",
          "Create a workspace directory (recursive, idempotent). Goes through the write gate.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(d("目录相对路径", "Directory-relative path")),
          },
          required: ["relativePath"],
        }),
        execute: wrapWrite("create_dir", ({ relativePath, actor, confirmed }) =>
          WorkspaceService.createDir({ relativePath, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.copy_file = tool({
        description: d(
          "工作区内复制文件。目标已存在时拒绝，除非 overwrite=true。文本经写闸，二进制过保护门。",
          "Copy a file inside the workspace. Refuses when dest exists unless overwrite=true. Text goes through the write gate; binaries pass the protection gate.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp(d("源相对路径", "Source relative path")),
            destRelativePath: strProp(d("目标相对路径", "Destination relative path")),
            overwrite: { type: "boolean", description: d("true 才覆盖已存在目标", "true allows overwriting an existing dest") },
          },
          required: ["relativePath", "destRelativePath"],
        }),
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
        description: d(
          "向个人待办清单（memory/todo.md）原子化追加一条或多条任务。支持在任务文本中嵌入截止日期（如「完成架构重构 📅 2026-09-10」）或通过 dueDate 指定。自动去重。",
          "Atomically append one or more todos to memory/todo.md. Due dates can be embedded in the text (e.g. 'finish refactor 📅 2026-09-10') or passed via dueDate. Auto-dedupes.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            text: strProp(d("待办任务文本（单条）", "Single todo text")),
            items: {
              type: "array",
              items: { type: "string" },
              description: d("可选：批量追加的多条待办任务文本", "Optional batch of todo texts"),
            },
            dueDate: strProp(d("可选：截止日期（YYYY-MM-DD）", "Optional due date YYYY-MM-DD")),
          },
        }),
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
        description: d(
          "切换待办事项的完成状态（已完成与未完成之间切换）。idOrText 可以是待办的文本片段或 id。标记完成时会自动打勾并记录完成时间，并同步到当前动态周期本。",
          "Toggle a todo between open and done. idOrText may be a text fragment or id. Completing checks the item, stamps completion time, and syncs to the current stream period.",
        ),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            idOrText: strProp(d("待办文本片段或待办 ID", "Todo text fragment or id")),
            completed: {
              type: "boolean",
              description: d("可选：显式指定目标状态（true=标记完成，false=取消完成）", "Optional explicit target state"),
            },
          },
          required: ["idOrText"],
        }),
        execute: wrapWrite("toggle_todo", ({ idOrText, completed, actor, confirmed }) =>
          WorkspaceService.toggleTodo(
            { idOrText, completed, actor: actor || "ai", confirmed },
            ctx,
          )),
      });
    }

    return tools;
  } catch (err) {
    logError("ai-tools", "buildDesktopAiTools failed", { error: err?.message || String(err) });
    return {};
  }
}

/** Exported for tests — names of tools that exist when write is allowed. */
// Constants moved to ./lib/ai-tool-names.mjs (re-exported above for backward compat)
