# TOOLS.md — UTR 命令面 · 写回 · Frontmatter

> **位置**：本文档是 UTR 命令面、写入语义、note frontmatter 字段的**唯一真源**。  
> 产品入口：根 `README.md`（简体中文）· `README.en.md`（English）；UTR 模块 README 同此约定。  
> **6 条核心规约**与**三平面模型**：`PROJECT-MODEL.md`。  
> **行为契约**：工作区根 `topmind.yaml`（顶层键白名单：`contract_version` + workspace / categories / stream / memory / protection / lifecycle / writeback / ingest / agent / presentation）。  
> UTR 对 Skills/agent 仍为**可选**底座；Desktop 安装包 **捆绑** `utr/`（Tools 控制台 / doctor），但日常编辑与 AI 写回不强制走 UTR（`PRODUCT-BOUNDARIES.md`）。  
> **架构**：UTR = Kernel 的 CLI/MCP **adapter**（非第三套业务语义）。耐久**文本类**（.md/.txt/.json/.yaml/.csv/代码/配置）主写经 `lib/writeback-engine.mjs`（**Done**，见 `docs/ARCHITECTURE-RESET.md` §2.2）；备份/回执**仅高影响**（locked 覆盖 · 锁定/核心 delete）；归档=迁入 role:system 当新家 `{archive}/{category}-{topic}-{stamp}/`（含 `archive-receipt.json`；文件级 trash/backup 另有 `backups/trash`）；open 常规更新/删除不备份；二进制走独立 `saveBinary`/媒体通道（不经文本写闸字符串路径）。  
> **类别按角色**：inbox / delivery / archive 解析走现场契约与 `{NN-…}` 目录，不把 `00-Inbox` 当唯一 inbox。
> 保存设置仅 **auto | confirm**（无 batch；UTR 对显式 `batch`/未知模式 **硬拒绝**，不 silent 映射）。

## Roots

```text
Engine root:
  topmind/

User data root（三平面工作区）:
  {workspace}/
  ├── topmind.yaml          系统平面：唯一行为契约
  ├── 00-Inbox/ … 88-交付/ 99-归档/   内容平面：编号类别（自发现；用户改名同等有效）
  ├── memory/               语义平面：持续记忆（固化目录，英文名不改名）
  └── .topmind/             系统平面：机器态（index/loop/logs）

Desktop runtime state (not content truth; default home):
  ~/topmind/topmind-desktop/state/     # override: topmind_DESKTOP_HOME
  ~/topmind/topmind-desktop/plugins/
  ~/topmind/topmind-desktop/skills-extra/
```

Do not put user data in the engine root. Do not treat Desktop runtime state as canonical content.

## UTR Boundary（可选 agent 底座）

> **产品边界真源**：`PRODUCT-BOUNDARIES.md`。  
> UTR **不是** Skills 或 Desktop 的必需运行时。Skills 主路径 = host 文件工具；Desktop 主路径 = 自有 WorkspaceService。

UTR（Unified Tool Runtime）是 topmind 的**可选**确定性 CLI/MCP 底座，服务：

- Agent Host 需要结构化 tool 调用时
- 脚本 / CI / 批量迁移与 doctor
- 无 GUI 的 headless 操作

用户面工作流不变：

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

UTR 命令必须支持该工作流，**不暴露** 大类/专题命名、命令 kind、workflow 阶段作为日常 UI 概念。

它拥有：

- contract loading · payload validation · path resolution（三平面感知）
- policy-aware preview/run · protection 求值 · writeback.mode 判定
- CLI + MCP 暴露 · structured results · write evidence（path + affected-files；仅高影响才落 `99-归档/receipts/`）

**不**拥有 high-level skill taxonomy 或产品 workflow language。  
**不**作为 Desktop 编辑器/AI 的强制中介。

> **i18n**：UTR 错误消息与内容模板通过 `utr/core/i18n-strings.mjs` 支持中英双语。Locale 优先级：工作区 `topmind.yaml` `workspace.locale` 字段 → `topmind_LOCALE` 环境变量 → 默认 `zh-CN`。CLI/MCP 启动时自动读取工作区契约并设置 locale。

### 与 Desktop / Skills 的边界

| 场景 | 走哪条路径 |
|------|------------|
| Desktop 保存 / 捕获 / AI 写回 | **仅** Desktop WorkspaceService + 备份链 |
| Desktop Tools 控制台 / doctor | 捆绑 `topmind-engine/utr`（与 monorepo CLI 同契约） |
| Skills 在 Cursor/Claude/… | Host 文件工具（主）；UTR 若可用可加速 |
| Agent MCP / 脚本 doctor | UTR CLI/MCP（源码 / 本机安装） |
| 无独立 UTR CLI 的机器 | Skills + Desktop 仍完整可用（Desktop 自带引擎内 utr） |

统一层在**内容约定**（PROJECT-MODEL.md）与**行为契约**（topmind.yaml），不是统一进程。

## Kernel 8 引擎与 Target Tool Domains

底层由 **Kernel 八引擎** 驱动（Desktop 日常 AI 也走同一 `lib/`，不强制 UTR）：
1. **contract-engine**（规约加载/校验/迁移/求值）
2. **workspace-model**（类别/专题/路径解析）
3. **stream-engine**（周期本/reconcile · **年目录 `yearDir`** + **年归档 `archiveStreamYear`**）+ **`activity-window`**（近期周期 ∪ mtime ∪ 增补 parent；suggest/todo/AI ops 共用）
4. **memory-engine**（主 `profile` + 周期 `periodic`（**反思语义·年目录对齐**）；可选 `memory/topics` 仅显式语义记忆——**非** Desktop `topic_classify` 默认落点）
5. **lifecycle-engine**（归档/清理/回顾触发）
6. **writeback-engine**（保护级别判定/影子写/回执/备份 · **唯一写闸**）
7. **derived-builder**（衍生层生成与重建）
8. **ingest-pipeline**（URL/文档/连接器入管）

**卫星**（不是第九引擎）：`todo-engine`（`memory/todo.md`；UTR `memory.list-todos/add-todo/toggle-todo/update-todo/set-todo-due/delete-todo`）· `ai-operation-engine` · `suggest-engine` · `ledger-engine`（可选 `{memory.dir}/ledgers/`，无独立 UTR 域）。记账不是第六个用户概念。

**Stream AI（产品路径）**：Desktop `runActivityOps` / `generateSuggestions` / `todo_maintain` / `memory_organize`（profile+periodic confirm）/ `topic_classify`（内容大类 `create_topic` confirm）均经 Kernel；UTR **无**平行 activity-window 业务实现（可选将来薄只读 adapter）。

映射到 **9 个 UTR 命令域**（`creator` 是只读投影域，不是第九引擎）：

```text
workspace-read
workspace-write
workspace-transform
workspace-maintain
contract
memory
lifecycle
derived
creator
```

未来扩展先问：是否属于

```text
Source Connector -> Object Adapter -> Action Registry -> Tool Contract -> Surface Placement
```

只有 deterministic, reusable automation 才进 UTR。

Tool names use：

```text
<domain>.<command>
```

## Inventory (keep / update / drop)

Living verdict for **Desktop named AI tools**, the **Skills pack**, and the **UTR command registry**. One catalog — this table plus the name-list tests. Do not invent a second tool list.

**Writes** (any surface that mutates text notes — .md and other `TEXT_NOTE_EXTS`) still go through Kernel `writeback-engine`. Skills stay host-portable. UTR stays **optional**. **No default bash / unscoped FS.** Ledger is a satellite, not a sixth user concept; Obsidian does not ship a ledger mini-app.

### Desktop named AI tools — all **keep**

Names, bilingual descriptions, JSON schemas and read/write classification are maintained in Kernel `lib/agent-tool-catalog.mjs` (Desktop: 24 read + 25 write = 49). `topmind-desktop/electron/lib/ai-tool-names.mjs` is a generated snapshot. Obsidian uses the same catalog with a host capability subset; unsupported parameters are omitted. Builders in Desktop `electron/ai-tools.mjs` bind execution; writes pass `wrapWrite` → WorkspaceService → Kernel writeback. Run `npm run sync:agent-contract` after changing the catalog, goal protocol or agent policy; `npm run check:agent-contract` rejects drift.

`lib/agent-tool-policy.mjs` owns the semantic-memory fence, including real-path aliases and custom memory directories. `lib/pending-writes.mjs` owns the review queue: the workspace is explicit, confirmed deletes execute deletion, conflicts retain the entry, and failed applications remain retryable. `.topmind` state uses `lib/workspace-state.mjs` for fenced atomic file replacement. This does not serialize transactions across multiple processes.

| Class | Names | Verdict |
|-------|-------|---------|
| clarification | `request_clarification` | **keep** — asks a real question and stops the host run until the user replies |
| writing | `render_article` | **keep** — deterministic local typography; returns HTML/text and diagnostics, no source writes or publishing |
| skills | `list_skills` · `load_skill` · `load_skill_resource` | **keep** — portable pack, not `~/.pi` |
| capture / fetch / search | `capture_to_inbox` · `web_search` · `fetch_url` · `capture_url` | **keep** — `web_search` = no-key DDG shortlist (scored + host-deduped); `fetch_url` = page→Markdown with source receipts; `capture_url` = one-shot fetch+ingest (source URL attached). Research loop: search → fetch → cite → optional capture. Not bash `curl` |

**Deep research budget（产品约定）**：调研/对比/综述类任务走多跳 `web_search` → `fetch_url` → 交叉引用。预算：搜索 ≤3 轮 · 抓取 ≤5 页 · 同域去重（rankResults perHost=2）· 关键论断 ≥2 独立来源 · 单源必须标注「据 [来源]」。落库用 `capture_url`（source URL 随笔记）。禁止编造 URL；冲突来源并列呈现。

**Progressive tool exposure（渐进/按需）**：按回合类型裁剪工具面——`light`（问候）= 0 域工具；`query`（任务/记忆/动态查询）= 仅读工具；`task` = 全量写面。真源 `topmind-desktop/electron/lib/tool-progressive.mjs`。查询类问题由宿主**强制取证**（`query-evidence.mjs` 先调工具再注入 system+user），不依赖模型自觉调工具。

**Adaptive session budget（会话内自适应）**：`session-budget.mjs` 按回合类型 + 负载估算步数/续跑/紧凑度——light=0 步 · query=2–6 步 · task=8–48 步随负载伸缩；续跑 0–6；小上下文窗自动收紧。用户设置 `maxAgentSteps` 是上限，不再抬高简单任务的预算。宿主共享 `agent-task-contract.mjs` 对总调用、重复结果、失败及检索预算作执行约束，跨重试与续跑不重置；单篇文章不进入自动续跑/评审链。详见 [文章任务执行](docs/ARTICLE-TASK-EXECUTION-2026-10-27.md)。无向量/语义检索。

**Adaptive retry hints（工具失败自愈）**：`tool-retry-hints.mjs` 按错误类别给**一条**可执行恢复步骤（edit hash-stale → read_file 刷 hash；no-match → 复制精确 oldText；write-blocked → 只输出正文；locked → 请用户；capture 空页 → render:true/换源）。Desktop `wrapWrite` 与 Obsidian edit/capture 共用。

**Tool-result digest（结果摘要压缩）**：`tool-result-digest.mjs` 结构化压缩大结果——字符串头尾保留、数组收束、对象丢噪声字段；保留 `ok/error/hint/relativePath` 判词。防长 read/列表打爆上下文。

**Session health circuit breaker（失败熔断）**：`session-health.mjs` 滑窗监测工具失败率；失败率 ≥60% 或同工具连败 ×3 → 熔断，停止 auto-continue，诚实收尾 `incomplete`（blockReason=`tool-thrash`）。

**跨表面**：`web-search-core.mjs` / `tool-retry-hints.mjs`（纯函数）三份同步（engine `lib/` · Desktop `electron/lib/` · Obsidian `lib/`）。`capture_url` 两侧对齐（`url/title/note/forceInbox/forceAtom`，source 随笔记）。`agent-goal-protocol.mjs` 双拷贝字节一致。Skills pack **v4.15.10**（以 `topmind-skills/topmind-pack.json` 为准）。
| browse | `workspace_overview` · `list_categories` · `list_topics` · `list_topic_files` · `get_topic` · `list_inbox` · `list_outputs` | **keep** |
| fs browse | `list_files` · `glob_files` · `stat_path` | **keep** — structured list/glob/stat (all planes); replaces bare `ls`/`find` |
| read / search | `read_file` · `search` | **keep** — windowed / controlled grep; `encoding=` binary-friendly |
| write / edit | `save_note` · `save_file` · `edit_file` · `create_topic` · `create_dir` · `copy_file` · `move_to_topic` · `publish_to_outputs` · `delete_path` · `rename_path` · `reconcile_week` | **keep** — body writes sanitized (thinking/JSON dump block) |
| memory | `list_recent_memories` (read) · `append_topic_memory` · `append_core_memory` · `retire_core_memory` · `update_core_memory` · `restore_core_memory` · `compact_core_memory_history` | **keep** — read is `list_recent_memories` (profile/periodic/topic feed, no path guessing); writes are ADD / UPDATE / RETIRE / RESTORE / COMPACT-HISTORY (full lifecycle, UTR parity). Suggest kind `promote_memory` (payload.action `append_profile` / `update_profile` / `retire_profile` / `compact_history`) is confirm-gated and is **not** a chat tool name. `compact_core_memory_history` drops older near-dup History rows — confirm-gated |
| stream | `list_recent_stream` (read) · `append_stream_entry` | **keep** — recent period-note entries; 增补 = comment-like follow-up under an entry (same file). New entries stay `capture_to_inbox` |
| todos | `list_todos` · `add_todo` · `toggle_todo` · `update_todo` · `set_todo_due` · `delete_todo` | **keep** — full lifecycle (prefer toggle-to-done over delete) |
| pending | `list_pending_writes` | **keep** — confirm-mode queue visibility |
| health | `workspace_health` | **keep** — 结构 + 契约健康（`inspectContract`）+ counts；容量/类型/去重走 Desktop RPC `workspace.workspaceStats` / `workspaceDuplicates`；清理不进默认 AI 集（用户手势） |
| **drop** | `bash` · unscoped `shell` / `exec` · `run_in_workspace` | **drop — never registered** |
| Pi native aliases | `read` / `write` / `edit` / `grep` / `list` / `ls` / `list_dir` / `glob` / `find` / `stat` / `mkdir` / `mv` / `move` / `cp` / `copy` / `rm` / `delete` | **keep as fenced aliases** onto the Desktop tools above — not replacements, not unscoped Pi native |

**Pi 复用边界（2026-10-04，pin 1.0.2）**：循环是进程内 `pi-agent-core` `Agent`，LLM 字节仍走 AI SDK v7。Pi 1.0 的包根只剩 Agent / loop / proxy / types，不再自带 harness 工具或压缩、技能导出。Desktop 仍**围栏转发**而非重写：`read/write/edit` → `read_file/save_file/edit_file`（Kernel writeback + 围栏 + 精确片段/heading/expectedHash）；`bash/shell/exec` **永不注册**。领域工具（capture / memory / todos / topics）保持 Desktop 命名。超窗压缩只有确定性 `maybeCompactPiMessages` → `compactMessagesForModel`（按 `resolveCompactBudget`）；`compactPiMessagesLlm` 返回 null，不另起一套 LLM 摘要。技能发现由 Desktop 注入 catalog 的 name + description + location（`<available_skills>`），激活仍是 `load_skill`。`precise-edit` / `file-window` / `memory-feed` / `todo-engine` 走 Kernel 单真源。不依赖 `pi-coding-agent`，不以 `~/.pi` 或 `pi-durable` 为内容真源。

**update:** none blocking this wave. Optional later: tighter `edit_file` diagnostics (already has no-match / ambiguous hints).

### Skills pack — all **keep**

Daily entry `topmind`. Core: `topmind-capture` · `topmind-organize` · `topmind-write` · `topmind-memory` · `topmind-maintain` · `topmind-loop`. Optional connectors: `topmind-weread` · `topmind-x`. Optional satellite: `topmind-ledger` (not a PrimaryNav peer). WeChat (公众号) lives in the writing pack as `topmind-wechat-post` (topmind-writing-skills; external, loaded via extra skills roots) since skills 4.15.2. Manifest: [topmind-skills/topmind-pack.json](https://github.com/topmindspace/topmind-skills/blob/main/topmind-pack.json).

### UTR commands — all **keep** (optional surface)

**9 域 / 42 命令** as listed below. MCP default 33 (primary + danger). Not a second Desktop AI catalog. No bash command.

## Current Command Surface（命令面唯一真源）

**9 域 / 42 命令**。Agent MCP **默认只暴露 primary + danger（33 个）**；`advanced` 需 `topmind_MCP_ALL=1`。

### Primary（Agent 日常 29）

| Domain | Commands |
|---|---|
| `workspace-read` | `list-categories` · `list-category-files` · `list-topics` · `inspect-topic` · `list-topic-files` · `list-inbox` |
| `workspace-write` | `create-topic` · `capture-note` · `save-output` |
| `workspace-transform` | `plan-inbox-routing` |
| `workspace-maintain` | `doctor-workspace` |
| `contract` | `validate` |
| `creator` | `inspect` · `snapshot` · `matchLengthReport` |
| `memory` | `promote` · `digest` · `append-profile` · `append-topic` · `retire-profile` · `update-profile` · `compact-history` · `restore-profile` · `list-todos` · `add-todo` · `toggle-todo` · `update-todo` · `set-todo-due` · `delete-todo` |

### Danger（高风险 4，MCP 默认可见）

| Domain | Commands |
|---|---|
| `workspace-maintain` | `archive-topic` · `archive-stream-year` · `restore-safety-receipt` |
| `contract` | `reseed` |

### Advanced（扩展 9，默认折叠 / MCP 隐藏）

| Domain | Commands |
|---|---|
| `workspace-read` | `list-recent-captures` · `list-safety-receipts` |
| `workspace-write` | `update-topic` |
| `workspace-transform` | `normalize-note-metadata` · `migrate-v4` |
| `workspace-maintain` | `cleanup-empty-dirs` |
| `lifecycle` | `scan` |
| `derived` | `rebuild` |
| `contract` | `ensure` |

### New Commands（v4 新增 · 摘要，完整表见上方 Primary/Danger/Advanced）

| Command | Domain | 职责 |
|---|---|---|
| `creator.inspect` | creator | 只读检查工作区内显式指定的 Markdown 稿件，返回版本化创作视图、引用素材和诊断；不创建稳定创作 ID，不推断同目录变体 |
| `creator.snapshot` | creator | 只读计算选稿、匹配变体、资源、规则和能力版本的输入指纹；输入完整不等于平台校验通过 |
| `creator.matchLengthReport` | creator | 只读比较快照与长度报告；可选 `articleResult` 继续核对本地剪贴板文本产物，仍需核对目标编辑器 |
| `contract.validate` | contract | 校验工作区 `topmind.yaml` schema、顶层键白名单、与 FS 一致性；诚实报告 on-disk 健康（不把内存默认值伪装成文件已好） |
| `contract.ensure` | contract | 缺失创建 / 可修则合并默认重写 v4；损坏不可安全修复时返回 unrepairable。Desktop / Obsidian / UTR 共用 Kernel `ensureContract` |
| `contract.reseed` | contract | 备份损坏的 `topmind.yaml` 后写入全新有效 v4 默认契约；**不**删除用户内容目录 |
| `memory.promote` | memory | 将 Stream 条目提升为 memory/topics/{topic-slug}.md（标记 promoted_from/to；源文件仅读取标记，不修改原文） |
| `memory.digest` | memory | 确定性 adapter 骨架写入 memory/periodic/{year}/{period}.md（**无 AI 模型**；产品 AI 反思走 Desktop 建议管线确认后写） |
| `memory.append-profile` | memory | 追加「我的情况」到 memory/profile.md（原 append-core-memory） |
| `memory.append-topic` | memory | 追加专题稳定结论到 memory/topics/{topic-slug}.md（原 append-topic-memory） |
| `memory.retire-profile` | memory | 活跃事实 → ## 历史记录（带归档日期，不删原文）；匹配不到良性 skip |
| `memory.update-profile` | memory | 原位更新活跃事实为最新表述（旧表述进历史 sup）；历史段不可改 |
| `memory.compact-history` | memory | 压缩历史区近重复归档行，保留最新 |
| `memory.restore-profile` | memory | 历史事实恢复到活跃段落（retire 逆操作）；目标已有等价活事实则 skip |
| `memory.list-todos` | memory | 读 `memory/todo.md` 个人待办（语义平面卫星；对齐 Desktop `list_todos`） |
| `memory.add-todo` | memory | 原子追加待办（去重；文本可嵌截止日期；对齐 Desktop `add_todo`） |
| `memory.toggle-todo` | memory | 切换待办完成态（id 或文本片段；完成记时间并同步周期本；对齐 Desktop `toggle_todo`） |
| `memory.update-todo` | memory | 改写待办文本（对齐 Desktop `update_todo`） |
| `memory.set-todo-due` | memory | 设置/清除待办截止（对齐 Desktop `set_todo_due`） |
| `memory.delete-todo` | memory | 删除待办（prefer toggle；记 dismissed 不回灌；对齐 Desktop `delete_todo`） |
| `lifecycle.scan` | lifecycle | 按 contract `lifecycle` 扫描：inbox 超期、catch-all 清理、stale 专题、output lock |
| `derived.rebuild` | derived | 从真源全量重建各大类 `.derived/` 子目录 |
| `workspace-transform.migrate-v4` | workspace-transform | 一次性迁移：config v3→topmind.yaml、旧专题首页→topic.md、我的情况.md→memory/profile.md 等 |
| `workspace-maintain.archive-stream-year` | workspace-maintain | 将动态类别中完整年份的周期本目录原子移到 `99-归档/stream-archive/{year}/`；只允许归档当前年份之前；不另写 receipts YAML（`receiptPath` 为 null） |

`creator.inspect` 接收 `{ "targetPath": "<工作区内相对路径>.md" }`，工作区根由 CLI/MCP 启动参数 `--workspace-root` 绑定。只读结果 `schemaVersion: 3` 包含 `target`、`category`、`topic`、`assets`、`variants`、`diagnostics`；`target.relativePath` 是重命名后会改变的临时身份。`target.creationId` 只有在 `creation_id` 合法且当前工作区内唯一时才有值，`identityStatus` 为 `none`、`valid`、`invalid`、`conflict` 或 `scan-incomplete`。`variants` 只列显式关联且 ID 唯一的变体。正文图片支持 Markdown、HTML 和 Obsidian 的 `![[...]]` 图片嵌入；有路径的嵌入按工作区相对路径解析，无路径的文件名只有在工作区内唯一时才解析。同名歧义返回 `asset-ambiguous`，用户应改为 `![[attachments/明确路径.png]]`。缺图、远程图、未完全解析的图片语法和库外引用也有稳定诊断，不能把空资源表当作完整证明。CLI 的领域结果在 `result.data`；MCP 保留现有工具包装，其 JSON 文本里的领域结果在 `result.data.data`。该命令不写用户工作区、不创建稳定创作 ID，也不表示内容已通过平台校验。

`creator.snapshot` 接收 `targetPath`、`platform`、`format`、`entry`、对象型 `ruleset: {id, version, rules?}` 和 `provider: {id, version}`，可选 `accountCapabilities`、`parameters`、`lengthValidation` 对象。`rules` 是本次实际使用的 JSON 规则数据；Kernel 计算确定性 SHA-256 摘要，只在 `selection.ruleset.contentDigest` 返回摘要，不回传规则全文。对象在 MCP/CLI 请求中保持结构化，执行回执不展示对象参数值。领域结果 `schemaVersion: 5` 包含 `fingerprint`、`linked`、`assets`、`selection`、`rulesetBound`、`lengthValidationBound`、`inputsComplete` 和诊断。旧调用可只提供规则 ID/版本检查本地依赖，但此时 `rulesetBound: false`，快照比较不会返回未过期结论。`inputsComplete` 只表示已知本地依赖齐全；`variant-source-stale` 提示母稿自建立变体关系后已更新，需复核变体，但单独出现时不令本地输入不完整。母稿与变体当前字节仍进入指纹，旧报告失效。该标志不代表规则通过或允许发布。

Kernel `inspectCreationSnapshotConsistency(snapshot)` 在使用快照前重算其已覆盖字段的指纹，并核对 `inputsComplete`、`rulesetBound`、`lengthValidationBound` 与内容是否一致。`compareCreationInputSnapshots`、文章结果与长度报告比对都会拒绝被改坏的快照；UTR `creator.matchLengthReport` 返回 `snapshot-inconsistent` 时，界面应要求重新读取并重算快照。此检查不访问磁盘、不是签名或来源认证，也不证明缓存的快照仍是当前文件状态。交接前必须从工作区重建快照；相同路径下的源稿或资源变化应导致旧报告失效。

可选 `lengthValidation: { document, provider, asOf }` 绑定已准备的 `platform_text`、长度规则集能力提供者及 ISO 评估日期；此时 `accountCapabilities.account_capability` 必须是明确档位。Kernel 只返回 `selection.lengthValidation` 中的文本摘要、档位、提供者和日期。`compareCreationLengthReport(snapshot, report)` 核对规则 ID/版本与内容摘要、目标入口、账号档位、送检文本摘要、提供者和日期；即使返回 `matches: true`，也固定给出 `sourceLineageVerified: false`、`publishReady: false`。它只证明两份声明输入一致，尚不能证明送检文本从所选母稿或渲染产物产生。交接前仍须重算快照，且不能把匹配结果当成发布授权。

生成工作区报告时，先用同一规则数据与送检文本调用 `creator.snapshot`，再以返回的 `fingerprint` 作为 writing-skills `length.ruleset.evaluate` 的 `creationSnapshotFingerprint`，最后调用 Kernel `compareCreationLengthReport` 或 UTR `creator.matchLengthReport`。匹配会要求报告所记快照指纹等于所提供的快照；源稿或资源变化后须从工作区重算快照，旧报告会得到 `snapshot-fingerprint-mismatch`。独立 writing-skills 调用可以不带快照指纹，但不能关联为当前工作区报告。对象型参数不展示在 UTR 命令回执中。

本地文章渲染可把选中稿的原始 UTF-8 字节、规范工作区相对路径和当前快照指纹传给 writing-skills `prepareArticleResultFromSource`。该入口只接受 `platform`、`theme`、`title` 三项渲染选项；快照 `parameters` 应使用 `{theme: 实际主题, title: 实际标题或空串}`。Kernel `compareCreationArticleResult(snapshot, result)` 核对所选稿路径/字节摘要、渲染提供者、目标平台、主题与标题参数摘要、快照指纹、实际内嵌正文图片的字节摘要，以及预览、复制 HTML、源 Markdown、图片清单、本地剪贴板文本五份产物的内容哈希。读图回调若返回非可核对的内嵌图片，或 Kernel 发现当前渲染器未处理的正文图片写法，比较结果为 `rendered-assets-mismatch`。

要将**本地文本**接入长度报告，宿主按顺序执行：①用同一份原始字节与图片数据调用 `article.renderFromSource`，通过 `article.localTextDocument` 取得本地文本；②以此文本、明确账号档位、规则集和评估日期建立 `creator.snapshot`；③使用快照指纹重新渲染，并用相同文本调用 `length.ruleset.evaluate`；④调用 `creator.matchLengthReport`，传入 `snapshot`、`report` 和可选 `articleResult`。带 `articleResult` 时 Kernel `compareCreationLocalLengthChain` 校验本地产物文本摘要与快照、长度报告一致；返回 `localTextChainMatched: true` 仍固定 `platformEditorVerified: false`、`sourceLineageVerified: false`、`publishReady: false`。这是本地预检，不是平台编辑器回读；粘贴后的真实文字、封面与图片仍须单独复核。宿主在交接前重新取快照。旧的双参数报告匹配继续只比较声明输入。

规则内容摘要算法为 `SHA-256(UTF-8(JSON.stringify(canonical(rules))))`：`canonical` 递归按键名排序对象，保留数组顺序。跨仓测试向量 `[{"id":"a","check":{"max":5,"field":"body"}}]` 的摘要为 `83e4ff278a5b6eb76112c55654c54865b3a8a03dcef6bbebbb6c98ed88e29a49`。摘要一致只证明规则数据相同，不代表其证据、适用范围或判定正确。

Kernel `assignCreationId` 是显式用户动作的写入口，要求刚检查的 `target.sha256`、`userConfirmed: true`；缺少 `title` 或 `source_type` 的旧稿由调用者明确补齐。返回实际写闸回执；若正文已写入但安全回执失败，状态为 `assigned-needs-review`、回执 `partial: true`，不得把它当成未写而重试。复制冲突、非法 frontmatter、旧哈希和不完整唯一性扫描均拒绝写入。目前未将此写动词暴露为 UTR 命令或 DSH UI 操作。

Kernel `inspectCreationCoverPaths` 只读检查选中的现有原图与平台 rendition，返回两张图片的路径、格式、编码宽高、SHA-256 和诊断；界面先展示此结果。容器检查覆盖 PNG 块边界与 CRC、JPEG 帧/扫描/结束标记、WebP RIFF 块边界和尺寸，单图上限 32 MiB。Kernel `linkCreationCover` 要求已验证且未绑定封面的变体、两张图片和变体的当前 SHA-256，以及 `userConfirmed: true`，随后仅通过写闸向变体 frontmatter 增加 `creation_cover`。它不生成、裁切、复制或覆盖图片；写入后复查，如安全回执或关系复查不完整则返回 `linked-needs-review`。此写动词尚未暴露为 UTR 命令。

封面诊断区分 `cover-format-unsupported`（签名或扩展名不匹配）、`cover-image-invalid`（已识别格式但容器损坏）和 `cover-too-large`（超过 32 MiB）；三者都会使快照输入不完整。界面应据此分别提示换格式、修复或重导出、压缩或缩小文件。

Kernel `importCreationCoverRendition` 接收已渲染的图片字节、原图路径和三份当前 SHA-256；用户显式调用后，通过同一写闸的 `executeBinaryCreate` 在变体所在目录下的 `images/creation-covers/<variant-id>/` 独占创建内容哈希命名的平台版。大小上限 32 MiB，不覆盖已有文件；重复导入相同字节返回 `existing-unlinked`，已有路径内容不符则拒绝。返回 `imported-unlinked` 后，界面应展示图片并重新检查，再单独调用 `linkCreationCover`。导入不会改稿，关联失败时文件留在返回的路径供复核或重试。容器结构与编码尺寸检查不等于像素完整解码，也未处理 JPEG EXIF 方向、裁切或平台尺寸规则；这两个写动作均未暴露为代理可直接调用的 UTR 命令。

Kernel `executeWrite` 对 `creation_id`、`creation_variant_id`、`creation_parent_id`、`creation_target`、`creation_source_sha256`、`creation_cover` 做内容级变更检查。普通新建或更新若新增、删除、改写这些关系字段会被拒绝；显式迁移须由用户动作传 `allowCreationMetadataChange: true`，同时提供 `expectedHash` 和 `casRequiresExisting: true`。三个已实现的创作关系写入口还传入检查时的原始字节 `expectedRawSha256`，因此仅换行符变化也会拒绝过期写入。若正文已落盘但安全回执写失败，写闸返回 `wroteFiles: true`、`partial: true`、`reason: receipt-write-failed`，调用方不得据此重复写入。

### Per-Command Contract Metadata

| 字段 | 取值 | 含义 |
|---|---|---|
| `risk_level` | `low \| medium \| high` | 危险程度 |
| `review_policy` | `auto \| preview_or_auto` | 风险/预览元数据（preview 标签与工具列表）；**不是第二套授权门**——分级 confirm 真源在 Kernel `evaluateWritePermission` |
| `group` | `workflow \| atomic \| maintenance \| assistive \| danger` | 分组 |
| `exposure` | `primary \| advanced \| danger` | **Agent/MCP 暴露层级** |

`writeback.mode`（`auto\|confirm`）是 per-call 用户配置（来源 topmind.yaml `writeback.mode`），与 `review_policy` 正交。

### Category + Topic Input Convention

写入类命令使用两个独立字段：
- `category`：类别目录名（如 `"20-专题"` 或兼容 `"20 专题"`）
- `topic`：专题目录名（如 `"2026-示例记录"`）

读取类命令的 `category` 字段是可选过滤——不传则全工作区扫描。

`capture-note` 的 `routing` 子对象带 `category` + `topic` 两个字段。

**不使用**把 category + topic 拼成单字符串的输入形式。

### list-categories（WorkspaceModel）

解析实现：`lib/contract-engine.mjs` + `lib/workspace-model.mjs`（FS ⊕ `topmind.yaml` ⊕ `templates/*`）。

返回字段（`slots` / `categories` 同形）：

| 字段 | 说明 |
|------|------|
| `slot` | 两位编号 |
| `directory` | 真实目录名 |
| `role` | buffer / loose-stream / deep-work / fallback / reference / delivery / system |
| `specialBehavior` / `catchAll` / `referenceOnly` | 可选行为 |
| `source` | `fs+contract` · `fs+template` · `fs-only` … |
| `templateId` / `separator` | 工作区级 |

用户自定义一级类（如 `11-健康/`）合法；角色来自 contract `categories.extensions`，缺省 `deep-work`。  
`hidden: true` 时 Desktop 导航默认跳过；命令面仍可按路径操作。  
**禁止**用固定白名单否定自定义类。  
`memory/` 是语义平面固化目录，不进 `list-categories` 结果（不在编号空间内）；需单独通过 memory domain 命令访问。

可选派生索引：`.topmind/workspace-map.json`（`writeWorkspaceMap` / Desktop「重建派生索引」），**非内容真源**。

## Writeback Contract

### Save Settings

```yaml
# topmind.yaml
writeback:
  mode: auto | confirm
```

| 模式 | 行为 |
|------|------|
| `auto` | 内容与生命周期直接执行（默认）；危险改动可逆；path receipt |
| `confirm` | **分级**：内容新建/更新/编辑直接落盘；仅删除/归档进入待确认 |

**优先级**：`protection` × `writeback.mode`。`locked` = 重要内容——内容编辑允许（任务级首写快照）；可恢复 delete/archive 在 auto 下允许；永久删 locked/core 仅用户。confirm 下仅删/归档 pending。

**围栏（2026-09-17）**：契约/系统面/memory 根不可 lifecycle；策略路径名大小写不敏感；`protection: Locked` 归一为 locked；删除/移动/关联媒体仅在写闸提交后处理。

### Write Evidence Format

```yaml
operation: create | update | delete | archive | restore | refresh | promote
writeback_mode: auto | confirm
target_path: string
affected_files: string[]
wrote_files: boolean
receipt_path: optional string # 仅高影响：99-归档/receipts/{id}.yaml
backup_path: optional string  # 仅高影响：99-归档/backups/{snapshot} 或 trash
revision_path: optional string
protection: string             # open | locked（求值结果）
saved_at: ISO datetime
next_actions: optional string[]
```

**不要**添加一个 write command 报告 success 而没有 target-path 和 affected-file evidence。

### Write Semantics

| Command | Default mutation | Guardrail |
|---|---|---|
| `workspace-write.create-topic` | 创建专题目录 + `topic.md` 首页（frontmatter: title/category/topic/status） | 拒绝覆盖已有同名专题；**不**接受 `projectType`（已废弃） |
| `workspace-write.capture-note` | 在专题根下或 **role:buffer**（常为 `00-Inbox/`）或**大类根单篇**或**当前动态周期本**创建时间戳笔记 | 永不替换已有笔记 |
| `workspace-write.save-output` | 创建交付物到 `88-交付/` 扁平目录 | `ifExists`: `create-new`（默认）· `replace`（查找同名替换）· `fail`（同名报错） |
| `memory.append-topic` | 追加一条专题稳定结论到 `memory/topics/{topic-slug}.md` | 永不重写已有内容 |
| `memory.append-profile` | 追加「我的情况」到 `memory/profile.md` | 按段落追加；禁止 capture 静默写 |
| `memory.retire-profile` | 活跃事实移入 `## 历史记录` | 可逆归档，不删原文 |
| `memory.update-profile` | 原位替换活跃事实 | 旧表述进历史 `sup` |
| `memory.compact-history` | 历史近重复折叠保留最新 | 不碰活跃事实 |
| `memory.restore-profile` | 历史事实回到活跃段落 | 可逆；目标重复则 skip |
| Desktop `reconcileStreamPeriod` | 确定性整理本周 | 无 LLM：勾选完成、去重；返回候选；落盘时写 `reconciled_at`。列表 `reconciled` / 未整理 以 `reconcilePeriodBody` 是否还会改正文为准，不是缺 stamp |
| `workspace-write.update-topic` | 整文替换 `topic.md` | 要 `replaceReason`；经 Kernel 写闸；**仅高影响**（locked 覆盖）才有 backup/receipt，open 不造 99-归档 快照 |
| `memory.promote` | Stream 条目 → memory/topics/{topic-slug}.md | 标记 promoted_from/to；用户确认制 |
| `memory.digest` | 写入 UTR adapter 骨架到 memory/periodic/{year}/{period}.md | 非 AI；可重建；真实 AI 反思 = Desktop suggest apply |
| `workspace-maintain.archive-stream-year` | 原子移动 `10-动态/{year}/` 到 `99-归档/stream-archive/{year}/` | 只允许归档当前年份之前；不另写 receipts YAML；不影响 `memory/periodic/` |

## Frontmatter Schema

> Note frontmatter **唯一真源**。新字段先登记再使用。

### 必填

| 字段 | 取值 |
|------|------|
| `title` | string |
| `source_type` | `user-original` \| `ai-derived` \| `external-capture` |

### 常用可选

| 字段 | 取值 / 说明 |
|------|-------------|
| `source` | URL 或出处 |
| `creation_id` | 可选；母稿稳定身份，小写 UUID v4。仅在用户显式建立跨平台创作关系时由 Kernel 写入；重命名保留，复制冲突需人工选择后修复；不得作为发布状态 |
| `creation_variant_id` / `creation_parent_id` | 平台变体自己的小写 UUID v4、所关联母稿的 `creation_id`；由 Kernel 显式关联写入，不靠同目录猜关联 |
| `creation_target` | 平台变体的 YAML 映射：`platform`、`format` 必填，`entrypoint` 可选；具体交付快照与规则校验仍须明确入口。普通未关联稿无须此字段 |
| `creation_source_sha256` | 建立变体关系时母稿内容 SHA-256，不因后续编辑自动覆盖 |
| `creation_cover` | 可选；仅用于已验证的平台变体，YAML 映射 `{ source_path, rendition_path }`，均为工作区相对路径且不得指向同一文件；原图与平台裁切版独立保存。只读检查支持 PNG/JPEG/WebP 容器结构、扩展名及编码宽高，尚不代替像素完整解码、EXIF 方向、平台尺寸与比例校验 |
| `category` / `topic` | 类别名 / 专题名（推荐；亦可仅靠路径表达） |
| `protection` | `open` \| `locked` **v4 new** |
| `status` | 见下表；看板亦接受 `todo` / `in-progress` / `done` / `archived` |
| `promoted_from` | 提升源路径 **v4 new** |
| `promoted_to` | 提升目标路径 **v4 new** |
| `memory_layer` | `global` \| `periodic` \| `topic`（memory/ 内文件标识）**v4 new** |
| `review_after` | YYYY-MM-DD（lifecycle 回顾触发） **v4 new** |
| `derived_from` | 路径列表（衍生文件原料，重建线索） **v4 new** |
| `note_role` | `canonical` \| `bundle` \| `historical` \| `reference` |
| `tags` / `aliases` | **YAML 数组**（禁止逗号分隔单字符串） |
| `priority` | `high` \| `medium` \| `low` |
| `method` | 方法维度（如 `reading`） |
| 时间戳 | `captured_at` · `created_at` · `updated_at` · `synced_at` · `archived_at` · `published_at` · `confirmed_at`（ISO 8601） |
| 路由 | `capture_id` · `route_confidence` · `route_reason` |

### `source_type`

- `user-original` — 用户原创
- `ai-derived` — AI 生成（宜带时间戳）
- `external-capture` — 外部抓取；细节用 `url` / `synced_at` / `weread_book_id` 等子字段

### `status`（推荐中文；看板兼容英文）

`草稿` · `已确认` · `已锁定`（v4 收敛为三档）

| status | 含义 | AI 行为 | 用户感知 |
|--------|------|---------|----------|
| `草稿` | 进行中/未确认 | 自由修改/追加 | 还在写，随便改 |
| `已确认` | 定稿/已核实 | 可修改（但会标记 updated_at） | 认可了，但还能改 |
| `已锁定` | 已发布/归档 | 禁止直接改，只能 fork 新版本 | 定稿了，改动要走修订 |

**看板兼容映射**（保留，但不作为真源）：
- `todo` → 草稿
- `in-progress` → 草稿
- `done` → 已确认
- `archived` → 已锁定

**旧版迁移**：`reading` / `已确认知识` / `启用` / `可交付输出` / `已完成` 迁入上述枚举或 `method`。

### 专题扩展（按需）

素材库 / 交付物可加：`global_section` · `genre_hint` · `work_title` · `output_type` · `AIGC`（map）等。先登记再扩。

### 豁免

`README.md` · 工程元文件 · 用户模板：可无 frontmatter 或仅 `title` + `source_type`。

### 禁止字段

`project_type` · `note_kind: wiki|deck` · `legacy_source` · `parent_topic` · `legacy_date_hint` · `draft_kind: extract` · `protection_level`（用 `protection`）· `memory_type`（用 `memory_layer`）

### 格式

1. `---` YAML 块包围
2. 2 空格缩进，不混用
3. 特殊字符值加双引号
4. `tags` 必须是数组
5. 日期推荐 `YYYY-MM-DD` 或 ISO 8601

### 状态（非真源缓存）

`.topmind/workspace-map.json`、Desktop notes-index 等均为可选可重建缓存，**不是**内容真源。`{专题}/state.json` 亦同（v4 推荐删除，统一用各大类 `.derived/` 子目录）。

## Workspace File Classification

UTR 与 Desktop 共用同一三平面模型：

| 位置 | 平面 | Role / 说明 |
|------|------|-------------|
| `topmind.yaml` | 系统 | 唯一行为契约 |
| `{NN-大类}/` | 内容 | 物理大类容器 |
| `{大类}/{专题}/topic.md` | 内容 | 专题首页 / 稳定记忆（**可选**） |
| `{大类}/{专题}/*.md` | 内容 | 专题根笔记 |
| `{大类}/*.md` | 内容 | 未专题化笔记 / 周期本 |
| `{大类}/.derived/**` | 内容 | AI 衍生（摘要/历史，正式知识） |
| `88-交付/*` | 内容 | 扁平交付物 |
| `99-归档/**` | 内容 | 内容安全层（backups · stream-archive · backups/trash · receipts；legacy 顶层 trash 可共存） |
| `memory/profile.md` | 语义 | global 层核心记忆 |
| `memory/periodic/**` | 语义 | periodic 层反思（可重建；按年分组） |
| `memory/topics/*` | 语义 | topics 层持续演变（可选） |
| `.topmind/loop/**` | 系统 | loop 巡检进度 |
| `.topmind/*.json` | 系统 | 运行时状态（ai-ops · suggest-fingerprints · workspace-map，原子覆盖写） |

`list-safety-receipts` 扫描 `99-归档/backups/`、`99-归档/backups/trash/`（Kernel 删除落点）、legacy `99-归档/trash/`、归档专题目录与 `88-交付/` 修订版；`restore-safety-receipt` 按同一路径形状恢复（不覆盖已有文件，写 `-restored-` 副本）。

## CLI

Health check：

```bash
node utr/bin/topmind-cli.mjs doctor --json --mcp
```

Tool discovery：

```bash
node utr/bin/topmind-cli.mjs tool list
node utr/bin/topmind-cli.mjs tool inspect workspace-read
```

Contract validate：

```bash
node utr/bin/topmind-cli.mjs tool run contract validate
```

Preview（示例）：

```bash
# 列出所有大类
node utr/bin/topmind-cli.mjs tool preview workspace-read list-categories

# 列出 20-专题下所有专题（directory 以 list-categories 实测为准）
node utr/bin/topmind-cli.mjs tool preview workspace-read list-topics --input-json '{"category":"20-专题"}'

# 检视专题
node utr/bin/topmind-cli.mjs tool preview workspace-read inspect-topic --input-json '{"topic":"2026-示例记录"}'
```
