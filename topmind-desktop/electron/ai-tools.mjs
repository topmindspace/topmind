/**
 * Desktop-native AI tool set (full agent surface).
 *
 * Product boundary: map to WorkspaceService — never require UTR, never spawn
 * extra Electron windows/processes. All I/O stays in the main process.
 *
 * Write tools respect writebackMode:
 * - auto → write tools execute immediately (subject to protection)
 * - confirm（保存前问我）→ write tools still registered; Kernel pending → stash full body → AiPanel accept/reject
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

    /** AI write opts: always actor=ai; confirmed=false when Desktop settings writebackMode=confirm */
    const aiWriteOpts = () => ({
      actor: "ai",
      confirmed: !needsUserConfirm,
    });

    const promptLocale = resolvePromptLocale(ctx.appSettings?.ui?.locale);
    const writeCopy = promptLocale === "en"
      ? {
          pendingStashed: "Ask-before-save: write is pending. Accept or reject it in the AI panel pending-writes list.",
          pendingNoBody: "Ask-before-save: confirmation required, but the body was not cached (retry with save_file).",
          pendingDelete: "Ask-before-save: file deletion requires user confirmation; deletion was blocked.",
          writeFailed: "Write failed; adjust parameters and retry, or accept the write in the review bar when ask-before-save is on.",
        }
      : {
          pendingStashed: "保存前问我：写入已挂起，请在 AI 面板「待确认写入」中接受或拒绝",
          pendingNoBody: "保存前问我：写入需确认，但未能缓存正文（请重试 save_file 全量写入）",
          pendingDelete: "保存前问我：删除操作已拦截，需用户确认或手动操作",
          writeFailed: "写入失败；可调整参数后重试，或「保存前问我」模式下在审阅条接受写入",
        };

    const wrapWrite = (toolName, fn) => async (args) => {
      // Invalidate read cache on any write — prevents stale reads after edit/save
      readCache.clear();
      try {
        const raw = await fn({ ...args, ...aiWriteOpts() });
        const result = normalizeWriteResult(toolName, raw);
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
              });
              result.pendingId = stashed.id;
            } catch {
              /* ignore stash failure */
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
          if (isNoMatch) {
            hint = promptLocale === "en"
              ? `Edit failed: oldText was not found in the file. First call read_file({ relativePath: "${args?.relativePath || ""}", around: "keyword", offset: 1, limit: 100 }) to read the exact text and line numbers, then retry edit_file with actual lines or specify startLine/endLine.`
              : `编辑失败：未在文件中匹配到 oldText。建议先调用 read_file({ relativePath: "${args?.relativePath || ""}", around: "关键词", offset: 1, limit: 100 }) 查看带有行号的最新真实内容，重新复制精确的 oldText（可多带前后1-2行以确保唯一），或传入 startLine/endLine 缩小范围重试。`;
          } else if (isAmbiguous) {
            hint = promptLocale === "en"
              ? `Edit failed: oldText matched multiple times in the file. Add 1-2 surrounding lines to oldText to make it unique, or specify startLine/endLine or heading, or set replaceAll: true if you want to replace all occurrences.`
              : `编辑失败：oldText 在文件中命中多处。建议在 oldText 中多包含前后 1~2 行上下文以保证唯一性，或传入 startLine/endLine 或 heading 限定范围，若确实需要全部替换可设置 replaceAll: true。`;
          }
        } else if (toolName === "save_file" || toolName === "save_note") {
          if (message.includes("locked") || message.includes("保护")) {
            hint = promptLocale === "en"
              ? "Write failed: target file is locked or protected. AI is not permitted to overwrite locked files."
              : "写入失败：目标文件被锁定或保护（locked），系统禁止 AI 覆盖受保护笔记。";
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
        description:
          "列出可用 skills（id + 简述）。路由起点；动手前 load_skill 激活全文。",
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
        description:
          "激活 skill 全文（Activation）。skillId 如 topmind-capture / topmind。执行流程前调用。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            skillId: strProp("skill id，如 topmind-capture、topmind、topmind-organize"),
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
        description:
          "加载 skill 资源（Resources）：shared/*.md 或 skill references/*。路径相对 skills 根，如 shared/project-model-brief.md。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            path: strProp("相对 skills 根路径，如 shared/capability-degradation.md"),
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
      description:
        "列出工作区类别（directory/slot/role/specialBehavior）。系统提示词已内联概览时无需调用。",
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
      description:
        "一次性获取工作区全貌：类别列表(含专题数) + 收件箱待处理数 + 最近动态周期本 + 输出数。减少多次 list_* 调用。系统提示词已内联部分概览，此工具获取更完整实时数据。",
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
      description: "列出某类别下的专题与单篇笔记。",
      inputSchema: jsonSchema({
        type: "object",
        properties: { category: strProp("类别目录名，如 20-研究") },
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
      description: "列出专题目录下的文件（不含内容）。",
      inputSchema: jsonSchema({
        type: "object",
        properties: { topicId: strProp("专题 ID：类别/专题名") },
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
      description: "获取专题概览（文件列表 + 元信息）。organize/write 常用。",
      inputSchema: jsonSchema({
        type: "object",
        properties: { topicId: strProp("专题 ID：类别/专题名") },
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
      description:
        "读取工作区相对路径的 Markdown/文本。返回带行号的 numbered 窗口（N|正文）。长文用 around= 关键词或 heading= 跳到中间，勿一次吞全文。edit_file 可把行号当 startLine/endLine。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          relativePath: strProp("工作区相对路径"),
          offset: {
            type: "number",
            description: "起始行号（1-based，默认 1）",
          },
          limit: {
            type: "number",
            description: "返回行数（默认 400；最大 2000）",
          },
          around: strProp("跳到包含该短语的行，返回其前后窗口（中段编辑首选）"),
          heading: strProp("跳到该 Markdown 标题所在节（须唯一）"),
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

    tools.search = tool({
      description:
        "只读搜索工作区 Markdown/文本（受控 grep，无 shell）。默认跳过 99-Archive。可 scope 到类别或专题路径。返回 relativePath + line + preview。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          query: strProp("关键词；regex=true 时为正则"),
          scope: strProp("可选：类别或专题路径前缀，如 20-研究 或 20-研究/2026-示例"),
          maxResults: {
            type: "number",
            description: "最多命中条数（默认 40，上限 80）",
          },
          regex: {
            type: "boolean",
            description: "true 时按正则匹配（默认 false，普通关键词）",
          },
          includeArchive: {
            type: "boolean",
            description: "true 才搜索 Archive（默认 false）",
          },
          context: {
            type: "number",
            description: "命中行前后上下文行数 0–2（默认 0）",
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
      description: "列出收件箱（Inbox）中的待分类材料。capture/organize 常用。",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      async execute() {
        try {
          return summarizeForModel(await WorkspaceService.listInbox({}, ctx));
        } catch (err) {
          return { ok: false, error: err?.message || String(err), hint: "获取收件箱列表失败。" };
        }
      },
    });

    tools.list_outputs = tool({
      description: "列出 88-Outputs 交付物。",
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
      description:
        "抓取网页正文并转为 Markdown。默认静态 HTTP+Readability；render=true 时用隐藏 Chromium 渲染 SPA。返回 truncated/likelySpa/canEnhance/warning。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          url: strProp("http(s) URL"),
          maxLen: {
            type: "number",
            description: "正文提取上限字符（默认 40000，长文可到 200000）",
          },
          render: {
            type: "boolean",
            description: "true 时启用增强渲染（SPA 空壳页）",
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
      description:
        "工作区健康巡检（loop skill）。返回结构化 JSON：{ ok, checks: [{ name, status, detail }], summary, recommendations }。可用于程序化判断工作区状态。",
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
      description:
        "列出个人待办清单（memory/todo.md）。返回活跃任务与统计；completed=true 时返回全部（含已完成）。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          completed: {
            type: "boolean",
            description: "true 时包含已完成项；默认 false（只返回未完成项）",
          },
          limit: {
            type: "number",
            description: "最多返回条数（默认 50）",
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
        description:
          "记一下：默认追加到动态周期本（每周一本）；forceInbox=true 时进收件箱；forceAtom=true 时单开文件。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            content: strProp("正文 Markdown"),
            title: strProp("可选标题"),
            source: strProp("可选出处 URL/说明"),
            sourceType: strProp("可选 source_type，默认 user-original"),
            forceInbox: { type: "boolean", description: "true → 收件箱" },
            forceAtom: { type: "boolean", description: "true → 不追加周期本，单开文件" },
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
        description: "在专题下新建或更新笔记（带 frontmatter；经写闸；仅 locked 等高影响才备份）。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            topicId: strProp("专题 ID：类别/专题名"),
            filename: strProp("文件名，如 note.md"),
            content: strProp("正文"),
            sourceType: strProp("可选 source_type"),
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
        description:
          "整文件覆盖写入 .md（经写闸；open 不备份，locked/删除才备份）。仅用于新建/大段重写；局部修改请优先 edit_file。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("工作区相对路径"),
            content: strProp("完整文件内容"),
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
        description:
          "精确局部修改 .md：oldText→newText。先唯一精确匹配，再容忍换行/行尾空白；多处命中则拒绝（或 replaceAll）。可用 startLine/endLine/heading 限定范围。失败返回 nearby/context。不写 99-Archive；整文件覆盖用 save_file。受 protection/locked 约束。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("工作区相对路径"),
            oldText: strProp("要替换的原文片段（建议含前后几行；可从 numbered 窗口复制，行号前缀会被剥掉）"),
            newText: strProp("替换后的文本（可为更长或更短）"),
            replaceAll: {
              type: "boolean",
              description: "true 时替换全部匹配；默认 false（必须唯一）",
            },
            startLine: {
              type: "number",
              description: "可选：限定匹配的起始行（1-based）",
            },
            endLine: {
              type: "number",
              description: "可选：限定匹配的结束行（含）",
            },
            heading: strProp("可选：限定在该 Markdown 标题节内匹配（须唯一）"),
          },
          required: ["relativePath", "oldText", "newText"],
        }),
        execute: wrapWrite("edit_file", ({
          relativePath, oldText, newText, replaceAll, startLine, endLine, heading, actor, confirmed,
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
              actor: actor || "ai",
              confirmed,
            },
            ctx,
          )),
      });

      tools.create_topic = tool({
        description: "在指定类别下创建新专题（名称须 YYYY-主题）。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            category: strProp("类别目录名"),
            name: strProp("专题名，如 2026-示例研究"),
          },
          required: ["category", "name"],
        }),
        execute: wrapWrite("create_topic", async ({ category, name, actor, confirmed }) => {
          const r = await WorkspaceService.createTopic({ category, name, actor, confirmed }, ctx);
          return { ...r, targetPath: r.topicId, operation: "create-topic" };
        }),
      });

      tools.append_topic_memory = tool({
        description: "向专题 topic.md 的 Stable Memory 段追加稳定结论（memory skill）。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            topicId: strProp("专题 ID：类别/专题名"),
            entry: strProp("要追加的记忆内容"),
            source: strProp("可选来源说明"),
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
        description: "更新「我的情况」（核心记忆）。仅用户明确要记住偏好/目标/关系时使用。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            entry: strProp("要追加的稳定信息"),
            section: strProp("段落：偏好 / 当前目标 / 关键的人与协作 / 进行中的事"),
            source: strProp("可选来源"),
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
        description:
          "归档「我的情况」中的过期事实：将其从当前活跃段落安全转移至「## 历史记录」，带归档日期标记，不删除原内容。仅在用户明确表示某目标已完成、偏好已过时或不再成立时调用。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            match: strProp("要归档的事实原文关键词或片段（需能唯一或清晰匹配）"),
            section: strProp("可选：限定所在的活跃段落（如 当前目标 / 进行中的事 / 偏好）"),
            reason: strProp("可选：归档原因说明"),
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
        description:
          "原位更新「我的情况」中的事实：用新的表述替换旧的事实行（保持原段落结构，自动带日期）。仅在用户明确纠正或更新现有偏好、目标等事实时调用。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            match: strProp("要修正的旧事实片段（需匹配）"),
            content: strProp("更新后的新事实内容"),
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
        description:
          "确定性整理本周动态周期本（合并完成状态、去重）。返回 changes 与候选（我的情况/专题），不自动写核心记忆。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            dryRun: { type: "boolean", description: "true=仅预览" },
            relativePath: strProp("可选指定文件；默认当前周期本"),
          },
        }),
        execute: wrapWrite("reconcile_week", ({ dryRun, relativePath, actor, confirmed }) =>
          WorkspaceService.reconcileStreamPeriod(
            { dryRun: Boolean(dryRun), apply: !dryRun, relativePath, actor: actor || "ai", confirmed },
            ctx,
          )),
      });

      tools.move_to_topic = tool({
        description:
          "把笔记移入专题（organize）。会一并移动 images/{slug}/ 关联资源；相对 Markdown 路径保持不变。可用 relativePath（任意 .md）或 inboxRelativePath。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("工作区相对路径（优先；任意位置的 .md）"),
            inboxRelativePath: strProp("兼容：Inbox 内相对路径"),
            targetTopicId: strProp("目标专题 ID：类别/专题名"),
          },
          required: ["targetTopicId"],
        }),
        execute: wrapWrite("move_to_topic", ({ relativePath, inboxRelativePath, targetTopicId, actor, confirmed }) =>
          WorkspaceService.moveToTopic({ relativePath, inboxRelativePath, targetTopicId, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.publish_to_outputs = tool({
        description:
          "发布交付副本到 88-Outputs（write 交付）。原文保留；关联 images/ 会复制到 Outputs。不是移动。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("要发布的工作区相对路径（.md）"),
          },
          required: ["relativePath"],
        }),
        execute: wrapWrite("publish_to_outputs", ({ relativePath, actor, confirmed }) =>
          WorkspaceService.publishPath({ relativePath, actor: actor || "ai", confirmed }, ctx)),
      });

      tools.delete_path = tool({
        description:
          "删除工作区文件。锁定/核心笔记（memory、topic.md、交付）会移入 99-Archive trash（可恢复）；普通开放笔记直接删除、无备份。删除 .md 时一并处理关联 images/{slug}/。仅在用户明确要求删除时使用。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("工作区相对路径，如 00-Inbox/foo.md"),
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
        description:
          "重命名工作区内的文件（同目录改名；经写闸）。.md 重命名时会同步 images/{旧stem}/→images/{新stem}/ 并改写正文引用。跨目录请用 move_to_topic。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("原相对路径"),
            newName: strProp("新文件名（不含路径，如 note-v2.md）"),
          },
          required: ["relativePath", "newName"],
        }),
        execute: wrapWrite("rename_path", async ({ relativePath, newName, actor, confirmed }) => {
          const r = await WorkspaceService.renamePath({ relativePath, newName, actor: actor || "ai", confirmed }, ctx);
          return { ...r, operation: "rename-path" };
        }),
      });

      tools.add_todo = tool({
        description:
          "向个人待办清单（memory/todo.md）原子化追加一条或多条任务。支持在任务文本中嵌入截止日期（如「完成架构重构 📅 2026-09-10」）或通过 dueDate 指定。自动去重。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            text: strProp("待办任务文本（单条）"),
            items: {
              type: "array",
              items: { type: "string" },
              description: "可选：批量追加的多条待办任务文本",
            },
            dueDate: strProp("可选：截止日期（YYYY-MM-DD）"),
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
        description:
          "切换待办事项的完成状态（已完成与未完成之间切换）。idOrText 可以是待办的文本片段或 id。标记完成时会自动打勾并记录完成时间，并同步到当前动态周期本。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            idOrText: strProp("待办文本片段或待办 ID"),
            completed: {
              type: "boolean",
              description: "可选：显式指定目标状态（true=标记完成，false=取消完成）",
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
