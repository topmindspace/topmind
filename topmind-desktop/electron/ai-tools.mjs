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
    const writebackMode = ctx.appSettings?.writebackMode || "auto";
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
              const count = text.split(args.oldText).length - 1;
              if (count >= 1) {
                content = args.replaceAll
                  ? text.split(args.oldText).join(args.newText)
                  : text.replace(args.oldText, args.newText);
              }
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
            (result.pendingId
              ? "保存前问我：写入已挂起，请在 AI 面板「待确认写入」中接受或拒绝"
              : "保存前问我：写入需确认，但未能缓存正文（请重试 save_file 全量写入）");
          result.previewContent = content || raw.previewContent;
          result.relativePath = rel;
        }
        batch.record(toolName, result);
        return result;
      } catch (err) {
        const message = err?.message || String(err);
        logError("ai-tools", `write tool ${toolName} failed`, { error: message });
        return {
          ok: false,
          tool: toolName,
          operation: toolName,
          error: message,
          note: "写入失败；可调整参数后重试，或「保存前问我」模式下在审阅条接受写入",
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
        return summarizeForModel(await WorkspaceService.listCategories({}, ctx));
      },
    });

    tools.workspace_overview = tool({
      description:
        "一次性获取工作区全貌：类别列表(含专题数) + 收件箱待处理数 + 最近动态周期本 + 输出数。减少多次 list_* 调用。系统提示词已内联部分概览，此工具获取更完整实时数据。",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      execute: wrapRead(async function workspace_overview() {
        const [cats, inbox, outputs, streamCtx] = await Promise.all([
          WorkspaceService.listCategories({}, ctx),
          WorkspaceService.listInbox({}, ctx),
          WorkspaceService.listOutputs({}, ctx),
          WorkspaceService.getStreamContext({}, ctx),
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
        return summarizeForModel(await WorkspaceService.listTopics({ category }, ctx));
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
        return summarizeForModel(await WorkspaceService.listTopicFiles({ topicId }, ctx));
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
        return summarizeForModel(await WorkspaceService.getTopic({ topicId }, ctx));
      },
    });

    tools.read_file = tool({
      description:
        "读取工作区相对路径的 Markdown/文本。支持按行窗口：offset（起始行，1-based）+ limit（行数，默认整文件上限 400 行）。长文务必分页读，勿一次吞全文。",
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
            description: "返回行数（默认 400；最大 2000；省略则尽量整文件）",
          },
        },
        required: ["relativePath"],
      }),
      execute: wrapRead(async function read_file({ relativePath, offset, limit }) {
        // Windowed read protects context: default 400 lines unless caller sets limit.
        const hasExplicitLimit = limit != null && limit !== "";
        const win = await WorkspaceService.readPathWindow({
          relativePath,
          offset: offset ?? 1,
          limit: hasExplicitLimit ? limit : 400,
        }, ctx);
        return summarizeForModel(win, 14000);
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
      }),
    });

    tools.list_inbox = tool({
      description: "列出收件箱（Inbox）中的待分类材料。capture/organize 常用。",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      async execute() {
        return summarizeForModel(await WorkspaceService.listInbox({}, ctx));
      },
    });

    tools.list_outputs = tool({
      description: "列出 88-Outputs 交付物。",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      async execute() {
        return summarizeForModel(await WorkspaceService.listOutputs({}, ctx));
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
        return summarizeForModel(
          await WorkspaceService.fetchUrl({ url, maxLen, render: Boolean(render) }, ctx),
          14000,
        );
      },
    });

    tools.workspace_health = tool({
      description:
        "工作区健康巡检（loop skill）。返回结构化 JSON：{ ok, checks: [{ name, status, detail }], summary, recommendations }。可用于程序化判断工作区状态。",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
      execute: wrapRead(async function workspace_health() {
        return summarizeForModel(await WorkspaceService.workspaceHealth({}, ctx), 10000);
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
        execute: wrapWrite("capture_to_inbox", ({ content, title, source, sourceType, forceInbox, forceAtom }) =>
          WorkspaceService.ingestInbox(
            {
              content,
              title,
              source,
              sourceType: sourceType || "user-original",
              dest: forceInbox
                ? { mode: "inbox" }
                : { mode: "stream", forceAtom: Boolean(forceAtom) },
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
          "精确局部修改 .md：oldText→newText（须唯一精确匹配，或 replaceAll）。不写 99-Archive（轻量改稿）；整文件覆盖用 save_file。改稿/润色首选。受 protection/locked 约束。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("工作区相对路径"),
            oldText: strProp("必须与文件内容精确匹配的原文片段（建议含前后几行上下文）"),
            newText: strProp("替换后的文本（可为更长或更短）"),
            replaceAll: {
              type: "boolean",
              description: "true 时替换全部匹配；默认 false（必须唯一匹配）",
            },
          },
          required: ["relativePath", "oldText", "newText"],
        }),
        execute: wrapWrite("edit_file", ({ relativePath, oldText, newText, replaceAll, actor, confirmed }) =>
          WorkspaceService.editPath(
            {
              relativePath,
              oldText,
              newText,
              replaceAll: Boolean(replaceAll),
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
        execute: wrapWrite("reconcile_week", ({ dryRun, relativePath }) =>
          WorkspaceService.reconcileStreamPeriod(
            { dryRun: Boolean(dryRun), apply: !dryRun, relativePath },
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
        execute: wrapWrite("move_to_topic", ({ relativePath, inboxRelativePath, targetTopicId }) =>
          WorkspaceService.moveToTopic({ relativePath, inboxRelativePath, targetTopicId }, ctx)),
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
        execute: wrapWrite("publish_to_outputs", ({ relativePath }) =>
          WorkspaceService.publishPath({ relativePath }, ctx)),
      });

      tools.delete_path = tool({
        description:
          "删除工作区文件（可逆：99-Archive trash）。删除 .md 时会一并回收关联 images/{slug}/。用户明确要求删除时使用。",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            relativePath: strProp("工作区相对路径，如 00-Inbox/foo.md"),
          },
          required: ["relativePath"],
        }),
        execute: wrapWrite("delete_path", async ({ relativePath }) => {
          const r = await WorkspaceService.deletePath({ relativePath }, ctx);
          return {
            ...r,
            targetPath: relativePath,
            operation: "delete-path",
            reversible: true,
            note: r?.note || "已可逆删除（Archive 可恢复；关联图片一并 trash）",
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
        execute: wrapWrite("rename_path", async ({ relativePath, newName }) => {
          const r = await WorkspaceService.renamePath({ relativePath, newName }, ctx);
          return { ...r, operation: "rename-path" };
        }),
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
