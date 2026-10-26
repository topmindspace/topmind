/** Portable agent tool contract. Canonical source: Kernel lib/agent-tool-catalog.mjs.
 * Hosts provide execution and transport; this module owns names, schemas and descriptions.
 * Desktop's electron/lib/ai-tool-names.mjs is a byte-identical build snapshot. */

export function buildAgentToolCatalog({ locale = "zh-CN", host } = {}) {
  const d = (zh, en) => String(locale).startsWith("en") ? en : zh;
  const strProp = (description) => ({ type: "string", description });
  const definitions = {
    render_article: {
      effect: "read", hosts: ["desktop", "obsidian"],
      description: d("从工作区 Markdown 源稿生成公众号、X 长文或文本排版，返回 HTML、文本、图片状态和诊断；不修改原稿、不发布。需要落盘时另用文件写入工具。", "Render a workspace Markdown source for WeChat, X Article or text. Returns HTML, text, image status and diagnostics. Does not change or publish the source. Use a file write tool to persist a delivery."),
      inputSchema: { type: "object", properties: { sourcePath: strProp(d("源稿相对路径", "Workspace-relative Markdown source")), platform: { type: "string", enum: ["wechat", "x", "text"] }, theme: { type: "string", enum: ["minimal-ink", "tech-blue", "newsprint", "graphite"] } }, required: ["sourcePath"] },
    },
    list_skills: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
          "列出可用 skills（id + 简述）。需要特定工作流指导时，再激活对应技能。",
          "List available skills (id + short description). Activate a relevant skill when task-specific guidance is useful.",
        ),
      inputSchema: { type: "object", properties: {} },
    },
    load_skill: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
          "激活 skill 全文（Activation）。skillId 如 topmind-capture / topmind。执行流程前调用。",
          "Activate a skill body. skillId examples: topmind-capture / topmind. Call before following a workflow.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            skillId: strProp(
              d("skill id，如 topmind-capture、topmind、topmind-organize", "skill id, e.g. topmind-capture, topmind, topmind-organize"),
            ),
          },
          required: ["skillId"],
        },
    },
    load_skill_resource: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
          "加载 skill 资源（Resources）：shared/*.md 或 skill references/*。传 skillId 时按该技能来源加载，支持 references/*、../shared/*；否则相对 skills 根。",
          "Load a skill resource: shared/*.md or skill references/*. Pass skillId to resolve references/* or ../shared/* from that skill; otherwise use a pack-relative path.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            skillId: strProp(d("所属 skill id（推荐，避免扩展资源混用）", "Owning skill id (recommended for source-consistent resources)")),
            path: strProp(
              d("相对 skills 根路径，如 shared/capability-degradation.md", "Path under the skills root, e.g. shared/capability-degradation.md"),
            ),
          },
          required: ["path"],
        },
    },
    list_categories: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出工作区类别（directory/slot/role/specialBehavior）。系统提示词已内联概览时无需调用。",
        "List workspace categories (directory/slot/role/specialBehavior). Skip if the system prompt already inlines an overview.",
      ),
      inputSchema: { type: "object", properties: {} },
    },
    workspace_overview: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "一次性获取工作区全貌：类别列表(含专题数) + Inbox 待处理数 + 最近动态周期本 + 交付数。减少多次 list_* 调用。系统提示词已内联部分概览，此工具获取更完整实时数据。",
        "One-shot workspace overview: categories (with topic counts) + Inbox count + current stream period + outputs count. Prefer this over many list_* calls.",
      ),
      inputSchema: { type: "object", properties: {} },
    },
    list_topics: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d("列出某类别下的专题与单篇笔记。", "List topics and loose notes under a category."),
      inputSchema: {
        type: "object",
        properties: {
          category: strProp(d("类别目录名，如 20-研究", "Category directory name, e.g. 20-研究")),
        },
        required: ["category"],
      },
    },
    list_topic_files: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d("列出专题目录下的文件（不含内容）。", "List files under a topic directory (names only)."),
      inputSchema: {
        type: "object",
        properties: {
          topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
        },
        required: ["topicId"],
      },
    },
    get_topic: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "获取专题概览（文件列表 + 元信息）。organize/write 常用。",
        "Get a topic overview (file list + metadata). Common for organize/write.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
        },
        required: ["topicId"],
      },
    },
    read_file: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "读取工作区相对路径的 Markdown/文本。返回带行号的 numbered 窗口（N|正文）+ contentHash（传给 edit_file 的 expectedHash）。长文用 around= 关键词或 heading= 跳到中间，勿一次吞全文。edit_file 可把行号当 startLine/endLine。",
        "Read a workspace-relative markdown/text file. Returns a numbered window (N|body) + contentHash (pass to edit_file expectedHash). For long files use around= or heading= instead of swallowing the whole file. edit_file accepts the same line numbers as startLine/endLine.",
      ),
      inputSchema: {
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
      },
    },
    list_files: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出工作区目录（name/type/size/mtime/ext）。path 空=工作区根；memory/ 与 .topmind/ 可读。",
        "List a workspace directory (name/type/size/mtime/ext). Empty path = workspace root; memory/ and .topmind/ are readable.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          relativePath: strProp(d("目录相对路径；空=根", "Directory relative path; empty = root")),
          includeSystem: { type: "boolean", description: d("true 时含隐藏/系统条目", "true includes hidden/system entries") },
        },
      },
    },
    glob_files: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "按 glob 模式找工作区文件（无 shell）。默认跳过 99-归档。支持 * ** ?。返回 relativePath/size/mtime。",
        "Find workspace files by glob (no shell). Skips 99-Archive by default. Supports * ** ?. Returns relativePath/size/mtime.",
      ),
      inputSchema: {
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
      },
    },
    stat_path: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "查看工作区路径元信息（type/size/mtime/ext/isBinaryExt）。不读正文。",
        "Stat a workspace path (type/size/mtime/ext/isBinaryExt). Does not read content.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          relativePath: strProp(d("工作区相对路径", "Workspace-relative path")),
        },
        required: ["relativePath"],
      },
    },
    search: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "只读搜索工作区 Markdown/文本（受控 grep，无 shell）。默认跳过 99-Archive。可 scope 到类别或专题路径。返回 relativePath + line + preview。",
        "Read-only workspace markdown/text search (controlled grep, no shell). Skips 99-Archive by default. Optional scope prefix. Returns relativePath + line + preview.",
      ),
      inputSchema: {
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
      },
    },
    list_inbox: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出 Inbox 中的待分类材料。capture/organize 常用。",
        "List unfiled Inbox materials. Common for capture/organize.",
      ),
      inputSchema: { type: "object", properties: {} },
    },
    list_outputs: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d("列出 88-Outputs 交付物。", "List delivery artifacts under 88-Outputs."),
      inputSchema: { type: "object", properties: {} },
    },
    web_search: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "网络搜索（无需 API Key）。返回标题/链接/摘要短列表；用它找最新事实、文档、竞品、新闻。命中后用 fetch_url 打开高相关链接取全文。引用来源时保留 URL。",
        "Web search (no API key). Returns a shortlist of title/url/snippet. Use it for current facts, docs, news, competitors. Then fetch_url the most relevant links for full text. Keep source URLs when citing.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          query: strProp(d("搜索关键词（可中文/英文）", "Search keywords (Chinese or English)")),
          limit: {
            type: "number",
            description: d("返回条数（默认 6，最多 8）", "Number of results (default 6, max 8)"),
          },
        },
        required: ["query"],
      },
    },
    fetch_url: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "抓取网页正文并转为 Markdown。一次调用=最高质量：X 状态走 fxtwitter 结构化；GitHub md/README 走 raw 直取；网页 Readability，SPA 空壳自动 render。返回 truncated/likelySpa/canEnhance/warning/image。",
        "Fetch a web page and convert to Markdown. One call = best quality: X status via fxtwitter structured API; GitHub md/README via raw; web via Readability with auto-render for SPA shells. Returns truncated/likelySpa/canEnhance/warning/image.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          url: strProp("http(s) URL"),
          maxLen: {
            type: "number",
            description: d("正文提取上限字符（默认 200000 全量）", "Max body chars (default 200000 full)"),
          },
          render: {
            type: "boolean",
            description: d("true 时启用增强渲染（SPA 空壳页）", "true enables enhanced rendering for SPA shells"),
          },
        },
        required: ["url"],
      },
    },
    capture_url: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
        "一键入库：抓取网页并保存到工作区（默认动态周期本；forceInbox→Inbox）。自动带 source URL 与标题，适合把搜索/研究到的页面沉淀为笔记。",
        "One-shot ingest: fetch a page and save it into the workspace (default stream period note; forceInbox→Inbox). Carries source URL + title — ideal for archiving pages found during research.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          url: strProp(d("http(s) URL", "http(s) URL")),
          title: strProp(d("可选覆盖标题", "Optional title override")),
          note: strProp(d("可选补充笔记（附加在正文前）", "Optional note prepended to the body")),
          forceInbox: {
            type: "boolean",
            description: d("true → Inbox；默认动态周期本", "true → Inbox; default stream period note"),
          },
          forceAtom: {
            type: "boolean",
            description: d("true → 单开文件，不追加周期本", "true → standalone file, not period note"),
          },
          render: {
            type: "boolean",
            description: d("SPA 空壳页启用增强渲染", "Enable enhanced rendering for SPA shells"),
          },
        },
        required: ["url"],
      },
    },
    workspace_health: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "工作区健康巡检（结构 + 契约 inspectContract + counts）。返回 JSON：{ ok, checks, summary, issues }。容量/重复/清理走 Desktop「工具与日志」面板（⌘⇧L），不进默认 AI 工具。",
        "Workspace health check (structure + inspectContract + counts). Returns { ok, checks, summary, issues }. Capacity/dedupe/cleanup live in the Tools & Logs panel (⌘⇧L), not this tool.",
      ),
      inputSchema: { type: "object", properties: {} },
    },
    list_todos: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出个人待办清单（memory/todo.md）。返回活跃任务与统计；completed=true 时返回全部（含已完成）。",
        "List the personal todo list (memory/todo.md). Returns open tasks + stats; completed=true includes finished items.",
      ),
      inputSchema: {
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
      },
    },
    list_recent_memories: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出「我的情况」最近记忆条目（memory/profile 活跃事实 · periodic 周期反思 · topics 专题记忆）。回答「最近的记忆 / 最近记了什么 / 我的情况里有什么」用这个，不要自己猜路径读 memory/。",
        "List recent memory entries (active profile facts · periodic reflections · topic memories). Use for 'recent memories / what did I note / what's in my profile' — do not guess memory/ paths.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          layer: {
            type: "string",
            description: d(
              "过滤层：all（默认）| profile | periodic | topic",
              "Layer filter: all (default) | profile | periodic | topic",
            ),
          },
          limit: {
            type: "number",
            description: d("最多返回条数（默认 12，上限 40）", "Max items (default 12, cap 40)"),
          },
        },
      },
    },
    list_recent_stream: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出动态最近条目（周期本 stream）。「最近记了什么 / 今天记下了啥 / 动态里有什么」用这个；「最近的记忆 / 我的情况」用 list_recent_memories。",
        "List recent stream entries (period notes). Use for 'what did I log recently / stream contents'; use list_recent_memories for profile/memory questions.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: d("最多返回条目数（默认 12，上限 40）", "Max entries (default 12, cap 40)"),
          },
          periods: {
            type: "number",
            description: d("扫描最近几个周期本（默认 2，上限 4）", "How many recent period notes to scan (default 2, cap 4)"),
          },
        },
      },
    },
    list_pending_writes: {
      effect: "read",
      hosts: ["desktop","obsidian"],
      description: d(
        "列出待确认写入（confirm 模式下删除/归档等挂起项）。用户问「还有什么要确认 / pending」时用。",
        "List pending writes awaiting user confirm (confirm-mode delete/archive). Use when the user asks what still needs confirmation.",
      ),
      inputSchema: { type: "object", properties: {} },
    },
    capture_to_inbox: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "记一下：默认追加到动态周期本（每周一本）；forceInbox=true 时进 Inbox；forceAtom=true 时单开文件。",
          "Capture: append to the current stream period note by default; forceInbox=true routes to Inbox; forceAtom=true creates a standalone file.",
        ),
      inputSchema: {
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
        },
    },
    save_note: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "在专题下新建或更新笔记的便捷入口（等价于 save_file 到 {topicId}/{filename}）。多数场景请直接用 save_file 指定完整相对路径。",
          "Convenience create/update under a topic (same as save_file to {topicId}/{filename}). Prefer save_file with a full relative path in most cases.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
            filename: strProp(d("文件名，如 note.md", "Filename, e.g. note.md")),
            content: strProp(d("正文", "Body content")),
            sourceType: strProp(d("可选 source_type", "Optional source_type")),
          },
          required: ["topicId", "filename", "content"],
        },
    },
    save_file: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "统一写入入口：新建或整文件覆盖工作区相对路径 .md（经写闸）。多段重写/结构调整/新建首选；locked 可编辑（任务内首写快照一次）。小改用 edit_file。",
          "Primary write entry: create or fully overwrite a workspace-relative .md via the write gate. Prefer for multi-section rewrites, structural edits, and new files. Locked notes are editable (one pre-write snapshot per task). Use edit_file for small spans.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(
              d("工作区相对路径", "Workspace-relative path"),
            ),
            content: strProp(d("完整文件内容", "Full file content")),
          },
          required: ["relativePath", "content"],
        },
    },
    edit_file: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "精确局部修改 .md：oldText→newText。匹配阶梯：唯一精确 → 换行/行尾空白归一 → 行级宽松（空行/列表标记/加粗）。多处命中则拒绝（或 replaceAll）。可用 startLine/endLine/heading 限定范围（行号过期时会自动外扩重试）。推荐传 expectedHash（read_file/edit_file 返回的 contentHash）做乐观并发校验。成功返回 postEditWindow + 新 contentHash，多步编辑请用它们，勿沿用更早 read 的行号。失败返回 nearby/context。不写 99-Archive；整文件覆盖用 save_file。",
          "Precise span edit on .md: oldText→newText. Match ladder: unique exact → newline/trailing-ws normalize → relaxed line (blank/list/bold). Multiple hits are rejected (or use replaceAll). Optional startLine/endLine/heading scope (auto-widens if stale). Prefer expectedHash from read_file/edit_file for optimistic concurrency. Success returns postEditWindow + new contentHash — reuse those for multi-step edits. Failure returns nearby/context. Never writes 99-Archive; full overwrite uses save_file.",
        ),
      inputSchema: {
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
        },
    },
    create_topic: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "在指定类别下创建新专题（名称须 YYYY-主题）。",
          "Create a new topic under a category (name must be YYYY-theme).",
        ),
      inputSchema: {
          type: "object",
          properties: {
            category: strProp(d("类别目录名", "Category directory name")),
            name: strProp(d("专题名，如 2026-示例研究", "Topic name, e.g. 2026-sample-research")),
          },
          required: ["category", "name"],
        },
    },
    append_topic_memory: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "向专题 topic.md 的 Stable Memory 段追加稳定结论（memory skill）。",
          "Append a stable conclusion to the topic.md Stable Memory section (memory skill).",
        ),
      inputSchema: {
          type: "object",
          properties: {
            topicId: strProp(d("专题 ID：类别/专题名", "Topic id: category/topic")),
            entry: strProp(d("要追加的记忆内容", "Memory entry to append")),
            source: strProp(d("可选来源说明", "Optional source note")),
          },
          required: ["topicId", "entry"],
        },
    },
    append_core_memory: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "更新「我的情况」（核心记忆）。仅用户明确要记住偏好/目标/关系时使用。",
          "Update core memory (about me). Use only when the user explicitly wants a preference/goal/relationship remembered.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            entry: strProp(d("要追加的稳定信息", "Stable fact to append")),
            section: strProp(d("段落：偏好 / 当前目标 / 关键的人与协作 / 进行中的事", "Section: preferences / current goals / key people / in progress")),
            source: strProp(d("可选来源", "Optional source")),
          },
          required: ["entry"],
        },
    },
    retire_core_memory: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "归档「我的情况」中的过期事实：将其从当前活跃段落安全转移至「## 历史记录」，带归档日期标记，不删除原内容。仅在用户明确表示某目标已完成、偏好已过时或不再成立时调用。",
          "Retire a stale fact from core memory: move it from the active section into ## 历史记录 with a dated marker — never delete the original. Call only when the user says a goal finished or a preference no longer holds.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            match: strProp(d("要归档的事实原文关键词或片段（需能唯一或清晰匹配）", "Keywords/span of the fact to retire (must match clearly)")),
            section: strProp(d("可选：限定所在的活跃段落（如 当前目标 / 进行中的事 / 偏好）", "Optional active section scope")),
            reason: strProp(d("可选：归档原因说明", "Optional reason")),
          },
          required: ["match"],
        },
    },
    update_core_memory: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "原位更新「我的情况」中的事实：用新的表述替换旧的事实行（保持原段落结构，自动带日期）。仅在用户明确纠正或更新现有偏好、目标等事实时调用。",
          "Update a core-memory fact in place: replace the old fact line (section structure kept, date stamped). Call only when the user explicitly corrects or updates a preference/goal.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            match: strProp(d("要修正的旧事实片段（需匹配）", "Old fact span to match")),
            content: strProp(d("更新后的新事实内容", "Updated fact content")),
          },
          required: ["match", "content"],
        },
    },
    restore_core_memory: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "恢复「我的情况」历史记录中的事实到活跃段落（retire 的逆操作）。仅在用户确认某条历史事实仍有效、需要重新生效时调用。",
          "Restore an archived core-memory fact from ## 历史记录 back to a live section (inverse of retire). Call only when the user confirms a historical fact should be live again.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            match: strProp(d("历史事实原文关键词或片段", "Keywords/span of the archived fact")),
            section: strProp(d("可选：目标活跃段落", "Optional target live section")),
          },
          required: ["match"],
        },
    },
    compact_core_memory_history: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "压缩「我的情况」历史记录中的近重复行（保留最新，丢弃更早近重复）。会永久丢弃历史行，必须用户确认后才可调用。",
          "Compact near-duplicate rows in core-memory ## 历史记录 (keep newest, drop older near-dups). Permanently drops history lines — only call after the user confirms.",
        ),
      inputSchema: {
          type: "object",
          properties: {},
        },
    },
    reconcile_week: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "确定性整理本周动态周期本（合并完成状态、去重）。返回 changes 与候选（我的情况/专题），不自动写核心记忆。",
          "Deterministic tidy of the current stream period (merge completions, dedupe). Returns changes + candidates (memory/topics); never auto-writes core memory.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            dryRun: { type: "boolean", description: d("true=仅预览", "true = preview only") },
            relativePath: strProp(d("可选指定文件；默认当前周期本", "Optional file; defaults to the current period note")),
          },
        },
    },
    move_to_topic: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "把笔记移入专题（organize）。写闸提交后才会移动 images/{slug}/ 关联资源；相对 Markdown 路径保持不变。可用 relativePath（任意 .md）或 inboxRelativePath。",
          "Move a note into a topic (organize). images/{slug}/ assets move only after the write gate commits; relative markdown refs stay intact. Use relativePath (any .md) or inboxRelativePath.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(d("工作区相对路径（优先；任意位置的 .md）", "Workspace-relative path (preferred; any .md)")),
            inboxRelativePath: strProp(d("兼容：Inbox 内相对路径", "Compat: path relative to Inbox")),
            targetTopicId: strProp(d("目标专题 ID：类别/专题名", "Target topic id: category/topic")),
          },
          required: ["targetTopicId"],
        },
    },
    publish_to_outputs: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "发布交付副本到 88-Outputs（write 交付）。原文保留；关联 images/ 会在写闸提交后复制到 Outputs。不是移动。",
          "Publish a delivery snapshot into 88-Outputs. Original note stays; associated images/ are copied after the write gate commits. This is a copy, not a move.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(
              d("要发布的工作区相对路径（.md）", "Workspace-relative .md path to publish"),
            ),
          },
          required: ["relativePath"],
        },
    },
    delete_path: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "删除工作区文件。锁定/核心笔记（memory、topic.md、交付）会移入 99-Archive trash（可恢复）；普通开放笔记直接删除、无备份。删除 .md 时一并处理关联 images/{slug}/。仅在用户明确要求删除时使用。",
          "Delete a workspace file. Locked/core notes (memory, topic.md, delivery) move to 99-Archive trash (recoverable); ordinary open notes are unlinked with no trash. Associated images/{slug}/ are handled after the write gate commits. Use only when the user explicitly asked to delete.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(
              d("工作区相对路径，如 00-Inbox/foo.md", "Workspace-relative path, e.g. 00-Inbox/foo.md"),
            ),
          },
          required: ["relativePath"],
        },
    },
    rename_path: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "重命名工作区内的文件（同目录改名；经写闸）。.md 重命名时会同步 images/{旧stem}/→images/{新stem}/ 并改写正文引用。跨目录请用 move_to_topic。",
          "Rename a file in place (same directory; via write gate). Renaming .md also renames images/{oldStem}/ → images/{newStem}/ and rewrites body refs. Use move_to_topic for cross-directory moves.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(d("原相对路径", "Original relative path")),
            newName: strProp(d("新文件名（不含路径，如 note-v2.md）", "New filename only, e.g. note-v2.md")),
          },
          required: ["relativePath", "newName"],
        },
    },
    create_dir: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "创建工作区目录（递归，幂等）。经写闸评估保护。",
          "Create a workspace directory (recursive, idempotent). Goes through the write gate.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(d("目录相对路径", "Directory-relative path")),
          },
          required: ["relativePath"],
        },
    },
    copy_file: {
      effect: "write",
      hosts: ["desktop"],
      description: d(
          "工作区内复制文件。目标已存在时拒绝，除非 overwrite=true。文本经写闸，二进制过保护门。",
          "Copy a file inside the workspace. Refuses when dest exists unless overwrite=true. Text goes through the write gate; binaries pass the protection gate.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(d("源相对路径", "Source relative path")),
            destRelativePath: strProp(d("目标相对路径", "Destination relative path")),
            overwrite: { type: "boolean", description: d("true 才覆盖已存在目标", "true allows overwriting an existing dest") },
          },
          required: ["relativePath", "destRelativePath"],
        },
    },
    add_todo: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "向个人待办清单（memory/todo.md）原子化追加一条或多条任务。支持在任务文本中嵌入截止日期（如「完成架构重构 📅 2026-09-10」）或通过 dueDate 指定。自动去重。",
          "Atomically append one or more todos to memory/todo.md. Due dates can be embedded in the text (e.g. 'finish refactor 📅 2026-09-10') or passed via dueDate. Auto-dedupes.",
        ),
      inputSchema: {
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
        },
    },
    toggle_todo: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "切换待办事项的完成状态（已完成与未完成之间切换）。idOrText 可以是待办的文本片段或 id。标记完成时会自动打勾并记录完成时间，并同步到当前动态周期本。",
          "Toggle a todo between open and done. idOrText may be a text fragment or id. Completing checks the item, stamps completion time, and syncs to the current stream period.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            idOrText: strProp(d("待办文本片段或待办 ID", "Todo text fragment or id")),
            completed: {
              type: "boolean",
              description: d("可选：显式指定目标状态（true=标记完成，false=取消完成）", "Optional explicit target state"),
            },
          },
          required: ["idOrText"],
        },
    },
    update_todo: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "修改待办文本（改写任务描述）。idOrText 定位原条目，newText 是完整新文本。",
          "Rewrite a todo's text. idOrText locates the item; newText is the full replacement.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            idOrText: strProp(d("待办文本片段或待办 ID", "Todo text fragment or id")),
            newText: strProp(d("完整新文本", "Full replacement text")),
            dueDate: strProp(d("可选：同时设置/清除截止（YYYY-MM-DD 或空）", "Optional due date YYYY-MM-DD or empty to clear")),
          },
          required: ["idOrText", "newText"],
        },
    },
    set_todo_due: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "设置或清除待办截止日期。dueDate 传 YYYY-MM-DD；传空字符串清除。",
          "Set or clear a todo due date. Pass YYYY-MM-DD, or empty string to clear.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            idOrText: strProp(d("待办文本片段或待办 ID", "Todo text fragment or id")),
            dueDate: strProp(d("YYYY-MM-DD，或空字符串清除", "YYYY-MM-DD, or empty string to clear")),
          },
          required: ["idOrText", "dueDate"],
        },
    },
    delete_todo: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "删除一条待办（用户明确说不要了才用）。优先 toggle 完成而不是删除。",
          "Delete a todo (only when the user explicitly says drop it). Prefer toggle-to-done over delete.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            idOrText: strProp(d("待办文本片段或待办 ID", "Todo text fragment or id")),
          },
          required: ["idOrText"],
        },
    },
    append_stream_entry: {
      effect: "write",
      hosts: ["desktop","obsidian"],
      description: d(
          "增补：对动态已有条目续写（同文件评论感）。relativePath 是周期本，heading 是条目标题，content 是续写正文。不要用来新开条目——那用 capture_to_inbox。",
          "Append a comment-like continuation under an existing stream entry (same period note). relativePath = period note, heading = entry title, content = the follow-up. For a new entry use capture_to_inbox.",
        ),
      inputSchema: {
          type: "object",
          properties: {
            relativePath: strProp(d("周期本相对路径（如 10-动态/2026/2026-W40.md）", "Period note relative path")),
            heading: strProp(d("目标条目标题（该条的 ## 标题）", "Target entry heading (its ## title)")),
            content: strProp(d("续写正文 Markdown", "Follow-up markdown body")),
            startLine: { type: "number", description: d("可选：条目起始行（精准锚定）", "Optional entry start line") },
            endLine: { type: "number", description: d("可选：条目结束行", "Optional entry end line") },
            anchorText: strProp(d("可选：条目锚文本（无行号时定位）", "Optional anchor text when no line numbers")),
          },
          required: ["relativePath", "content"],
        },
    },
    propose_memory_change: {
      effect: "proposal", hosts: ["obsidian"],
      description: d("提出画像记忆变更，生成用户可审阅的建议卡片；此工具不写入记忆。", "Propose a profile change as a reviewable suggestion. This tool does not write memory."),
      inputSchema: { type: "object", properties: { action: { type: "string", enum: ["append_profile", "update_profile", "retire_profile"] }, content: { type: "string", maxLength: 2000 }, match: { type: "string", maxLength: 500 }, section: { type: "string", maxLength: 100 }, title: { type: "string", maxLength: 100 } } },
    }
  };
  if (host === "obsidian") {
    // Host capabilities differ: requestUrl does not render pages; discovery of
    // memories is profile-only. Do not advertise arguments the host ignores.
    const omit = { capture_to_inbox: ["title", "source", "sourceType"], save_note: ["sourceType"], list_files: ["includeSystem"], fetch_url: ["render"], capture_url: ["render"], list_recent_memories: ["layer", "limit"], list_recent_stream: ["periods"] };
    for (const [name, keys] of Object.entries(omit)) {
      for (const key of keys) delete definitions[name].inputSchema.properties[key];
    }
    definitions.list_recent_memories.description = d("读取当前有效画像事实（历史折叠）。更多记忆请使用 search/read_file。", "Read active profile facts with history collapsed. Use search/read_file for other memory sources.");
    definitions.list_recent_stream.description = d("列出近期动态周期本的实际路径，再用 read_file 读取条目。", "Discover recent stream period paths, then use read_file to read entries.");
    definitions.fetch_url.description = d("通过宿主 HTTP 抓取 URL 正文，不执行网页脚本。", "Fetch URL content through host HTTP without executing page scripts.");
  }
  return Object.fromEntries(Object.entries(definitions).filter(([, spec]) => !host || spec.hosts.includes(host)));
}

const desktop = buildAgentToolCatalog({ host: "desktop" });
export const AI_TOOL_NAMES_READ = Object.freeze(Object.keys(desktop).filter(name => desktop[name].effect === "read"));
export const AI_TOOL_NAMES_WRITE = Object.freeze(Object.keys(desktop).filter(name => desktop[name].effect === "write"));

export function getAgentToolDefinition(name, options) {
  const spec = buildAgentToolCatalog(options)[name];
  if (!spec) throw new Error(`Unsupported agent tool: ${name}`);
  return spec;
}

/** Legacy text callers keep their public aliases; native tools use canonical names. */
export function normalizeAgentToolCall(call) {
  if (!call || typeof call !== "object" || Array.isArray(call)) throw new Error("tool-call-must-be-object");
  const result = { ...call, tool: String(call.tool || call.name || "") };
  if (result.tool === "capture") {
    result.tool = "capture_to_inbox";
    if (call.target === "inbox") result.forceInbox = true;
  }
  if (result.tool === "save_note" && call.relativePath) result.tool = "save_file";
  if (["toggle_todo", "update_todo", "set_todo_due", "delete_todo"].includes(result.tool)) {
    result.idOrText = call.idOrText || call.id || call.text || "";
  }
  if (result.tool === "update_todo") result.newText = call.newText || call.text || "";
  if (result.tool === "set_todo_due" && call.dueDate === null) result.dueDate = "";
  if (result.tool === "glob_files" && call.limit != null && call.maxResults == null) result.maxResults = call.limit;
  return result;
}

/** Human fallback protocol is generated from the same schemas used by native providers. */
export function formatAgentToolGuide({ locale = "zh-CN", host = "obsidian", turnKind = "task" } = {}) {
  const english = String(locale).startsWith("en");
  const catalog = filterAgentToolsForTurn(buildAgentToolCatalog({ locale, host }), turnKind);
  const lines = Object.entries(catalog).map(([name, spec]) => {
    const required = new Set(spec.inputSchema.required || []);
    const parameters = Object.entries(spec.inputSchema.properties || {}).map(([key, schema]) => `${key}${required.has(key) ? "" : "?"}:${schema.type || "value"}`).join(", ");
    return `- ${name}(${parameters}): ${spec.description}`;
  });
  return [english ? "Available workspace tools (parameters marked ? are optional):" : "可用工作区工具（? 为可选参数）：", ...lines].join("\n");
}

/** Same advertised and callable tool subset on every host. */
export function filterAgentToolsForTurn(tools, kind) {
  if (!tools || typeof tools !== "object" || kind === "light") return {};
  if (kind === "task") return { ...tools };
  const catalog = buildAgentToolCatalog();
  return Object.fromEntries(Object.entries(tools).filter(([name]) => catalog[name]?.effect === "read"));
}
