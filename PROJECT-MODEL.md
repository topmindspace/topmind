# PROJECT-MODEL.md — 数据模型与设计哲学

> **内容约定唯一真源**（路径、命名、frontmatter、核心规约、契约 schema）。  
> **产品北极星（2026-07-25）**：**最低摩擦个人动态流** — 记下来尽可能简单；AI 建议、用户确认后沉淀；文件即真源。  
> **工作流**：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`  
> **用户动词（≤5 概念）**：`记一下 · 动态 · 专题 · 我的情况 · 写出来`  
> **实施与诚实状态**：`docs/ARCHITECTURE-RESET.md` §2 — Phase A/B 主路径 **Done**；备份全覆盖 / 全量归档卡 **Partial**；语义索引 Phase C **Target**。
>
> **设计哲学的权衡选择**：
> 1. **降低记录门槛**：先记后分 — 随手记落入动态周期本，主题反复出现再升专题或记忆。  
> 2. **人类主导与 AI 透明**：物理文件即真源；耐久主写经 writeback-engine（保护 · 备份 · 回执；**Done**，见 Reset §2.2）。  
> 3. **契约单一真源** — 工作区根 `topmind.yaml`（v4）；Desktop / Skills / UTR 共同遵守。  
> 4. **可移植优先** — Skills 纯 Markdown；UTR / Desktop 可选。  
> 5. **命名即文档** — Category / Topic / Memory；代码 Topic* / Category* / Memory*。  
>
> **Kernel 八引擎**（文件在 `lib/`；合闸状态见 ARCHITECTURE-RESET §2）：  
> contract · workspace-model · stream · memory · lifecycle · **writeback（唯一写闸 · Done 主路径）** · derived · ingest。

---

## 0. 用户词表（对外只讲这些）

| 用户说 | 含义 | 系统落点 |
|--------|------|----------|
| **记一下** | 存下来 | 动态周期本 / 收件箱 / 专题 |
| **动态** | 日常流水 | `role:loose-stream` 类；默认**每周一本** |
| **专题** | 长期主题夹 | `{大类}/{YYYY-主题}/` |
| **我的情况** | 关于我的稳定信息 | `memory/profile.md`（global 层） |
| **整理本周** | 理顺本周流水 + 可选归位 | 就地改周期本；候选写 memory/专题 |
| **写出来** | 出成品 | role:delivery（常为输出/） |
| **检查一下** | 健康/恢复 | maintain / 99-归档 |
| **找回** | 找以前的东西 | 搜索 + memory/ + 主题/记忆视图 |

**不要**在产品 UI 教用户：沉淀、涌现、protection、derived、writeback_mode（设置里用白话：「保存前问我」）。

### 三块地方 + 一个记忆（语义，不是物理根清单）

```text
动态     → 时间叙事（可只整理、不必升专题）
专题     → 主题夹（反复出现才建议建立）
我的情况 → memory/：跨天仍成立的偏好/目标/关系，分层维护
```

---

## 1. 三平面目录模型（v4 根基）

工作区根目录由**三个平面**构成。新增任何东西先问它属于哪个平面：

| 平面 | 命名法 | 物质 | 谁能定义 |
|------|--------|------|----------|
| **内容平面** | `{NN-名称}/` 编号目录（自发现） | 用户数据：缓冲、流水、专题、交付、内容安全层 | 系统给默认，用户自由增删改 |
| **语义平面** | 固定英文语义名（无编号） | 跨工具约定的用户资产：**`memory/`** | 系统固化；用户不改名、不删除 |
| **系统平面** | 根契约文件 + 点目录 | **`topmind.yaml`**（契约）；**`.topmind/`**（机器态） | 系统固化 |

### 1.1 推荐默认结构（模板 `stream`）

```text
{workspace}/
├── topmind.yaml            【系统平面】唯一行为契约
├── 00-收件箱/              【内容平面】role: buffer（强制，唯一强制内容类）
├── 10-动态/               【内容平面】role: loose-stream；周期本 2026-W30.md
├── 20-专题/               【内容平面】role: deep-work；{YYYY-主题}/
├── 88-输出/               【内容平面】role: delivery（扁平交付）
├── 99-归档/               【内容平面】role: system（内容安全层）
│   ├── backups/             高影响快照（locked 覆盖 · trash/归档）
│   │   └── trash/           Kernel 删除落点（可恢复；permanent 不生成）
│   ├── trash/               可选 legacy 顶层 trash（旧工作区）
│   └── receipts/            写操作回执（内容安全层，不可删）
├── memory/                 【语义平面】持续记忆（固化目录，英文名不改名）
│   ├── profile.md           global 层：核心个人事实/偏好/长期目标
│   ├── periodic/            periodic 层：2026-W30.md（AI 生成，人可改）
│   └── topics/              topics 层：{topic-slug}.md（可选，默认不启用）
└── .topmind/               【系统平面】机器态（可忽略、可重建）
    ├── index/               可选语义索引（默认关闭）
    ├── loop/                loop 巡检进度
    └── logs/                运行日志
```

**关键规则**：
- **derived 跟随大类**：AI 衍生（摘要/历史）放各大类 `.derived/` 子目录，是正式知识不是机器态
  - `20-专题/2026-示例/.derived/topic-summary.md`
  - `10-动态/.derived/period-digest.md`
  - `memory/periodic/.derived/conflict-report.md`
- **`.topmind/` 只放真正的机器态**：index/loop/logs（可删可重建）
- **receipts 留在 `99-归档/receipts/`**：内容安全层，是"找回/恢复"的依据，不可删

**进阶模板**（同一物理契约，更多抽屉）：`balanced` · `research` · `periodic`。

### 1.2 模板收敛 (4 种 Profile 差异)

v4 收敛至 4 种官方模板，在相同的「三平面模型」基础上，提供了不同的目录抽屉和预设：

| 模板 (Profile) | 目标群体 / 特点 | 目录倾向 | 编号分配 |
|---|---|---|---|
| **stream (极简流式)** | **默认**。追求轻量级、无压记录 | `00-收件箱`、`10-动态`、`20-专题`、`88-输出`、`99-归档` | 00/10/20/88/99 |
| **balanced (平衡知识)** | 多数知识工作者，兼顾记录与沉淀 | 同 stream · 增加标签视图 | 00/10/20/88/99 |
| **research (研究学术)** | 严谨追踪来源的深度研究者 | 同 stream + `30-研究`、`40-参考资料` | 00/10/20/30/40/88/99 |
| **periodic (周期回顾)** | 时效导向、强调周期复盘的执行者 | 同 stream + 强周期回顾（memory/periodic/ 默认启用） | 00/10/20/88/99 |

**编号位置固定规则**：
1. 编号位置固定，角色在所有模板中一致（00=buffer / 10=loose-stream / 20=deep-work / 30=deep-work / 40=reference / 88=delivery / 99=system）
2. 目录名可本地化（英文 `00-inbox/` / 中文 `00-收件箱/`）
3. 用户可选择加载哪些（stream 有 00/10/20/88/99，balanced 同 stream + 标签视图，research 加 30/40，periodic 同 stream + 强周期回顾）
4. 用户可扩展（50/60/70 等空槽位加自定义类，角色默认 deep-work）

### 1.3 平面判定规则

1. 是**用户内容**吗？→ 内容平面 `{NN-名称}/`，走自发现。
2. 是**跨工具约定的用户资产**（每个工作区必有、外部 Agent 要认）吗？→ 语义平面固化名。目前唯一成员 `memory/`；新增语义平面部件必须走 ADR。
3. 是**机器生成 / 可重建**的吗？→ `.topmind/` 内（只放 index/loop/logs）。

### 1.4 为什么 memory/ 不是编号目录

编号目录的语义是「排序 + 用户可扩展」；记忆是每个工作区**必有且仅有一个**的固定件，不是可扩展槽位。根下 `memory/` 对齐业界 Agent 记忆约定：任何外部 Agent 打开工作区，看到 `memory/` 即知「关于这个人的持续记忆在这里」——零说明书的互操作。语义平面目录名**不随 locale 变化**（英文工作区也叫 `memory/`），内部文件名也英文（`profile.md` / `periodic/` / `topics/`），不做本地化；内容平面目录名才本地化。

---

## 2. 内容平面：大类 + 专题

### 2.1 核心概念

- **大类（Category）**：两位数字前缀的目录（如 `20-专题/`），数字前缀保证字典序。
- **专题（Topic）**：大类下的主题目录，命名 `YYYY-主题`。
- **周期本（Period note）**：动态类下按 `stream.packing` 维护的 `YYYY-Www.md` / `YYYY-MM-DD.md` 等；记一下默认 **append**。
- **单篇（atom）**：`packing: atom` 或用户强制单独开卡时，一记一文件。

### 2.2 类别自发现与自动修复 (Auto-Repair)

```text
规则与机制：
  1. 自发现匹配：工作区根下任何匹配 {两位数字}[ -]{名称}/ 的目录 = 一个大类。
  2. 数字前缀仅保证排序，不限制数量上限。
  3. 自动修复：非标准命名大类载入时按 contract category_separator 安全批量重命名；
     缺少 00-收件箱 / 88-输出 / 99-归档（required roles）时自动安全补全。
  4. 推荐 00 + 10-60 + 88/99 作为默认入门；用户可新增（11-健康/、21-学习笔记/）、
     删除、重命名（renameCategory，含 frontmatter 与 contract 同步）。
  5. 00-收件箱/ 是唯一强制内容类（缓冲层不可删除）。
  6. 99-归档/ 是内容安全层（backups/trash/receipts），不参与日常导航。
```

**工具行为（统一 WorkspaceModel）**：
- `lib/workspace-model.mjs`（门面；实现在 `model-core/topic/stream/memory`）→ `resolveWorkspaceModel` 合并 FS + contract + template
- `workspace-read.list-categories` / Desktop `workspace.listCategories` → 完整 CategoryDescriptor（slot / directory / role / specialBehavior / source）
- Desktop 设置 → 新增一级类别写入 contract `categories.extensions`
- Skills 路由 → 先解析类别表，再按 **role + specialBehavior** 匹配归属（不硬编码 `10-动态`）

### 2.3 大类之间不重叠原则

同一内容/主题只能在一个大类下。判定依据：**内容性质 > 主题名称**。

- AI 智能体作为**研究对象** → `20-研究/`
- AI 智能体作为**创作主题** → `40-创作/`
- AI 智能体作为**日记随想** → `10-动态/`

AI 分发遇到歧义时按"内容性质"判定；无法判定时 → `00-收件箱/`。

### 2.4 类别区间推荐

| 区间 | 用途 | 推荐默认 |
|------|------|----------|
| `00` | 缓冲 | `00-收件箱` |
| `10-19` | 生活/日常 | `10-动态` |
| `20-29` | 研究/学习 | `20-专题` 或 `20-研究` |
| `30-39` | 阅读 | `30-阅读` |
| `40-49` | 创作 | `40-创作` |
| `50-59` | 杂项 | `50-其他` |
| `60-69` | 参考资料 | `60-参考资料` |
| `70-87` | 用户自由区间 | — |
| `88-89` | 交付物 | `88-输出` |
| `90-99` | 系统/安全 | `99-归档` |

> 两位数 `NN`，推荐按 10 的倍数跳跃。用户可在区间内插入。语义平面的 `memory/` 不占编号槽。

---

## 3. 6 条核心规约

| # | 规约 | 含义 |
|---|------|------|
| 1 | **大类不重叠** | 同一内容/主题只能在一个大类下，按"内容性质"判定 |
| 2 | **专题自然涌现** | 默认不建专题夹；同主题反复出现时 **建议** 升专题（UI 不说「涌现」） |
| 3 | **动态类特殊** | `specialBehavior: flat-default` / `loose-stream`：默认周期本或平铺，不强建专题 |
| 4 | **定期清理兜底类** | `catchAll` 类按 contract `lifecycle.catch_all.retention_days` 回顾 |
| 5 | **参考资料定位明确** | `referenceOnly` 类只放反复引用的素材，不放"读完就忘"的笔记 |
| 6 | **类别命名稳定** | 已创建的类别目录名不轻易改；改必须走 `renameCategory` 批量更新引用 |

> 规约 3–5 通过模板属性参数化，不绑定固定编号。  
> 规约 1 / 2 / 6 对所有类别生效。Skills / UTR / Desktop 读 `topmind.yaml` → `templates/*.json` 决定路由与清理提示。  
> 语义平面与系统平面固定件（`memory/` · `topmind.yaml` · `.topmind/`）**不改名、不删除、不进自发现**——这是平面规则，不占 6 条规约。

---

## 4. 渐进式专题解析模型 (Progressive Topic Model)

```text
【极简单篇（起步）】
   └── 10-动态/周末随想.md （直接平铺，无专题、无 topic.md）
   └── 状态：所有工具判定为健康，正常工作

【自然涌现专题（演进）】
   └── 20-专题/2026-示例研究/ （2+ 篇笔记 + 持续主题 → 升级为专题）
   └── topic.md 可选；要写就写，不写就靠 frontmatter.topic 聚合

【规范专题（定案）】
   └── 20-专题/2026-示例创作/ （完整结构：topic.md + *.md 笔记 + images/）
   └── 长期持续推进的项目自然形成完整结构
```

> `topic.md` 是推荐的专题首页和稳定记忆库，但它的缺失**绝对不能**导致专题读取、写入或健康诊断抛错。

---

## 5. 柔性扁平与逻辑语义索引 (Latent Indexing)

- **大类内专题扁平（推荐）**：每个大类根下专题目录平铺。专题内部笔记文件推荐直接放在根目录；用户可按需创建子目录，系统自动感知和适配。
- **不强制扁平**：用户自建子目录（如 `notes/`、`drafts/`）应被 Skills、UTR、Desktop 正确识别。不做硬索引，通过文件系统遍历和 frontmatter 语义发现内容。
- **虚拟文件夹**：Desktop 侧边栏和 AI 技能通过 frontmatter 的 `topic` / `category` 字段聚合为虚拟分组。
- **去 INDEX.md 机制**：内容发现依赖：
  1. 文件名（描述性、人类可读）
  2. Frontmatter（`topic` / `category` / `source_type` / `tags`）
  3. `topic.md` 索引段（轻量，AI 或用户可选维护）
  4. OS 文件搜索（Finder / Obsidian / VS Code / grep）
  5. 可选派生：各大类 `.derived/` 子目录 · `.topmind/workspace-map.json` · `.topmind/index/`（均可随时重建，**非真源**）
- **顶级目录约束**：不新增全局 `references/`、`sources/`、`library/` 顶级物理目录；所有资料和库资产统一以类别+专题形式自治管理。

---

## 6. 专题内部结构

```text
{大类目录}/{专题目录}/
├── topic.md            # 可选：专题首页 + 稳定记忆 + 索引 + 下一步
├── *.md                # 笔记即主题核心内容，直接放专题根目录
├── images/             # 可选：局部资源（约定见 skills/shared/media-assets.md）
└── .derived/           # 可选：AI 衍生（topic 摘要、item 历史）
```

> 笔记在专题根；不默认 `notes/` / sections / entities 等嵌套。

### 6.1 88-输出 — 扁平交付物层

全部交付物进 `88-输出/`（`YYYY-MM-DD-描述.ext`）。

**发布语义**：生成**交付副本**，**不删除**专题/Inbox 原文；若笔记有关联 `images/{slug}/`，一并**复制**到 `88-输出/images/{slug}/`。与「移入专题」（整理）不同——整理会迁走原文与资源。

### 6.2 99-归档 — 内容安全层（role:system）

```text
99-归档/
├── backups/            # 高影响快照（locked 覆盖备份；delete/archive trash；旋转 BACKUP_KEEP=3）
│   └── trash/          # Kernel 删除落点：backups/trash/{originalRel}（可恢复）
├── trash/              # 可选 legacy 顶层 trash（旧工作区仍可 list/restore）
└── receipts/           # 写操作回执（内容安全层，不可删）
```

> 写操作**回执**是内容安全层的一部分，是"找回/恢复"的依据，不可删。  
> **备份/回执策略（高影响 only）**：常规 `open` 文件写入（AI/user 更新）**不**创建 backup 与 receipt。仅高影响落盘：`locked` 既有文件覆盖（多为 user；AI 写 locked 被拒）、非 `permanent` 的 delete/archive（trash/归档副本 + 回执）。高影响备份/回执旋转上限 `BACKUP_KEEP=3` · `RECEIPT_KEEP=50`。策略集中在 Kernel 写闸，不靠调用方零散 `skipBackup` 拼语义。  
> **删除落点**：`executeDelete` 默认写入 `99-归档/backups/trash/…`（与 `backup_to` 同根）；legacy 顶层 `99-归档/trash/` 仍可被 `list-safety-receipts` / `restore-safety-receipt` 识别。  
> **彻底删除**：`executeDelete`/`executeArchive` 支持 `permanent:true`，跳过 trash/archive 副本直接删除（不可恢复，UI 提供复选框确认）。  
> 恢复入口：UTR `list-safety-receipts` → `restore-safety-receipt`（不覆盖已有文件，写 `-restored-` 副本）/ Desktop 找回面板。

---

## 7. 语义平面：memory/ 持续记忆

记忆是定位的一半：**Stream 解决「记下来」，Memory 解决「持续维护与找回」**。

### 7.1 三层结构

| 层 | 物理 | 内容 | 更新方式 |
|----|------|------|----------|
| **global** | `memory/profile.md` | 跨时间的个人事实、偏好、长期目标、关键的人 | 段落追加；`## 偏好` `## 当前目标` `## 关键的人与协作` `## 进行中的事` |
| **periodic** | `memory/periodic/2026-W30.md` | 本周/本月重点事项汇总 | lifecycle 触发，AI 生成，人可改 |
| **topics** | `memory/topics/{topic-slug}.md` | 围绕特定主题的持续演变记录与摘要（可选，默认不启用） | Stream→Memory 提升；AI 建议，用户确认 |

- 解析：`lib/memory-engine.mjs` · workspace-model `resolveMemoryPaths()` / `ensureCoreProfile()`
- 写入：`memory.append-profile` / `memory.append-topic` / memory skill；**禁止** capture 静默改
- 目录可配：contract `memory.dir`（默认 `memory/`）；三层开关与风格在 contract `memory.layers`
- **文件名英文统一**：`profile.md` / `periodic/` / `topics/`，不做本地化
- **产品面状态**：**Done**（Phase A/B）— 目录约定 · 侧栏「我的情况」+ `ensureCoreProfile` · AiPanel 建议条 generate/apply（digest/promote）；周期摘要经建议管线可生成。仍受 `require_confirm` / open|locked 约束（产品正确）。语义 Ask 索引 → Phase C **Target**

### 7.2 Stream → Memory 提升

```text
周期本条目/单篇 --(出现≥N次 或 用户/AI 标记)--> 建议卡片（默认可生成，须用户确认）
  ├─ 确认 → 写入 memory/topics/{topic-slug}.md（受 protection + writeback）
  │         原条目标记 promoted_to；记忆文件标记 promoted_from + memory_layer
  └─ 忽略 → 记录忽略，下个周期不重复建议
周期结束 --> reconcile（整理本周）+ 建议生成 periodic 摘要 memory/periodic/{period}.md
```

提升规则在 contract `memory.promotion`（`min_occurrences` · `require_confirm`）。  
**流水可以只是流水**，不必升专题也不必升记忆。  
**实现状态**：memory-engine + Desktop 建议条 apply（digest/promote）**Done**；全自动周期 promote 策略仍受 `require_confirm` 约束（产品正确，非未实现）。

---

## 8. 系统平面：topmind.yaml 与 .topmind/

### 8.1 Contract（`topmind.yaml`，schema v4）

唯一行为契约真源。**放在工作区根目录**：契约是人读人写的门面文件（同 `package.json` 之于仓库），任何工具与 Agent 打开根目录即可发现；工作区自洽自包含。

```yaml
contract_version: 4
workspace:
  name: 我的 topmind
  locale: zh-CN                # zh-CN | en-US；影响 UTR 消息、内容模板、Skills 安装
  template: stream             # stream | balanced | research | periodic
  category_separator: "-"      # - 或空格

categories:                    # 用户扩展与覆盖；存在性以 FS 为准
  extensions:
    "11": { name: 健康与运动, role: loose-stream, specialBehavior: flat-default }
  overrides:
    "50": { hidden: true }

stream:                        # 流规约
  packing: weekly              # atom | daily | weekly | monthly（默认 weekly）
  append_heading: day          # day | none

memory:                        # 记忆维护规约
  dir: memory
  layers:
    global:   { file: profile.md, update: on-suggest }   # on-suggest | auto | manual
    periodic: { dir: periodic, cadence: weekly, style: brief }
    topics:   { dir: topics, auto_create: false }
  promotion: { enabled: true, min_occurrences: 2, require_confirm: true }

protection:                    # 保护与权限规约
  defaults:
    by_role:
      buffer: open           # 收件箱：AI 自由整理
      loose-stream: open     # 动态流：AI 自由追加/整理
      deep-work: open        # 专题：AI 可改
      memory: open           # 记忆层：AI 可生成/维护（文件级可覆盖 locked）
      delivery: open         # 交付层：AI 可生成/更新（文件级可覆盖 locked）
      system: locked         # 归档层：锁（唯一默认 locked）
  # 文件级 frontmatter protection 可覆盖目录默认
  # 优先级：protection > writeback.mode（locked 时无论 mode 如何，AI 禁止直接写）

lifecycle:                     # 生命周期规约
  inbox: { review_after_days: 7 }
  catch_all: { retention_days: 30 }
  stream: { digest_after_periods: 4 }
  topic: { stale_after_days: 90, suggest_archive: true }
  output: { lock_after_days: 30 }

writeback:                     # 写回与伦理规约
  mode: auto                   # auto | confirm（设置白话：保存前问我）
  shadow: true
  backup_to: 99-归档/backups
  receipts: 99-归档/receipts   # receipts 留在内容安全层

ingest:                        # Ingest 与连接器规约
  default_target: stream
  url: { renderer: auto }      # L1 readability | L2 enhanced | L3 bridge
  connectors:
    weread: { sync_category: auto }
    x: { sync_category: auto }

agent:                         # Agent 行为规约
  skills_entry: topmind
  confirm_by_default: false
  hooks:
    on_capture: [suggest_topic]
    on_period_end: [reconcile, suggest_promotion]
    on_stale_topic: [suggest_archive]

presentation:                  # 呈现规约
  views: { default: stream, enabled: [stream, category, timeline, tags, kanban] }
```

**规则**：
- `contract_version` 单调递增；contract-engine 负责校验与迁移（8 类顶层键白名单，拒绝未知键）。
- **存在性以 FS 为准**：contract 声明但未建目录 → `pendingCreate`。
- **合并优先级（属性）**：`overrides` > `extensions` > `templates/*.json` > 默认 `role: deep-work`。
- **隐藏**：`overrides[slot].hidden: true` — 不删盘；侧栏/timeline/tags/kanban/connector 默认跳过。
- **ensure 策略**：打开工作区只保证 required roles（buffer/delivery/system）+ 语义平面 `memory/` + 系统平面骨架；**不**复活用户已删可选类。
- 类别变更 API：`addCategory` · `updateCategoryAttributes` · `renameCategory`（改目录名 + 树内 frontmatter + contract）。
- 派生索引：`writeWorkspaceMap` → `.topmind/workspace-map.json`（可删，非真源）。

### 8.2 `.topmind/` — 机器态

可整体忽略、可整体重建；**永不作为内容真源**。

| 子目录 | 内容 | 重建 |
|--------|------|------|
| `index/` | 可选语义索引（SQLite + embedding；默认关闭） | 随时重建 |
| `loop/` | loop 巡检进度（可中断可恢复） | — |
| `logs/` | 运行日志 | — |

**注意**：derived（AI 衍生）不在 `.topmind/`，而是跟随各大类 `.derived/` 子目录（正式知识，非机器态）。

---

## 9. 文件系统即真源 (File-System-First)

- **没有独立数据库** — 所有用户数据以 Markdown 文件存储
- **外部工具友好** — Finder、Obsidian、VSCode 修改文件，topmind 即时感知（fs.watch / FSEvents）
- **一切缓存可重建** — `.topmind/**`、Desktop notes-index 均为派生，非真源
- **Desktop runtime state 非真源** — 默认 `~/topmind/topmind-desktop/state/`（`topmind_DESKTOP_HOME` 可改），仅 UI / 设置 / 会话；绝不进 engine 仓

```text
真源层:      {workspace}/{编号类}/**/*.md + memory/**/*.md + topmind.yaml   ← 用户数据
派生层:      {workspace}/{大类}/.derived/** + .topmind/**                   ← 可重建（receipts 除外，凭证只增）
运行状态:    ~/topmind/topmind-desktop/state/                               ← 非真源（Desktop home）
安全层:      {workspace}/99-归档/                                          ← 内容备份与回收（含 receipts）
```

---

## 10. 影子流式写入与原子提交 (Shadow Writeback)

1. **影子暂存**：AI 输出的流式文本写入当前目录下的隐藏临时文件（如 `.shadow-draft.tmp`）
2. **视口直通**：Desktop 编辑器将影子文件临时叠加在视图层
3. **保护判定**：writeback-engine 先求值目标文件的有效 protection（文件级 > role 默认）
4. **原子落盘**：生成完毕且用户 Commit（或自动保存策略判定安全）时，原子替换物理文件。备份/回执仅高影响：`locked` 覆盖与 delete/archive 进 `99-归档/backups/`（含 trash）与 `99-归档/receipts/`；open 常规更新不造备份/回执
5. **安全中断**：强行中断只需丢弃影子文件，物理真源毫发无损

---

## 11. 保护级别 (Protection) 与数据溯源 (Provenance)

**溯源 ≠ 权限**，两个正交维度：

### 11.1 保护级别（AI 能碰什么）

| protection | 含义 | 典型区域 |
|---|---|---|
| `open` | AI 可按写回规约直接修改 | 动态、收件箱、专题、记忆、交付（默认） |
| `locked` | 只读；任何写需先人工解锁或 fork 新版本 | 99-归档、锁定输出（文件级覆盖） |

求值顺序：文件 frontmatter `protection` > contract `protection.defaults.by_role` > `open`。

**优先级**：`protection` > `writeback.mode`（locked 时无论 mode 如何，AI 禁止直接写）。

### 11.2 数据溯源（这是谁写的）

| source_type | 含义 | AI 权限 |
|---|---|---|
| `user-original` | 用户原创 | 仅拼写格式修饰，不得篡改实质字句 |
| `ai-derived` | AI 自动生成 | 可自由更新，必须附带生成时间戳 |
| `external-capture` | 外部抓取 | 保留原文摘录；AI 整理用 `---` 划界并标 `[AI整理]` |

完整 frontmatter 字段定义见 `TOOLS.md` §Frontmatter Schema。

---

## 12. 命名规约

### 12.1 类别目录

格式：`{NN}-{名称}/`（推荐）或 `{NN} {名称}/`，NN = 两位数字（00-99）。

```text
00-收件箱/        ✅ (推荐连字符)
10-动态/          ✅
20 研究/          ✅ (兼容空格)
21-Learning/     ✅ (用户自定义)
AI研究/           ❌ 缺少数字前缀
memory/           ❌ 语义平面保留名，禁止作为类别
```

### 12.2 专题目录

格式：`{YYYY}-{主题}`（年份-主题，连字符，纯）。

```text
2026-示例记录           ✅
2026-研究-AI智能体      ❌  不要把类型塞进专题名；类型由大类表达
```

### 12.3 笔记与输出文件

- 笔记：描述性命名。如 `研究方法论对比.md`
- 输出：`88-输出/YYYY-MM-DD-描述.ext`
- 单篇可带日期排序：`周末随想-2026-06-21.md`

### 12.4 保留名（三平面固定件）

| 保留 | 用途 |
|------|------|
| `topmind.yaml` | 契约文件 |
| `memory/` | 语义平面记忆目录 |
| `.topmind/` | 系统平面机器态 |
| `topic.md` | 专题首页保留文件名（专题根下） |
| `.derived/` | AI 衍生子目录（各大类/专题/记忆层下） |

### 12.5 禁止目录与文件

**工作区根禁止**：`knowledge/` · `writing/` · `references/` · `sources/` · `library/` · `projects/`（一律用类别 + 专题）。

**禁止文件**：`.tmp` · `.clean` · `.DS_Store`；Desktop runtime state 不进用户工作区。

---

## 13. 多工作区支持

- 一个工作区 = 一个包含 `topmind.yaml` + 三平面结构的文件系统路径
- 用户可创建多个工作区（个人 / 工作）
- Desktop 一次打开一个活跃工作区；切换 = 切换文件系统根，所有工具重新扫描
- 活跃/最近列表在 Desktop home（`topmind_DESKTOP_HOME`），非内容真源

---

## 14. 当前禁止（实现硬约束）

| 禁止 | 正确做法 |
|------|----------|
| 类型写进命名或 `project_type` 字段 | `{大类}/{YYYY-主题}/`；类型 = 物理类别位置 |
| 默认创建 `outline.md` / `setting.md` / `style.md` | 内容写入 `topic.md` |
| 默认 `entities/` · `chapters/` · `articles/` · 专题内 `notes/` · `outputs/` | 专题根 `*.md` + 可选 `images/`；交付进 `88-输出/` |
| 全局 `references/` · `sources/` · `library/` 根 | 做成类别下的专题 |
| 把 `.topmind/**` 当内容真源 | 可重建派生；可忽略 |
| 硬编码固定类别槽位上限 | 动态自发现 `{NN-Name}/` + WorkspaceModel |
| 用白名单否定自定义类 | 仅校验命名模式；角色来自 contract/template |
| 代码使用 Project* 日常命名 | Topic* / Category* / Memory*；命令域 `workspace-*` |
| 打开工作区复活已删可选类 | 只 ensure required roles + 语义/系统平面骨架 |
| 把 `memory/` 做成编号目录或随 locale 改名 | 语义平面固化英文名 |
| 把 receipts/logs/index 进 `99-归档/` 或内容类 | receipts 在 `99-归档/receipts/`（内容安全层）；logs/index 在 `.topmind/`（机器态） |
| 把 derived 放 `.topmind/derived/` | derived 跟随各大类 `.derived/` 子目录（正式知识） |

---

## 15. 与外部工具的契约

物理结构应对任意工具「打开即懂」：

- 任意 Agent — 根目录三件门面：`topmind.yaml`（规则）· `memory/`（关于我）· 编号目录（内容）
- Obsidian / VS Code / 文件管理器 — `NN` 前缀保证默认排序
- grep / ripgrep — 直接扫工作区根
- 任意编辑器 / LLM — 目录 + frontmatter 双源

同步文档：`SKILL-ARCHITECTURE.md` · `TOOLS.md` · `DESIGN.md` · `PRODUCT-BOUNDARIES.md`。
