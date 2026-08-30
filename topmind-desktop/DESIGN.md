# topmind Desktop — UI/UX 设计规范

> **理念**：精准、安静、对象优先、**长时阅读友好**、可审查、**可扩展的富工作台**。  
> **产品北极星**：最低摩擦个人动态流；导航与概念**清晰简单**；AI **内生副驾**（建议默认 · 确认执行）。  
> **美学**：**Design System 3.0 — ZCode Neutral（中性石墨 × Sky 强调）** — 纯中性灰阶（零色偏，对齐 ZCode 桌面端）+ 单一 sky 主色 + **黑白单色实心主 CTA**（Linear 密度 × Craft 阅读 × 文件对象感）。3.0 取代 2.1 微暖中性：中性更纯净、圆角更利落、主按钮单色化。  
> **栈**：Tailwind 4 · shadcn 风格 · Radix · Lucide · Design Tokens。  
> **品牌色**：sky 轴 `#075985` deep → `#0ea5e9` mid + capture teal `#2fa89a`（teal 仅限捕获动作）；强调交互色 = sky `#0284c7`（dark `#38bdf8`）；实心主 CTA = 单色 ink（light 近黑 / dark 近白）。  
> **实施锁**：[`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md) · 产品原则：[`../DESIGN.md`](../DESIGN.md)

个人工作台 UI：**状态可感知** · **正文区优先** · **低视觉负担** · **智能可中断** · **扩展不抢主路径**。

> **真源**：本文件是 Desktop UI/UX 唯一规范；`tokens.css` 是色/型/密数值真源。根 `DESIGN.md` 不复制像素线框。  
> 历史平行提案已删除；IA 目标以本节 §0.0 与根 DESIGN 为准。

## 0.0 信息架构目标（导航变薄 · 2026-07-25）

用户概念硬上限 ≤5：**记一下 · 动态 · 专题 · 我的情况 · 写出来**。

```text
标题栏主锚点：动态（默认） · 收件箱 · 写出来 · 搜索 · 记一下 · AI
侧栏默认：本周动态 / 周期本时间线
二级入口：专题树 · 我的情况（记忆浏览：列表/卡片，点开条目仍落文件） · 归档（⌘⇧A / 命令面板；不在 PrimaryNav）
高级（折叠或 ⌘K）：标签 · 看板 · Tools/UTR；可选插件/mini-app 在标题栏 **Apps 菜单**（2026-08-30）
```

### 0.0.1 捕获词汇与入口（强制 · 单一心智）

| 用户说法 | 系统动作 | **唯一**主入口 | 禁止 |
|----------|----------|----------------|------|
| **记一下** | 打开完整捕获（笔记 / 链接 / 附件） | 顶栏主 CTA（⌘N / 全局 ⌘⇧N） | 在动态页再堆一个同名主按钮 |
| **记下** | 把输入框追加到**当前周期本** | 动态主区输入框主按钮（⌘↵） | 把「记下」标成「记一下」 |
| **AI 润色** | 只改输入框通顺/格式 · **不落盘** | 输入框旁 AI 次级按钮 | 与「记一下」共用文案或图标语义 |
| **AI 待办** | 从动态提取/更新 `memory/todo.md` | 动态顶栏 / 侧栏 ✨ · 标题栏清单 | 与 ActionBar「建议」混称「待办」 |
| **AI 建议** | 工作区整理候选 · 确认后写入 | **标题栏灯泡** + 有条目时**状态栏计数 chip** → **`SuggestPopover` 确认面** | 嵌进 Stream 卡片；仅藏在 AI 聊天轨里才可操作；空态永久占位条 |
| **增补** | 对已有动态条目续写（评论感 · 同文件） | 动态卡片上的增补入口 + 续写徽章 | 平行评论 DB / 新真源 |

**动态页主路径**：输入 →（可选润色）→ **记下**（EN: Log it）；对旧条 **增补**；链接/文档走顶栏「记一下」（EN: Note it）。链接检测 CTA 亦用「记一下」而非「快速捕获」。页头 **AI 待办 · 整理 · 刷新**（**个人清单不在页头重复**——唯一入口是标题栏 ListTodo / ⌘⇧T；状态栏 Todo busy 可点开同一弹层）。  
**统一建议入口（全局）**：标题栏 💡（始终可点）+ 有 `items` 时**状态栏计数 chip**（**count=0 自动隐藏**）；点击 → `openSuggestSurface()` → **`SuggestPopover`**。画布顶 `SuggestEntryStrip` 已删除，不得再挂。  
**唯一确认面**：`SuggestPopover`（接受 / 忽略 / 待确认写入）· 与 AI 聊天轨解耦；AI 轨 `ActionBar` **仅专注模式**（状态栏可能被藏时的回退），不挂第二套完整列表。  
**会话稳定**：软刷新 / 15s 轮询不得因 kernel 空 regenerate 清空已展示建议（`sessionSuggestionCache` + `mergeSuggestRefreshItems`）；dismiss/apply 仍可移除。  
**卡片正文**：`stream-md-preview` 轻预览（剥 `<!-- topmind:append -->`；首行子弹/时间进芯片不进正文）；**Feed 稳定**：软 reload 不全页 loading。  
**信息流两种布局（`settings.ui.feedLayout` · 列表 / 卡片）**：开关在**信息流正文上方**（`data-feed-chrome`，与帖子同列），不在页头 AI 动作条。列表 = X 式单列紧凑帖（细线分隔）；卡片 = **同一套 chunks** 的单列等宽卡片——**不是** Pinterest/masonry 多列。记下输入框、列表、卡片共用 `--feed-column-max`（`.v4-feed-column`）。收件箱 / 类别 / 专题 / 写出来 共用同一开关。  
**分块诚实**：日/周期段若是 markdown **列表**（`-` / `*` / `1.`）仍按条目拆帖；**无列表标记的长散文换行**是一条帖（空行分段仍是段落 `<p>`，不是每行一个 `<li>`）；timed/list 条目后续段落留在同一帖。列表与卡片消费同一 parse，切换布局不重拆。  
**我的情况**：侧栏 Profile **与动态信息流上的「我的情况」** 打开记忆浏览（画像 / 周期反思 / 专题记忆 **分层芯片**）；点开条目仍落到真实相对路径；「在目录中显示」展开侧栏 `memory/`（不是第六用户概念）。**整理我的情况**走已有 `memory_organize` → `runActivityOps` → **SuggestPopover 确认面**；自动准备可生成建议，**从不静默写画像**。无平行记忆库。  
**个人清单**：TodoPopover · **≠** 建议。  
**建议沉淀**：confirm 后 profile/periodic / 内容大类专题。

#### 建议种类（Suggestion Kinds）

| kind | 说明 | 影响 | apply 行为 |
|------|------|------|-----------|
| `inbox_review` | 收件箱文件超过回顾天数 | high | 迁入 99-归档（新家，不是删除） |
| `inbox_organize` | **AI 分析收件箱 → 移入已有专题或新建专题** | medium | 先写目标再删源（与 Desktop moveToTopic 相同） |
| `stale_topic` | 专题长期未更新 | high | 归档整个专题目录 |
| `catch_all` | 兜底类文件过期 | high | 迁入 99-归档（新家） |
| `stream_digest` | 为周期本生成反思 | high | AI 生成真实反思写入 memory/periodic |
| `promote_memory` | 动态 → 我的情况 | high | 追加到契约画像文件（默认 memory/profile.md） |
| `ai_summary` | AI 活动窗口反思 | medium | AI 反思写入 memory/periodic |
| `create_topic` | AI 建议新建专题 | medium | 在内容大类下创建专题目录 + topic.md |
| `open_profile` | 完善「我的情况」 | low | 打开契约画像文件（默认 memory/profile.md） |

**inbox_organize 特殊行为**：
- AI 可用时：分析每个收件箱文件内容，建议移入已有专题或新建专题
- AI 不可用且收件箱 ≥3 条：提示配置 AI 后可自动整理
- 确认后：先 `executeWrite` 写入目标专题，再 unlink 源文件（源失败则保留）
- 导航：确认后跳转到目标专题中的文件（而非回到动态）

### 0.0.2 图标语义（强制）

| 图标 | 用途 | 禁止 |
|------|------|------|
| **Zap** | 「记一下」完整捕获 | 用于 AI 润色 / 待办 |
| **Sparkles** | AI 润色 · AI 待办 · 建议条 AI 动作 | 用于普通保存 |
| **Send** | 「记下」写入周期本 | 与 Zap 混用为捕获 |
| **ListTodo** | 标题栏个人待办清单 · 状态栏「AI 整理待办中」chip（可点开清单） | 与 ActionBar 建议混称；**禁止**用于后台 Task 面板 |
| **Loader2** | 后台任务 busy · AI 轨 TaskBadge · 通用 spinner | 与 ListTodo 混用表示个人清单 |
| **Wand2** | 整理本周 / 确定性 reconcile | 与 AI 润色混用 |

**捕获英文对译（强制）**：`记一下` = **Note it**（完整捕获）；`记下` = **Log it**（动态主区写入周期本）。禁止用 Save 冒充「记下」、用 Quick Capture 冒充「记一下」。

### 0.0.3 多路 AI 并发（强制 · 安静诚实）

| 路径 | 优先级 | 车道 | 用户提示 |
|------|--------|------|----------|
| **Agent 对话** `ai.invoke` | 用户主路径 | 独立（单 stream） | AI pill「工作中」；可取消 |
| **行内 / 润色** `ai.complete` | 用户短路径 | 独立 | 专用 chip；离开页确认 |
| **准备建议** | 后台 prep | **background lane**（串行） | 建议 chip · 可点开 SuggestPopover |
| **AI 整理待办** | 后台 prep | **background lane**（串行） | 待办 chip · 可点开清单；排队时文案「排队等待…」 |
| **引擎 Task** reconcile 等 | 后台 | TaskStore 队列 | Task chip → TaskPanel |

**规则**

1. **后台 prep 串行**（`ai-background-lane`）：suggest 与 todo maintain **不同时打 LLM**，防 token 踩踏与限流。  
2. **Agent 不进 lane**：对话与 prep 可并行；软刷新建议在 **streaming 时跳过 kernel AI**（`agent_busy`），用户强制刷新 💡 仍执行。  
3. **自动待办让路**：`autoMaintainTodos` 等待 agent 空闲 + suggest 非 loading（最多 ~45s）再跑。  
4. **StatusBar**：同路径不双标；**多路径**时 `multiActive` + tip「同时进行：对话 · 准备建议…」；pill 可显示 `AI ×N`。  
5. **禁止**静默改 locked / 未经确认的高影响批写（既有写闸）。

| 原则 | 落地 |
|------|------|
| **一条主路径** | 打开 = **动态**（`StreamDetailView` 周期本）+ 标题栏「记一下」；**建议**走全局入口（标题栏灯泡 / 状态栏计数），不在主画布堆仪表盘 |
| **富而不挤** | 编辑器深度、阅读 Aa、多标签、插件能力保留；不一次性摊开全部视图 |
| **建议条** | **`SuggestPopover`**（标题栏 💡 / 状态栏计数打开）= 唯一完整确认面；AI 轨 `ActionBar` 仅专注模式回退；状态栏 count=0 自动隐藏（≠ 个人清单） |
| **设置白话** | 「保存前问我」「自动准备 AI 建议」「自动 AI 整理待办（默认关）」「重要文件不让 AI 直接改」 |
| **扩展外围** | connector / 第三方插件不占默认主 chrome：入口统一在**标题栏 Apps 菜单**（`AppsMenu` launchpad · `lib/apps-menu`），侧栏只承载内容导航 |

**IA 已收敛（Wave F–M · S\*）**：默认 **动态** = `StreamDetailView`（按日分组 · 周期 chip · 条目增补）；Home 已删。侧栏主轨 = 动态安静列表 / 目录 / 时间；标签/看板在「更多」；**个人清单**在标题栏图标弹层（⌘⇧T · pin/unpin）。**建议**在标题栏 💡 + `SuggestPopover`（全局确认面 · 会话缓存防闪烁）；AI 面板 3 层：**对话**（消息 + Composer）· **建议入口**（轨内 compact ActionBar 跳转弹层）· **后台**（TaskBadge + TaskPanel）。写出来列表展示 `published_at`。行内 AI 可拖动。

### 待办清单（TodoPopover · 标题栏弹层 · pin/unpin）

**概念区分**（重要）：

| 系统 | 用途 | 存储 |
|------|------|------|
| **TodoStore / TodoPopover** | 用户个人任务跟踪（AI 从动态提取 + 手动增删改） | `memory/todo.md`（语义平面）|
| **ActionStore / SuggestPopover** | AI 建议 + confirm 挂起写入（工作区管理确认面） | 运行时态 |
| **TaskStore / TaskPanel** | 后台引擎任务（reconcile / ai_digest） | 运行时态 |

- **存储**：`memory/todo.md` — 简洁 Markdown 清单（`- [ ]` / `- [x]`）；经 writeback-engine 写入（唯一写闸）
- **AI 提取 / 维护**：点 ✨ → AI 分析**活动窗口 prompt corpus**（周期正文 ∪ 折叠 extras；截断时优先保留 extras；排除 `memory/` 尤其 `memory/todo.md`）→ 提取/勾完/改写 → 去重后经 writeback 写入；`processedHashes` 对 budgeted corpus；自动维护尊重 skip，手动 ✨ 在「已处理」后再点一次 progressive force 重扫
- **语义深度（2026-08-09）**：AI 提取不再基于关键字过滤（`extractKeySegments` 已废弃），改用 `smartBudgetCorpus`——保留 frontmatter/段落结构/首尾上下文。提示词注入用户画像（`memory/profile.md`）+ 近期周期反思，AI 能识别「真正需要行动」而非简单匹配「待办/任务」等关键字。活动窗口 21 天 / 30 文件 / 6 周期。语料预算：extract 16K / maintain 12K（与 suggest 16K 对齐）。
- **用户操作**：勾选完成 · 内联添加 · 双击编辑 · 悬停删除 · 清除已完成
- **视图**：标题栏图标弹层 `TodoPopover`（`⌘⇧T`）；未 pin 时为右侧浮层（点击外部 / **面板外**滚动 / Esc 关闭；**面板内列表滚动不关闭**——与 DropdownMenu 共用 `shouldCloseOnScroll`）；pin 后变为可拖动浮动面板（不阻塞编辑器交互）；进行中在上（按截止日期排序），已完成折叠；AI 来源项带 ✨ 标记
- **过长处理**：已完成项默认折叠；「清除已完成」一键清理；活跃项上限 50

### 可选记账（ledger mini-app · 非第六用户概念）

- **存储**：`{memory.dir}/ledgers/{id}.md` + `catalog.md` — 默认一本 **Personal / 自己**；用户再加账本和分类。经 writeback-engine 写入。
- **入口**（`settings.ledger.enabled`，默认开）：标题栏 Apps 菜单 · StatusBar chip · ⌘K「记账」。**不是** PrimaryNav。关掉插件后这些入口消失。
- **表面**：plugin-app overlay（看板 · 流水 · 分类 · 快捷记账）。「记一下」捕获表单 / 动态 composer 在检测到 记账/记一笔/花了/存入 时注入快捷记账，不另占主 chrome。
- **NL**：记账 / 记一笔 / 花了 / 存入；读：查看账单 / 账户余额。未点名账本落到默认个人本，不发明 ClassFund / Giggs / Mom。

## 0. 视觉与认知原则（Design System 3.0 · ZCode Neutral · 2026-08-30）

> **2026-08-07 全面优化**：标题栏品牌 chip 移除；chrome-y 38→36px、status-y 26→24px（更纤细）；border alpha 降低（0.065→0.055）；card shadow 增加微 hairline（更精致浮起感）；hover 用 surface-hover 半透明（更柔和）；nav-pill active 改用 accent-bg-faint + font-weight 500（更安静）；titlebar-btn 过渡 duration 140→100ms（更跟手）；active scale 0.985→0.992（更微妙）；chrome-sep 高度 14→13px（更纤细）；侧栏 ViewSwitcher 行去 border-b 改用留白；Landing 移除 workflow 教育 chips + 底部文案精简；状态栏移除路径常驻按钮（workspace switcher tooltip 已承担）。

| 原则 | 落地 |
|------|------|
| **品牌对齐** | 实心主 CTA = **单色 ink**（`.v4-titlebar-btn-primary` / `bg-primary`，light 近黑 · dark 近白）；focus / 链接 / 选中 / accent wash = **sky**；**记一下** capture = teal（`.v4-titlebar-btn-capture` · 全局唯一彩色实心捕获）；AI 按钮 = deep→mid→aqua 轴；**禁止** indigo/purple 渐变 |
| **安静 chrome** | 标题栏 / 状态栏 solid `app-chrome` + `border-subtle-dim`；侧栏与 AI 轨同色；**禁止**工作区主壳营销渐变；渐变仅 logo / boot 弱光晕 / Landing 品牌时刻；**标题栏扁平**（纯色 + 单 hairline，无渐变/高光叠层）；**品牌字标不进标题栏**（窗口/任务栏已标识，仅留 logo chip） |
| **Surface 阶梯** | light：`app-chrome`/`sidebar` `#f0f0f0` → `background` `#f7f7f7` → `surface` `#fdfdfd` → **`surface-elevated` `#ffffff`**（禁止同色塌陷；elevated 弹层必须叠 `--shadow-float` / hairline）；dark（ZCode 阶梯）：`sidebar` `#0e0e0e` → `chrome` `#161616` → `background` `#171717` → `surface` `#1d1d1d` → **`surface-elevated` `#262626`**。侧栏是**最深平面**（`.v4-sidebar-rail` 用 `--color-sidebar`）。Feed 卡用 **`--shadow-card`**（弱于 overlay） |
| **低视觉负担** | 选中/hover 用浅 brand wash（`accent-bg-subtle` / `surface-selected`）；每区一个实心 CTA；边框优先 `border-subtle-dim`（light `rgba(23,23,23,0.06)` · dark `rgba(255,255,255,0.06)`；`border-subtle` = fg @ 10%，ZCode 同源）；避免多重 box-shadow + 边框叠厚；**侧栏树隐藏 `.md` 后缀**（`stripMdExt`）；**PARA 编号弱化**（`renderCategoryLabel`：`00-` 用 `text-quaternary/70`）；**卡片优先 bg + shadow 而非 border**（`--shadow-card` token）；**今日卡片 accent ring**（`ring-1 ring-inset ring-accent-color/15`） |
| **弹层与对比度** | `.v4-overlay-sheet` / Dialog 用 `surface-elevated` + `border-subtle`；**浮动弹窗**（`TodoPopover` / `SuggestPopover` / `TaskPanel`）采用 **毛玻璃质感**（`backdrop-blur-[var(--blur-glass)] backdrop-saturate-150` + `bg-surface-elevated/90` + `border-border-subtle` + `shadow-[var(--shadow-elevated-hairline)]`）；**交互一致**：点击外部 + 外部滚动 + Esc 关闭（内部列表滚动不关）；文本对比度达 WCAG AA 4.5:1+ (dark Primary `#e5e5e5` · Secondary `#c9c9c9` · Tertiary `#a1a1a1` · Quaternary `#8c8c8c`) |
| **玻璃面边界** | 暗色 `.v4-menu-surface` 内置 glass+hairline（Dropdown/ContextMenu）；可选 `.v4-glass-panel` 工具类；主壳 / 侧栏 / 编辑画布保持 solid |
| **一条主路径** | 标题栏主叙事 **动态（默认）** · 收件箱 · 写出来 + **记一下**；搜索/AI 可达；深度动作放 ⌘K / 二级；右侧工具 **图标 XOR「更多」**（禁止同动作双入口） |
| **控件分层** | **一级**常显 · **二级**折叠 · **三级**「更多」/ Tooltip / `/slash`（见 §0.1） |
| **CTA 权重** | 每区域 **一个** `Button variant=default`（主操作）；取消/复制用 outline/secondary；关闭 X 用 ghost。**捕获**：标题栏 aqua「记一下」唯一 L1 实心；列表头/空态打开捕获用 **outline**「打开记一下」；动态页实心仅为「记下」（`composeSubmit`），composer 眉题禁止复用「记一下」 |
| **统一 chip 语言** | `.v4-chip` / `.v4-segmented` / `.v4-composer` / `CaptureModeBar` / FilterChip |
| **列表 / 下拉** | 门户 `DropdownMenu`/`MenuSelect` / ContextMenu 共用 `.v4-menu-surface`；**先 hidden 测量再显示**（无打开闪跳）；**滚动即关**；`z-menu(110)` > tooltip(100) |
| **空态** | `EmptyState`：图标芯片 + 一句原因 + **一个主 CTA**（侧栏 compact 同构）；时间线/标签空态须有下一步 |
| **侧栏树** | 图标 `tree-node-icons` · 右键 `tree-node-context-menu` · 展开/排序/筛选 + **手动刷新** `tree-toolbar`（`data-sidebar-refresh`，与排序折叠同组；非标题栏第二份）· 路径 `lib/tree-path`；**文件名隐藏 `.md` 后缀**（`stripMdExt`）；**PARA 编号弱化渲染**（`renderCategoryLabel`：`00-` 前缀用 `text-text-quaternary/70`）。**感知**：`lib/tree-listing-change` 区分 listing（inbox/add/unlink/ingest-done）与 topic 内 content-only；空 inbox 写入后重建并展开，不依赖重启 |
| **少硬分割线** | 编辑器常驻 ≤2 条 full-width 分割（工具栏 + 可选属性）；避免斑马纹；**Recent tab strip 无底边框**（`.v4-editor-recents` transparent + `shadow-divider-bottom`）；**标题栏 cluster 透明**（`.v4-titlebar-cluster` 无背景无 inset）；**命令触发器为搜索框式浅井**（`.v4-cmd-trigger`：muted well + inset shadow + kbd 右置，Linear 式焦点，非按钮排）；**侧栏头部一条带**（`data-sidebar-header`：ViewSwitcher 满宽 + 我的情况同行、无底边框用留白分隔；pins 行无边框） |
| **长时阅读** | UI ≥12px；正文默认 16px / 1.7；列宽 `--content-max-width-prose`；专注模式 ⌘⌥F；边框 alpha 足以勾勒结构、避免糊成一片 |
| **动效克制** | `duration-fast` 140ms · `duration-enter` 160ms；列表 stagger ≤8；`prefers-reduced-motion` 全关 |
| **性能** | `content-visibility` 列表、panel `contain`、AI 面板 lazy、流式滚动尊重用户上滑 |
| **响应式 chrome** | 操作按钮按宽度 **铺开 ↔ ⋯ 溢出**（`ChromeOverflowActions`）；TitleBar 右轨 ResizeObserver 互斥；主锚文案按窗口宽度（≥960）显示，窄屏 **tooltip + aria-label 必在**；编辑器右侧发布/AI/专注同轨溢出；禁止同动作双入口 |
| **StatusBar 可交互** | **健康即沉默**：工作区正常仅一颗绿点（详情在 tooltip），异常才出文字；路径（xl 安静按钮）/ **AI 就绪 pill（唯一主控件）**：离线->设置 · 就绪->toggle AI 面板；流式时 pill 显示会话态；**命名 busy 单路径**（`deriveStatusBarBusy`：tasks > todo > suggest > **inline** 最多一颗命名 chip；todo/suggest/inline 独占时 AI pill 不显示「工作中」）；**进度动效**：每个 busy chip 附带 `v4-ai-progress-dot` 脉动指示器；tooltip 含预期时长。**中央位置 hint 仅 file 选择时显示**（点击 reveal）；其余 kind 由画布 PageHeader + PrimaryNav active 自明，不重复占位。**建议计数在状态栏**（count>0 时 `showSuggestCountChip`；生成中走 busy chip），与标题栏 💡 构成两处入口 |
| **TitleBar 右轨分层** | **L1** capture 实心 + AI 轨开关（`.v4-titlebar-btn-ai`）· **L2** 建议 💡 + 清单（`.v4-titlebar-tier-l2` 安静图标）· **L3** 搜索/设置 cluster / 窄屏 overflow；`data-chrome-tier`；**主题常驻为轮转式**（wide 单击循环 auto→浅色→深色，图标随当前主题；窄屏收进 ⋯ 菜单三选 `themeMenuSection`）；**badge 纪律：仅在需要行动时出现**——收件箱（分诊队列）+ 建议 💡 保留；写出来计数（库存非行动）与清单常驻数字点（恒非零）已移除 |
| **建议入口降噪** | 建议计数**恰好两处**：标题栏 💡 badge + **状态栏计数 chip**（count>0 才出现）；AI 轨 `ActionBar` **仅专注模式**（状态栏可能被藏时的回退）；画布顶 strip 已删。禁止 strip + 轨 chip + 状态栏 三处等权 |
| **编辑器默认 chrome** | 格式工具条 **默认展开**（`showFormat=true`，可收起）；常驻 ≤2 条 full-width 分割 |
| **Todo idle** | `TodoPopover` 维护按钮 idle = ghost Sparkles；**仅 maintaining 时** `.v4-ai-chip-gradient` |
| **Apps 菜单** | 标题栏 L3 `AppsMenu` launchpad（`data-titlebar-apps`）：列表行（accent 图标 chip + 名称 + 一句描述）+「管理应用…」；候选 = 已启用首方（settingsKey 连接器 · launchable mini-app · builtin 管道 ingest）+ 活跃外部插件；**打开菜单实时拉 settings + 订阅 `plugins:settings-changed`**（不依赖启动快照）；未配置连接器标「待配置」pill，点击直达 `topmind-<name>.settings` 设置页；打开方式由 `resolveLaunchableOpenTarget` 决定（connector hub 进画布，其余 `plugin-app` overlay）；菜单组件无写死插件 id（就绪判定集中在 `lib/apps-menu.pluginReadiness`） |
| **设置 / 弹层** | `SettingsDialog` 用 elevated ladder + quiet nav chrome（`.v4-settings-dialog` / `.v4-settings-nav`）；`SettingsSection` 用 `shadow-card` 卡片；Command/Search palette header 走 elevated 混色 |
| **连接器 Hub** | `ConnectorHubHeader` 与 `PageHeader` 同级标题（`text-xl font-semibold`）；actions 区禁止 solid「记一下」捕获（outline 打开捕获） |
| **FilterChip** | 高度 22px chip 语言（`data-filter-chip`）；禁止实心按钮高度 |
| **AI 建议生命周期** | `autoPrepare` 关：不调 kernel 生成，仍拉 pending writes。开：冷启动/软刷新走 `decideSuggestRefresh`（4s 软节流；force 清 session cache）。**活动指纹** 持久化在 `.topmind/suggest-fingerprints.json`（系统平面）——活动窗口未变则**跨进程跳过 AI 重跑**，避免每次启动 thrash。Session merge（`mergeSuggestRefreshItems`）防中途闪没。**个人清单** `memory/todo.md` ≠ 建议。确认后写入仍经 writeback。 |
| **动态密度** | 周期 chip ≤6、22px；日分组弱标签；卡内操作 hover 显；composer `shadow-card` 轻量（**无 label/hint meta 行**——placeholder 承担引导，计数在 PageHeader subtitle；卡片去 border 纯阴影）；主路径仍 写下→润色(ghost)→**记下**；**日分组卡无边框**（`bg-surface` + `shadow-[0_1px_3px_rgba(0,0,0,0.04)]`）；**今日 accent ring**（`ring-1 ring-inset ring-accent-color/15`）；**日 header 无 border-b**（`bg-surface-muted/25` 区分） |
| **侧栏 pin** | 本周周期 pin 可截断，**仅在 timeline/tags/kanban 视图渲染**（stream 视图由 StreamView 自带周期头承担；category 树内已有周期节点，树头不再放 pin——窄栏截断只剩噪声 2026-08-30）；**我的情况上移到 ViewSwitcher 行**（全局可达 · 图标化 + aria-label，不再单列 pins 行）；ViewSwitcher 已有 icon-only / 更多 |

### 0.1 控件分层（强制）

| 层级 | 定义 | 编辑器 | AI 面板 | TitleBar |
|------|------|--------|---------|----------|
| **一级** | 打开即见、完成主任务 | 标题 · 编辑/预览 · 保存态 · 专注 | 会话 · 消息 · 输入 · 发送 | 主锚点 · **捕获** · **AI 开关** |
| **二级** | 点一次展开 | **格式工具（默认展开，可收起）** · **阅读 Aa** · 属性条 | 模型 · 技能 · 写回 | **建议 💡** · **清单** · 搜索 · 设置 |
| **三级** | 「更多」或 ⌘K | 发布 · 记忆 · 挂载 AI · 发 X · 文件信息 · 全部设置 | slash / 会话管理 | 主题 · 工作区切换 · 窄屏 overflow |

### 0.2 字号与可读性（强制）

| 角色 | Token | 尺寸 | 用途 |
|------|-------|------|------|
| kbd glyph / 极小徽章 | `text-5xs` / `text-4xs` | 10px / 11px | 快捷键单字符、绝对微缩标记 |
| 快捷键 Chip | `text-3xs` | **11.5px** | Kbd Badge、微缩行内状态指示 |
| 标注说明 / Badge | `text-2xs` | **12px** | 状态栏、路径、FilterChip、说明文字 |
| 表单 / 按钮 / 控件 | `text-xs` | **13px** | 控件标签、下拉选项、操作按钮 |
| UI 主文 / 树节点 | `text-sm` | **13px** | 侧边栏树节点、列表主行 |
| 标准正文 | `text-base` | **14px** | 卡片正文、单行输入框文字 |
| 小标头 | `text-md` | **14px** | 卡片次级小标头 |
| 卡片标题 | `text-lg` | **16px** | 区块标头、PageHeader 子标头 |
| 小节标题 | `text-xl` | **16px** | 区域小节标题 |
| 章节大标题 | `text-2xl` | **18px** | 模块章节标题 |
| 页面主标题 | `text-3xl` | **24px** | 页面 Head Title |
| 巨幕 Display | `text-4xl` | **28px** | 展台 Header 气场标题 |
| 正文 prose | settings.editor | **默认 16 / 1.7** | 编辑/预览共用（可调 12–24） |

**禁止**：新增 &lt;11.5px 的 UI 主文案；9px 路径/状态已淘汰。3.0 起字号对齐 ZCode 整数阶（13/14/16）。

### 0.2.1 编辑器阅读外观（编辑 + 预览共用）

| 项 | 字段 | 入口 |
|----|------|------|
| 字号 / 行距 / 字族 | `fontSize` · `lineHeight` · `fontFamily` | 工具栏 **Aa** · 设置 → 通用 → 编辑器 |
| 栏宽 | `contentWidth` = compact \| reading \| wide \| full | 同上 |
| 边距 | `pagePadding` = compact \| comfortable \| spacious | 同上 |
| 纸张色 | `paper` = default \| soft \| paper \| sepia | 仅画布，不改全局主题 |
| 行内 AI | `ai.complete` | 选区浮条 · 工具栏 ✨ / 右键（**无**空行常驻 chip） |

实现：`lib/editor-prefs.ts` · `EditorReadingMenu` · shell `data-content-width` / `data-page-padding` / `data-paper`。

### 0.3 专注模式

- 快捷键：**⌘⌥F**；Esc（无浮层时）退出  
- 隐藏：侧栏 · AI 轨 · 状态栏 · 文件标签条 · 属性条 · 文件信息 · 完整 TitleBar 导航  
- 保留：极简标题栏（「topmind · 专注」+ 退出按钮）+ 编辑器工具行（标题 / 模式 / 保存 / 专注）  
- 会话级状态，不写入 settings  

### 0.4 macOS Dock 图标

**根因（本机实测，非猜测）**：Messages / VS Code / Claude / Obsidian 的 `.icns` 都是  
**画布 1024、色板约 80.5%（inset ≈ 100px / 9.8%）、圆角约板边 25%、板外透明**。  
Electron `setIcon(PNG)` **不**套系统 squircle；满出血方图 → 硬直角；满画布圆角板（inset 0）→ **比同列大一圈**。

- `icon-mac.png` / `.icns` = **peer 几何预裁白圆角板 + 居中 mark**（`compose_mac_dock_master`）  
  - `CANVAS_INSET_RATIO = 100/1024` → plate 824（80.5%）  
  - `PLATE_RADIUS_RATIO ≈ 0.25`（相对 **板** 边长）  
  - mark 板内安全边约 10%  
- 生成脚本会校验 plate fill ∈ [78%, 84%] 且画布角/中边 α≈0  
- **iconset 10 档**；`app.dock.setIcon` **仅 PNG**（缩到 256），**禁止** `.icns`  
- 开发：`patch-electron-icon.mjs`；**完全退出再开**  
- 重生：`python3 scripts/generate-icons.py`  
- **不要**改回「满出血交给系统遮罩」或「满画布预裁」——对 Electron Dock 都不对

**体验原则**：

- 反馈即时（toast + `workspace:file-changed`）；高影响写回的 toast 带可操作的「撤销」按钮（`backupPath` 存在时展示，6 秒停留窗口内可一键恢复）
- 路径可见；编辑器「更多」收纳发布 / 记忆 / AI  
- 命令面板按选区排序技能；无障碍 listbox  
- 侧栏 ViewSwitcher；空状态永远有 CTA（含动态流「记一下」）  
- AI 离线可点进设置（RuntimeBadge · 状态栏 · composer）；Settings 分模块（环境 / 智能体 / 扩展 / 管理与更新）  
- 列表副文 / 设置描述 / 看板元数据 / 连接器 Hub 状态行 ≥ `text-3xs`（12px）；`text-5xs` 仅 kbd glyph  
- 连接器中心页标题用 `text-lg`（与 PageHeader 列表页一致）；Apps 菜单条目与 `v4-menu-item` 同密度（图标 chip + 名称 + 一句描述）  
- 共享 primitives：`plugins/connector-ui.tsx`（Hub header / status pill / toast banner）  
  - **Weread / X / Ingest hub 必须**使用 `ConnectorHubHeader`（+ StatusPill / ToastBanner 按需）  
  - `badTone="muted"`：可选能力关闭（如 X 不可发帖）用中性 pill，勿用 warning 恐吓  
- ingest：目标 FilterChip 语言；状态栏活动计数可点开队列  
- Settings 全面板（General / Workspace / AI / Skills / Tools / Plugins / Manage）主文案统一 ≥ `text-3xs`；左侧导航按 **环境 / 智能体 / 扩展 / 管理与更新** 分组 + **筛选搜索**  
- 拖拽浮层 / 看板 overlay：`bg-surface` + `shadow-float`  


## 1. 工作流

围绕 `PROJECT-MODEL.md` 的四步循环：

> **收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整**

- **收进来**: ⌘⇧N 全局捕获，⌘N 窗口内捕获；默认**本周动态**；不确定进收件箱
- **继续做**: Tiptap 深度编辑；动态主表面 / 最近专题
- **交付/沉淀**: 88-输出；建议确认后写入记忆（目标）
- **找回/调整**: 搜索 · 99-归档恢复 · 我的情况

## 2. 布局

### 三栏响应式 Shell

**产品目标 IA（唯一 present-tense 目标 · Reset B · §0.0）** — 新功能与改版只朝此收敛：

```
┌──────────────────────────────────────────────────────────────┐
│ 标题栏: [◀▶][☰] topmind·切换器 │ 动态·收件箱·写出来 │ ⌘K │ 记一下 · 搜 · AI │
├──────────┬───────────────────────────────────┬───────────────┤
│ 侧栏     │  主画布（默认本周动态 / 编辑器）     │  AI 副驾       │
│ 动态优先 │  ViewSlot                         │  对话（建议走全局弹层）│
├──────────┴───────────────────────────────────┴───────────────┤
│ 状态栏 · 引擎 · AI · 选区                                      │
└──────────────────────────────────────────────────────────────┘
```

- **标题栏**（`--density-chrome-y` 36px solid chrome — 2026-08-07: 38→36 纤细化） 
  - 左：导航控制 + 应用标识 + 工作区切换器  
  - 中：`PrimaryNav` — **动态（默认）** · **收件箱** · **写出来** · **搜索** + ⌘K  
  - 右：**记一下**（唯一主捕获）+ 建议 💡 · 清单 · 设置 · AI  
  - **禁止**再增加等权主锚点；「工作台」三元组不再是产品目标  
- **侧栏默认**：本周动态 / 周期本时间线；专题树 · 记忆 · 我的情况 · 归档为二级；标签/看板为高级（折叠或 ⌘K）；**可选插件 / mini-app 在标题栏 Apps 菜单**  
- **主画布默认**：`StreamDetailView` — 当前周期本条目卡片 + **内联记一下** + reconcile / 周期切换（**无**建议数角标、无旧仪表盘）；未知 selection kind → 同视图
- **AI 面板**：副驾；**对话区** + **compact ActionBar**（有建议时计数 → 打开 `SuggestPopover`）+ **Composer**  
- **建议确认面**：全局 **`SuggestPopover`**（标题栏 💡 / 状态栏计数 / openSuggestSurface）；不埋仅在 AI 聊天轨  
- **看板可写 / Inbox 批处理 / 知识加工 / tokens / 图标** 等能力保留（富工作台）  
- **快捷键**：⌘⇧S → 动态 · ⌘⇧T → 待办清单（TitleBar 弹层） · ⌘⇧I 收件箱 · ⌘⇧O 写出来 · ⌘⇧A 归档 · ⌘N 记一下  
- **记下 / 记一下**：Stream 内联「记下」（`ingest` stream）· 顶栏「记一下」完整捕获；条目 **增补**（`appendStreamEntry` · 同文件）  
- **整理**：`runOrganizeWeek` = reconcile + **`runActivityOps`**（suggest + memory/topic → `SuggestPopover` 确认；不静默高影响写）  
- **StreamDetailView**：宽轨周期本 — 内联 composer · **按日分组 + 按条软拆 + 日内 cohesion**（`stream-entry-present.ts`：moment 收集后续 append → 嵌套展示；命名 `##` 非日期段 → **文章卡** title+summary+跳转；短内容全展示 · 长内容才出现展开/折叠按钮 `streamEntryNeedsExpand`）· 真实 MD 预览（列表/任务/代码/续）· 头栏清单/AI 待办/整理 · 周期 chip · 条目增补（建议入口在标题栏 💡 + 状态栏计数，不嵌 Stream 列表）  

- **无当前周期文件时**：回退 `listStreamPeriods` 最新一本，避免空白主表面  

- **设置 ↔ 壳同步**：`settings.ui`（含 `aiPanelOpen` / 侧栏视图 / 宽度）经 `lib/ui-settings-sync` 即时写入 view-store；Shell 收到 `ui:settings-applied` 后 **跳过一轮** 布局防抖写盘，避免盖掉设置  
- **UI 默认**：无效 `sidebarView` normalize 为 **`stream`**（产品默认，非 category）

- **窗体 / 托盘 / Landing / 状态栏 / Overlay** 与实现一致；PrimaryNav = **动态 · 收件箱 · 写出来 · 搜索**

### 2.1 标题栏（目标）

**左侧**:
- 侧栏开关 · 前进/后退 · 应用标识 · 工作区切换器（⌘⇧W，portal 下拉）

**中间** — `PrimaryNav`（**目标**）:
- **动态**（默认，打开工作区落点）· **收件箱** · **写出来** · **搜索**（⌘P）
- 归档不在主锚（⌘⇧A / 侧栏 / 命令面板）
- `⌘K` 命令面板

**右侧**:
- **记一下**（⌘N / 全局 ⌘⇧N）— 唯一醒目捕获；默认本周动态  
- 建议 💡 · 清单（安静图标对）· 设置 · AI 面板  
- 主题不进标题栏（⌘, 设置 / 窄屏 ⋯）；badge 仅在需要行动时出现（收件箱 · 建议）

### 2.2 侧栏树

- **ViewSwitcher**：侧栏顶部 `.v4-segmented` + **滑动 thumb**（`.v4-segmented-thumb`）
  - **主轨（默认可见）**：**动态流** · **目录** · **时间**
  - **高级（「更多」折叠）**：**标签** · **看板**（不占默认主 chrome；IA thrift / Wave E）
  - **待办清单**：不占侧栏；TitleBar 图标弹层 `TodoPopover`（⌘⇧T · pin/unpin · 可拖动浮动面板）
  - 视图模式持久化到 `settings.ui.sidebarView`（Shell 防抖写入；旧 `localStorage` 键启动时清理）
  - 窄轨自动 icon-only；`prefers-reduced-motion` 时 thumb 无过渡
- **自动刷新**：侧栏订阅 `workspace:file-changed`。目录树用 `classifyTreeFileChange`：inbox / 输出 / 归档 / 类别根 / add·unlink / ingest 完成 = listing 重建（空 inbox 有文件则展开）；专题内部保存 = 定向刷新、不整树闪。Inbox 主列表静默重载（无全页空态闪）。手动刷新在树工具条（展开/折叠/排序旁），不是标题栏第二按钮。StreamView 450ms 防抖。
- **DataSource 区段**：每个注册的 DataSource 渲染为可折叠区段，带 Database 眉头图标 + 半粗体大写标签。
- **加载状态**：共享 save-dot 旋转动画；错误/空状态使用规范侧栏提示样式。
- **TreeView**：递归渲染，按深度缩进。首次渲染时自动展开 group/category 节点。
- **节点图标**（Lucide）：Inbox（00-收件箱 区段）、Layers（88-输出）、Archive（99-归档）、Brain（memory 记忆区段）、Folder/FolderOpen（类别/专题）、FileText（文件）。
- **行交互**：`rounded-md hover:bg-surface-muted`（空闲）、`bg-accent-bg-subtle text-accent-color`（活跃）。箭头随展开状态旋转。
- **拖放目标**：`.v4-drop-target` **idle 无描边/无底色**；仅 `.v4-drop-target-active`（isOver）显示 wash；DragOverlay elevated hairline。**冲突处理**：专题下同名 → 自动副本名。
- **右键菜单**：右键任意节点显示上下文操作（新建笔记/专题、重命名、删除、发布）。

### 2.3 编辑区

- **ViewSlot 解析**：`registry.resolveView(sel)` 返回第一个匹配槽位（order 最低）。
- **内置视图**：StreamDetailView（默认动态）、CategoryView、TopicOverviewView、FileEditorView、InboxView、OutputsView、ArchiveView。
- **连接器中心**：`Selection.kind=connector` + `id=weread|x` → 阅读/X 轻中心页（状态 · 同步 · 选书/预览 · 统计缓存）；侧栏仅一行摘要，设置只做凭据与偏好。
- **兜底**：无 ViewSlot 匹配时显示共享 EmptyState（下一步 CTA：**回到动态** / 记一下）。
- **动态主表面（Done）**：打开即 `StreamDetailView`（本周/当前周期本）。独立 HomeView 仪表盘已删除；「建议」在标题栏 💡 `SuggestPopover`（状态栏计数 chip 为次入口），主 CTA「记一下」在标题栏。
- **CategoryView**：类别头部 + 专题列表 + 散记列表，支持新建专题/笔记快捷操作。
- **TopicOverviewView**：专题头部 + 笔记列表（含修改时间/大小）。
- **文件标签条**（`EditorRecentBar`）：多 tab pin/close/中键关/拖拽重排/右键菜单；溢出时左右 **edge fade**；激活 tab 滚入视野；右键 **在右侧打开对照**（分屏）。  
- **编辑区对照分屏**（session-only）：`splitSecondaryPath` 在主 selection 旁开第二文件（可编辑）；拖拽中缝调比例；关闭/对调；关 tab 时自动清分屏。**不是**双 history / 双 selection 状态机。主槽与分屏次槽共用 `isMarkdownNotePath`：`.md` → `FileEditorView`，其它 → `FilePreviewView`（禁止第二套 `fileExt`）。  

- **FileEditorView**：Tiptap + ⌘S；chrome 拆 `file-editor-chrome`（SaveBadge）· `file-editor-format-bar`（模式/格式默认展开/更多）· **`EditorReadingMenu`（阅读 Aa）**。格式轨：粗体/斜体/下划线/删除线/代码/H1–H3/列表/引用/链接/日期时间；与选区 AI 浮条独立。发布与 AI 编辑在轨上（icon+tooltip）；**唯一 ⋯** 放文件信息 / 专题记忆 / 发 X / 打开 AI 面板 / 挂载（动作不在轨上再出现一次）。窄宽 `data-compact` 隐藏 `[data-compact-hidden]` 标签，不截半截字。**编辑**用 TipTap；**预览 / 只读**用 `getEditorHtml()` 快照到静态 HTML（`.v4-tiptap`），不是同一实例 `setEditable` 切换。路径切换经 `nextPreviewHtml(..., { pathChanged: true })` 重置，空笔记不保留上一篇 HTML。**同一阅读偏好**（`data-paper` / `data-content-width` / `data-page-padding` + `proseStyle` 字号/行高/字体）包住两边。Frontmatter 在属性条，不进正文。专注模式 ⌘⌥F；`readOnly` 归档只读。  
  - **行内 AI**（Notion 式 · `SelectionAiBar` + `ai.complete` / `ai.cancelComplete`）：  
    - **出现**：非空选区 → 浮条；工具栏 ✨ / 右键「AI 改写」→ 主动面板（**同一动作集**）；**无**空行常驻 chip  
    - **动作**：润色 / 简洁 / 扩写 / 列表 / **格式** / 纠错 / 总结 / 续写 / 自定义指令  
    - **整篇格式上下文**：选区改写时 `documentText` 带全文 Markdown；主进程 `buildInlineCompletePrompt` 注入「贴合全文结构/列表/标题」约束（禁止只按局部另起版式）  
    - **快捷格式条**：选区模式下浮条内置粗体/斜体/代码/H2/列表按钮（`setTextSelection` 后执行）；主工具栏 `EditorFormatBar` 仍可用、不被 AI 面板禁用  
    - **定位**：视口边缘安全（prefer above · 不够则 below · 水平 clamp）；滚动时 **更新坐标** 而非立刻消失  
    - **状态**：生成中 spinner + 文案 + **取消/Esc**（主进程 `AbortSignal` 真取消）；未配置 → 设置；错误可关  
    - **单飞**：同时仅一请求；`requestId` 关联取消；迟到结果忽略；**切换笔记**清空并 abort  
    - **离开守卫**：`useInlineAiStore` 跟踪 session（file/stream/any anchor）；导航前 `wouldAbandonInlineAi` 拦截 → `requestNavConfirm` 挂起 → `InlineAiLeaveHost` 弹 `ConfirmDialog`（**先确认再走，不走完再拦**）；确认后 `applySelectForced` / `applyHistoryForced` 强制跳转  
    - **StatusBar 联动**：inline session 注册后 StatusBar 显示命名 chip（`showInlineChip` · label 来自 session）；不与 streaming pill 双标  
    - **应用安全**：选区替换前比对「生成时原文」与当前文档；漂移则**阻止覆盖**并提示重选  
    - **预览**：替换/插入；选区 **Diff**（字号 ≥12）；预览区可纵向 resize  
    - **结果卫生**：主进程 `sanitizeInlineAiResult` + 渲染层二次剥离 — 去掉 `<think>`/`thinking` 围栏、元前缀/后缀；**应用进文档的只有正文结果**  
    - **快捷键**：**⌘↵ 接受** · **Esc 丢弃/取消**（按钮旁 `kbd` 明示）  
    - 关闭：× / Esc / 丢弃；只读笔记不可改写  
  - 切换路径 / 关窗前会 flush 脏缓冲；body 写入串行化，避免与 frontmatter 竞态。  
  - 外部/AI 写盘时：干净则自动重载，脏则 toast 冲突提示。  
  - 表格：StarterKit 基础 HTML 表（无完整 GFM 表格扩展）；复杂表用源码编辑。
- **FilePreviewView**（非 `.md`）：HTML 沙箱 iframe + 诚实截断；其它文本等宽；二进制不能预览 + 打开外部。路径切换立即清空正文并回到 HTML 预览档；窄宽 toolbar 与编辑器同 `data-compact` 纪律（动作 icon + tooltip，不堆长标签）。
- **InboxView/OutputsView/ArchiveView**：列表视图，使用共享 `FileRow` 组件。

### 0.2.2 行内 AI · 对抗性场景（验收）

| 场景 | 期望 |
|------|------|
| 未配置密钥 | 动作禁用或点按引导设置；不静默失败 |
| 生成中点取消 / Esc | 主进程 abort；UI 回 idle；迟到成功不写预览 |
| 生成中切换笔记 | 面板关闭；旧请求 abort；不写到新笔记 |
| 生成中用户改了选区原文 | 点「替换」时检测漂移 → 报错，不覆盖 |
| 并行连点多个动作 | 仅首请求生效（single-flight） |
| 工具栏 ✨ vs 选区浮条 | 动作一致；全文/续写在 pinned 菜单可用 |
| 右键菜单 | 测尺寸后显示，不闪跳；**面板外**滚动关闭（内滚保持） |
| 模型返回 `<think>` / 思考围栏 /「以下是结果」 | 预览与替换内容均为清洗后正文；不把思考写入笔记 |

### 0.2.3 多语言视觉自适应规范 (Multi-Language Adaptive Layout)

topmind 设计系统原生支持多语言排版（Simplified Chinese / English），遵守以下弹性视觉约束：

1. **控件文本长度自适应**：
   - 按钮、标签、下拉菜单统一使用弹性 flex 布局或 `min-w-[size]` 策略，禁止写死固定宽度（如 `w-20`），允许英文变长文本（如 `Cancel` vs `取消`、`Publish Copy` vs `发布副本`）自适应拓展。
2. **Tooltip 气泡文本安全**：
   - Tooltip 气泡容器统一设置 `max-w-xs` 与 `break-words` 换行策略，避免英文长提示溢出屏幕边缘。
3. **文本截断与单行收缩**：
   - 文件名、路径、状态标签在空间受限时统一应用 `truncate`，配合 `title` 或 Tooltip 悬停全量呈现，确保在任何 Locale 下布局不会崩解破损。

---

## 3. AI 面板（全能力 Agent）

> 框架：Vercel AI SDK v7（`streamText` + multi-step tools）。工具映射 WorkspaceService，**不依赖 UTR、不 spawn 第二 Electron 窗口**。  
> **UI 目标**：首屏只见「会话 + 消息 + 输入」；模型 / 技能 / 写回为二级控件。
> **概念收敛（3 层）**：**对话**（消息 + Composer）· **建议**（全局 `SuggestPopover` 确认面；轨内 compact ActionBar 仅入口）· **后台**（TaskBadge + TaskPanel）。  
> 勿与标题栏 **个人清单**（TodoPopover / `memory/todo.md`）混称「待办」。

### 3.0 结构（自上而下 · 3 层极简）

| 区 | 样式 / 行为 |
|----|-------------|
| **Header** | `.v4-ai-chrome`：会话名下拉 + RuntimeBadge + TaskBadge + 新建 / 清空 |
| **ContextPills** | pill 胶囊，无额外 Separator |
| **Thread** | `.v4-msg-user` / `.v4-msg-assistant` 气泡；流式 `v4-stream-cursor`；工具结果内联 diff |
| **ActionBar** | **compact 跳转 chip**（有 N 条时）：点击 `openSuggestSurface` → **`SuggestPopover`**；无项时隐藏 |
| **Composer** | `.v4-composer`：一级工具条（Skill 固定 / 技能展开）→ 可选 skills 行 → slash 提示 → `.v4-composer-field` 输入 |

### 3.1 控件语义

- **RuntimeBadge**：ready → success 点 + 提供商数；offline → 中性 chip **可点进设置 → AI**（与状态栏「AI 离线」一致）。
- **默认简版**：模型折叠在会话行 chip；**技能 chips 默认收起**（点「技能」或 `/slash`）。
- **模型**：`provider/modelId`；按提供商分组。
- **Skill pin**：`<select class="v4-chip v4-chip-select">` 固定本会话 skill；空 = 自动路由。
- **Agent / 写回**：同为 `.v4-chip`；写回两态 `auto | confirm` 循环；UI 缓存 `settings.writebackMode`，操作真源是 `topmind.yaml` `writeback.mode`（设置变更会镜像进契约）。
- **EmptyConversation**：短文案 + 按选区最多 2 条上下文快捷提示；stagger 入场。
- **离线 composer**：单 CTA「前往设置」，无冗长说明。
- **工具时间线**：助手消息内 `toolCalls` 卡片（running/done + 路径跳转 + `edit_file` diff 内联）。
- **ActionBar（轨内）**：有建议时 compact「建议 · N 条」→ 打开 `SuggestPopover`；无项隐藏。完整列表不在 AI 轨内展开。
- **TaskBadge**：Header 中的微型 spinner + 数字角标，点击展开 TaskPanel。
- **思考过程**：`reasoning-*` 与正文里的 `<think>` / 思考围栏 / 未标注 CoT 在 ingest 拆出，默认折叠进 `ReasoningBlock`；气泡正文只渲染结论。
- **流式状态文案**：`lib/stream-status.ts` 统一 StatusBar / ChatMessage / ChatInput。
- **助手代码块**：语言 pill + 一键复制（对话内；编辑器 Tiptap 代码块保持样式壳）。
- **会话标题**：首条用户消息自动截断命名。
- **AI 按钮视觉体系**：`.v4-ai-btn`（accent tint）/ `.v4-ai-btn-solid`（filled）/ `.v4-ai-btn-ghost`（text only）/ `.v4-ai-btn-gradient`（紫蓝渐变 · 突出 AI 身份）/ `.v4-ai-chip-gradient`（紧凑 icon-only）；`ChromeOverflowActions` 支持 `aiAction` 属性自动应用 accent 样式。
- **助手消息 Markdown**：`ChatMessage` 结构化渲染 — 代码块（语言 pill + 复制）/ H1-H4 / 有序无序列表 / 引用块 / 段落；`BlockFormatted` + `InlineFormatted` 组合；轻量内联解析器（非 full remark）。

### 3.2 Agent 能力面

| 层 | 实现 |
|----|------|
| 模型 | 多 provider（OpenAI/Anthropic/Google/xAI/DeepSeek/Moonshot/Zhipu/MiniMax/Ollama/Custom）；官方 list-models + models.dev 社区目录 + 精选回退 |
| 工具 | `electron/ai-tools.mjs` → WorkspaceService（读/写/抓 URL/健康）|
| 系统提示 | skill-first 协议 + **按工作流阶段分组的工具描述**（Skills → 收集 → 浏览 → 读取 → 写入 → 诊断）+ 预加载上下文（概览/我的情况/专题首页）+ 写回策略 + 质量纪律 |
| 读缓存 | `read_file` / `search` / `workspace_overview` / `workspace_health` 结果在单轮 agent loop 内缓存；写操作自动失效缓存 |
| 改稿 | **优先** `edit_file` 唯一片段（先精确，再换行/行尾空白规范化；`startLine`/`endLine`/`heading` 可限定；失败回 nearby/context；不进 Archive）；整文件 `save_file` **仅 locked 覆盖才备份**；长文 `read_file` 带行号，中段用 `around=` / `heading=` |
| 搜索 | 受控 `search`/grep（可 scope；默认不搜 Archive；无 shell）|
| 步骤 | `maxAgentSteps`（默认 **20**，可配 3–50）；近上限自动收尾提示 |
| 中途 | 流式中可继续输入补充（Enter）；stop 取消 |
| 焦点 | 当前打开文件**自动**进入本轮上下文（「固定」才常驻胶囊）|
| Skills | skill-first 底座；用户侧 slash 用中文短标签 |
| 进程 | 全部主进程；禁止第二 BrowserWindow（main 自动 destroy）|

### 3.3 AI 写回模式

两种权限级别（v4：仅 `auto | confirm`；UTR 显式 `batch` 拒绝；多路径写回时 `auto` 自动出 `batchEvidence` 回执）：

| 模式 | 徽章文案 | 徽章颜色 | 实现语义 | 备注 |
|------|---------|----------|----------|------|
| `auto` | 自动写 | success 绿 | 注册写工具；直接写入；仅高影响才 99-归档 备份 | 默认；≥2 路径时出 evidence 条 |
| `confirm` | 保存前问我 | warning 琥珀 | **仍注册写工具**；写经 Kernel pending → 待确认写入条接受/拒绝 | 不是「无写工具」只读壳 |

点击徽章循环切换模式：先写入 app-settings 展示缓存，再镜像进工作区 `topmind.yaml`。设置面板的通用标签页也有同一下拉框，两者通过 `ViewStore.writebackMode` 保持同步。Kernel 写闸只读契约，不把 app-settings `writebackMode` 当第二份合同。

### 3.4 流式传输

`ai:stream` 事件流：后端 `AiService.invoke` → `ctx.emit("ai:stream", chunk)` → preload → `subscribe("ai:stream")` → ai-store 消息追加。流式光标（▋ 闪烁）在 `streaming === true` 时显示在最后一条助手消息上。用户上滑阅读时不强制贴底滚动。

### 3.5 整理任务（AI 轨 TaskBadge + 可选浮动 TaskPanel）

确定性引擎任务（当前：`reconcile` 整理周期本）与 AI 对话同属副驾面：

| 层 | 组件 | 职责 |
|----|------|------|
| **AI Header 常驻** | `TaskBadge` + 共享 `TaskListBody`（compact） | spinner + 运行中数字角标；点击展开 TaskPanel |
| **浮动详情** | `TaskPanel` | 拖拽 / 最小化 / 完整日志与结果；经 ⌘⇧J · AI chrome · ⌘K · badge 点击打开 |
| **主画布** | `StreamDetailView`「整理」 | 本地 reconcile + toast；有候选则开 AI 轨建议，**不**自动灌对话 |

- **触发**：AI dock · StreamDetail 整理 · ⌘⇧J · ⌘K「整理本周 / 后台任务」  
- **任务类型**：仅 `reconcile`（整理本周）接真实引擎；digest / promote / archive 走 **建议条确认 apply**（不造假后台任务）  
- **整理本周入口**：⌘K / `organize:week` → `runOrganizeWeek`（动态 + reconcile 任务 + AI 轨）；完成后若有候选自动开 AI 轨刷新建议  

- **并发**：`maxConcurrent: 3`  
- **列表实现**：`task-list-body.tsx` 单源；禁止平行 mock 任务  

### 3.6 建议确认面（`SuggestPopover` · 全局）

- **入口**：**标题栏 💡**（toggle · 始终可点 · 有 badge 时高亮）+ **状态栏建议计数 chip**（toggle · count>0 时显示）+ AI 轨 compact ActionBar（**仅专注模式**）  
- **打开/关闭**：`toggleSuggestSurface()` → `ActionStore.panelOpen` → **`SuggestPopover`**（独立浮层，不依赖 AI 聊天轨展开）；再次点击同一入口关闭  
- **交互一致**（与 `TodoPopover` 对齐）：点击外部关闭 · 外部滚动关闭 · Esc 关闭 · 内部列表滚动不关闭  
- **列表**：建议 + 待确认写入混排（`ActionStore`）；pending 可审阅全文；**不是**个人清单  
- **文案**：「建议 / 待确认写入」；禁用「待办」作产品词  
- **会话稳定**：软刷新 / 轮询用 `sessionSuggestionCache` + `mergeSuggestRefreshItems`，kernel 空 regenerate 不闪没未 dismiss 项  
- **autoPrepare 门控**（`ai.autoPrepareSuggestions`，默认开）：关闭时不拉取建议；pending writes 始终拉取  
- **autoMaintainTodos 门控**（`ai.autoMaintainTodos`，默认**关**）：开启后每会话就绪时自动 AI 整理待办；关则仅手动 ✨  

- **轨内 ActionBar**：仅计数 chip → `openSuggestSurface`（始终打开，非 toggle）；**禁止**在轨内再挂第二套完整展开列表

## 4. 覆盖层

### 4.1 记一下（⌘N）

- **默认极简**：落点 chip（**本周动态** / 收件箱）+ 正文 + 保存；标题/模式/来源在「更多选项」  
- **默认落点**：动态周期本（`dest.stream`）；用户可改收件箱  
- 成功后关闭 → 回到 **动态**（或收件箱）；路径证据走 writeback toast（不强制进 file 编辑器）  
- **来源类型**（高级）：手写 / 摘录；URL 自动切摘录并露出抓取  
- **剪贴板 / 附件 / 文档**：智能粘贴；文档走 ingest 队列（与 Hub 同管道）。默认 **anydoc**（设置可改 markitdown / pandoc / 仅内置）；缺失或失败回退。anydoc 装在用户数据 sidecar 或 PATH，**升级不必重打包 Desktop**；asar 内应用代码仍需新版。设置页：检测 / 重新检测 / 安装到应用。  
- **URL 抓取**：主进程 `workspace.fetchUrl`  
  1. **L1 静态**：HTTP → Readability → `html-to-markdown`  
  2. **L2 增强渲染**（可选）：隐藏 BrowserWindow  
  3. 默认 **40k** / 完整 **200k**；截断 →「完整抓取」；SPA →「增强渲染」  
  约定：`skills/shared/long-url-capture.md`  
- **Inbox 筛选**：全部 / 网页摘录 / 手写 / 其他  
- **浏览器剪藏**：设置 → Clip Bridge；扩展 `browser-extension/` · `docs/capture-clip-matrix.md`  
- **Loop 报告**：⌘K / Skills「Loop」→ `loop-report`  


### 4.2 命令面板（⌘K）

- 搜索输入（"搜索命令、跳转、技能…"），也可从标题栏中间触发按钮打开
- 按 `ActionSlot.group` 分组：导航（goto）/ 技能（skill）/ 命令（navigate）
- **子序列模糊匹配**：查询字符需按顺序出现；连续匹配、前缀匹配、子串匹配得分更高
- 方向键导航，Enter 执行，活跃行显示 CornerDownLeft 图标
- 底部：↑↓ 选择 · ↵ 执行 · 匹配计数

### 4.3 全局搜索（⌘P）

- 全文搜索所有工作区 Markdown 文件
- 250ms 防抖，结果显示相对路径 + 内容预览
- 方向键导航，Enter 在编辑器中打开文件

### 4.4 设置（⌘,）

**设计原则**：控件为主、说明进 `HelpTip` / 字段 `hint`；禁止大段说明文字堆叠。`SettingsSection` 仅短标题 + 可选 help。

IA 分组（左侧 nav）：

| 组 | 页 |
|----|-----|
| **环境** | 通用 · 工作区 |
| **智能体** | AI · Skills |
| **扩展** | 插件 · 微信读书 · X |
| **关于** | 关于 |

- 对话框约 `1020×820`；左侧分组；右侧标题 + HelpTip + 自动保存指示
- **通用**: 主题、布局、编辑器、写回、剪藏桥、快捷键（紧凑）
- **AI**: 供应商卡片（国际/国内/本地三区分组）+ 模型列表内联；**双源目录**（官方 list-models + models.dev + 精选回退）；刷新强制绕过 TTL，失败不把空列表写成已同步；配置 Key / 切换提供商后自动解析；Agent 开关；密钥分区
- **Skills**: Skill-first 开关 + 清单卡片（描述进 tooltip）
- **工作区**: 路径/分隔符/视图/类别/最近
- **插件 / 连接器**: 启停 + 配置跳转
- **关于**: 版本、更新三面、健康诊断

#### 密钥持久化（正确性）

| 项 | 约定 |
|----|------|
| 路径 | `~/topmind/topmind-desktop/state/app-settings.json`（+ `.bak`） |
| 加密 | Electron `safeStorage` → `secureStorage.manual.*` / `secureStorage.integration.*` |
| 磁盘明文 | `ai.manual.*Key` / `weread.apiKey` / `x.bearerToken` **恒为空**（仅内存 hydrate） |
| 空字符串补丁 | **保留**已有密钥（禁止 UI 误传空串清空） |
| 显式清除 | 传 `null` 或 UI「清除」→ 写入空密文 |
| 序列化保护 | 若内存为空但磁盘仍有密文 → **保留密文**（防 race / 空字段覆盖） |
| 原子写 | temp → fsync → rename；写前备份 `.bak`；清理 0-byte `.tmp.*` |

> **说明**：若密钥已在磁盘 `secureStorage` 被写成空，无法从应用内恢复，需重新填写。优化代码本身不会迁移/删除 `~/topmind` 目录；换机或重装 macOS 钥匙串可能导致 safeStorage 密文无法解密。

## 5. 设计令牌（Design System 3.0 · ZCode Neutral）

定义在 `src/styles/tokens.css` 的 `@theme` 块。浅色 + 深色（`.dark` 类）。语义别名见 `tailwind-theme.css`。

### 5.0 品牌色板（sky 主轴 + 捕获 teal + 单色 ink）

| Token | Light 角色 | 用途 |
|-------|------------|------|
| `--color-brand-deep` | `#075985` sky deep | 渐变深停 / skill-organize |
| `--color-brand-mid` | `#0ea5e9` sky mid | info、skill-write、次要信号 |
| `--color-brand-aqua` | `#2fa89a` capture teal | **仅限捕获动作**；inbox 身份衍生 |
| `--color-ink` | `#1a1a1a`（dark `#f2f2f2`） | **实心主 CTA**（`bg-primary`，单色 ink） |
| `--color-accent-color` | sky `#0284c7`（dark `#38bdf8`） | focus / 链接 / 选中 / accent wash |
| `--color-accent-inbox` | teal 系加深 `#12897b`（可读） | Inbox 模式 / capture skill |

**中性色**：纯中性灰（ZCode neutral 阶，零色偏）；light 画布 `#f7f7f7`，dark 画布 `#171717`（neutral-900）、elevated `#262626`（neutral-800）、sidebar `#0e0e0e`；边框 = 前景 @ 10%（ZCode 同源）。想读暖纸可用编辑器 `paper` / `sepia` 纸张色（仅画布，不改全局）。

**Dark**：accent = sky-400（`#38bdf8` 量级），`text-on-accent` 用深墨保证对比；**禁止**回退 lavender indigo。

**渐变**：`.v4-brand-gradient` / `.v4-brand-gradient-text` / boot 弱光晕 — **仅** Landing / logo 邻域；壳层 rails **禁止**铺满渐变。

### 5.1 色彩层级

```
chrome（微暖框架）→ background（净白画布）→ surface（工作面板）
→ surface-elevated（弹层 / 菜单 / 对话框）→ surface-inset（凹陷输入）
```

**强制**：light 下 `surface` 与 `surface-elevated` 不得同色塌陷；弹层用 elevated + `shadow-overlay` / `shadow-float`。Accent / 正文 ink **只引用 token 名**，组件禁止硬编码旧 hex；输入框凹陷统一用 `--shadow-input-inset`。Inbox 模式切换为 teal 系 accent。

### 5.2 语义别名

| Tailwind 工具类 | 映射到 |
|----------------|--------|
| `bg-background` / `text-foreground` | 应用背景 / 主文本 |
| `bg-card` / `text-card-foreground` | surface（卡片） |
| `bg-primary` / `text-primary-foreground` | **单色 ink**（`--color-ink` + ink-foreground；hover/active 用 `bg-primary-hover` / `bg-primary-active`） |
| `bg-secondary` / `bg-muted` | surface-muted |
| `text-muted-foreground` | text-tertiary |
| `bg-accent-bg-subtle` / `text-accent-color` | accent 悬停/活跃（浅 wash） |
| `bg-brand-deep` / `mid` / `aqua` | logo 三停（稀用） |
| `bg-destructive` / `text-error` | status-error |
| `bg-border` / `border-border-subtle` | 细微边框 |
| `bg-input` | surface-inset（表单输入） |
| `bg-chrome` | app-chrome（侧栏、标题栏、状态栏） |
| `text-success` / `text-warning` | status-success / status-warning |

### 5.3 圆角

ZCode 阶：`--radius-xs: 2px` · `--radius-sm: 4px` · `--radius-md: 6px` · `--radius-lg: 8px` · `--radius-xl: 12px` · `--radius-2xl: 16px`

### 5.4 字体与密度

见 **§0.2**。密度以 `tokens.css` 为准：

| Token | 默认 | 用途 |
|-------|------|------|
| `--density-chrome-y` | 36px | 标题栏（2026-08-07: 38→36 更纤细） |
| `--density-status-y` | 24px | 状态栏（2026-08-07: 26→24 更纤细） |
| `--density-tree-row` | 28px | 侧栏树行 |
| `--density-editor-toolbar-y` | 32px | 编辑器顶栏 |
| `--content-max-width-prose` | 52rem | 正文列宽（阅读列默认） |

编辑器默认：`fontSize: 16` · `lineHeight: 1.7`。

### 5.5 动效

| Token | 值 | 用途 |
|-------|-----|------|
| `--duration-fast` | 140ms | hover / 颜色 |
| `--duration-enter` | 160ms | 入场 |
| `--duration-exit` | 120ms | 退场（更快） |
| `--ease-out` / `--ease-spring` | cubic-bezier(0.16,1,0.3,1) | 自然减速 |
| `prefers-reduced-motion` | 全量降级 | 无障碍 |

工具类：`animate-fade-in` · `animate-fade-in-scale` · `animate-toast-in` · `stagger-children`。

## 6. UI 规范

- **禁止装饰性内联样式**；允许 settings/runtime 度量（如编辑器 `fontSize`）
- **UI 基础组件**（`src/components/ui/`）：Button, Dialog, Input, Textarea, Select, Card, Tabs, Separator, Splitter, ContextMenu, view（共享视图原语）
- **共享视图原语**（`view.tsx`）：ViewContainer, PageHeader, SectionHeader, EmptyState, LoadingState, ErrorState, MetaText, FileRow, RowList — **空状态必须用 EmptyState**
- **设置卡片**：`SettingsSection` / `Field` / `SwitchField`（`settings/fields.tsx`）
- **图标**: 仅 `lucide-react` + `ICON.*`（nano 9 → xl 28）；面板开合见 `PanelToggleIcon`
- **排版令牌**：text-5xs(10) → text-4xs(11) → text-3xs(12 UI 下限) → text-2xs(12) → text-xs(13) → text-sm(13) → text-base(14) → text-lg(16) → text-xl(16) → text-2xl(18) → text-3xl(24)
- **v4 壳层工具类**（`src/styles/v4.css`）：
  - Chrome：`v4-titlebar-glass` · `v4-shell-chrome` · `v4-sidebar-rail` · `v4-ai-panel`
  - 导航：`v4-nav-pill` · `v4-cmd-trigger` · `v4-segmented` / `v4-segmented-item`
  - AI：`v4-composer` · `v4-composer-field` · `v4-chip` · `v4-chip-select` · `v4-ai-header` · `v4-ai-context-bar` · `v4-msg-user` / `v4-msg-assistant`
  - 通用：`v4-divider` · `v4-overlay-sheet` · `v4-list-virtual` · `v4-panel-contain` · `v4-kbd`
- **z-index 语义体系**（禁止硬编码 `z-[N]`，禁止使用 Tailwind 原生 `z-10`/`z-20`/`z-50` 等数字类）：
  - `z-local`(1) — 局部层叠
  - `z-shell-rail`(10) — Shell 固定栏
  - `z-header`(20) — 标题栏
  - `z-popover`(30) — 浮层/下拉
  - `z-floating`(50) — 浮动元素
  - `z-overlay`(70) — 覆盖层背景
  - `z-modal`(80) — 模态对话框/右键菜单
  - `z-notification`(90) — 通知
  - `z-toast`(100) — Toast 消息
  - `z-menu`(110) — 菜单/listbox（高于 tooltip）
  - `z-popover-overlay`(120) — 待办/建议弹层（高于打开的菜单）
- **焦点环**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`；composer 用 `shadow-focus`
- **滚动条**: 细、半透明（`v4-sidebar-scroll` 类）

## 7. 键盘快捷键

| 快捷键 | 作用域 | 操作 |
|--------|--------|------|
| ⌘⇧N | 全局（任意应用） | 显示窗口 + 记一下 |
| ⌘N | 窗口内 | 记一下 |
| ⌘⇧W | 窗口内 | 切换工作区（下拉菜单） |
| ⌘K | 窗口内 | 命令面板 |
| ⌘P | 窗口内 | 全局搜索 |
| ⌘, | 窗口内 | 设置 |
| ⌘[ / ⌘] | 窗口内 | 后退 / 前进（历史） |
| ⌘S | 编辑器中 | 保存当前文件 |
| ⌘⌥F | 窗口内 | 专注模式开关 |
| ⌘1 | 窗口内（非输入框） | 侧栏视图：流式 |
| ⌘2 | 窗口内（非输入框） | 侧栏视图：分类 |
| ⌘3 | 窗口内（非输入框） | 侧栏视图：时间线 |
| ⌘4 | 窗口内（非输入框） | 侧栏视图：标签 |
| ⌘5 | 窗口内（非输入框） | 侧栏视图：看板 |
| ⌘⇧J | 窗口内（非输入框） | 打开/关闭任务面板 |
| ⌘⇧I | 窗口内（非输入框） | 导航到收件箱 |
| ⌘⇧S | 窗口内（非输入框） | 导航到**动态**（`{ kind: "stream" }` → StreamDetailView） |
| ⌘⇧T | 窗口内（非输入框） | 待办清单弹层（TitleBar 图标） |
| ⌘⇧B | 窗口内（非输入框） | 侧栏看板（高级视图） |
| ⌘⇧O | 窗口内（非输入框） | 导航到写出来（输出） |
| ⌘⇧A | 窗口内（非输入框） | 导航到归档 |
| Enter | 聊天输入中 | 发送 AI 消息 |
| Shift+Enter | 聊天输入中 | 换行 |
| ESC | 浮层 / 专注 | 关闭浮层；无浮层时退出专注 |
| ↑/↓ | 命令面板 / 搜索 | 导航选项 |
| 右键 | 树节点 | 上下文菜单 |

## 8. 启动与引导

- **加载中**: `Loader2` 旋转动画居中
- **引导**（无有效工作区）: `OnboardingScreen` 工作区选择器
- **就绪**: `Shell` 渲染

引导界面包含：Logo + 最近工作区卡片列表 + "选择/新建工作区"按钮 + "使用默认工作区"选项。

---

版本真源：`package.json`。工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`。

---

## 变更摘要

> **现在时规范是 §0–§3**（尤其 §2.2 侧栏 · §2.3 编辑区）。本节是发版指针，不是第二套 spec。Phase 0–6 / Brand Horizon / Design System 2.0 像素台账以 git 历史为准，不在此复述。

- Design System **3.0** ZCode Neutral（纯中性灰 + sky 强调 + 单色 ink 主 CTA；token 真源 `src/styles/tokens.css`）
- 捕获词汇：用户可见文案一律 `记一下` / `Note it` · `记下` / `Log it`（禁止 Quick Capture 冒充）
- 建议确认面 = `SuggestPopover`；编辑 = TipTap、预览 = `getEditorHtml()` 静态 HTML
- 建议 kind 与 Kernel 对齐（无 `archive_path` / 卡片级 `todo_extract` / `topic_classify`）

## Sidebar · 一级类与交付物

- **一级类（category）**：始终按 `NN` / slot 排序；时间/名称排序只影响专题与文件。
- **结构带**：`00-收件箱` → 用户类 → **`88-输出`（交付）** → `99-归档`。交付物固定在类列表之后（非插件区），便于日常找回。
- **标签页**：设置 → 通用 → 多标签（激活不改顺序）/ 单标签。
- **非 Markdown 文件**：知识区列出全部类型；`.html` 沙箱 iframe（截断）；其它文本等宽；二进制打开外部。Markdown 预览见 §2.3（静态 HTML，不是 live TipTap）。
- **图标**：macOS `.icns` + `icon-mac.png` = **peer 几何预裁白圆角板**（板 ~80.5% 画布 + 圆角 ~25% 板边，与 VS Code/Claude 一致）；Win/Linux/扩展为透明 mark；`setIcon` 仅 plate PNG。


## 截图与文档

产品截图真源：`docs/images/`（索引见 `docs/images/README.md`）。  
仓库默认 README 为**英文**（`README.md`）；简体中文 `README.zh-CN.md`。各模块 README 同此约定。

---

## UI/UX 审查清单（UIX-401 ~ UIX-407 · 2026-08-10）

### UIX-401：用户概念 ≤5 硬上限 ✅

界面显性概念严格限定为：**记一下 · 动态 · 专题 · 我的情况 · 写出来**。

- 标题栏主锚点：动态（默认）· 收件箱 · 写出来 · 搜索
- 侧栏 ViewSwitcher：流式 / 分类 / 时间线 / 标签 / 看板（高级折叠）
- 捕获词汇：`记一下`（Note it · 完整捕获）vs `记下`（Log it · 周期本追加）— 语义不混
- 无多余概念暴露

### UIX-402：底层术语屏蔽 ✅（已修复）

已清理的内核术语暴露：

| 位置 | 修复前 | 修复后 |
|------|--------|--------|
| `settings.json` zh/en `currentHelp` | `schema v4` | 移除 |
| `settings.json` zh/en `firstLevelCatsHelp` | `categoryExtensions` / `overrides` / `buffer/delivery/system` | 白话化 |
| `settings.json` zh/en `rebuildIndex` | `重建派生索引` / `Rebuild derived index` | `重建索引` / `Rebuild index` |
| `settings.json` zh/en `tabDesc.tools` | `UTR 工具目录` | `工具目录` |
| `settings.json` zh/en `tabHelp.tools` | `node-runtime` / `ELECTRON_RUN_AS_NODE` / `WorkspaceService` | 白话化 |
| `settings.json` zh/en `helpUtr` | `engine 的 utr/` / `pathContext` / `engineRoot` | 白话化 |
| `settings.json` zh/en `warnExecute` | `写回伦理` / `CLI` / `契约 exposure` | 白话化 |
| `settings.json` zh/en `trustModel` | `renderer` / `ctx.rpc` / `ctx.register` / `soft gate` | 白话化 |
| `settings.json` zh/en `writebackHelpAuto` | `受保护级别约束` / `protection` | 移除 |
| `settings.json` zh/en `writebackHelpConfirm` | `高影响记忆` / `high-impact` | `重要记忆` / `important` |
| `settings.json` zh/en `updateHelp` | `UTR` / `topmind-engine` | `引擎` / `engine` |
| `editor.json` zh/en `writebackAutoHint` | `Agent 可写盘` | `AI 可写入` |
| `editor.json` zh/en `writebackConfirmHint` | `Agent 写工具结果` | `AI 写入结果` |
| `ai.json` zh/en `writebackMode` | `写回模式` / `Writeback mode` | `保存模式` / `Save mode` |
| Obsidian `zh-CN.ts` / `en-US.ts` `settings_writeback_mode` | `写回模式` / `Writeback Mode` | `保存模式` / `Save Mode` |
| Obsidian `en-US.ts` `settings_ai` | `AI Co-pilot & Writeback` | `AI Co-pilot & Save` |

### UIX-403：视觉品质 ✅

- **深色模式**：Design System 3.0 ZCode Neutral 石墨阶梯（sidebar `#0e0e0e` → chrome `#161616` → canvas `#171717` → surface `#1d1d1d` → elevated `#262626`），AA+ 对比度
- **Glassmorphism**：浮动弹层 `backdrop-blur-[var(--blur-glass)]`（14px）+ `backdrop-saturate-150`，仅限浮层（菜单/弹出/下拉），不用于主 chrome
- **微交互动画**：`--duration-quick: 100ms` / `--duration-fast: 140ms` / `--ease-default: cubic-bezier(0.2, 0.8, 0.2, 1)` — 统一快捷柔和
- **Typography**：系统 UI 字栈（`--font-family-ui`，非 Inter）+ ZCode 整数字号阶（`text-5xs: 10px` → `text-4xl: 28px`）

### UIX-404：Chrome 纤细化 ✅

- 标题栏高度 `--density-chrome-y: 36px`（2026-08-07 从 38px 降至 36px）
- 状态栏高度 `--density-status-y: 24px`（2026-08-07 从 26px 降至 24px）
- 侧栏头部统一：`ViewSwitcher` + `ProfileButton` 在同一行，无重复 border
- Landing 页噪点清理：workflow chips 已移除（2026-08-07）；brand chip 已移除（2026-08-07）

### UIX-405：ActionBar 建议条与 confirm 二阶段 ✅

- `ActionBar`：仅 focus mode 显示（精简指示器）；非 focus mode 由 StatusBar chip 承担入口
- 主动 AI **只生成建议**，用户确认后才调 writeback 执行
- `SuggestPopover` 为唯一完整确认面：接受 / 忽略 / 待确认写入三模式
- 空态自动隐藏（`count=0` 不占位）

### UIX-406：SuggestPopover 与 Pending 审阅 ✅

- 外部点击关闭（unpinned 模式）；Esc 关闭；面板内滚动不关闭
- 批量操作：Accept All（顺序执行）+ Dismiss All（仅建议）
- 待确认写入（`pending_write`）：`ConfirmDialog` 预览完整内容 → 接受/拒绝后落盘
- 卡片信息精简，长文 tooltip；路径显示为友好面包屑（非 raw monospace）

### UIX-407：StatusBar 多路 AI 并发 ✅

- `deriveStatusBarBusy` 纯函数追踪 5 种并发工作类型（agent / task / todo / suggest / inline）
- `multiActive` 在 2+ 并发时激活；pill 显示 `AI ×N`
- tip 列出所有活跃工作（如「同时进行：对话 · 准备建议…」）
- 同路径不双标：后台 prep 有独立 named chip，不与 AI pill 重复
- 后台 prep 串行（`ai-background-lane`），防 token 踩踏
