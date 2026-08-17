# SKILL-ARCHITECTURE.md — Skill 架构

> 唯一日常入口：`topmind`。内部 action / connector 是实现模块，**不是**用户第二前台入口。  
> 产品入口：根 `README.md`（English）· `README.zh-CN.md`（简体中文）；Skills 模块 README 同此约定。  
> 路由：`读契约 → 哪个类别？哪个专题？哪个对象？什么动作？`  
> Pack 版本：`skills/topmind-pack.json`。  
> **产品北极星**：最低摩擦个人动态流；用户概念 ≤5（记一下 · 动态 · 专题 · 我的情况 · 写出来）。  
> **契约**：工作区根 `topmind.yaml` **v4**；写回 **auto | confirm**；memory 在 `memory/profile.md` 等。  
> **实施**：`docs/ARCHITECTURE-RESET.md`。

## 0. 设计理念 (Design Philosophy)

```text
推荐引导，不强制约束。
智能路由，不打断用户。
能力降级，不依赖特定工具。
自包含打包，可移植到任何 Agent Host。
契约驱动，不各自发明语义。
```

### 0.1 三条原则

1. **契约单一真源** — 工作区根 `topmind.yaml`（8 类规约）+ `topmind-pack.json` + 本文档 + `TOOLS.md` 唯一表达行为契约，各 SKILL.md 不重复定义规约，只引用。
2. **可移植优先** — Skills 保持纯 Markdown，不引入代码运行时（无 Loader/Registry）；frontmatter 字段是约定，由 host agent 解析。
3. **命名即文档** — skill id、目录名、frontmatter 字段名必须反映 Category/Topic/Memory 心智模型。

### 0.2 对用户

用户只需要理解四个概念：**类别、专题、记忆、输出**。所有 AI 操作应该透明地路由到正确的位置，用户不需要了解内部模块。

- 说"记一下这个链接" → 自动判断类别和专题，保存笔记
- 说"帮我整理最近的研究" → 自动读取相关笔记，提炼结构
- 说"基于这些素材写报告" → 自动整合素材，生成输出
- 说"把这个记住" → 按记忆规约写入 memory/（global 或主题层）
- 说"跑一遍 loop" → 自动巡检工作区，执行生命周期任务，进度落盘可恢复

### 0.3 对 AI Agent

Skills 是一组纯 Markdown 指令集，告诉 AI 如何操作 topmind 工作区。它们：

- **契约驱动**：动手前先读工作区根 `topmind.yaml`，按契约求值行为（落点、保护级别、保存设置、生命周期）
- **自包含**：每个 SKILL.md 包含完整的操作指令，不依赖外部运行时
- **可降级**：主路径 Host 文件工具；UTR 可选加速；最低对话建议
- **可移植**：同一套 skills 可以安装到 OpenCode、Claude Code、Codex 等任何支持 skill 的 Agent Host
- **守边界**：Skill 只操作用户工作区数据，不碰 engine 代码

### 0.4 与业界规范对比（Agent Skills 开放标准 · agentskills.io）

| 维度 | topmind Skills Pack | Agent Skills Open Standard | MCP | Claude Code Skills | OpenAI Codex Skills | Cursor Rules |
|---|---|---|---|---|---|---|
| 格式 | 每 skill 目录 + `SKILL.md` + 可选 `references/` | 同左 + 可选 `scripts/` / `assets/` | JSON tool schema | 同开放标准 `SKILL.md` | `.codex/skills/` 目录 | `.cursorrules` 单文件 |
| Pack 契约 | **一份** `topmind-pack.json`（禁止每 skill 再拆 pack JSON） | 通常单 skill 分发 | server 清单 | skill install | skill-installer | 无 pack 概念 |
| 入口 | 用户日常入口唯一 `topmind`；host/skills.sh 可直连索引全部 description | 每 skill 独立 discovery (npx skills / skills.sh) | 工具列表 | 每 skill 独立 | 每 skill 独立 | 全局规则文件 |
| Progressive disclosure | Discovery=`name+description` → Activation=`SKILL.md` → Resources=`shared/`+`references/` | 同三阶段 | 无 | 同三阶段 | 两阶段（discovery + activation） | 单阶段（全量加载） |
| description | ≤1024 字符；含 Use when + Do not use | 必填触发真源 | tool description | ≤1024 字符 + Use when + Do NOT | 类似 | 无限制 |
| 降级 | Host 文件 → 可选 UTR → 对话 | 无内建降级 | 协议层 | 无内建降级 | 无内建降级 | 无 |
| 错误处理 | 写入失败可逆 + 回执 + 错误指导 | 无内建错误恢复 | 协议层 | 无内建错误恢复 | 无内建错误恢复 | 无 |
| 语义消歧 | `action_category`(skill) vs 笔记 `category`(大类目录) | 无数据大类概念 | n/a | 无 | 无 | 无 |
| 行为契约 | 工作区根 `topmind.yaml`（8 类规约机器可读） | 无 | 无 | 无 | 无 | 无 |
| 可移植性 | 5 安装目标（claude-code/codex/hermes/opencode/generic），MCP/Obsidian 经各自宿主接入 | 按 host 独立 | MCP 协议层 | Claude-only | Codex-only | Cursor-only |
| 数据模型 | 三平面（内容/语义/系统）+ 6 条规约 | 无 | 无 | 无 | 无 | 无 |
| 写回安全 | writeback-engine 唯一写闸 + 保护级别 + 备份回执 | 无 | 无 | 无 | 无 | 无 |

**设计选择说明**：
- **Hybrid Pack**：9 个标准 skill 目录（兼容开放标准），**只有一份** pack 级 JSON；子 skill 自包含可激活，但不各自版本/内容模型。
- **frontmatter 用 `action_category` 而非 `category`**：避免与用户笔记 `category`（物理大类）碰撞。
- **`description` 是触发器**：What + Use when + Do NOT；≤1024 字符；不是 README 摘要。
- **Router 勿过宽**：禁止「any knowledge task」淹没子 skill；单意图优先子 skill。
- **三级降级是 topmind 独有**：见 `skills/shared/capability-degradation.md`。
- **契约驱动而非散文复制**：规约语义从 `topmind.yaml` 求值；`shared/project-model-brief.md` 是给人/Agent 读的契约摘要，SKILL.md 不内联规约细节。
- **Pack 级 `shared/`**：开放标准按 skill 目录分发；topmind 需 `shared/` 与 skill **同级**（见 `skills/shared/host-loading.md`）。
- **纯 Markdown**：无 Loader/Registry；`topmind-pack.json` 是 pack 机器契约，不是运行时。
- **写回安全链是 topmind 独有**：业界 skills 均无内建写入安全机制；topmind 通过 writeback-engine 实现保护判定 → 备份 → 原子落盘 → 回执的全链路可逆。
- **多 host 可移植**：Claude/Codex/Cursor skills 均绑定单一 host；topmind 同一 pack 可安装到 5 个官方目标（claude-code/codex/hermes/opencode/generic），共享内容约定与行为契约。

---

## 1. 心智模型对齐

topmind 用户心智是**三平面工作区**上的**类别 + 专题 + 记忆**：

```text
系统平面:  topmind.yaml（契约）+ .topmind/（机器态：index/loop/logs，勿当内容）
语义平面:  memory/（持续记忆：profile.md + periodic/{YYYY}/ + topics/）
内容平面:  {NN-Name}/ 文件系统自发现
  类别（Category）: 编号目录；专题（Topic）: {类别}/{YYYY-主题}/
  动态周期本:       stream.packing=weekly|daily|monthly|atom（默认 weekly）; yearDir=true（按年分组）
  对象（Object）:   topic.md / *.md / 周期本
动作（Action）:   capture / organize / write / memory / maintain / loop / connector
用户动词:         记一下 · 整理本周 · 更新我的情况 · 写出来 · 找回
解析:             lib/contract-engine.mjs + workspace-model + stream-period + memory-engine
模板 Profile:     stream | balanced | research | periodic (默认 stream)
```

**6 条核心规约**（来自 `PROJECT-MODEL.md` §3，所有 skill / UTR / Desktop 行为必须遵守）：

1. **大类不重叠** — 同一内容/主题只能在一个大类下，按"内容性质"判定
2. **专题自然涌现** — 默认不建专题；反复出现时建议建立（UI 不说「涌现」）
3. **动态类** — loose-stream / flat-default：默认周期本（stream.packing=weekly）
4. **定期清理兜底类** — `catchAll` 按 contract `lifecycle.catch_all.retention_days` 回顾
5. **参考资料定位明确** — `referenceOnly` 只放反复引用素材
6. **类别命名稳定** — 改名走 `renameCategory` / 显式 migration

**保护级别**（写回前必须求值，见 `PROJECT-MODEL.md` §11）：文件 frontmatter `protection` > contract `protection.defaults.by_role` > `open`。`locked` 只读或 fork 新版本；`open` 可直接写。优先级：protection > writeback.mode。

---

## 2. Target Layers

```text
Layer 1: Engine repo
  topmind/
    skills/              agent skill modules (portable)
    utr/                 deterministic tool runtime (optional accelerator)
    topmind-desktop/     optional client

Layer 2: User data
  {workspace-root}/
    topmind.yaml          行为契约（先读）
    00-收件箱/             缓冲层（强制存在）
    10-动态/               默认流水类（yearDir: true → {YYYY}/周期本.md）
    20-专题/               类别（推荐，可删除）
    ...
    {NN-任意}/             用户扩展类别（动态发现）
    88-输出/           交付物层（推荐）
    99-归档/           内容安全层（backups · stream-archive · backups/trash · receipts）
    memory/                持续记忆（语义平面：profile.md + periodic/{YYYY}/ + topics/）
    .topmind/              机器态（index/loop/logs；勿当真源）
```

### 2.1 专题本地物理结构

```text
{类别目录}/{专题目录}/
├── topic.md                   # 可选：专题首页 + 稳定记忆
├── *.md                       # 笔记推荐直接放专题根目录，用户可灵活组织子目录
├── images/                    # 可选：局部资源目录
└── .derived/                  # 可选：AI 衍生（topic 摘要、item 历史）
```

> `chapters/`、`articles/`、`entities/` 不作为默认推荐结构，仅在用户明确需要时按需创建。Skills 以通用 `*.md` + role:delivery（常为 `88-输出/`）模型工作。

### 2.2 记忆与三平面结构

**三平面定义**：
- **内容平面**： `{NN-名称}/` 编号目录（用户日常记录，包括动态、专题、归档等）。
- **语义平面**： `memory/`（固化英文名，不占编号槽，跨工具约定），包含三层视图：
  - `memory/profile.md`（global 层：全域偏好、状态）
  - `memory/periodic/{YYYY}/`（periodic 层：年月周反思——关于用户的洞察提炼，非事件摘要）
  - `memory/topics/`（topics 层：长期稳定知识与事实，可选，默认不启用）
- **系统平面**： `topmind.yaml` + `.topmind/`（引擎读写态：index/loop/logs）。

**Stream→Memory 提升机制**：
日常动态 (Stream) 是流水账，当内容具备长期价值时，通过 `topmind-memory` 提升为 Memory：
- AI 使用 `memory.promote` 或文件拷贝将内容固化。
- 使用 `promoted_from` 与 `promoted_to` frontmatter 字段做双向链接溯源。
- 由 lifecycle-engine 自动生成提升候选（候选卡片），用户确认后完成。

---

## 3. Skill Packages（Hybrid）

```text
skills/
├── topmind-pack.json              # 唯一 pack 机器契约
├── install-targets/               # host 安装形状
├── shared/                        # 跨 skill 按需加载（须与 skill 目录同级安装）
│   ├── host-loading.md            # Host 三级披露 + 安装形状
│   ├── project-model-brief.md     # 契约摘要（三平面内容模型 + 规约速览）
│   ├── output-language.md         # 模型输出语言：用户要求 → 原文 → 工作区 locale
│   ├── capability-degradation.md  # 三级降级表（唯一）
│   ├── writeback-receipt.md       # 写回回执形状
│   ├── trigger-disambiguation.md  # 触发词消歧
│   ├── long-url-capture.md        # 长链/网页抓取
│   ├── document-ingest.md         # 本地文档 → Markdown 知识加工
│   └── media-assets.md            # 图片/媒体资源约定
├── topmind/                       # router（唯一日常入口）
│   ├── SKILL.md
│   └── references/                # multi-intent · template · connector
├── topmind-capture/ … topmind-x/  # action / connector
│   ├── SKILL.md                   # ≤500 行；自包含最小流程
│   └── references/                # 按需（loop 等）
├── evals/ · tests/
└── skills.md · README.md · LICENSE
```

**禁止**：每个子 skill 再维护独立 `*-pack.json` / 独立 semver / 复制 PROJECT-MODEL 全文 / 内联规约细节（引用 contract-brief）。

### 3.1 frontmatter Schema

```yaml
---
name: topmind-capture              # 必填。kebab-case，= 目录名（Agent Skills）
version: <pack.version>            # 必填。= skills/topmind-pack.json（非独立 semver）
description: >-                    # 必填。≤1024 字符；含 Use when + Do not use
  Capture … Use when … Do NOT use …
action_category: capture           # 必填。capture|organize|write|memory|maintain|loop|router|connector
                                   # ⚠️ 不是用户笔记的 category（大类目录名）
triggers: [记一下, capture]         # 必填。中英触发词
tags: [capture, inbox]
entrypoint: false                  # 仅 topmind router 为 true
compatibility: topmind workspace…  # 可选。对齐 Agent Skills compatibility
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-07-23
degradation: ../shared/capability-degradation.md
# v2 新增字段示例（根据需要可选）
protection: open                   # open | locked
promoted_from: <path>              # Stream→Memory 提升源
promoted_to: <path>                # 被提升至何处
memory_layer: periodic             # global | periodic | topics
review_after: 2026-12-31           # 生命周期扫描依据
derived_from: <path>               # 衍生层追溯真源
---
```

**正文结构**（推荐）：When NOT → Inputs/Workflow → Defaults/gotchas → Receipt → Tool boundary → 条件引用 shared/references。

Pack 元数据由 `topmind-pack.json` 唯一表达；SKILL frontmatter 镜像 `author`/`license`/`homepage`/`updated`。

### 3.1.1 Locale Overlay（国际化）

安装器支持按 locale 覆盖安装（机制已实现，**当前未随包发布任何 overlay**；`--locale` 一律回退基础版）：

```text
skills/topmind/
├── SKILL.md              ← 基础版（默认 zh-CN；唯一随包发布形态）
└── locales/              ← 可选 overlay 目录（发布 overlay 时才存在）
    └── en-US/
        ├── SKILL.md      ← 英文 overlay（覆盖基础版）
        └── references/   ← 英文引用（可选，按需覆盖）
```

1. `topmind-pack.json` 声明 `locales.available`（当前 `["zh-CN"]`；发布 overlay 后才会出现其他值）
2. 安装时通过 `--locale <code>` 或 `topmind_LOCALE=<code>` 环境变量指定
3. 安装器复制基础文件后，将 `locales/{locale}/` 中的文件覆盖到对应位置
4. 安装后删除 `locales/` 目录；无 overlay 时回退基础版

**触发词**：每个 SKILL.md 的 `triggers` 同时包含中英触发词。  
**UTR 错误消息**：`utr/core/i18n-strings.mjs` 中英双语；locale 从工作区 `topmind.yaml` 的 `workspace.locale` 解析。  
**模型输出语言**（用户可见回复 / 写入工作区的正文，与 skill 正文语言无关）：用户本轮明确要求 → 正在处理的原文 → `workspace.locale`，再回退中文。UI 语言不是输出语言。见 `skills/shared/output-language.md`。  
**注意**：`memory/` 等语义平面目录名**不**随 locale 变化；内容平面目录名才本地化。

### 3.2 `topmind`（唯一日常入口）

路由 + 政策 shell。它负责：

- 读工作区根 `topmind.yaml`（不存在则按默认契约解释）
- 发现可用类别（扫描 `{workspace-root}/{NN-*}*/`）
- 识别专题（已有 `YYYY-主题` 目录，或建议新建）
- 识别对象（`topic.md` / `*.md` / 周期本）
- 决定动作（capture / organize / write / memory / maintain / loop）
- 求值保护级别（protection）与保存设置（`writeback.mode`）

**智能路由规则**：

```text
高信心类别+专题 → 直接写入 {类别}/{专题}/ 下对应 .md
高信心类别，中信心专题 → 写入 {类别}/{专题}/ 下对应 .md，回执标注路由理由
高信心类别，低信心专题 → 写入 {类别}/*.md（单篇），提示"是否升级为专题"
低信心类别 → 写入 **role:buffer**（常为 `00-收件箱/` / `00-Inbox/`），提示稍后分类
记一下且无明确归属 → 追加到当前动态周期本（contract stream.packing）
```

### 3.3 Action Subskills

| 子 skill | action_category | 职责 | 触发场景 |
|---|---|---|---|
| `topmind-capture` | capture | 链接/摘录/速记/想法摄入（默认进当前周期本；不改 topic.md / memory） | "记一下"、"保存这个链接"、"收集这个想法" |
| `topmind-organize` | organize | 整理/分析/提炼/综合证据/审质量/Inbox路由；**综合默认落盘**（不建 INDEX） | "整理一下"、"分析"、"总结要点"、"整理 inbox" |
| `topmind-write` | write | 起草/续写/修订/润色/改格式/交付；**有 topic.md 先读**；写前求值 protection | "写"、"继续"、"出稿"、"导出" |
| `topmind-memory` | memory | memory/ 三层维护 + **Stream→Memory 提升**（用户确认制） | "记住这个"、"更新我的情况"、"加到主题记忆" |
| `topmind-maintain` | maintain | 诊断/清理/索引修复/**契约校验**（topmind.yaml schema） | "检查一下"、"清理工作区"、"修复索引" |
| `topmind-loop` | loop | 生命周期执行器：reconcile/digest/提升候选/归档建议；可中断可恢复，进度落 `.topmind/loop/` | "跑一遍 loop"、"巡检"、"复盘" |
| `topmind-weread` | connector | 微信读书划线/笔记/统计同步 | "同步微信读书"、"划线同步" |
| `topmind-x` | connector | X (Twitter) 发布/搜索/时间线 | "发推"、"搜索推文" |

子 skill 是实现模块，**不是独立前台产品**。用户不需要知道或选择它们。

> **Connector 类型**：`topmind-weread` 和 `topmind-x` 是可选的 source connector skill，落点遵循 contract `ingest.connectors.*`。

### 3.4 移植性（Portability）

```text
安装方式:
  OpenCode:  symlink skills/ → ~/.config/opencode/skills/topmind-*
  Claude Code: skill install topmind-pack.json
  Codex:      通过 codex.json install target
  Hermes:     通过 hermes.json install target

依赖:
  UTR — 可选。提供确定性操作加速。不可用时降级为文件操作。
  Desktop — 可选。纯 UI 层。Skill 逻辑不依赖 Desktop。
  MCP — 可选。提供工具暴露。降级为 CLI 或文件操作。

核心契约:
  所有 Host 暴露同一入口 (topmind) 和同一 类别/专题/记忆/对象/动作 流程。
  行为语义从工作区 topmind.yaml 求值；不得创建第二套内容模型。
```

---

## 4. Capability Degradation（能力降级，共享表）

```text
Level 1（主）: Host 文件工具
  → 直接读写工作区 Markdown / 目录；遵守 PROJECT-MODEL 与 topmind.yaml；返回路径回执

Level 2（可选）: UTR CLI / MCP
  → workspace-read.* / workspace-write.* / memory.* 等确定性加速

Level 3（最低）: 仅对话
  → 给出路径与步骤；不静默假装已写入
```

降级表唯一：`skills/shared/capability-degradation.md`，各 SKILL.md frontmatter `degradation` 字段指向它。

**不要**把「先装 UTR」写成用户前提。每个 SKILL.md 的 Tool Boundary 只列本 skill 相关命令。

---

## 5. Data Provenance & Protection

每条笔记的 frontmatter 标记 `source_type`（溯源）与可选 `protection`（权限）：

| source_type | 含义 | 规则 |
|---|---|---|
| `user-original` | 用户原创 | 保留字句，除非用户显式要求修订 |
| `ai-derived` | AI 分析/总结/抽取 | 带生成时间和依据；可改 |
| `external-capture` | URL/PDF/PPT/外部源 | 保留原文摘录 + source；AI 总结用 `---` 划清并标 `[AI整理]` |

| protection | AI 行为 |
|---|---|
| `open`（默认） | 按写回规约直接修改（仍受 `writeback.mode` auto\|confirm） |
| `locked` | AI 禁止直接写；需人工解锁或 fork 新版本 |

完整字段定义见 `TOOLS.md` §Frontmatter Schema。

---

## 6. Context Loading（最小读取原则）

Skill 路由时的最小读取顺序（**默认不加载整工作区**）：

1. 读 `{workspace-root}/topmind.yaml`（如存在；否则默认契约）
2. 扫描 `{workspace-root}/` → 发现所有类别目录 + `memory/`
3. 读目标类别的 `{类别}/{专题}/topic.md`（如存在）
4. 读当前对象（专题根下 `*.md` / delivery 层相关文件）
5. 必要时才读专题内其他文件 / `memory/主题/{主题}.md`

**默认不加载整工作区；`.topmind/` 不作为内容读取**（derived 摘要可作为上下文线索引用，需标注为衍生）。

---

## 7. Engine → UTR 命令映射 (8 域 / 28 命令)

Kernel 八引擎是内部领域逻辑；UTR 8 域是其 CLI/MCP adapter 暴露面。并非每个引擎都有独立 UTR 域——`stream` / `writeback` / `ingest` 是内部引擎，由其他 UTR 命令内部调用，不直接暴露。

| 引擎 (Engine) | 职责 | UTR 确定性命令（真实 8 域 / 28） | 降级边界 |
|---|---|---|---|
| **contract** | 契约加载/校验/ensure/reseed/求值 | `contract.validate` · `contract.ensure` · `contract.reseed` | Kernel `inspectContract` / `ensureContract` / `reseedContract`（v4 白名单） |
| **workspace-model** | 类别/专题/路径 | `workspace-read`：`list-categories` · `list-topics` · `inspect-topic` · `list-topic-files` · `list-inbox` · `list-recent-captures` · `list-safety-receipts`；`workspace-write`：`create-topic` · `capture-note` · `save-output` · `update-topic`；`workspace-transform`：`plan-inbox-routing` · `normalize-note-metadata` · `migrate-v4`；`workspace-maintain`：`doctor-workspace` · `archive-topic` · `archive-stream-year` · `restore-safety-receipt` · `cleanup-empty-dirs` | 目录扫描 + 基础读写 |
| **stream** | 周期本/reconcile | （无独立 UTR 域；`workspace-write.capture-note` 内部走 stream-engine 落周期本） | 文本追加 |
| **memory** | 分层记忆/提升 | `memory.promote` · `memory.digest` · `memory.append-profile` · `memory.append-topic` | 跨层复制 + frontmatter 标记 |
| **lifecycle** | 归档/清理/回顾扫描 | `lifecycle.scan`；归档/恢复经 `workspace-maintain.archive-topic` · `restore-safety-receipt` · `cleanup-empty-dirs` | 文件移动操作 |
| **writeback** | 保护/备份/回执（唯一写闸） | （无独立 UTR 域；所有 UTR 写命令内部经 writeback-engine） | 文件暂存与覆写 |
| **derived** | `.derived/` 生成重建 | `derived.rebuild` | 从真源重新生成 |
| **ingest** | URL/文档路由语义 | （无独立 UTR 域；路由经 `workspace-transform.plan-inbox-routing`；转换器在 Desktop） | 文件写入 + metadata 提取 |

---

## 8. Writeback（写回契约）

任何写用户真源的动作遵循契约的保存设置：

```yaml
# topmind.yaml
writeback:
  mode: auto | confirm
```

- `auto` — 直接写入并返回 path + affected-files evidence。（默认）
- `confirm` — 写入前打开 target/diff review。

**写入顺序（任何 Surface 一致）**：求值 protection → 影子暂存（大篇幅）→ 原子落盘 →（仅高影响）备份 →（仅高影响）回执。普通开放笔记的 create/update/move/rename 不写 `99-归档/receipts/`。

变更意图必须显式：

| 意图 | 首选路径 | 规则 |
|---|---|---|
| 新材料 | `capture-note` / `save-output` | 新建文件；默认不覆盖 |
| 稳定专题记忆 | `memory.append-topic` | 追加 `memory/topics/{slug}.md`；不静默替换前文 |
| 核心记忆 | `memory.append-profile` | 追加 `memory/profile.md`；禁止 capture 静默写 |
| 局部修订 | Proposal 带 before/after | 展示基线；auto 写带回执 |
| 整文重写 | `update-topic` | 要结构性理由；经 Kernel 写闸；仅高影响才有 backup/receipt |
| 提升记忆 | `memory.promote` | 复制新版本 + `promoted_from` / `promoted_to`；经 writeback-engine |

完整写回契约和 evidence 格式见 `TOOLS.md` §Writeback Contract。

---

## 9. Desktop Boundary

Desktop 必须反映同一动作模型：

```text
读契约 → 类别 → 专题 → 对象 → 动作 → save setting → receipt/revision
```

Desktop 定位：**通用个人工作台**，不限于特定写作场景。

- 默认视图 = Stream（contract `presentation.views.default`）
- 不内置段落管理、实体提取器等特定场景工具
- 以通用笔记编辑 + AI 辅助为核心
- 建议卡片（提升为记忆 / 归档 / 冲突）是一等交互；AI 动作默认可配置为「需确认」
- URL 抓取：L1 静态 Readability · L2 可选增强渲染 · L3 浏览器扩展 Clip Bridge；与 `shared/long-url-capture.md` 对齐
- 扩展与 Desktop **共用** Readability / HTML→Markdown，不维护第二套转换器
- Inbox 按 `source_type` 筛选；捕获回执路径可见
- 记忆视图（global / 周期 / 主题三层）与保护状态指示可见
- Desktop 状态不成为内容真源

详见 `topmind-desktop/{README,ARCHITECTURE,DESIGN}.md`。

---

## 10. Cross-Agent Skill Topology

引擎 Skills 在 `skills/`，可独立打包安装到任意 Agent Host：

- OpenCode — 通过 skills symlink + MCP
- Claude Code — 通过 skill install
- Codex — 通过 skill pack
- Hermes — 通过 skill install

**Desktop 是可选的**。Skill pack 本身可以无 Desktop 运行。
所有 Host 必须暴露同一入口（`topmind`）和同一类别/专题/记忆/对象/动作流程，
**不得**创建第二套内容模型。

**UTR 是可选的**。无 UTR 时 Skill 降级为 host 文件工具操作，
保留同一 workspace contract。UTR 是确定性自动化加速器。

---

## 11. Extension Layering Contract

```text
Source Connector → Object Adapter → Action Registry → Tool Contract → Surface Placement
```

新功能按类别 → 专题 → 对象三段路由归位，落在这五层之一。
不新增前台用户心智概念（类别 / 专题 / 记忆 / 输出 已完备）。

---

## 12. Skill 硬约束（摘要）

- 唯一日常入口 `topmind`；UTR 命令域 `workspace-*` / `memory.*` / `contract.*` / `lifecycle.*` / `derived.*`
- 动手前读 `topmind.yaml`；规约引用 `shared/project-model-brief.md`，不内联复制
- 路径 `{类别}/{YYYY-主题}/`；类型由类别位置表达
- 内容写 `topic.md`；不默认 outline/setting/style
- 专题根 `*.md`；交付 `88-输出/`；内容安全层 `99-归档/`；机器态 `.topmind/`
- 记忆写 `memory/`（语义平面，固定英文名，不改名不删除）
- 写回前求值 protection；仅高影响才落 `99-归档/receipts/`
- 类别动态自发现；loop 为独立 skill（生命周期执行器）
- 降级表唯一：`skills/shared/capability-degradation.md`
- Progressive disclosure：`shared/` + skill `references/`；SKILL.md ≤500 行
- 一份 `topmind-pack.json` only；禁止每 skill 再拆 pack JSON / 独立 semver
- Frontmatter：name · version · description（Use when + Do not use）· action_category · triggers（+ compatibility / 推荐元数据）
- Agent 规范：`AGENTS.md`（`CLAUDE.md` 为薄壳）

同步：`PROJECT-MODEL.md` · `TOOLS.md` · `DESIGN.md` · `PRODUCT-BOUNDARIES.md`。
