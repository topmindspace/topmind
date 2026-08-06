# Stream-first 个人动态流 — 整体优化与重构方案

> **状态**：**Wave S\* 已合闸（Shipped）** · 历史分析保留作决策记录  
> **日期**：2026-08-03（分析）· 合闸更新同日  
> **角色**：理想使用态 + delta 方案 + **现行产品真理**  
> **基线真源**：`docs/ARCHITECTURE-RESET.md` · `DESIGN.md` · `PRODUCT-BOUNDARIES.md` · `topmind-desktop/DESIGN.md`  
> **实现**：`lib/activity-window.mjs` · suggest/todo/ai-ops · Desktop `StreamDetailView` / `ActionStore.runActivityOps` / `organize-week`

---

## 0. 现行产品真理（优先于下文历史缺口表）

| 能力 | 现状 |
|------|------|
| 整理范围 | **活动窗口**（近期周期 ∪ mtime ∪ 增补 parent）— 非「仅最新周期文件名」 |
| 条目增补 | 动态卡片续写 · 同 Markdown · `<!-- topmind:append -->` |
| AI 在动态 | 标题栏 💡 + 有条目时画布顶 strip（空则隐藏）→ `openSuggestSurface` → **SuggestPopover** 确认面（无第二套列表；不埋 AI 聊天轨） |
| 整理按钮 | reconcile 任务 + `runActivityOps`（suggest + memory_organize + topic_classify） |
| memory | **profile + periodic only**（confirm） |
| topic | **内容大类 `create_topic`**（confirm · 不进 `memory/topics`） |
| 写闸 | 全部 apply 经 writeback / applySuggestion + high-impact gate |

下文 §2 缺口表为 **合闸前分析快照**；处置列已由 Wave S\* 关闭的项以 §8 进度表为准。

## 0.1 一句话结论（分析时）

**不必推倒重来；沿「动态主路径」做体验与范围语义硬合闸。**  
Reset A–D 保持；废弃与流模型打架的实践；不发明第二真源。

---

## 1. Ideal usage model（用户镜头 · 理想使用态）

### 1.1 日常节奏（主习惯）

用户打开 topmind，**默认就在「动态」**——像打开个人 Twitter / 个人时间线，而不是打开文件夹管理器或聊天机器人。

```text
打开 → 看见最近动态 feed
  → 随时「记下」一条（最低摩擦）
  → 有时回到某条旧记录上「增补/评论」几句（延续，不是新开平行叙事）
  → 系统根据「近期活动」准备整理建议（待办 / 记忆 / 笔记 / 主题）
  → 用户在 feed 附近一眼看见建议，点头确认 → 沉淀到待办 / 我的情况 / 专题 / 写出来
  → 文件永远是真源；随时可在 Finder / Obsidian 打开同一工作区
```

### 1.2 用户心智闭环（唯一认知环）

```text
记 → 动态 feed → 在动态上增补 → AI 建议/整理（在动态语境里显眼）→ 确认沉淀
  → 专题 / 记忆 / 待办 / 写出来（二级深工，不抢主路径）
```

对应 ≤5 用户概念（**不新增**）：

| 用户说 | 在本模型中的体感 |
|--------|------------------|
| **记一下** | 完整捕获（链接/附件/不确定落点）— 入口在顶栏，不重复堆在动态上 |
| **动态** | **主视图**：持续更新 + 浏览已发内容 + 对旧条增补 |
| **专题** | 从动态中「长出来」的长期夹；由建议或用户主动打开，不默认强迫建夹 |
| **我的情况** | 稳定的「关于我」；由动态/整理建议提升，不要求用户先学 memory 层 |
| **写出来** | 成品出口；来自动态深工或专题，不是默认落点 |

### 1.3 「评论式增补」是什么、不是什么

**是：**

- 用户对**已经记录过的一条内容**追加后续（进度、更正、相关链接、一句感想）  
- 时间线上**仍能读到完整脉络**：原内容 + 后续增补  
- 该动作使 **原条目（及其关联知识）重新进入最新整理范围**——不仅处理 delta 本身  

**不是：**

- 公开社交网络（关注、算法时间线、公开回复）  
- 强制引入第二套「评论表 / thread 数据库」作为真源  
- 放弃周期本 Markdown 文件真源  

### 1.4 AI 的职责边界（理想）

| AI 做什么 | AI 不做什么 |
|-----------|-------------|
| 从**活动窗口**提取待办、记忆候选、主题建议、笔记归位 | 静默改 locked / 未经确认的高影响批写 |
| 在动态语境中**显眼且可忽略**地展示建议 | 逼用户先学会打开 AI 轨才能完成「整理」心智 |
| 对「旧文被增补」整包再理解（原文 + 增补） | 只扫最新周期文件名，无视用户刚改过的旧专题笔记 |
| 维护查看形式（摘要、分组、健康提示） | 把 Desktop 会话态写成内容真源 |

### 1.5 整理范围（理想语义 · Activity Window）

整理与建议的输入集 =：

```text
activity_window =
    时间带内的动态条目
  ∪ 时间带内 mtime/内容变更的笔记与专题文件
  ∪ 对旧条目的增补所锚定的「关联原文 / 原文所在文件」
  ∪ 用户显式钉住的范围（可选）
```

**关键规则**：用户评论/增补一条很久以前的笔记时，**整段关联知识进入最新整理窗口**，而不是只把评论句丢给模型。

### 1.6 成功体感（验收语言，非像素）

用户应能不经培训地感到：

1. 「我主要就是在刷/写动态」  
2. 「补一句就像回自己」  
3. 「AI 会看着我最近动过的东西，问我要不要整理」  
4. 「我点头之后，待办/记忆/专题才变」  
5. 「文件还在磁盘上，结构一眼能懂」  

---

## 2. Gap map（**历史快照 · 2026-08-03 合闸前**）

> ⚠️ **非现行产品真理**。合闸前对照表；处置结果以 **§0 现行产品真理** 与 **§8 实施进度** 为准。  
> 下列「disabled / 只取最新一个 / 无增补」等措辞描述的是 **分析当日代码**，不是今日仓库。

每条标注当时 **keep / harden / redesign / deprecate**。

### 2.1 总表（合闸前）

| 域 | 当时现状 | 相对理想 | 当时处置 → **合闸后** |
|----|----------|----------|----------------------|
| 产品北极星 A–D | Reset 已锁 | 对齐 | **keep** → 仍 keep |
| 默认主表面 = 动态 | selection=stream | 对齐 | **keep** → 仍 keep |
| 动态主画布 | 周期 chip · 记下 · 头栏整理 | 部分对齐 | harden/redesign → **Done**（增补+安静 chip） |
| 条目交互 | 仅打开整文件；无增补 UI | 偏离 | redesign → **Done** `appendStreamEntry` |
| 周期本数据模型 | weekly packing | 正确 | **keep** |
| 整理本周 | reconcile + 开 AI 轨 | 可用 | harden → **Done** + `runActivityOps` |
| 建议生成范围 | 当时最新周期中心 | 非 activity window | redesign → **Done** `activity-window` |
| 待办 AI | depth 偏窄 | 近周 | harden → **Done** 接活动窗口 |
| 记忆/专题 AI ops | 当时 disabled placeholder | 缺口 | redesign → **Done**（profile+periodic / 内容大类） |
| AI 建议放置 | 仅 AI 轨 | 张力 | redesign → **Done** quiet chip + ActionBar |
| 三套「待办」概念 | 易混 | 认知 | harden 文案 → 持续 |
| Writeback / Kernel | 写闸 Done | 对齐 | **keep** |
| Skills organize | 偏周复盘 | 语言 | harden → **Done** 活动窗口叙事 |
| UTR | adapter | 对齐 | **keep** |
| Clip / Ingest | 完整 | 对齐 | **keep** |
| embedding / Ask | Non-goal | deferred | **keep as deferred** |

### 2.2–2.4 分面与废弃清单（合闸前摘要）

合闸前主要缺口（均已在 Wave S\* 关闭，详见 §8）：

- 条目无增补 UI → **Done**  
- 建议仅 AI 轨 / 最新周期中心 → **Done** 活动窗口 + quiet chip  
- `memory_organize` / `topic_classify` disabled → **Done**（profile+periodic / 内容大类）  
- Skills 周复盘唯一叙事 → **Done** 活动窗口语言  

**Deprecate / do-not-carry（仍有效 · 勿回潮）**：

| # | 不携带 | 状态 |
|---|--------|------|
| D1 | 「整理范围 = 仅最新周期文件名」当产品真理 | **已废弃**；活动窗口为真理 |
| D2 | 「整理 = 必须先开满 AI 轨」为唯一反馈 | **已缓解**；quiet chip + ops 合入 |
| D3 | 三套系统都叫「待办」 | **持续 harden** 文案 |
| D4 | disabled 占位对外暗示已有能力 | **已关闭**（ops 已启用） |
| D5 | 评论平行 DB | **仍禁止** |
| D6 | 复活 Home / 第六概念 | **仍禁止** |
| D7 | 主写绕 UTR / 第二写闸 | **仍禁止** |
| D8 | 社交算法 feed | **仍 Non-goal** |

Reset A/B/C/D 对齐立场不变（强化动态流 · 写闸 · 建议确认）。Q2 张力已按 **A** 落地：feed 顶安静摘要 + ActionBar 确认面。

---

## 3. Overall optimization scheme（分波 · **已实施** · 下文为原计划）

> 原分析写「不实施」；**Wave S\* 已合闸**。本节保留作波次设计记录；执行结果见 §8。

### 3.1 总原则

1. **进化，不是第二产品**：在 Reset 之上做 Wave S*（Stream-coherence），不重开 A–D。  
2. **一个认知环**：记 → feed → 增补 → 建议 → 确认 → 沉淀。  
3. **范围先于模型炫技**：先做 activity window，再谈 embedding/Ask。  
4. **真源仍是 Markdown 文件**；体验层可以像 Twitter，存储层不要像 Twitter。  
5. **AI 显眼但不吵**：默认可瞥见、可忽略、确认后才写。  
6. **果断删**：占位能力、错误用户词、强迫开面板的唯一路径。

### 3.2 目标架构（体验叠在现 Kernel 上）

```text
┌─────────────────────────────────────────────────────────────┐
│ Experience                                                   │
│  Stream feed（主）· 条目增补 · 语境建议 chip · 深工编辑器     │
│  Skills 口语 · Clip · 连接器（外围）                         │
└────────────────────────────┬────────────────────────────────┘
                             │ 统一：activity_window + write + confirm
┌────────────────────────────▼────────────────────────────────┐
│ Kernel（保持唯一领域逻辑）                                    │
│  + activity-window resolver（新）                             │
│  + stream entry append 约定（轻）                             │
│  suggest · todo · ai-ops · memory · lifecycle · writeback     │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│ Workspace 三平面（不变）                                      │
│  内容 {NN-}/ · memory/ · topmind.yaml + .topmind/            │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 分波方案

#### Wave S0 — 决策与诚实（文档 / 产品语言 · 0.5–1 周量级）

| 产出 | 说明 |
|------|------|
| 锁本方案与 Reset 关系 | 本文进 `docs/`；Reset 分数卡增加「Stream-coherence 目标」行，**不**改 A–D |
| 用户词表 | 「个人清单」vs「建议」vs「后台整理」；禁止 UI 三处都叫「待办」 |
| 占位 ops 政策 | memory/topic：排期实现 **或** 从用户可见面消失（D4） |
| 开放问题拍板 | §5 Q1–Q4 用户决策后才开 S2 数据约定 |

**首波外**：embedding、移动端、多工作区、社交化。

#### Wave S1 — Activity Window（Kernel 范围语义 · 核心）

| 产出 | 验收意向 |
|------|----------|
| `resolveActivityWindow({ workspaceRoot, since, limit })` | 返回：近期周期片段 + mtime 变更 md + 显式锚点文件 |
| suggest / todo / 未来 memory_organize **共用**该窗口 | 禁止各引擎私自 `findLatestPeriodNote` 分叉 |
| 「增补锚定」：若窗口含 reply/append 元数据，**拉入 parent 原文** | 单测：改旧专题一节 → 该文件出现在 window |
| Skills organize / Desktop「整理」文案 | 「整理近期动态与改动」可与「整理本周」并存，默认语义升级 |
| UTR 薄命令（可选） | `workspace.activity-window` 只读 |

**故意首波不做**：向量检索、全库 Ask、跨设备同步。

#### Wave S2 — 动态上的增补（条目续写体验）

| 产出 | 验收意向 |
|------|----------|
| 条目级「增补」入口（Stream 卡上） | 不强制进整文件编辑器即可追加 |
| 落盘约定（待 Q1） | 人读 Markdown；Desktop/Skills/UTR 同契约 |
| 增补成功 → 触发 window 失效 / 建议轻刷新 | 不静默 apply |
| 深链仍可 `focusHeading` 打开整文件 | 富编辑保留 |

**数据取向推荐（待用户确认 Q1）**：

- **推荐默认**：周期本 / 笔记内 **子块续写**（blockquote 或 `### 续 · 时间`），frontmatter 或 HTML comment 可选 `reply_to` 锚点；**不**新建 comments 集合。  
- 专题旧文：在**原文文件尾部**或指定 heading 下追加，并写 `updated_at`；activity window 靠 mtime + 锚点收录全文。

#### Wave S3 — 动态语境中的 AI 可见性

| 产出 | 验收意向 |
|------|----------|
| Stream 头或 feed 顶：**单一**安静状态条（有 N 条建议 / 整理完成） | 不复制 ActionBar 全列表到主画布 |
| 一键「查看并确认」→ 统一确认面（现 ActionBar / 审阅抽屉） | 确认伦理不变 |
| 条目旁可选：轻量「与本条相关的建议」chip（仅当有关联） | 默认可关；遵守安静 chrome |
| 整理按钮默认**不**抢走焦点开满 AI 轨 | 可设置；高影响仍可自动展开确认 |

若用户在 Q2 选择「主画布完整建议列表」→ 必须同步修订 `topmind-desktop/DESIGN.md` 安静 chrome 条款，避免双真源设计。

#### Wave S4 — 沉淀闭环（todo / memory / topic 一体）

| 产出 | 验收意向 |
|------|----------|
| `todo_maintain` 接 activity window | 旧文增补可抽出待办 |
| 最小 `memory_organize`（confirm） | 从窗口提 profile/topic 记忆候选 → 建议条 apply |
| 最小 `topic_classify`（confirm） | 窗口内容 → 建议归入/新建专题（不自动建夹洪水） |
| 笔记建议到相关主题 | 建议卡带 target path；确认后 writeback |
| Skills 与 Desktop 同一 ops 语言 | pack 文案同步 |

**失败则执行 D4**：删除 disabled 占位，文档写 Non-goal，避免假能力。

#### Wave S5 — 跨表面一致与卫生

| 产出 | 说明 |
|------|------|
| Skills / UTR / Desktop 活动窗口与增补契约一致 | 无第三套业务 |
| Clip/connector 写入进入 window 索引 | |
| 文档与死代码 | 清「仅最新周期」旧叙述；dead-code 护栏可增 pattern |
| 质量门 | 现有 `desktop:quality` + 窗口/增补单测 |

### 3.4 波次依赖

```text
S0（决策/语言） 
  → S1（activity window · Kernel）
      → S2（条目增补）∩ S3（动态 AI 可见性）  // 可部分并行，但 Q1/Q2 先决
          → S4（memory/topic 闭环）
              → S5（跨表面卫生）
```

### 3.5 首波（S0+S1）明确不做

- embedding / 语义索引 / 全库 Ask  
- 移动端 · 多工作区 · 云权威同步  
- 社交化 feed  
- 替换 Skills+Desktop+UTR 为单一运行时  
- 强制 UTR 日常路径  
- 像素级重做 Brand Horizon  
- 废弃周期本 packing（**keep**）

### 3.6 成功度量（方案级 · 非本 goal 实施）

| 信号 | 理想方向 |
|------|----------|
| 用户完成「记 + 补 + 确认一条建议」的步数 | 下降，且不必先理解 AI 轨 |
| 对旧文件编辑后，下一次整理是否包含该文件 | 是 |
| 用户是否仍说「有三个待办」 | 否（词表收敛） |
| 写闸/备份/确认伦理回归 | 零例外新路径 |

---

## 4. Cross-surface consistency rules（跨表面一致性）

### 4.1 一条产品语言

| 规则 | Skills | Desktop | UTR | 插件/Clip |
|------|--------|---------|-----|-----------|
| ≤5 用户概念 | 口语映射到五概念 | 主 chrome 只露五概念 | 不暴露 engine 名作 UI | 落点用五概念白话 |
| 文件真源 | Host 写 Markdown | WorkspaceService→Kernel | adapter→Kernel | 最终进工作区文件 |
| 耐久写 | write 伦理 + 可选 UTR | **必须** writeback | **必须** writeback | commit 经路由+写闸 |
| 建议→确认→写 | 对话建议不落盘直至用户要 | ActionBar / 统一确认面 | confirm 模式 | 不静默改 locked |
| 活动窗口 | organize/memory 技能读同一语义 | 整理/AI ops 同一 resolver | 只读 tool 暴露 | 写入后进入窗口 |
| 动态主路径 | 「记/整理」指向 stream 周期与窗口 | 默认 stream 视图 | capture 默认 period | 默认进动态/inbox 策略不变 |
| AI 在动态可见 | 技能描述写「在动态语境整理」 | S3 轻提示 + 统一确认 | 不规定 GUI | — |
| 不教内部词 | 无 protection 说教 | 设置白话 | CLI 可技术、MCP 描述克制 | — |

### 4.2 禁止的平行物

1. **平行 truth store**（会话 JSON、第二套建议 DB、评论云表当权威）  
2. **平行 write permission**（Desktop `writeback.mjs` 仅 helper，已是锁）  
3. **平行「最新周期」私函数**（S1 后 suggest/todo/ai-ops 必须共用 window）  
4. **平行用户概念**（「动态墙」「时间线 2」「Inbox 2」）  
5. **主画布与 AI 轨两套互不相同的建议数据源**

### 4.3 AI 能力放置矩阵（目标）

| 能力 | 动态主视图 | AI 轨 | 其他 |
|------|------------|-------|------|
| 记下 / 增补 | **主** | — | 顶栏完整捕获 |
| AI 润色输入 | composer 旁 | — | — |
| 个人待办清单 | 入口 chip | — | 标题栏 TodoPopover |
| 工作区建议 / 待确认写 | **轻状态 + 入口（S3）** | **完整列表与审阅（主确认面）** | — |
| 整理触发 | 头栏主按钮 | 可手动 | ⌘K |
| 后台 reconcile 进度 | 安静角标可选 | TaskDock | — |
| 深聊 / 工具调用 | — | **主** | — |
| 行内改写 | — | — | 编辑器选区 |

### 4.4 扩展性规则

- 新 AI 能力 → **先** `ai-operation-engine.registerOperationType`，再挂 UI；禁止各 Surface 私写 LLM 业务。  
- 新捕获源 → ingest 路由 + writeback；结果进 activity window。  
- 新插件 → 不占默认主 chrome；不新增第六概念。

---

## 5. Open design questions（**已拍板** · 见 §8）

用户确认：**Q1–Q5 均取推荐 A**（Q4 修正：topic→内容大类，非 memory/topics）。

| 题 | 决策（锁定） |
|----|----------------|
| **Q1** 增补形态 | **A** 同 Markdown 续写 + 锚点（无平行库） |
| **Q2** AI 显眼度 | **A** feed 顶安静摘要 + ActionBar 确认面 |
| **Q3** 整理文案 | **A** 保留「整理本周」，底层 activity window |
| **Q4** memory/topic ops | **A 修正** memory=profile+periodic；topic=内容大类 |
| **Q5** 跨周期 feed | **A** 单周期 + chip（Q5-B 聚合为后续可选） |

未决仅剩未来可选项：Q5-B 跨周期聚合 feed、UTR 只读 activity-window 命令（均为 Non-goal 本阶段）。

---

## 6. 实施状态（**已合闸** · 非「仅分析」）

Wave S\* **已实施并合入产品路径**（非本文件「只交付分析」的旧表述）。订单与结果：

1. ~~用户拍板 Q1–Q4~~ → **Done**（§8）  
2. ~~S0 文档与词表~~ → **Done**  
3. ~~S1 activity window + 单测~~ → **Done** `lib/activity-window.mjs`  
4. ~~S2/S3 体验~~ → **Done** 增补 + quiet chip  
5. ~~S4 沉淀 ops~~ → **Done** memory_organize / topic_classify  
6. S5 跨表面 → **Partial**（Skills/文档已对齐；UTR 薄命令可选后续）  

质量：`npm run root:test` · Desktop organize 结构测试 · i18n · dead-code 护栏。

---

## 7. 附录：代码证据摘要表（**现行 · Shipped**）

| 主题 | 路径 | 要点（今日） |
|------|------|----------------|
| 默认动态 | `topmind-desktop/src/stores/view-store.ts` | `selection: { kind: "stream" }` |
| home→stream | `topmind-desktop/src/types.ts` `normalizeSelection` | legacy home 软迁移 |
| 活动窗口 | `lib/activity-window.mjs` | `resolveActivityWindow` · `appendToStreamEntry` · parent 锚定 |
| 动态主视图 | `.../views/StreamDetailView.tsx` | composer · **按条软拆 feed** · **条目增补** · **MD 卡片预览**（`stream-md-preview` · 任务/列表/续）· organize · AI todos（建议入口在画布顶 strip） |
| Stream MD 预览 | `topmind-desktop/src/lib/stream-md-preview.ts` | 复用 `markdownToHtmlFragment`（任务列表/h4 增补/链接安全）；卡片 `v4-stream-md` |
| Feed 稳定 | `stream-feed-stability.ts` + StreamDetailView | soft body 等值跳过；expand remap；AI 条带 min-height；ActionStore soft loading |
| 个人清单入口 | Stream 页头 `personal-todos` | TodoPopover；≠ ActionBar 建议 |
| topic 落点闸 | `lib/workspace-model.mjs` `sanitizeTopicPlacement` | 单段大类 · 拒 reserved plane（memory/.topmind）· 不进 `memory/topics` |
| 整理编排 | `topmind-desktop/src/lib/organize-week.ts` | reconcile + **`runActivityOps`**（memory/topic 合入 ActionBar） |
| 建议合入 | `topmind-desktop/src/stores/action-store.ts` | `mergeSuggestions` · `opSuggestionCache` · apply `create_topic` |
| 建议范围 | `lib/suggest-engine.mjs` | **activity window** corpus（非仅最新文件名） |
| 待办范围 | `lib/todo-engine.mjs` | `findRecentPeriodNotes` → 活动窗口 + 相关材料 |
| AI ops | `lib/ai-operation-engine.mjs` | todo + **memory_organize** + **topic_classify 均启用** |
| create_topic apply | `lib/suggest-engine.mjs` | 内容大类下 `topic.md`；不进 `memory/topics` |
| 建议 UI | TitleBar 💡 + `SuggestEntryStrip`（count>0）+ `SuggestPopover` | 全局入口；软刷新会话缓存防闪烁；确认面独立浮层 |
| 写闸 | `lib/writeback-engine.mjs` | 唯一写闸 + high-impact gate |
| Skills 整理 | `skills/topmind-organize` · `topmind-memory` | 活动窗口；memory=profile+periodic；专题=大类 |
| 周期 packing | `lib/stream-period.mjs` | weekly 默认 · append body |
| 决策锁 | `docs/ARCHITECTURE-RESET.md` | A/B/C/D · Wave S\* Done 行 |
| 边界 | `PRODUCT-BOUNDARIES.md` | 三体 · 写闸 · ≤5 · 活动窗口 |

---

## 8. 决策锁定（2026-08-03 · 用户确认）

| 题 | 决策 | 备注 |
|----|------|------|
| Q1 增补形态 | **A** 同 Markdown 续写 + 可选锚点 | 无平行评论库 |
| Q2 AI 显眼度 | **A** feed 顶安静摘要 + 统一确认面 | 不复制整条 ActionBar |
| Q3 整理文案 | **A** 保留「整理本周」，底层 activity window | |
| Q4 memory/topic ops | **A 修正** | **memory** = 主 profile + 周期 periodic；**topic 归内容大类/专题**，不进 `memory/topics` 当默认沉淀 |
| Q5 跨周期 feed | **A** 单周期浏览器 + chip | |

实施波次：S0 本文锁 → S1 activity-window → S2 条目增补 → S3 安静摘要 → S4 ops → S5 跨表面。

### 实施进度（2026-08-03）

| 波次 | 状态 | 证据 |
|------|------|------|
| S0 决策锁 | **Done** | 本节 + topic≠memory |
| S1 activity-window | **Done** | `lib/activity-window.mjs`；suggest/todo 共用 |
| S2 条目增补 | **Done** | `appendToStreamEntry` + Desktop `appendStreamEntry` + Stream 卡片 UI |
| S3 安静摘要 | **Done** | 标题栏 💡 + strip（count>0）→ `openSuggestSurface` → **`SuggestPopover`** |
| S4 memory/topic ops | **Done** | `memory_organize`（profile+periodic）· `topic_classify`（内容大类 `create_topic`） |
| S5 跨表面 | **Partial** | Skills organize 文案已更新；UTR 薄命令可后续加 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-03 | 首版：理想态 · 缺口图 · 分波方案 · 一致性规则 · 开放问题 · 废弃清单 |
| 2026-08-03 | 用户确认 Q1–Q5 推荐项；topic≠memory（大类专题 vs profile+periodic） |
| 2026-08-03 | Wave S\* 合闸：§0/§6/§7 改为 Shipped 真理；§2–§3 标历史快照；docs/README 索引对齐 |
| 2026-08-03 | Stream 完善：MD 卡片预览 · sanitize reserved plane · topic 大类过滤 · ActionBar 建议词 · 文档诚实 |
