# TOOLS.md — UTR 命令面 · 写回 · Frontmatter

> **位置**：本文档是 UTR 命令面、写入语义、note frontmatter 字段的**唯一真源**。  
> **6 条核心规约**与**三平面模型**：`PROJECT-MODEL.md`。  
> **行为契约**：工作区根 `topmind.yaml`（8 类规约，机器可读）。  
> UTR 对 Skills/agent 仍为**可选**底座；Desktop 安装包 **捆绑** `utr/`（Tools 控制台 / doctor），但日常编辑与 AI 写回不强制走 UTR（`PRODUCT-BOUNDARIES.md`）。  
> **架构**：UTR = Kernel 的 CLI/MCP **adapter**（非第三套业务语义）。耐久 `.md` 主写经 `lib/writeback-engine.mjs`（**Done**，见 `docs/ARCHITECTURE-RESET.md` §2.2）；备份/回执**仅高影响**（locked 覆盖 · delete/archive）；open 常规更新不备份；非 `.md` 二进制可仍直写。  
> 保存设置仅 **auto | confirm**（无 batch；UTR 对显式 `batch`/未知模式 **硬拒绝**，不 silent 映射）。

## Roots

```text
Engine root:
  topmind/

User data root（三平面工作区）:
  {workspace}/
  ├── topmind.yaml          系统平面：唯一行为契约
  ├── 00-收件箱/ … 88-输出/ 99-归档/   内容平面：编号类别（自发现）
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
- CLI + MCP 暴露 · structured results · recoverable write evidence（`99-归档/receipts/`）

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
3. **stream-engine**（周期本/reconcile）+ **`activity-window`**（近期周期 ∪ mtime ∪ 增补 parent；suggest/todo/AI ops 共用）
4. **memory-engine**（主 `profile` + 周期 `periodic`；可选 `memory/topics` 仅显式语义记忆——**非** Desktop `topic_classify` 默认落点）
5. **lifecycle-engine**（归档/清理/回顾触发）
6. **writeback-engine**（保护级别判定/影子写/回执/备份 · **唯一写闸**）
7. **derived-builder**（衍生层生成与重建）
8. **ingest-pipeline**（URL/文档/连接器入管）

**Stream AI（产品路径）**：Desktop `runActivityOps` / `generateSuggestions` / `todo_maintain` / `memory_organize`（profile+periodic confirm）/ `topic_classify`（内容大类 `create_topic` confirm）均经 Kernel；UTR **无**平行 activity-window 业务实现（可选将来薄只读 adapter）。

映射到 **8 个 UTR 命令域**：

```text
workspace-read
workspace-write
workspace-transform
workspace-maintain
contract
memory
lifecycle
derived
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

## Current Command Surface（命令面唯一真源）

**8 域 / 27 命令**。Agent MCP **默认只暴露 primary + danger（18 个）**；`advanced` 需 `topmind_MCP_ALL=1`。

### Primary（Agent 日常 15）

| Domain | Commands |
|---|---|
| `workspace-read` | `list-categories` · `list-topics` · `inspect-topic` · `list-topic-files` · `list-inbox` |
| `workspace-write` | `create-topic` · `capture-note` · `save-output` |
| `workspace-transform` | `plan-inbox-routing` |
| `workspace-maintain` | `doctor-workspace` |
| `contract` | `validate` |
| `memory` | `promote` · `digest` · `append-profile` · `append-topic` |

### Danger（高风险 3，MCP 默认可见）

| Domain | Commands |
|---|---|
| `workspace-maintain` | `archive-topic` · `restore-safety-receipt` |
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

### New Commands（v4 新增）

| Command | Domain | 职责 |
|---|---|---|
| `contract.validate` | contract | 校验工作区 `topmind.yaml` schema、8 类规约白名单、与 FS 一致性；诚实报告 on-disk 健康（不把内存默认值伪装成文件已好） |
| `contract.ensure` | contract | 缺失创建 / 可修则合并默认重写 v4；损坏不可安全修复时返回 unrepairable。Desktop / Obsidian / UTR 共用 Kernel `ensureContract` |
| `contract.reseed` | contract | 备份损坏的 `topmind.yaml` 后写入全新有效 v4 默认契约；**不**删除用户内容目录 |
| `memory.promote` | memory | 将 Stream 条目提升为 memory/topics/{topic-slug}.md（标记 promoted_from/to；源文件仅读取标记，不修改原文） |
| `memory.digest` | memory | 确定性 adapter 骨架写入 memory/periodic/{period}.md（**无 AI 模型**；产品 AI 摘要走 Desktop 建议管线确认后写） |
| `memory.append-profile` | memory | 追加「我的情况」到 memory/profile.md（原 append-core-memory） |
| `memory.append-topic` | memory | 追加专题稳定结论到 memory/topics/{topic-slug}.md（原 append-topic-memory） |
| `lifecycle.scan` | lifecycle | 按 contract `lifecycle` 扫描：inbox 超期、catch-all 清理、stale 专题、output lock |
| `derived.rebuild` | derived | 从真源全量重建各大类 `.derived/` 子目录 |
| `workspace-transform.migrate-v4` | workspace-transform | 一次性迁移：config v3→topmind.yaml、旧专题首页→topic.md、我的情况.md→memory/profile.md 等 |

### Per-Command Contract Metadata

| 字段 | 取值 | 含义 |
|---|---|---|
| `risk_level` | `low \| medium \| high` | 危险程度 |
| `review_policy` | `auto \| preview_or_auto` | 命令默认审阅机制 |
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
| `auto` | 直接写入 + path receipt（默认）；危险改动可逆 |
| `confirm` | 写入前审阅 |

**优先级**：`protection` > `writeback.mode`（locked 时无论 mode 如何，AI 禁止直接写）。

### Write Evidence Format

```yaml
operation: create | update | delete | archive | restore | refresh | promote
writeback_mode: auto | confirm
target_path: string
affected_files: string[]
wrote_files: boolean
receipt_path: string          # 99-归档/receipts/{id}.yaml
backup_path: optional string  # 99-归档/backups/{snapshot}
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
| `workspace-write.capture-note` | 在专题根下或 `00-收件箱/` 或**大类根单篇**或**当前动态周期本**创建时间戳笔记 | 永不替换已有笔记 |
| `workspace-write.save-output` | 创建交付物到 `88-输出/` 扁平目录 | `ifExists`: `create-new`（默认）· `replace`（查找同名替换）· `fail`（同名报错） |
| `memory.append-topic` | 追加一条专题稳定结论到 `memory/topics/{topic-slug}.md` | 永不重写已有内容 |
| `memory.append-profile` | 追加「我的情况」到 `memory/profile.md` | 按段落追加；禁止 capture 静默写 |
| Desktop `reconcileStreamPeriod` | 确定性整理本周 | 无 LLM：勾选完成、去重；返回候选；写 `reconciled_at` 标记 |
| `workspace-write.update-topic` | 整文替换 `topic.md` | 要 `replaceReason`；经 Kernel 写闸；**仅高影响**（locked 覆盖）才有 backup/receipt，open 不造 99-归档 快照 |
| `memory.promote` | Stream 条目 → memory/topics/{topic-slug}.md | 标记 promoted_from/to；用户确认制 |
| `memory.digest` | 写入 UTR adapter 骨架到 memory/periodic/{period}.md | 非 AI；可重建；真实 AI 摘要 = Desktop suggest apply |

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
| `88-输出/*` | 内容 | 扁平交付物 |
| `99-归档/**` | 内容 | 内容安全层（backups · backups/trash · receipts；legacy 顶层 trash 可共存） |
| `memory/profile.md` | 语义 | global 层核心记忆 |
| `memory/periodic/*` | 语义 | periodic 层摘要（可重建） |
| `memory/topics/*` | 语义 | topics 层持续演变（可选） |
| `.topmind/index/**` | 系统 | 可选语义索引（可重建） |
| `.topmind/loop/**` | 系统 | loop 巡检进度 |
| `.topmind/logs/**` | 系统 | 运行日志 |

`list-safety-receipts` 扫描 `99-归档/backups/`、`99-归档/backups/trash/`（Kernel 删除落点）、legacy `99-归档/trash/`、归档专题目录与 `88-输出/` 修订版；`restore-safety-receipt` 按同一路径形状恢复（不覆盖已有文件，写 `-restored-` 副本）。

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
