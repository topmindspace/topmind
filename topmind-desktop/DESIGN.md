# topmind Desktop — UI/UX 设计规范

> **理念**：精准、安静、对象优先、**长时阅读友好**、可审查、**可扩展的富工作台**。  
> **产品北极星**：最低摩擦个人动态流；导航与概念**清晰简单**；AI **内生副驾**（建议默认 · 确认执行）。  
> **美学**：**Design System 3.0 — ZCode Neutral（中性石墨 × Sky 强调）** — 纯中性灰阶（零色偏，对齐 ZCode 桌面端）+ 单一 sky 主色 + **黑白单色实心主 CTA**（Linear 密度 × Craft 阅读 × 文件对象感）。3.0 取代 2.1 微暖中性：中性更纯净、圆角更利落、主按钮单色化。  
> **栈**：Tailwind 4 · shadcn 风格 · Radix · RemixIcon · Design Tokens。  
> **品牌色**：sky 轴 `#075985` deep → `#0ea5e9` mid + capture teal `#2fa89a`（teal 仅限捕获动作）；强调交互色 = sky-700 `#0369a1`（dark sky-400 `#38bdf8`）；实心主 CTA = 单色 ink（light 近黑 / dark 近白）。**实测对比度基线见 §5.0.1**。  
> **实施锁**：[`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md) · 产品原则：[`../DESIGN.md`](../DESIGN.md)

个人工作台 UI：**状态可感知** · **正文区优先** · **低视觉负担** · **智能可中断** · **扩展不抢主路径**。

> **真源**：本文件是 Desktop UI/UX 唯一规范；`tokens.css` 是色/型/密数值真源。根 `DESIGN.md` 不复制像素线框。  
> 历史平行提案已删除；IA 目标以本节 §0.0 与根 DESIGN 为准。

## 0.0 信息架构目标（导航变薄 · 2026-07-25）

用户概念硬上限 ≤5：**记一下 · 动态 · 专题 · 我的情况 · 交付**。

```text
中栏主锚点：动态（默认） · Inbox · 交付
状态栏 compact：状态（路径 · AI · busy）— 主锚不在状态栏
中栏动作：面包屑 · 注入动作 · AI 列开关（主锚在**侧栏主 header**；搜索非 PrimaryNav：⌘K 命令面板 · ⌘P 笔记全文；记一下在左栏）
左栏：内容导航 + 底栏工作区切换 + ViewSwitcher 下沉
右栏：AI 工作区 pane 对话 / 建议 / 清单 / 应用
二级入口：专题树 · 我的情况（记忆浏览：列表/卡片，点开条目仍落文件） · 归档（⌘⇧A / 命令面板；不在 PrimaryNav）
高级（折叠或 ⌘K）：标签 · 看板 · Tools/UTR；可选插件/mini-app 在 **AI 工作区 · 应用** pane
```

### 0.0.1 捕获词汇与入口（强制 · 单一心智）

| 用户说法 | 系统动作 | **唯一**主入口 | 禁止 |
|----------|----------|----------------|------|
| **记一下** | 打开完整捕获（笔记 / 链接 / 附件） | 左栏 Sidebar 主 header（⌘N / 全局 ⌘⇧N） | 在动态页再堆一个同名主按钮；实心 teal CTA |
| **记下** | 把输入框追加到**当前周期本** | 动态主区输入框主按钮（⌘↵） | 把「记下」标成「记一下」 |
| **AI 润色** | 只改输入框通顺/格式 · **不落盘** | 输入框旁 AI 次级按钮 | 与「记一下」共用文案或图标语义 |
| **AI 待办** | 从动态提取/更新 `memory/todo.md` | AI 工作区 清单 pane · ⌘⇧T | 与建议混称「待办」 |
| **AI 建议** | 工作区整理候选 · 确认后写入 | 有条目时**状态栏计数 chip** → AI 工作区 **建议** pane（`SuggestPopover` 确认列表；专注模式仍浮动） | 嵌进 Stream 卡片；仅藏在 AI 聊天轨里才可操作；空态永久占位条 |
| **增补** | 对已有动态条目续写（评论感 · 同文件） | 动态卡片上的增补入口 + 续写徽章 | 平行评论 DB / 新真源 |

**动态页主路径**：输入 →（可选润色）→ **记下**（EN: Log it）；对旧条 **增补**；链接/文档走侧栏「记一下」（EN: Note it）。链接检测 CTA 亦用「记一下」而非「快速捕获」。页头 **整理 · 刷新**（情境动作）。**个人清单 / AI 待办**不在页头——唯一入口是 ⌘⇧T → AI 工作区 清单 pane（pane 内 ✨ 维护）；专注模式才浮动。  
**统一建议入口（全局）**：有 `items` 时**状态栏计数 chip**（**count=0 自动隐藏**）；点击 → `openSuggestSurface()` → AI 工作区 **建议** pane。画布顶 `SuggestEntryStrip` 已删除，不得再挂。无始终可点的标题栏 💡（安静 chrome）。  
**唯一确认面**：AI 工作区 **建议** pane 内的 `SuggestPopover`（接受 / 忽略 / 待确认写入）；专注模式仍浮动（AI 列被藏）。不在对话 pane 再挂第二套完整列表。  
**会话稳定**：软刷新 / 15s 轮询不得因 kernel 空 regenerate 清空已展示建议（`sessionSuggestionCache` + `mergeSuggestRefreshItems`）；dismiss/apply 仍可移除。  
**忽略要落盘**：dismiss 写入 `.topmind/suggest-dismissed.json`（`lib/suggest-dismissed.mjs`），生成侧 `suggest-engine` 返回前过滤。「忽略」不能只是一个会话内的视觉操作——否则下一次轮询会把同一条原样端回来。  
**「全部接受」= 一个请求，不是一个循环**：渲染侧走单次 `applySuggestions(items)`，主进程串行写、逐条 `ctx.emit` 进度。早期版本是渲染侧 `for` 循环逐条 IPC，N 条建议要 N 次 settings 加载与 N 个往返，且中途失败只留半张卡的中间态。  
**失败语义分两类**（`src/lib/suggest-apply-label.ts`）：**终态失败**——源文件已不在 / 目标已存在 / 落点越出工作区 / 读写失败等 12 个 reason 码，重试不会变好，故**自动等同「忽略」**（移卡 + 记 dismissed）并给一条说明；**可重试失败**——AI 忙 / 超时 / 引擎暂时不可用，保留卡片让用户再试。两类都要有 i18n 文案，禁止把 reason 码裸露给用户（`editor:applyFail.*`）。  
**卡片正文**：`stream-md-preview` 轻预览（剥 `<!-- topmind:append -->`；首行子弹/时间进芯片不进正文）；**Feed 稳定**：软 reload 不全页 loading。  
**信息流两种布局（`settings.ui.feedLayout` · 列表 / 卡片）**：开关在**信息流正文上方**（`data-feed-chrome`，与帖子同列），不在页头 AI 动作条。列表 = X 式单列紧凑帖（细线分隔）；卡片 = **同一套 chunks** 的单列等宽卡片——**不是** Pinterest/masonry 多列。记下输入框、列表、卡片共用 `--feed-column-max`（`.v4-feed-column`）。Inbox / 类别 / 专题 / 交付 共用同一开关。  
**分块诚实**：日/周期段若是 markdown **列表**（`-` / `*` / `1.`）仍按条目拆帖；**无列表标记的长散文换行**是一条帖（空行分段仍是段落 `<p>`，不是每行一个 `<li>`）；timed/list 条目后续段落留在同一帖。列表与卡片消费同一 parse，切换布局不重拆。  
**我的情况**：侧栏 Profile **与动态信息流上的「我的情况」** 打开记忆浏览（画像 / 周期反思 / 专题记忆 **分层芯片**）；点开条目仍落到真实相对路径；「在目录中显示」展开侧栏 `memory/`（不是第六用户概念）。**整理我的情况**走已有 `memory_organize` → `runActivityOps` → **AI 工作区建议 pane**；自动准备可生成建议，**从不静默写画像**。无平行记忆库。  
**个人清单**：AI 工作区 **清单** pane（专注模式浮动 `TodoPopover`）· **≠** 建议。  
**建议沉淀**：confirm 后 profile/periodic / 内容大类专题。

#### 建议种类（Suggestion Kinds）

| kind | 说明 | 影响 | apply 行为 |
|------|------|------|-----------|
| `inbox_review` | Inbox 文件超过回顾天数（**仅作回顾提示，不再默认归档**） | high | 保留兼容 kind；产品默认走 `inbox_organize` 归位 |
| `inbox_organize` | **AI/规则建议：移入已有专题或新建专题**（超期笔记优先） | medium/high | 先写目标再删源（与 Desktop moveToTopic 相同） |
| `stale_topic` | 专题长期未更新 | high | 归档整个专题目录 |
| `catch_all` | 兜底类文件过期 | high | 迁入 99-归档（新家） |
| `stream_digest` | 为周期本生成反思 | high | AI 生成真实反思写入 memory/periodic |
| `promote_memory` | 动态 → 我的情况 | high | 不是 append-only。`payload.action`：`append_profile` 新稳定事实（跨活跃段去重）；`update_profile` 原位更新；`retire_profile` 移入 `## 历史记录`（日期前缀，不删）。确认后经 Kernel `applySuggestion` |
| `ai_summary` | AI 活动窗口反思 | medium | AI 反思写入 memory/periodic |
| `create_topic` | AI 建议新建专题 | medium | 在内容大类下创建专题目录 + topic.md |
| `open_profile` | 完善「我的情况」 | low | 打开契约画像文件（默认 memory/profile.md） |

**Inbox 生命周期语义（强制）**：超期 **≠** 归档。年龄只触发「待归位」回顾；首选结果是移入合适专题 / 新建专题。归档是用户手动的最后手段，不是确认卡片的默认动作。

**inbox_organize 特殊行为**：
- AI 可用时：分析 Inbox 文件（含嵌套目录，超期优先），建议移入已有专题或新建专题；提示词明确禁止仅因较旧就建议归档
- AI 不可用且 Inbox ≥3 条 **或** 有超期笔记：出一张「待归位」批量提示（batch_hint，不写盘）
- 确认后：先 `executeWrite` 写入目标专题，再 unlink 源文件（源失败则保留）
- 导航：确认后跳转到目标专题中的文件（而非回到动态）

### 0.0.2 图标语义（强制）

| 图标（RemixIcon） | 用途 | 禁止 |
|------|------|------|
| **RiFlashlightLine** | 「记一下」完整捕获（线形；禁止 Fill 实心） | 用于 AI 润色 / 待办 |
| **RiSparklingLine** | AI 润色 · AI 待办 · 建议条 AI 动作 | 用于普通保存 |
| **RiSendPlane2Line** | 「记下」写入周期本 | 与 Flashlight 混用为捕获 |
| **RiListCheck** | AI 工作区清单 pane · 状态栏「AI 整理待办中」chip（可点开清单） | 与建议混称；**禁止**用于后台 Task 面板 |
| **RiLoader4Line** | 后台任务 busy · AI 轨 TaskBadge · 通用 spinner | 与 ListCheck 混用表示个人清单 |
| **RiMagicLine** | 整理本周 / 确定性 reconcile | 与 AI 润色混用 |
| **RiHome4Line / Fill** | 状态栏 PrimaryNav「动态」（默认主页） | 与后台 Task 的 Pulse 混用 |
| **RiInbox2Line / Fill** | 状态栏 PrimaryNav「Inbox」· 侧栏 Inbox 节点 | 用 Unarchive 冒充 Inbox |
| **RiShareForwardLine / Fill** | 状态栏 PrimaryNav「交付」· 侧栏交付 / 交付节点 | 与「记下」SendPlane 混用 |
| **RiChatAiLine** | AI 工作区「对话」pane + 该 pane 内会话列表 | 用机器人图标冒充对话；普通「消息」不要另起第三个聊天气泡图标 |
| **RiEditLine** | 重命名 / 编辑（右键菜单 · 格式条编辑模式） | 用 RiEdit2Line / RiPencilLine 另起一套「编辑」 |
| **RiQuillPenLine** | 用户原创（Inbox badge）· 交付 skill | 用于重命名 |
| **RiListCheck2** | 编辑器 Markdown 任务列表语法开关（格式条） | 用于产品「清单」pane（那是 RiListCheck） |

> 图标体系（2026-09）：全应用 **RemixIcon**（`@remixicon/react`），尺寸标尺集中 `src/lib/icons.ts` `ICON = { nano:10, micro:12, xs:14, sm:17, md:20, lg:24, xl:30 }`。语义边界：**nano 仅限箭头/圆点/kbd；功能图标 micro 起步；header/sidebar/主导航用 sm**。二态开关用 Line/Fill 变体对（如 PanelToggleIcon）。**一概念一图标**：同一产品概念在所有表面复用同一 glyph（对话 / 清单 / 交付 / 编辑 / 整理），不要在第二个组件另起近似图标。

#### 跨表面图标映射（强制 · Desktop Remix ↔ Obsidian Lucide）

宿主图标库不同，**语义必须一一对应**。Obsidian `setIcon` 用 Lucide 名；禁止用 `list-checks` 表示「整理」（那是清单）。

| 概念 | Desktop (Remix) | Obsidian (Lucide) | 禁止 |
|------|-----------------|-------------------|------|
| 记一下 | `RiFlashlightLine` | `zap` | Fill 实心闪电；与记下混用 |
| 记下 | `RiSendPlane2Line` | `send` | Save 冒充 |
| 整理 | `RiMagicLine` | `wand-2` | `list-checks` / `refresh-cw` |
| 清单 / 待办 | `RiListCheck` | `list-checks` | 与整理混用 |
| 建议 | `RiSparklingLine` / Lightbulb 面板 | `lightbulb` | 三处等权入口 |
| 对话 | `RiChatAiLine` | `bot` | 普通 `message-circle` |
| 后台任务 busy | `RiLoader4Line` | spinner / `loader` | 与清单混用 |

**捕获英文对译（强制）**：`记一下` = **Note it**（完整捕获）；`记下` = **Log it**（动态主区写入周期本）。禁止用 Save 冒充「记下」、用 Quick Capture 冒充「记一下」。

### 0.0.3 多路 AI 并发（强制 · 安静诚实）

| 路径 | 优先级 | 车道 | 用户提示 |
|------|--------|------|----------|
| **Agent 对话** `ai.invoke` | 用户主路径 | 独立（单 stream） | AI pill「工作中」；可取消 |
| **行内 / 润色** `ai.complete` | 用户短路径 | 独立 | 专用 chip；离开页确认 |
| **准备建议** | 后台 prep | **background lane**（串行） | 建议 chip · 可点开 AI 工作区建议 pane |
| **确认写入建议** | 用户确认后的回写 | 顺序逐条，**一次 IPC**（`applySuggestions`，主进程内循环，只加载一次 settings） | 建议 pane 进度条 + 状态栏「正在执行 n/m」chip；禁止静默、禁止每条都弹 toast |
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
| **一条主路径** | 打开 = **动态**（`StreamDetailView` 周期本）+ 侧栏「记一下」；**建议**走全局入口（AI 工作区建议 pane / 状态栏计数），不在主画布堆仪表盘 |
| **富而不挤** | 编辑器深度、阅读 Aa、多标签、插件能力保留；不一次性摊开全部视图 |
| **建议条** | AI 工作区 **建议** pane（状态栏计数打开；`SuggestPopover` 为确认列表）= 唯一完整确认面；专注模式浮动 `SuggestPopover`；状态栏 count=0 自动隐藏（≠ 个人清单） |
| **设置白话** | 「保存前问我」「自动准备 AI 建议」「自动 AI 整理待办（默认关）」「重要文件不让 AI 直接改」 |
| **扩展外围** | connector / 第三方插件不占默认主 chrome：入口统一在 **AI 工作区 · 应用** pane（`AppsLaunchList` · `lib/apps-menu`），侧栏只承载内容导航 |

**IA 已收敛（Wave F–M · S\*）**：默认 **动态** = `StreamDetailView`（按日分组 · 周期 chip · 条目增补）；Home 已删。侧栏主轨 = 动态安静列表 / 目录 / 时间；标签/看板在「更多」；**个人清单**在 AI 工作区 清单 pane（⌘⇧T；专注模式浮动）。**建议**在状态栏计数 → AI 工作区建议 pane（会话缓存防闪烁）；右列四 pane：**对话** · **建议** · **清单** · **应用**；后台仍是 TaskBadge + TaskPanel。交付列表展示 `published_at`。行内 AI 可拖动。

### 0.0.4 能力单家（Header homes）

中栏画布 **保留一条薄 chrome**（`TitleBar` · `data-canvas-chrome`），不删尽：窗口拖动、红绿灯/标题按钮垫、侧栏收起后主锚仍可达。**不**再叠一条与产品命令重复的 PageHeader 动作条。三列贯通（左 | 画布 | AI 工作区）；**没有**横跨三列的产品栏；不新增第四个 PrimaryNav 对等锚；用户概念 ≤5。

**2026-09 v4 三列 header 职责：**

- **左 Sidebar 主 header**（顺序固定）：**PrimaryNav（动态 · Inbox · 交付）→ Profile → 搜索 ⌘K → 记一下**。macOS 整组右对齐（红绿灯占左栏左侧）；Windows/Linux 左对齐（栏就是窗口左缘）。记一下是纯图标 chrome 按钮（`RiPencilLine` 铅笔，通用「写」认知），非实心 teal CTA，捕获强调色；tooltip/aria 承载文案（避免 macOS 原生按钮挤压）。
- **左 Sidebar 次级 header**：ViewSwitcher 纯图标（动态 / 目录 / 时间 / 看板等）与树的排序 / 展开折叠 / 筛选 / 刷新合在**同一行**小图标；非目录模式隐藏树工具。
- **中间 TitleBar**：三列顶栏共用 `.v4-column-chrome`（`--density-chrome-y` 44px · 控件 32px）对齐。左侧 = Toggle + 后退/前进 + 可点击祖先面包屑（第一层 `max-w-36`，后续更短）+ 当前页标题 + 该页统计；右侧 = 视图注入动作 slot（`data-titlebar-actions-slot`）+ AI 面板 toggle。集合页（动态 / Inbox / 交付 / 类别 / 专题 / 我的情况 / 归档）的身份与新建/整理/刷新等动作住在 TitleBar，画布不再重复 PageHeader 标题条。文件页把注入 AI / 发布 / 移动 / 记忆等原编辑器拖把右侧快捷键注入 TitleBar；拖把只留格式 + 编辑/预览图标 + 大纲/阅读/专注 + 属性开关 + 保存/⋯。**大纲 / 阅读外观 / 专注模式住在编辑器工具栏右侧**（`EditorViewChrome`），不再挂在属性行——属性默认收起时它们仍常驻。文件标题**右键**承载页签操作（关闭 / 固定 / 对照 / 文件操作），单页签（无 Tab 条）时这是主路径。
- **StatusBar**：左端绿点 + **完整工作区路径**（`data-status-workspace-path`，不是 basename）；tooltip 含 engine 路径。**不含 PrimaryNav**（状态栏是状态，不是导航；主锚在侧栏主 header）。

| 能力 | 唯一主家 | 侧栏收起后如何到达 |
|------|----------|-------------------|
| **记一下** | 左栏 Sidebar 主 header L1 捕获（⌘N / 全局 ⌘⇧N） | 侧栏收起后 ⌘N / ⌘⇧N 全局快捷键仍可达 |
| **动态 · Inbox · 交付** | **侧栏主 header**（`data-sidebar-primary-nav` · 与 Profile/搜索/记一下同行） | 侧栏收起时 TitleBar **紧凑图标**（`PrimaryNav variant=compact`）；⌘⇧S / ⌘⇧I / ⌘⇧O · ⌘K |
| **建议** | 右列 AI 工作区 **建议** pane；状态栏计数（count>0）只打开该 pane | 状态栏计数仍在（count>0）；专注模式浮动 `SuggestPopover` |
| **清单** | 右列 AI 工作区 **清单** pane（`TodoListBody`；✨ 维护在 pane 内）；⌘⇧T 开门 | 专注模式浮动 `TodoPopover` |
| **应用** | 右列 AI 工作区 **应用** pane | ⌘K「打开应用」走 `openAiWorkspace("apps")`（不依赖右列已挂载） |
| **设置** | 侧栏页脚 **设置图标钮**（`data-workspace-settings`）/ WorkspaceSwitcher 菜单旁 / ⌘, | ⌘, / ⌘⇧W（Shell 常驻宿主，侧栏收起后仍开菜单） |
| **主题** | 侧栏页脚 **主题循环钮**（`data-workspace-theme`，与工作区名同排；菜单内不再塞三格主题簇） | 专注模式 ⌘⇧W 菜单仍可进设置改主题 |
| **工具与日志** | WorkspaceSwitcher 菜单 / ⌘⇧L | Overlay `tools-logs`：概览 stats · 操作日志 · 系统日志 · 健康（含契约）· 清理预览/去重 |
| **帮助** | WorkspaceSwitcher 菜单 | Overlay `help`：快速开始 · 功能 · 工作流 · 理念 · FAQ；可跳转设置 / 工具与日志 |
| **AI 列开关** | 中栏薄 chrome L1 | TitleBar 仍在 |

**PageHeader** 不再作为集合画布的标题 + 动作条。集合身份（目录名 + 原页头副标题统计）与视图动作注入 TitleBar：动态整理本周 · 刷新；Inbox 新笔记 · 刷新；归档/交付刷新；类别新建专题/笔记；专题记忆 / topic.md / 新建；我的情况打开目录 / 整理。禁止把 记一下 / 建议 / 清单 再做成与顶栏等权的第二命令条。空态 outline「打开记一下」是恢复 CTA，不是第二条产品栏。

### 0.0.5 计数角标（CountBadge · 强制）

数字角标（建议数 / 待办数 / AI 工作区 tab 数 / 运行中任务数 / 会话已载技能数）**只有一个实现**：`src/components/ui/CountBadge.tsx`。

> **为什么要单独立规**：此前三处调用点各自手写 `<span>`，圆角、偏移、填充三套互不相同。其中 AI 工作区那处填的是 `bg-skill-loop` —— 该 token 早已在设计系统重构中被删除，Tailwind v4 对未定义 token **一条规则都不生成**，角标于是成了「透明底 + 继承字色」：浅色 ~1.14:1、深色 ~1.09:1，**两种模式全隐形，且没有任何东西报错**。

| 项 | 规定 |
|----|------|
| 形状 | `--radius-xs`(2px) 方圆角，**不是**胶囊——与 `v4-chip` 语言一致，避免圆点抢读 |
| 字号 | `text-4xs`(11px) / `font-bold` / `leading-none`；**不得**用 `text-5xs`(10px) |
| 填充 | `--color-badge` 轴（`bg-badge`），告警用 `bg-badge-alert`。**不用** `accent-color`：它在 inbox 模式翻成 teal，白字掉到 4.3:1 |
| 前景 | `--color-badge-foreground` / `--color-badge-alert-foreground`；**禁止**硬编码 `text-white`（深色模式角标是浅底 + 深字） |
| 定位 | 由**调用方**给（如 `className="absolute -right-0.5 -top-0.5"`）。组件只管视觉不管坐标——两个 offset 工具类并列时按 CSS 生成顺序决胜、不按书写顺序，坐标必须只有一处说了算 |
| 溢出 | 两位数显示 `9+`；`count = 0` 时**调用方不渲染**，组件不返回空壳占位 |
| 语义 | `aria-hidden`；数字信息由父控件 label / tooltip 承担 |

**守护**：`tests/ui-token-compliance.test.mjs` 断言三处调用点仍走 `<CountBadge`、字号 ≥ `text-4xs`、填充来自 `--color-badge` 轴；同文件的全量扫描确保**任何**颜色工具类都解析到已定义 token——幽灵引用无处可藏。

### 待办清单（AI 工作区 清单 pane · 专注模式 TodoPopover）

**概念区分**（重要）：

| 系统 | 用途 | 存储 |
|------|------|------|
| **TodoStore / 清单 pane** | 用户个人任务跟踪（AI 从动态提取 + 手动增删改） | `memory/todo.md`（语义平面）|
| **ActionStore / 建议 pane** | AI 建议 + confirm 挂起写入（工作区管理确认面） | 运行时态 |
| **TaskStore / TaskPanel** | 后台引擎任务（reconcile / ai_digest） | 运行时态 |

- **存储**：`memory/todo.md` — 简洁 Markdown 清单（`- [ ]` / `- [x]`）；经 writeback-engine 写入（唯一写闸）
- **AI 提取 / 维护**：点 ✨ → AI 分析**活动窗口 prompt corpus**（周期正文 ∪ 折叠 extras；截断时优先保留 extras；排除 `memory/` 尤其 `memory/todo.md`）→ 提取/勾完/改写 → 去重后经 writeback 写入；`processedHashes` 对 budgeted corpus；自动维护尊重 skip，手动 ✨ 在「已处理」后再点一次 progressive force 重扫
- **语义深度（2026-08-09）**：AI 提取不再基于关键字过滤（`extractKeySegments` 已废弃），改用 `smartBudgetCorpus`——保留 frontmatter/段落结构/首尾上下文。提示词注入用户画像（`memory/profile.md`）+ 近期周期反思，AI 能识别「真正需要行动」而非简单匹配「待办/任务」等关键字。活动窗口 21 天 / 30 文件 / 6 周期。语料预算：extract 16K / maintain 12K（与 suggest 16K 对齐）。
- **用户操作**：勾选完成 · 内联添加 · 双击编辑 · 悬停删除 · 清除已完成
- **视图**：`⌘⇧T` 打开 AI 工作区 **清单** pane（`TodoListBody`）。专注模式（AI 列隐藏）才用浮动 `TodoPopover`（点击外部 / **面板外**滚动 / Esc 关闭；**面板内列表滚动不关闭**——与 DropdownMenu 共用 `shouldCloseOnScroll`；可 pin 拖动）。进行中在上（按截止日期排序），已完成折叠；AI 来源项带 ✨ 标记
- **过长处理**：已完成项默认折叠；「清除已完成」一键清理；活跃项上限 50

### 可选记账（ledger mini-app · 非第六用户概念）

- **存储**：`{memory.dir}/ledgers/{id}.md` + `catalog.md` — 默认一本 **Personal / 自己**；用户再加账本和分类。经 writeback-engine 写入。
- **入口**（`settings.ledger.enabled`，默认开）：AI 工作区 · 应用 pane · StatusBar chip · ⌘K「记账」。**不是** PrimaryNav。关掉插件后这些入口消失。
- **表面**：plugin-app overlay（看板 · 流水 · 分类 · 快捷记账）。「记一下」捕获表单 / 动态 composer 在检测到 记账/记一笔/花了/存入 时注入快捷记账，不另占主 chrome。
- **NL**：记账 / 记一笔 / 花了 / 存入；读：查看账单 / 账户余额。未点名账本落到默认个人本，不发明 ClassFund / Giggs / Mom。

### 长文大纲目录（EditorOutlinePanel · ⌘⌥O / Ctrl+Alt+O）

- **定位**：长文阅读与结构化编辑辅助抽屉（遵循 Jakob's Law 传统大纲心智），不属于独立视图，仅附着于 `FileEditorView`。
- **实时同步**：订阅 TipTap 实时更新事件（150ms 节流防抖），正文输入标题时大纲毫秒级即时呈现，杜绝未存盘不同步问题。
- **Scrollspy**：视口滚动智能跟随，高亮当前阅读章节。
- **交互与直达**：点击标题平滑直达正文对应位置；桌面端右侧折叠抽屉，窄屏自适应浮层，支持 `Esc` 快速关闭。

## 0. 视觉与认知原则（Design System 3.0 · ZCode Neutral · 2026-08-30）

> **2026-08-07 全面优化**：标题栏品牌 chip 移除；chrome-y 38→36px、status-y 26→24px（更纤细）；border alpha 降低（0.065→0.055）；card shadow 增加微 hairline（更精致浮起感）；hover 用 surface-hover 半透明（更柔和）；nav-pill active 改用 accent-bg-faint + font-weight 500（更安静）；titlebar-btn 过渡 duration 140→100ms（更跟手）；active scale 0.985→0.992（更微妙）；chrome-sep 高度 14→13px（更纤细）；侧栏 ViewSwitcher 行去 border-b 改用留白；Landing 移除 workflow 教育 chips + 底部文案精简；状态栏移除路径常驻按钮（workspace switcher tooltip 已承担）。

| 原则 | 落地 |
|------|------|
| **品牌对齐** | 实心主 CTA = **单色 ink**（`.v4-titlebar-btn-primary` / `bg-primary`，light 近黑 · dark 近白）；focus / 链接 / 选中 / accent wash = **sky**；**记一下** = 普通 chrome 按钮 + 捕获 teal / 渐变图标与文字（禁止 `.v4-titlebar-btn-capture` 实心）；AI 按钮 = deep→mid→aqua 轴；**禁止** indigo/purple 渐变 |
| **安静 chrome** | 标题栏 / 状态栏 solid `app-chrome` + `border-subtle-dim`；侧栏与 AI 轨同色；**禁止**工作区主壳营销渐变；渐变仅 logo / boot 弱光晕 / Landing 品牌时刻；**标题栏扁平**（纯色 + 单 hairline，无渐变/高光叠层）；**品牌字标不进标题栏**（窗口/任务栏已标识，仅留 logo chip） |
| **Surface 阶梯** | light：`app-chrome`/`sidebar` `#f0f0f0` → `background` `#f7f7f7` → `surface` `#fdfdfd` → **`surface-elevated` `#ffffff`**（禁止同色塌陷；elevated 弹层必须叠 `--shadow-float` / hairline）；dark（ZCode 阶梯）：`sidebar` `#0e0e0e` → `chrome` `#161616` → `background` `#171717` → `surface` `#1d1d1d` → **`surface-elevated` `#262626`**。侧栏是**最深平面**（`.v4-sidebar-rail` 用 `--color-sidebar`）。Feed 卡用 **`--shadow-card`**（弱于 overlay） |
| **低视觉负担** | 选中/hover 用浅 brand wash（`accent-bg-subtle` / `surface-selected`）；每区一个实心 CTA；边框优先 `border-subtle-dim`（light `rgba(23,23,23,0.06)` · dark `rgba(255,255,255,0.06)`；`border-subtle` = fg @ 10%，ZCode 同源）；避免多重 box-shadow + 边框叠厚；**侧栏树隐藏 `.md` 后缀**（`stripMdExt`）；**PARA 编号弱化**（`renderCategoryLabel`：`00-` 用 `text-quaternary/70`）；**卡片优先 bg + shadow 而非 border**（`--shadow-card` token）；**今日卡片 accent ring**（`ring-1 ring-inset ring-accent-color/15`） |
| **弹层与对比度** | `.v4-overlay-sheet` / Dialog 用 `surface-elevated` + `border-subtle`；**工作台 OverlayHost**（设置 / 捕获 / ⌘K / 搜索 / plugin-app）**门户到 `document.body`**、`z-modal`、`isolate`、`v4-no-drag`；Confirm/Prompt/Error 门户到 body、`z-dialog`(130)。打开时 `acquireOverlayLayer` 盖 `html[data-overlay-open]` 并 inert `#workbench-root`。**列表日头**（`data-stream-day-toggle` sticky）在该 attr 下必须 `position: static`——Electron 会把 sticky+z-index 合成到任何 `position:fixed` 对话框之上（卡片模式无 sticky，故正常）。`.v4-main-canvas` `isolation: isolate` 约束 sticky 合成层。**浮动弹窗**（`TodoPopover` / `SuggestPopover` / `TaskPanel`）采用 **毛玻璃质感**（`backdrop-blur-[var(--blur-glass)] backdrop-saturate-150` + `bg-surface-elevated/90` + `border-border-subtle` + `shadow-[var(--shadow-elevated-hairline)]`）；**交互一致**：点击外部 + 外部滚动 + Esc 关闭（内部列表滚动不关）；文本对比度达 WCAG AA 4.5:1+ (dark Primary `#e5e5e5` · Secondary `#c9c9c9` · Tertiary `#a1a1a1` · Quaternary `#8c8c8c`) |
| **玻璃面边界** | 暗色 `.v4-menu-surface` 内置 glass+hairline（Dropdown/ContextMenu）；主壳 / 侧栏 / 编辑画布保持 solid |
| **一条主路径** | 状态栏常驻 **动态（默认）** · Inbox · 交付；**记一下**在左栏 Sidebar 主 header；搜索/AI 可达；深度动作放 ⌘K / 二级；右侧工具 **图标 XOR「更多」**（禁止同动作双入口） |
| **控件分层** | **一级**常显 · **二级**折叠 · **三级**「更多」/ Tooltip / `/slash`（见 §0.1） |
| **CTA 权重** | 每区域 **一个** `Button variant=default`（主操作）；取消/复制用 outline/secondary；关闭 X 用 ghost。**捕获**：Sidebar 主 header「记一下」普通按钮 + 强调色图标/文字（禁止 `v4-titlebar-btn-capture` 实心）；**列表不再重复捕获**；空态才用 **outline**「打开记一下」作恢复 CTA；动态页实心仅为「记下」（`composeSubmit`），composer 眉题禁止复用「记一下」 |
| **统一 chip 语言** | `.v4-chip` / `.v4-segmented` / `.v4-composer` / `CaptureModeBar` / FilterChip |
| **列表 / 下拉** | 门户 `DropdownMenu`/`MenuSelect` / ContextMenu 共用 `.v4-menu-surface`；**先 hidden 测量再显示**（无打开闪跳）；**滚动即关**；画布菜单在 `html[data-overlay-open]` 时关闭；`z-menu(110)` > tooltip(100) > 工作台 overlay `z-modal`(80)。**视口定位单实现** `lib/dropdown-position.ts`：`computeDropdownPosition`（表单/下拉，贴 trigger、上下 flip、边距 clamp）+ `placeContextMenu`（右键，近边翻转）；侧栏页脚等贴边 trigger 可 `preferPlacement: "top"` |
| **空态** | `EmptyState`：图标芯片 + 一句原因 + **一个主 CTA**（侧栏 compact 同构）；时间线/标签空态须有下一步 |
| **侧栏树** | 图标 `tree-node-icons` · 右键 `tree-node-context-menu` · 展开/排序/筛选 + **手动刷新** `tree-toolbar`（`data-sidebar-refresh` 仍在 toolbar 组件上，视觉上与 ViewSwitcher **同一行**——主 header 承载目的地，次级 chrome `data-sidebar-secondary-header` 只留视图切换与树工具；目录树本身不再另起工具行）· 路径 `lib/tree-path`；**文件名隐藏 `.md` 后缀**（`stripMdExt`）；**PARA 编号弱化渲染**（`renderCategoryLabel`：`00-` 前缀用 `text-text-quaternary/70`）。**感知**：`lib/tree-listing-change` 区分 listing（inbox/add/unlink/ingest-done）与 topic 内 content-only；空 inbox 写入后重建并展开，不依赖重启 |
| **少硬分割线** | 编辑器常驻 ≤2 条 full-width 分割（工具栏 + 可选属性）；避免斑马纹；**Recent tab strip 无底边框**（`.v4-editor-recents` transparent + `shadow-divider-bottom`）；**标题栏 cluster 透明**（`.v4-titlebar-cluster` 无背景无 inset）；**搜索为侧栏图标按钮**（`.v4-search-trigger`，纯按钮无输入框，⌘K）；**侧栏主 header**（`data-sidebar-header`：PrimaryNav → Profile → 搜索 → 记一下）；**次级 header**（`data-sidebar-secondary-header`：ViewSwitcher 与树工具一行） |
| **图标按钮三档** | `.v4-icon-btn` 基类 + 尺寸档：**chrome 32**（TitleBar / Sidebar header / AI 列 header）· **tool 26**（编辑器格式条）· **micro 24**（树工具）。hover 一律 `--color-surface-hover` 铺满**完整热区**；**禁止** chrome 按钮写 `min-width:0`（记一下曾因此 hover 盒塌成图标本体）。纯图标 chrome 保持 32×32；带文案的 chrome 动作用 `gap` + padding 自然撑开 |
| **工作区页脚** | 左：标识（文件夹图标 · 名称 · 上拉）打开菜单；右：**主题循环** + **设置** 两颗 chrome 钮同排（高频动作不进菜单）。菜单分区：名称+复制路径 → 最近工作区 → 打开/关闭 → 专注/工具/帮助 → 语言。禁止把主题三格簇再塞回菜单 |
| **长时阅读** | UI ≥12px；正文默认 16px / 1.7；列宽 `--content-max-width-prose`；专注模式 ⌘⌥F；边框 alpha 足以勾勒结构、避免糊成一片 |
| **动效克制** | `duration-fast` 140ms · `duration-enter` 160ms；列表 stagger ≤8；`prefers-reduced-motion` 全关 |
| **性能** | `content-visibility` 列表、panel `contain`、AI 面板 lazy、流式滚动尊重用户上滑 |
| **响应式 chrome** | 操作按钮按宽度 **铺开 ↔ ⋯ 溢出**（`ChromeOverflowActions`）；TitleBar 右轨 ResizeObserver 互斥；主锚文案按窗口宽度（≥960）显示，窄屏 **tooltip + aria-label 必在**；编辑器右侧发布/AI/专注同轨溢出；禁止同动作双入口 |
| **StatusBar 可交互** | 工作区正常：绿点 + **完整工作区路径**（`data-status-workspace-path`，tooltip 含 engine 路径）；异常才出错误文字。**不含 PrimaryNav**（主锚在侧栏主 header；收起时 TitleBar 紧凑图标）。**AI 就绪 pill（唯一主控件）**：离线->设置 · 就绪->toggle AI 面板；流式时 pill 显示会话态；**命名 busy 单路径**（`deriveStatusBarBusy`：apply > tasks > todo > suggest > **inline** 最多一颗命名 chip；todo/suggest/inline/apply 独占时 AI pill 不显示「工作中」）；**进度动效**：每个 busy chip 附带 `v4-ai-progress-dot` 脉动指示器；tooltip 含预期时长。**文件 chip 仅 file 选择时显示**（点击 reveal）。**建议计数在状态栏**（count>0 时 `showSuggestCountChip`；生成中走 busy chip；确认写入走 apply chip） |
| **TitleBar 右轨分层** | **L1** 视图注入动作（`data-titlebar-actions-slot`）+ AI 轨开关（`.v4-titlebar-btn-ai`）。记一下不在 TitleBar（左栏 Sidebar 主 header）。建议 / 清单 / 应用在 AI 工作区 pane；主题 / 语言 / 设置在 WorkspaceSwitcher。`data-chrome-tier`；**badge 纪律：仅在需要行动时出现**——Inbox（分诊队列）+ 建议计数（状态栏 count>0）保留；交付计数（库存非行动）与清单常驻数字点（恒非零）已移除 |
| **建议入口降噪** | 建议计数**恰好一处可见入口**：状态栏计数 chip（count>0 才出现）+ AI 工作区建议 tab；专注模式浮动 `SuggestPopover`；画布顶 strip 已删。禁止 strip + 轨 chip + 状态栏 三处等权 |
| **编辑器默认 chrome** | 格式工具条 **默认展开**（`showFormat=true`，可收起）；**属性行默认收起**；**Tab 条仅 ≥2 文件时出现**；编辑/预览纯图标；Save clean 勾点；常驻 ≤2 条 full-width 分割 |
| **Todo idle** | `TodoPopover` 维护按钮 idle = ghost Sparkles；**仅 maintaining 时** `.v4-ai-chip-gradient` |
| **应用 pane** | AI 工作区 **应用** pane（`AppsLaunchList`）：列表行（accent 图标 chip + 名称 + 一句描述）+「管理应用…」；候选 = 已启用首方（settingsKey 连接器 · launchable mini-app · builtin 管道 ingest）+ 活跃外部插件；**打开时实时拉 settings + 订阅 `plugins:settings-changed`**；未配置连接器标「待配置」pill；打开方式由 `resolveLaunchableOpenTarget` 决定；无写死插件 id（就绪判定集中在 `lib/apps-menu.pluginReadiness`）。⌘K「打开应用」经 Shell 调用 `openAiWorkspace("apps")` |
| **设置 / 弹层** | `SettingsDialog` 用 elevated ladder + quiet nav chrome（`.v4-settings-dialog` / `.v4-settings-nav`）；sheet `role=dialog` `aria-modal`；`SettingsSection` 用 `shadow-card` 卡片；Command/Search palette header 走 elevated 混色；OverlayHost 见「弹层与对比度」 |
| **连接器 Hub** | `ConnectorHubHeader` 与 `PageHeader` 同级标题（`text-xl font-semibold`）；actions 区禁止 solid「记一下」捕获（outline 打开捕获） |
| **FilterChip** | 高度 22px chip 语言（`data-filter-chip`）；禁止实心按钮高度 |
| **AI 建议生命周期** | `autoPrepare` 关：不调 kernel 生成，仍拉 pending writes。开：冷启动/软刷新走 `decideSuggestRefresh`（4s 软节流；force 清 session cache）。**活动指纹** 持久化在 `.topmind/suggest-fingerprints.json`（系统平面）——活动窗口未变则**跨进程跳过 AI 重跑**，避免每次启动 thrash。Session merge（`mergeSuggestRefreshItems`）防中途闪没。**个人清单** `memory/todo.md` ≠ 建议。确认后写入仍经 writeback。 |
| **动态密度** | 周期 chip ≤6、22px；日分组弱标签；卡内操作 hover 显；composer `shadow-card` 轻量（**无 label/hint meta 行**——placeholder 承担引导，计数在 PageHeader subtitle；卡片去 border 纯阴影）；主路径仍 写下→润色(ghost)→**记下**；**日分组卡无边框**（`bg-surface` + `shadow-[0_1px_3px_rgba(0,0,0,0.04)]`）；**今日 accent ring**（`ring-1 ring-inset ring-accent-color/15`）；**列表日头** sticky + 不透明 `--color-background`、禁止 backdrop-filter；**卡片日头 static**。`html[data-overlay-open]` 时列表日头 flatten 为 static，避免盖住设置 / ConfirmDialog |
| **侧栏 pin** | 本周周期 pin 可截断，**仅在 timeline/tags/kanban 视图渲染**（stream 视图由 StreamView 自带周期头承担；category 树内已有周期节点，树头不再放 pin——窄栏截断只剩噪声 2026-08-30）；**我的情况在 Sidebar 主 header Profile**（全局可达 · 图标化 + aria-label；⌘K「转到 · 我的情况」在侧栏收起后仍可达）；ViewSwitcher 已有 icon-only / 更多 |

### 0.1 控件分层（强制）

| 层级 | 定义 | 编辑器 | AI 面板 | TitleBar |
|------|------|--------|---------|----------|
| **一级** | 打开即见、完成主任务 | 标题 · 编辑/预览 · 保存态 · 专注 | 会话 · 消息 · 输入 · 发送 | 视图切换 · **AI 开关** |
| **二级** | 点一次展开 | **格式工具（默认展开，可收起）** · **阅读 Aa** · 属性条 | 模型 · 技能 · 写回 | 注入动作 |
| **三级** | 「更多」或 ⌘K | 发布 · 记忆 · 挂载 AI · 发 X · 文件信息 · 全部设置 | slash / 会话管理 | 主题 · 工作区切换 · 设置（WorkspaceSwitcher / ⌘,） |

### 0.2 字号与可读性（强制）

| 角色 | Token | 尺寸 | 用途 |
|------|-------|------|------|
| kbd glyph / 极小徽章 | `text-5xs` / `text-4xs` | 10px / 11px | 快捷键单字符、绝对微缩标记 |
| 快捷键 Chip / 计数角标 | `text-3xs` / `text-4xs` | **12px** / **11px** | Kbd Badge、`CountBadge` 数字、微缩行内状态指示 |
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

**禁止**：新增 &lt;12px 的 UI 主文案（UI 下限 = `text-2xs` / `text-3xs` = 12px）；9px 路径/状态已淘汰。`text-4xs`(11px) 仅限计数角标数字与 kbd glyph，`text-5xs`(10px) 仅限 kbd glyph——两者都不是承载句子的档位。3.0 起字号对齐 ZCode 整数阶（13/14/16）。

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

- **收进来**: ⌘⇧N 全局捕获，⌘N 窗口内捕获；默认**本周动态**；不确定进 Inbox
- **继续做**: Tiptap 深度编辑；动态主表面 / 最近专题
- **交付/沉淀**: 88-交付；建议确认后写入记忆（目标）
- **找回/调整**: 搜索 · 99-归档恢复 · 我的情况

## 2. 布局

### 三栏响应式 Shell

**产品目标 IA（唯一 present-tense 目标 · Reset B · §0.0）** — 新功能与改版只朝此收敛：

```
┌──────────┬───────────────────────────────────┬───────────────┐
│ 左栏贯通  │  中栏贯通                           │  右栏贯通      │
│ Profile  │  Toggle · 视图菜单 · 面包屑 · 动作   │  对话·建议     │
│ 搜索·记一下│  画布身份 + 注入动作 + AI 开关      │  清单·应用     │
│ 次级：模式 │  内容画布（默认本周动态 / 编辑器）    │  Composer     │
│ 底：工作区│                                     │               │
├──────────┴───────────────────────────────────┴───────────────┤
│ 状态栏 · 路径 · 动态 / Inbox / 交付 · 引擎 · AI                 │
└──────────────────────────────────────────────────────────────┘
```

三列各自顶栏对齐（`.v4-column-chrome` · `--density-chrome-y` 44px · 控件 32px），**没有**横跨三列的产品命令条。**操作系统外壳不占产品 IA**（见下方 §窗口外壳）。

- **窗口外壳（OS chrome）** — 唯一真源 `electron/lib/window-shell.mjs`  

  | 平台 | 边框 | 标题栏 | 窗口内菜单栏 |
  |---|---|---|---|
  | macOS | `hiddenInset`（无边框内嵌） | 红绿灯在**我们自己**的 44px **产品**顶栏内（左侧） | 无（系统菜单栏） |
  | Windows | 原生边框 + `titleBarOverlay` | **全宽 OS 壳层条**（`OsChromeStrip`，在三栏之上）：图标 · 名称 · 菜单条；最小化/最大化/关闭画在该条右端 | 无原生栏；OS 条弹出**原生**子菜单 |
  | Linux | 原生边框 | DE 标题栏 | **原生菜单栏（常显）** |
  | 浮窗（mac / Win） | mac `hiddenInset` · Win**无边框** | **应用自绘 32px 头行**：标题 + 显式 ✕ + 拖动区（mac 红绿灯落在这行内） | 无（`autoHideMenuBar`） |
  | 浮窗（Linux） | 原生边框 | DE 标题栏 | 无（`autoHideMenuBar`） |

  - **为什么 Windows 用独立 OS 壳层条（而不是融进中栏 TitleBar）**：Windows 把 HMENU 画在标题栏**下方**的独立一条，Electron 没有任何 API 能把「原生菜单栏 + 原生标题栏」并成**一条原生**行。于是可选只有：① 原生两行（菜单 + 标题栏，约 50px OS chrome）；② `titleBarStyle: 'hidden'` + `titleBarOverlay`，由应用自绘**一行**，系统只负责右端 min/max/close。我们选 ② 的「一行」形态，但该行是**横跨三栏之上**的 `OsChromeStrip`（`data-os-chrome`），**不是**中栏产品 header 的一部分——v4.2.0 把菜单条塞进中栏 TitleBar 会把 OS 外壳混进产品 IA，已废弃。菜单内容仍是原生 `Menu.popup`（`menu-spec.mjs` 只定义一次）。Linux 不动：装饰属于 DE，能否 overlay 取决于 DE 与 X11/Wayland。
  - **让位垫必须量出来，不能猜**：`src/lib/window-controls.ts` 读 `navigator.windowControlsOverlay.getTitlebarAreaRect()`（`geometrychange` 时重算），发布 `--wc-inset-right/-left`；消费它的规则是**复合选择器** `html[data-wc-inset] [data-os-chrome]`——只让位 OS 条，**不**附着到任何 `[data-column-chrome]` 产品表头。
  - 因此 `.v4-column-chrome` 永远用 `padding-left/right` 长写（禁止 `padding` 简写——简写会重置 `padding-right`，而该规则位于样式表末尾，等权重下按源码顺序取胜，正是当年让位垫静默失效的原因）。
  - **浮窗（快速捕获 / 记一下）自绘头行，不要第二条标题栏**：480px 便签本来就是自带「标题 + ✕ + `v4-drag`」的一行，再叠一条原生标题栏就是把身份信息（`topmind` / 快速捕获）说两遍——Windows 上尤其明显，因为应用菜单栏是全局的，会横穿便签。故 mac `hiddenInset`（红绿灯并进这行）、Windows `frame: false`（连 caption 按钮也不要：`skipTaskbar` 便签上的最小化会把它藏得找不回来；thickFrame 仍留着缩放边与投影）、Linux 保留 DE 装饰（与主窗同理）。三平台一律 `autoHideMenuBar: true`。
- **原生菜单（快捷操作入口）** — `electron/lib/menu-spec.mjs`（纯模板）+ `app-menu.mjs`（Electron 接线）  
  - 菜单 = **第二个前端**，所以菜单项不自带行为：点菜单项发出的 id 与键盘 `src/lib/shortcuts.ts` 的 id 同源，渲染侧 `src/lib/native-menu.ts` 统一分发（`runWorkbenchAction`）。  
  - 结构（三平台一致）：**文件**（记一下 / 全局记一下 / 搜索 / 命令面板 / 整理本周；非 mac 另有 设置… · 退出）、**编辑**、**工作区**（打开 · 新建 · 切换 · 最近打开 · 在文件管理器中显示 · 复制路径 · 重新载入 · 关闭）、**显示**（动态/Inbox/交付/归档 · 侧栏视图 · AI pane · 侧栏与 AI 列开关 · 专注模式 · 后退/前进/对照分栏/任务面板/待办 · 外观 · 语言 · 重载/缩放/全屏）、**窗口**、**帮助**；mac 另加 App 菜单。  
  - 勾选态：设置侧字段（工作区 / 最近 / 主题 / 语言）由主进程从 app-settings 推；UI 态（专注 / 侧栏 / AI pane / 当前视图）由渲染侧推（`system.updateMenuState`），主进程合并后重建。  
  - **键盘归属**：非 mac 的菜单项用 `registerAccelerator: false` —— 只显示不注册，键盘仍归渲染侧，否则菜单与页面同时触发、开关键自相抵消。mac 菜单本就抢在 web 内容之前处理按键，只触发一次。  
  - **菜单语言 = 应用语言**：每个 `role` 项都必须显式给 `label`（`t("menu.*")`）。Electron 的 role 标签跟随**系统**语言，而语言是本应用内的开关——不写 label 会让「中文系统 + 应用切英文」的菜单栏恰好混进一块中文（mac 的 App 菜单整条都是 role，最容易漏）。有守护测试兜底。  
  - **关于**不走 `role: "about"`：那会弹 Electron 原生面板，而其他平台统一进 设置 → 关于与更新。一个产品面、一个门，原生面板只是该 tab 已有的版本 / 更新检查的劣化副本（mac App 菜单同此）。  
  - **全局记一下**（⌘⇧N）的 chord 归 `main.mjs` 的 `globalShortcut`，菜单项只是镜像：非 mac 显示但不注册；**mac 连 accelerator 都不给**——Electron 只在 Linux/Windows 认 `registerAccelerator`，mac 上「显示」必伴随「注册」，等于给同一个动作再塞一个 owner。取舍是 mac 菜单不显示该 chord，快捷键仍在应用内文案里说明（`window.hideMacHint` / 托盘提示）。chord 与 main.mjs 的一致性由测试锁定。  
  - 菜单文案在主进程 i18n（`electron/lib/electron-i18n.mjs`），语言切换后重建。
  - **`appSettings` 只有一个写方**：`main.mjs` 的 `setAppSettings()`。开机、切换/新建/关闭工作区、窗口尺寸持久化、UI 缩放、裁剪令牌、关闭行为选择、最近列表修剪——七条路径全都经过它。原因：菜单的工作区/最近/主题/语言与 OS 标题栏都是从 app-settings 派生的，绕过它就等于**菜单继续展示刚刚离开的那个工作区**（关闭工作区仍可点、最近打开仍是旧列表、标题栏仍是旧名字）。`setAppSettings` 先 diff 再决定是否重建（resize 风暴不会重建菜单）。有守护测试锁「唯一写方」。
  - **Windows 没有原生菜单栏**：菜单由**全宽 OS 壳层条**承载（`OsChromeStrip` → `AppMenuBar`），它只认 id——主进程 `system.menuTopLevel` 给顶层条目（标签已按**应用语言**本地化），`system.menuPopup` 按 id 弹**真正的原生子菜单**。勾选态、子菜单、禁用态、快捷键全由 Electron 渲染，渲染侧不复制任何一条菜单结构，所以新增一个顶层菜单不需要动渲染侧。原生菜单本身仍安装着（只是栏隐藏），它拥有的 F11 / Ctrl+R / Ctrl+Z 等 role 快捷键照常生效，Alt 也仍能唤出原生栏作为纯键盘回退。**禁止**把该条塞回中栏 TitleBar / 任一产品列 header。
  - **`role` 的隐含 chord 必须一起查**：role 没有「只显示不注册」模式，它的默认 chord 会真注册。本轮据此抓出 `toggleDevTools`（Windows/Linux 上 Ctrl+Shift+I）与渲染侧 Inbox（⌘⇧I）撞键——一次按键同时开 Inbox 和 DevTools，开发构建里必现。改用显式 `F12`。守护测试现在把「role 的生效 chord」与 `WORKBENCH_SHORTCUTS` 交叉比对（此前只比菜单内部，这正是漏掉它的原因）。
  - **不设** `role: "close"`：它会占用 ⌘W/Ctrl+W，等于悄悄夺走「关闭标签页」（应用是多标签的）；缩放的 `resetZoom/zoomIn/zoomOut` role 同理（自带 ⌘0/⌘±，会与渲染侧撞成「按一次缩两格」），故走渲染侧 `view.zoom.*` 命令。

- **中栏顶栏**（`data-canvas-chrome`）  
  - 侧栏开关 + 前进/后退 + 面包屑（工作区切换器在**左栏底部**）  
  - 右侧：当前视图注入动作 + AI 列开关  
  - **记一下**在左栏 Sidebar 主 header（唯一主捕获）；建议 / 清单 / 应用在右列 AI 工作区 pane（状态栏计数开门）  
  - **禁止**再增加等权主锚点；「工作台」三元组不再是产品目标  
- **侧栏默认**：本周动态 / 周期本时间线；专题树 · 记忆 · 我的情况 · 归档为二级；标签/看板为高级（折叠或 ⌘K）；**底栏工作区切换器**（Outlook / ZCode）；可选插件 / mini-app 在 **AI 工作区 · 应用** pane  
- **主画布默认**：`StreamDetailView` — 当前周期本条目卡片 + **内联记下** + reconcile / 周期切换（**无**建议数角标、无旧仪表盘）；未知 selection kind → 同视图
- **AI 工作区**（右列，与内容工作区**对等**）：pane **对话 / 建议 / 清单 / 应用**（`AiWorkspace`）；Composer **钉在列底**（切 pane 仍可对话）；不是「聊天侧栏」  
- **建议确认面**：AI 工作区 **建议** pane（状态栏计数 / `openSuggestSurface` 打开该 pane）；专注模式仍用浮动 `SuggestPopover`  
- **看板可写 / Inbox 批处理 / 知识加工 / tokens / 图标** 等能力保留（富工作台）  
- **快捷键**：⌘⇧S → 动态 · ⌘⇧T → 待办清单（AI 工作区 清单 pane） · ⌘⇧I Inbox · ⌘⇧O 交付 · ⌘⇧A 归档 · ⌘N 记一下  
- **记下 / 记一下**：Stream 内联「记下」（`ingest` stream）· 侧栏「记一下」完整捕获；条目 **增补**（`appendStreamEntry` · 同文件）  
- **整理**：`runOrganizeWeek` = reconcile + **`runActivityOps`**（suggest + memory/topic → AI 工作区建议 pane 确认；不静默高影响写）  
- **StreamDetailView**：宽轨周期本 — 内联 composer · **按日分组 + 按条软拆 + 日内 cohesion**（`stream-entry-present.ts`：moment 收集后续 append → 嵌套展示；命名 `##` 非日期段 → **文章卡** title+summary+跳转；短内容全展示 · 长内容才出现展开/折叠按钮 `streamEntryNeedsExpand`）· 真实 MD 预览（列表/任务/代码/续）· 页头整理/刷新（不重复 记一下 / 建议 / 清单）· 周期 chip · **交互式条目增补（Interactive Append）**：支持富元数据（时间戳、标签、状态）与扩展 UI 控件，精准写回当前周期对应条目（建议入口在状态栏计数，不嵌 Stream 列表）  

- **无当前周期文件时**：回退 `listStreamPeriods` 最新一本，避免空白主表面  

- **设置 ↔ 壳同步**：`settings.ui`（含 `aiPanelOpen` / 侧栏视图 / 宽度）经 `lib/ui-settings-sync` 即时写入 view-store；Shell 收到 `ui:settings-applied` 后 **跳过一轮** 布局防抖写盘，避免盖掉设置  
- **UI 默认**：无效 `sidebarView` normalize 为 **`stream`**（产品默认，非 category）

- **窗体 / 托盘 / Landing / 状态栏 / Overlay** 与实现一致；PrimaryNav = **动态 · Inbox · 交付**（侧栏主 header；侧栏收起时 TitleBar 紧凑图标；搜索非 PrimaryNav：⌘K 命令面板 · ⌘P 笔记全文）

### 2.1 中栏顶栏（薄 chrome · 非横跨三列的产品 header）

能力单家见 **§0.0.4**。本条是那张表的中栏落地，不是第二条产品栏。

**左侧**:
- 侧栏开关 · 前进/后退（工作区切换器在左栏底部，⌘⇧W 仍打开）

**侧栏主 header** — `PrimaryNav variant="sidebar"`（`data-sidebar-primary-nav` · 与 Profile/搜索/记一下同行）:
- **动态**（默认，打开工作区落点）· **Inbox** · **交付**
- 归档不在主锚（⌘⇧A / 侧栏 / 命令面板）
- 搜索：⌘K 命令面板 · ⌘P 笔记全文（均非 PrimaryNav）
- 侧栏收起时 **TitleBar 紧凑图标**（`PrimaryNav variant="compact"`，状态栏不承载导航）

**右侧**:
- 视图注入动作 + AI 列开关  
- 记一下在左栏；建议 / 清单 / 应用在右列 AI 工作区 pane；设置 / 主题在 WorkspaceSwitcher  
- badge 仅在需要行动时出现（Inbox · 建议计数）

### 2.2 侧栏树

- **ViewSwitcher**：侧栏顶部**单一下拉**（触发器显示当前模式文案，如「目录 ▾」；默认 **目录/category**；菜单含 目录 / 流式 / 时间 / 标签 / 看板 + 一句 hint）
  - 这是**侧栏视图**，不是主画布模式；主画布信息流的列表/卡片开关仍在流上方（`data-feed-chrome`）
  - 与 ViewSwitcher **不在同一行**（2026-09）：PrimaryNav 升到主 header；次级 header 只留 ViewSwitcher + 树工具
- **PrimaryNav**：侧栏**单一下拉**（动态 / Inbox / 交付）；侧栏收起时 TitleBar 紧凑图标
- **自动刷新**：侧栏订阅 `workspace:file-changed`。目录树用 `classifyTreeFileChange`：inbox / 交付 / 归档 / 类别根 / add·unlink / ingest 完成 = listing 重建（空 inbox 有文件则展开）；专题内部保存 = 定向刷新、不整树闪。Inbox 主列表静默重载（无全页空态闪）。手动刷新在树工具条（展开/折叠/排序旁），不是标题栏第二按钮。StreamView 450ms 防抖。
- **渐进展开**：每个展开节点默认只渲染 **8** 个子项，其余收成「还有 N 项…」；再点再翻 8 个。避免长目录一展开就刷屏。
- **DataSource 区段**：每个注册的 DataSource 渲染为可折叠区段，带 Database 眉头图标 + 半粗体大写标签。
- **加载状态**：共享 save-dot 旋转动画；错误/空状态使用规范侧栏提示样式。
- **TreeView**：递归渲染，按深度缩进。首次渲染时自动展开 group/category 节点。
- **节点图标**（RemixIcon）：InboxUnarchive（00-Inbox 区段）、Stack（88-交付）、InboxArchive（99-归档）、Brain（memory 记忆区段）、Folder/FolderOpen（类别/专题）、FileText（文件）。
- **行交互**：`rounded-md hover:bg-surface-muted`（空闲）、`bg-accent-bg-subtle text-accent-color`（活跃）。箭头随展开状态旋转。
- **稳定尾部插槽（Trailing Slot）**：操作按钮、文件计数、加载/拖放指示器均在 `ml-auto flex h-6` 容器中常驻定位，**无 layout shift**（不再 `hidden → inline-flex` 跳动）。操作按钮 `h-6 w-6`（24px 触控目标）+ `opacity-0 pointer-events-none` 空闲 → `group-hover:opacity-100 / isActive: opacity-100 / [@media(hover:none)]:opacity-100` 渐变可见。专题文件计数 `text-3xs tabular-nums` 在 hover/active 时 `opacity-0` 让位给操作按钮。
- **拖放目标**：`.v4-drop-target` **idle 无描边/无底色**；仅 `.v4-drop-target-active`（isOver）显示 wash；DragOverlay elevated hairline。**冲突处理**：专题下同名 → 自动副本名。
- **右键菜单**：右键任意节点显示上下文操作（新建笔记/专题、重命名、删除、发布）。
- **EditorOutlinePanel**：文件编辑区可展开的 Markdown 大纲导航面板，实时提取标题层级 → 点击定位。

### 2.3 编辑区

- **ViewSlot 解析**：`registry.resolveView(sel)` 返回第一个匹配槽位（order 最低）。
- **内置视图**：StreamDetailView（默认动态）、CategoryView、TopicOverviewView、FileEditorView、InboxView、OutputsView、ArchiveView。
- **连接器中心**：`Selection.kind=connector` + `id=weread|x` → 阅读/X 轻中心页（状态 · 同步 · 选书/预览 · 统计缓存）；侧栏仅一行摘要，设置只做凭据与偏好。
- **兜底**：无 ViewSlot 匹配时显示共享 EmptyState（下一步 CTA：**回到动态** / 记一下）。
- **动态主表面（Done）**：打开即 `StreamDetailView`（本周/当前周期本）。独立 HomeView 仪表盘已删除；「建议」在状态栏计数 → AI 工作区建议 pane；主 CTA「记一下」在左栏 Sidebar 主 header。
- **CategoryView**：类别头部 + 专题列表 + 散记列表，支持新建专题/笔记快捷操作。
- **TopicOverviewView**：专题头部 + 笔记列表（含修改时间/大小）。
- **文件标签条**（`EditorRecentBar`）：**条件式**——`fileTabs.length ≤ 1` **不渲染**（TitleBar 面包屑即身份；页签动作走标题右键 / ⌘W）；`≥2` 显示 slim 条（pin/close/中键关/拖拽重排/右键菜单）；溢出时左右 **edge fade**；激活 tab 滚入视野；右键 **在右侧打开对照**（分屏）。  
- **编辑区对照分屏**（session-only）：`splitSecondaryPath` 在主 selection 旁开第二文件（可编辑）；拖拽中缝调比例；关闭/对调；关 tab 时自动清分屏。**不是**双 history / 双 selection 状态机。主槽与分屏次槽共用 `isMarkdownNotePath`：`.md` → `FileEditorView`，其它 → `FilePreviewView`（禁止第二套 `fileExt`）。  

- **FileEditorView**：Tiptap + ⌘S；chrome 拆 `file-editor-chrome`（SaveBadge）· `file-editor-format-bar`（模式图标/格式默认展开/更多）· **`EditorReadingMenu`（阅读 Aa）**。**编辑/预览 = 纯图标 segmented**（tooltip 承载语义）；**SaveBadge clean 仅勾点**（dirty/saving/error 才展开文案）。格式轨：粗体/斜体/下划线/删除线/代码/H1–H4/列表/引用/链接/日期时间；与选区 AI 浮条独立。工具栏右侧常驻：`EditorViewChrome`（大纲 · Aa · 专注）+ **属性开关**（`RiPriceTag3Line`；折叠且有 status/priority/due 时显示摘要文案）+ **唯一 ⋯**（显示/隐藏属性 · 文件信息 · 字数）。**FrontmatterBar 属性行默认收起**（`propertiesOpen=false`）；展开才占一行 chips。发布与 AI 等注入 TitleBar，不在轨上双入口。窄宽 `data-compact` 隐藏 `[data-compact-hidden]` 标签。**编辑**用 TipTap；**预览 / 只读**用 `getEditorHtml()` 快照到静态 HTML（`.v4-tiptap`），不是同一实例 `setEditable` 切换。专注模式 ⌘⌥F；`readOnly` 归档只读。典型单文件 chrome：TitleBar 44 + 工具栏 32 ≈ **76px**（无 Tab 条、属性收起）。  
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

> 框架：`pi-agent-core` 循环（LLM 字节仍走 AI SDK v7 providers；`streamText` 仅作模块加载失败回退）。工具映射 WorkspaceService，**不依赖 UTR、不 spawn 第二 Electron 窗口**。  
> **UI 目标**：右列是 **AI 工作区**（对话 / 建议 / 清单 / 应用）；Composer 钉在列底（切 pane 仍可输入）；**发送/续写切到对话 pane**（`revealChatThreadOnSend`）以展示流式正文、工具时间线、思考折叠。模型 / 技能 / 写回为二级控件。
> **概念收敛（3 层）**：**对话**（消息）· **建议**（AI 工作区 pane / `SuggestPopover` 确认面）· **后台**（TaskBadge + TaskPanel）。  
> 勿与同一右列的 **个人清单**（清单 pane / `memory/todo.md`）混称「待办」。

### 3.0 结构（自上而下 · 3 层极简）

| 区 | 样式 / 行为 |
|----|-------------|
| **Header** | `.v4-ai-chrome`：会话名下拉 + RuntimeBadge + TaskBadge + 新建 / 清空 |
| **ContextPills** | pill 胶囊，无额外 Separator |
| **Thread** | `.v4-msg-user` / `.v4-msg-assistant` 气泡；流式 `v4-stream-cursor`；工具结果内联 diff |
| **Composer** | `.v4-composer`：一级工具条（Skill 固定 / 技能展开）→ 可选 skills 行 → slash 提示 → `.v4-composer-field` 输入 |

### 3.1 控件语义

- **RuntimeBadge**：ready → success 点 + 提供商数；offline → 中性 chip **可点进设置 → AI**（与状态栏「AI 离线」一致）。
- **默认简版**：模型折叠在会话行 chip；**技能 chips 默认收起**（点「技能」或 `/slash`）。
- **模型**：`provider/modelId`；按提供商分组。
- **Skill pin**：`<MenuSelect variant="chip">` 固定本会话 skill（`ChatInput`，非原生 `<select>`）；空 = 自动路由。选中态 `border-accent-border-subtle bg-accent-bg-subtle text-accent-color`。**所有设置 / 表单下拉一律经 `Select` → `MenuSelect`**（`select.tsx` 只是 `menu-select` 的 shim），禁止原生 `<select>` 另起一套。
- **Agent / 写回**：操作真源是 `topmind.yaml` `writeback.mode`（`auto | confirm`）。设置面板「保存设置」改契约；AI 面板 **没有** 写回循环徽章。`ai.invoke` 不带 view-store 默认 `auto`。
- **EmptyConversation**：短文案 + 按选区最多 2 条上下文快捷提示；stagger 入场。
- **离线 composer**：单 CTA「前往设置」，无冗长说明。
- **工具时间线**：助手消息内 `toolCalls` 卡片（`data-tool-timeline`；running/done + 路径跳转 + `edit_file` diff 内联）；回合内 status 走 `StreamStatusIndicator`（`data-stream-status`）。
- **TaskBadge**：Header 中的微型 spinner + 数字角标，点击展开 TaskPanel。
- **思考过程**：Kernel `splitAssistantVisible` / `ingestAssistantTextDelta` / `visibleAssistantMessage` 把 `<think>`、思考围栏、未标注 CoT 从正文拆出；`ReasoningBlock` **默认折叠**（`useState(false)` · `data-reasoning-open="false"`）；气泡正文只渲染可见结论，禁止 `split.body || raw` 回退把思考当回复。Stop/interrupt 仍在 Composer。
- **流式状态文案**：`lib/stream-status.ts` 统一 StatusBar / ChatMessage / ChatInput。
- **助手代码块**：语言 pill + 一键复制（对话内；编辑器 Tiptap 代码块保持样式壳）。
- **会话标题**：首条用户消息自动截断命名。
- **AI 按钮视觉体系**：`.v4-ai-btn`（accent tint）/ `.v4-ai-btn-ghost`（text only）/ `.v4-ai-chip-gradient`（紧凑 icon-only）；`ChromeOverflowActions` 支持 `aiAction` 属性自动应用 accent 样式。**禁止**另起紫/靛渐变 AI 按钮——与 §0「禁止 indigo/purple 渐变」冲突，AI 身份由 deep→mid→aqua 轴承担。
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
| `confirm` | 保存前问我 | warning 琥珀 | **仍注册写工具**；写经 Kernel pending → AI 工作区 **建议** pane 接受/拒绝 | 不是「无写工具」只读壳 |

切换入口：设置 → 通用 → 保存设置（镜像进 `topmind.yaml`）。**没有** AI 面板写回循环徽章。Kernel 写闸只读契约，不把 app-settings `writebackMode` 当第二份合同。`ai.invoke` 不发送 view-store 默认值。

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

- **入口**：**状态栏建议计数 chip**（toggle · count>0 时显示）+ AI 工作区建议 tab；专注模式浮动 `SuggestPopover`  
- **打开/关闭**：`toggleSuggestSurface()` → `openAiWorkspace("suggest")` + `ActionStore.panelOpen`；确认列表是 **`SuggestPopover`**（嵌入 AI 工作区建议 pane；专注模式浮动，因 AI 列被藏）；再次点击同一入口关闭  
- **交互一致**（专注模式浮动时与 `TodoPopover` 对齐）：点击外部关闭 · 外部滚动关闭 · Esc 关闭 · 内部列表滚动不关闭  
- **列表**：建议 + 待确认写入混排（`ActionStore`）；pending 可审阅全文；**不是**个人清单  
- **文案**：「建议 / 待确认写入」；禁用「待办」作产品词  
- **会话稳定**：软刷新 / 轮询用 `sessionSuggestionCache` + `mergeSuggestRefreshItems`，kernel 空 regenerate 不闪没未 dismiss 项  
- **autoPrepare 门控**（`ai.autoPrepareSuggestions`，默认开）：关闭时不拉取建议；pending writes 始终拉取  
- **autoMaintainTodos 门控**（`ai.autoMaintainTodos`，默认**关**）：开启后每会话就绪时自动 AI 整理待办；关则仅手动 ✨  

- **禁止**在对话 pane 内再挂第二套完整展开列表

## 4. 覆盖层

### 4.1 记一下（⌘N）

- **默认极简**：落点 chip（**本周动态** / Inbox）+ 正文 + 保存；标题/模式/来源在「更多选项」  
- **默认落点**：动态周期本（`dest.stream`）；用户可改 Inbox  
- 成功后关闭 → 回到 **动态**（或 Inbox）；路径证据走 writeback toast（不强制进 file 编辑器）  
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

| Token | Light 值（dark） | 用途 |
|-------|------------------|------|
| `--color-brand-deep` | `#075985` sky-800 | 渐变深停（logo / Landing） |
| `--color-brand-mid` | `#0ea5e9` sky-500 | 渐变中停；**不作文字色**（白底 2.77:1） |
| `--color-brand-aqua` | `#2fa89a` capture teal | 渐变尾停；**仅限捕获动作**身份 |
| `--color-ink` | `#1a1a1a`（dark `#f2f2f2`） | **实心主 CTA**（`bg-primary`，单色 ink） |
| `--color-accent-color` | `#0369a1` sky-700（dark `#38bdf8` sky-400） | focus / 链接 / 选中 / accent wash |
| `--color-accent-inbox` | `#115e59` teal-800（dark `#4fc2b0`） | Inbox 模式 / capture skill |
| `--color-badge` | `#0369a1`（dark `#38bdf8`） | `CountBadge` 填充（见 §0.0.5） |
| `--color-badge-alert` | `#b45309` amber-700（dark `#fbbf24`） | 高优先建议计数角标 |

**品牌渐变停不是文字色**。`brand-mid` / `brand-aqua` 为渐变与浅底淡彩而选，白底对比度只有 2.77 / 2.83:1；需要「强调色文字」时一律用 `accent-color` / `text-accent` 一档。

**中性色**：纯中性灰（ZCode neutral 阶，零色偏）；light 画布 `#f7f7f7`，dark 画布 `#171717`（neutral-900）、elevated `#262626`（neutral-800）、sidebar `#0e0e0e`；边框 = 前景 @ 10%（ZCode 同源）。想读暖纸可用编辑器 `paper` / `sepia` 纸张色（仅画布，不改全局）。

**Dark**：accent = sky-400（`#38bdf8`）；`text-on-accent` 用深墨保证对比；**禁止**回退 lavender indigo。

**渐变**：`.v4-brand-gradient` / `.v4-brand-gradient-text` / boot 弱光晕 — **仅** Landing / logo 邻域；壳层 rails **禁止**铺满渐变。

### 5.0.1 对比度基线（实测 · 硬约束）

配色纪律的**可执行**形式：`tokens.css` 的 stop 即对比度预算，**透明度修饰符会把它还回去**。下表数字由 `tests/ui-token-compliance.test.mjs` 断言（纯 JS 计算 WCAG 比值，含 alpha 叠加），改 token 必须同步改测试。

**规则**

1. 语义色 token 停止位必须 ≥ **4.5:1**（AA 小字）在**全部**表面阶梯上成立；深色另算（`surface-elevated` 是最苛刻面）。
2. **禁止** `text-{accent-color|success|warning|error|status-*|badge*}/NN`。token 已调好，`/70` 会把它拉回 3.3:1。要更弱的语气请用 `text-text-tertiary` 这类 muted token。
3. 状态色几乎总是坐在**自己的 `-bg` 淡底**上，故基线按「字 @ 自身 9–12% 淡底 @ 最苛刻表面」核算，不能只算白底。
4. 一个设计意图 = 一个 token。**禁止**用透明度表达严重度梯度（用 `text-text-tertiary → text-warning → text-error`）。

**基线表（light · 括号内为 2026-09-14 修改前）**

| 角色 | 停止位 | 白底 `#ffffff` | 画布 `#f7f7f7` | chrome `#f0f0f0` | 自身淡底 @chrome |
|------|--------|----------------|----------------|------------------|------------------|
| accent | `#0369a1` | 5.93 (4.10) | 5.54 (3.82) | 5.21 (3.59) | 4.66 (3.27) |
| accent · inbox | `#115e59` | 7.58 (4.29) | 7.08 (4.01) | 6.65 (3.77) | 5.82 (3.39) |
| success | `#166534` | 7.13 (3.30) | 6.66 (3.08) | 6.26 (2.89) | 5.49 (2.64) |
| warning | `#92400e` | 7.09 (3.00) | 6.62 (2.80) | 6.22 (2.63) | 5.44 (2.42) |
| error | `#b91c1c` | 6.47 (4.51) | 6.04 (4.21) | 5.68 (3.96) | 4.90 (3.49) |
| badge 填充 | `#0369a1` + 白字 | 5.93 | — | — | — |
| badge-alert 填充 | `#b45309` + 白字 | 5.02 | — | — | — |

**基线表（dark）**

| 角色 | 停止位 | chrome `#161616` | 画布 `#171717` | elevated `#262626` | 自身淡底 @elevated |
|------|--------|------------------|----------------|--------------------|--------------------|
| accent | `#38bdf8` | 8.45 | 8.37 | 7.06 | 5.55 |
| success | `#22c55e` | 7.94 | 7.87 | 6.64 | 5.41 |
| warning | `#ff8a30` | 7.70 | 7.62 | 6.44 | 5.24 |
| error | `#ff7b72` | 7.18 | 7.11 | 6.00 | 4.94 (4.27) |
| badge 填充 | `#38bdf8` + `#082f49` | — | — | — | 6.48 |
| badge-alert 填充 | `#fbbf24` + `#451a03` | — | — | — | 8.97 |

> 深色 `error` 由 `#ff5c5c` 提到 `#ff7b72`（2026-09-14）：放在暗表面上没问题，但叠在自身 12% 淡底 + `surface-elevated` 上只剩 4.27:1。**淡底会抬升背景亮度**——这正是这张表按「自身淡底」列核算、而不是只算裸表面的原因。

### 5.1 色彩层级

```
chrome（中性框架）→ background（净白画布）→ surface（工作面板）
→ surface-elevated（弹层 / 菜单 / 对话框）→ surface-inset（凹陷输入）
```

**强制**：light 下 `surface` 与 `surface-elevated` 不得同色塌陷；弹层用 elevated + `shadow-overlay` / `shadow-float`。Accent / 正文 ink **只引用 token 名**，组件禁止硬编码旧 hex；输入框凹陷统一用 `--shadow-input-inset`。Inbox 模式切换为 teal 系 accent。

### 5.2 语义别名（`tailwind-theme.css`）

该文件只把组件**实际在用**的 shadcn 名重导出到 3.0 token。**一个定义了却没人用的别名，正是幽灵引用（`bg-skill-loop` 那一类）的温床**——所以别名集按「今天能解析到」收敛：

| Tailwind 工具类 | 映射到 |
|----------------|--------|
| `bg-background` | 应用背景 |
| `bg-surface` / `bg-surface-muted` / `bg-surface-elevated` | 工作面板 / 弱化面 / 弹层面 |
| `bg-primary` / `text-primary-foreground` | **单色 ink**（`--color-ink` + ink-foreground；hover/active 用 `bg-primary-hover` / `bg-primary-active`） |
| `bg-secondary` / `text-secondary-foreground` | surface-muted / text-primary（等价别名） |
| `bg-accent-bg-subtle` / `bg-accent-bg-faint` / `text-accent-color` | accent 浅 wash / 极浅 wash / accent 文字 |
| `bg-badge` / `text-badge-foreground` | 计数角标填充 / 角标前景（见 §0.0.5） |
| `bg-brand-deep` / `mid` / `aqua` | logo 三停（稀用；**不作文字色**） |
| `text-error` / `text-success` / `text-warning` | status-error / success / warning |
| `bg-status-{success,warning,error}-bg` | 对应状态淡底（配 `text-{...}` 使用；见 §5.0.1 规则 3） |
| `border-border-subtle` / `border-border-subtle-dim` | 常规 / 极细边框 |
| `bg-input` | surface-inset（表单输入） |
| `bg-chrome` | app-chrome（侧栏、标题栏、状态栏） |
| `ring-ring` | accent（focus 环） |

**2026-09-14 删除的零引用别名**（写 `bg-card` / `text-muted-foreground` 之类已不再解析）：`--color-card`、`card-foreground`、`popover-foreground`、`muted`、`muted-foreground`、`foreground`、`destructive`、`destructive-foreground`、`border-semantic`。需要哪个就在**同一次改动里**把别名和真实用法一起加回来。

### 5.3 圆角

ZCode 阶：`--radius-xs: 2px` · `--radius-sm: 4px` · `--radius-md: 6px` · `--radius-lg: 8px` · `--radius-xl: 12px` · `--radius-2xl: 16px`

### 5.4 字体与密度

见 **§0.2**。密度以 `tokens.css` 为准：

| Token | 默认 | 用途 |
|-------|------|------|
| `--density-chrome-y` | 44px | 三列顶栏（2026-09-07: 40→44，与 32px 控件对齐） |
| `--density-chrome-control` | 32px | 顶栏按钮命中高度 |
| `--density-status-y` | 26px | 状态栏 |
| `--density-tree-row` | 30px | 侧栏树行 |
| `--density-editor-toolbar-y` | 32px | 编辑器格式条（工具按钮 26px，小于窗口顶栏） |
| `--content-max-width-prose` | 52rem | 正文列宽（阅读列默认） |
| `--feed-column-max` | 56rem | 信息流/我的情况/Inbox/专题/交付 阅读列——**流体**：填充主画布实际可用宽度（侧栏/AI 面板/分栏感知），数值仅为可读性上限（≈896px，兼顾 CJK/Latin 行长与宽松 UI）。**注意与 `--content-max-width-dashboard` 区分**：后者 72rem，是列表类视图容器上限 |
| `--content-max-width-dashboard` | 72rem | 列表类视图容器上限（同样流体，≤cap） |

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
- **UI 基础组件**（`src/components/ui/`，**以目录为准**）：`Button` · `CountBadge` · `Dialog` · `DropdownMenu` · `context-menu` · `menu-select` · `select`（menu-select 的 shim）· `Input` · `textarea` · `tabs` · `tooltip` · `Splitter` · `PanelToggleIcon` · `workspace-file-menu` · `ErrorBoundary` · `LazyBoundary` · `view`（共享视图原语）。**没有** `Card` / `Separator` / `Badge` 组件——卡面与分隔用 token + 工具类，计数角标用 `CountBadge`
- **共享视图原语**（`view.tsx`）：ViewContainer, PageHeader, SectionHeader, EmptyState, LoadingState, ErrorState, MetaText, FileRow, RowList — **空状态必须用 EmptyState**
- **设置卡片**：`SettingsSection` / `Field` / `SwitchField`（`settings/fields.tsx`）
- **图标**: 仅 `@remixicon/react`（RemixIcon）+ `ICON.*`（nano 10 → xl 30）；填充字形读感偏大已按光学权重调校；面板开合见 `PanelToggleIcon`（Line=关 / Fill=开）
- **排版令牌**：text-5xs(10) → text-4xs(11) → text-3xs(12 UI 下限) → text-2xs(12) → text-xs(13) → text-sm(13) → text-base(14) → text-lg(16) → text-xl(16) → text-2xl(18) → text-3xl(24)
- **v4 壳层工具类**（`src/styles/v4.css`；下表为**当前实际定义**的类，文档提到但代码不存在的已删除）：
  - Chrome：`v4-column-chrome` · `v4-shell-chrome` · `v4-sidebar-rail` · `v4-ai-panel` · `v4-ai-chrome`
  - 导航：`v4-nav-pill` · `v4-cmd-trigger` · `v4-segmented` / `v4-segmented-item` / `v4-segmented-thumb`
  - AI：`v4-composer` · `v4-composer-field` · `v4-chip` · `v4-msg-user` / `v4-msg-assistant` · `v4-stream-cursor`
  - 弹层 / 菜单：`v4-menu-surface` · `v4-overlay-sheet` · `v4-settings-dialog` · `v4-settings-nav`
  - 编辑器 / 列表：`v4-tiptap` · `v4-editor-recents` · `v4-feed-column` · `v4-drop-target` · `v4-list-virtual` · `v4-panel-contain` · `v4-kbd` · `v4-sidebar-scroll` · `v4-focus-ring`
- **z-index 语义体系**（禁止硬编码 `z-[N]`，禁止使用 Tailwind 原生 `z-10`/`z-20`/`z-50` 等数字类）：
  - `z-local`(1) — 局部层叠
  - `z-shell-rail`(10) — Shell 固定栏
  - `z-header`(20) — 标题栏
  - `z-popover`(30) — 浮层/下拉
  - `z-floating`(50) — 浮动元素
  - `z-overlay`(70) — 覆盖层背景 token（保留；工作台 OverlayHost 用 `z-modal`）
  - `z-modal`(80) — OverlayHost / IngestStaging（**portal 到 `document.body`**；必须低于 `z-menu`，设置内下拉才能露出来）
  - `z-notification`(90) — 通知
  - `z-toast`(100) — Toast 消息；画布 tooltip 在 overlay 打开时隐藏（设置内 HelpTip 门户进 sheet）
  - `z-menu`(110) — 菜单/listbox（高于 tooltip；设置内下拉也走这一层）
  - `z-popover-overlay`(120) — 待办/建议弹层（高于打开的菜单；overlay 打开时关闭）
  - `z-dialog`(130) — Confirm / Prompt / Error 全屏 scrim（高于浮动弹层；列表 sticky 仍靠 `data-overlay-open` flatten）
- **焦点环**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`；composer 用 `shadow-focus`
- **滚动条**: 细、半透明（`v4-sidebar-scroll` 类）

## 7. 键盘快捷键

> **本表用 macOS 规范字形书写，不是渲染结果。** 绑定与文案都只声明一次（`⌘⇧I`），显示时一律经 `src/lib/chord.ts` 的 `formatChord()` 落到用户平台：Windows/Linux 读作 `Ctrl+Shift+I`。三个消费点：① 标记里的字面量（`<kbd>`）；② i18next `chord` 后处理器——所有译文里的 `⌘` 都会被改写，所以语言包**只写规范形**，不做平台分支；③ `WORKBENCH_SHORTCUTS[].display` 的文档注释。裸渲染 `display` 等于告诉 Windows 用户按一个他键盘上没有的键。

| 快捷键 | 作用域 | 操作 |
|--------|--------|------|
| ⌘⇧N | 全局（任意应用） | 显示窗口 + 记一下 |
| ⌘N | 窗口内 | 记一下 |
| ⌘⇧W | 窗口内 | 切换工作区（下拉菜单） |
| ⌘⇧L | 窗口内 | 工具与日志（stats · ops journal · 健康 · 清理） |
| ⌘K | 窗口内 | 命令面板 |
| ⌘P | 窗口内 | 全局搜索 |
| ⌘, | 窗口内 | 设置 |
| ⌘[ / ⌘] | 窗口内 | 后退 / 前进（历史） |
| ⌘W | 窗口内 | 关闭当前标签页 |
| ⌘⌥W | 窗口内 | 关闭全部标签页 |
| ⌘S | 编辑器中 | 保存当前文件 |
| ⌘⌥F | 窗口内 | 专注模式开关 |
| ⌘\ | 窗口内 | 对照分栏开关 |
| ⌘0 / ⌘+ / ⌘- | 窗口内（输入中也生效） | 缩放：实际大小 / 放大 / 缩小 |
| ⌃⌘F | 窗口内 | 全屏（菜单「显示 → 全屏」，全屏时该菜单项文案变为「退出全屏」） |
| ⌘1 | 窗口内（非输入框） | 侧栏视图：流式 |
| ⌘2 | 窗口内（非输入框） | 侧栏视图：分类 |
| ⌘3 | 窗口内（非输入框） | 侧栏视图：时间线 |
| ⌘4 | 窗口内（非输入框） | 侧栏视图：标签 |
| ⌘5 | 窗口内（非输入框） | 侧栏视图：看板 |
| ⌘⇧J | 窗口内（非输入框） | 打开/关闭任务面板 |
| ⌘⇧I | 窗口内（非输入框） | 导航到 Inbox |
| ⌘⇧S | 窗口内（非输入框） | 导航到**动态**（`{ kind: "stream" }` → StreamDetailView） |
| ⌘⇧T | 窗口内（非输入框） | 待办清单弹层（TitleBar 图标） |
| ⌘⇧B | 窗口内（非输入框） | 侧栏看板（高级视图） |
| ⌘⇧O | 窗口内（非输入框） | 导航到交付 |
| ⌘⇧A | 窗口内（非输入框） | 导航到归档 |
| Enter | 聊天输入中 | 发送 AI 消息 |
| Shift+Enter | 聊天输入中 | 换行 |
| ESC | 浮层 / 专注 | 关闭浮层；无浮层时退出专注 |
| ↑/↓ | 命令面板 / 搜索 | 导航选项 |
| 右键 | 树节点 | 上下文菜单 |

- **缩放键的 Shift**：`=`/`+` 与 `-`/`_` 是同一物理键的两种拼法，两种都算缩放；Windows 上「Ctrl +」写出来就是 `Ctrl+Shift+=`，所以这个监听**必须**接受 Shift（早期版本一律拒绝 Shift，`"+"` 分支成了死代码，Windows 用户只能按 `Ctrl+=` 放大）。`⌘0/⌘+/⌘-` 归**原生显示菜单**（非 mac 只显示不注册），渲染层只接管 `Ctrl`——否则 mac 上同一次按键会被菜单和监听各处理一遍，一格变两格。故 `menu-spec.mjs` **不**用 `resetZoom/zoomIn/zoomOut` role（role 会自带 accelerator，等于给同一个动作再塞一个 owner），而是发渲染侧命令 `view.zoom.*`。
- **`role` 的隐含 chord 会被真注册**：`togglefullscreen` / `toggleDevTools` 这类 role 没有「只显示不注册」模式。`toggleDevTools` 的默认 `Ctrl+Shift+I` 与 Inbox（⌘⇧I）撞键——一次按键同时开 Inbox 和 DevTools，故显式改 `F12`。守护测试把「role 的生效 chord」与 `WORKBENCH_SHORTCUTS` 交叉比对。
- **全屏**：状态由主进程拥有（窗口 `enter-full-screen` / `leave-full-screen` → `window:fullscreen`），渲染侧 `src/lib/fullscreen-chrome.ts` 写 `html[data-fullscreen]`。它驱动的是 **CSS 而非 React**：全屏时系统不再画红绿灯 / caption 按钮，于是那些「只为躲 OS 按钮」的让位垫（mac 左侧 pad、Windows `--wc-inset-right`）一并收回，避免全屏下留一条空白。开机竞态由 `system.windowState` 初值兜底。
- **对话框按钮顺序**：DOM 顺序恒为「取消在前」，Tab 序与「危险对话框 Enter 落在取消」的保证都不随布局移动；Windows 只在 CSS 里 `flex-direction: row-reverse` 把主操作翻到左边（平台惯例），见 `html[data-platform="win"] [data-dialog-footer]`。

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

- **2026-09-14 对比度校准 + token 收敛**：浅色 accent（→ sky-700）、status 三色（→ green-800 / amber-800 / red-700）、inbox teal（→ teal-800）与深色 error（→ `#ff7b72`）停止位重校准至 AA，**实测基线见 §5.0.1**；清理 14 个零引用 token、新增 4 个角标 token（`--color-*` 定义数 75 → 65）；语义色文字**禁止**透明度修饰符（16 个 TSX、32 处回正）；计数角标收口为 `CountBadge`（§0.0.5）
- Design System **3.0** ZCode Neutral（纯中性灰 + sky 强调 + 单色 ink 主 CTA；token 真源 `src/styles/tokens.css`）
- 捕获词汇：用户可见文案一律 `记一下` / `Note it` · `记下` / `Log it`（禁止 Quick Capture 冒充）
- 建议确认面 = AI 工作区建议 pane（`SuggestPopover` 确认列表）；编辑 = TipTap、预览 = `getEditorHtml()` 静态 HTML
- 建议 kind 与 Kernel 对齐（无 `archive_path` / 卡片级 `todo_extract` / `topic_classify`）

## Sidebar · 一级类与交付物

- **一级类（category）**：始终按 `NN` / slot 排序；时间/名称排序只影响专题与文件。
- **结构带**：`00-Inbox` → 用户类 → **`88-交付`** → `99-归档`。交付物固定在类列表之后（非插件区），便于日常找回。
- **标签页**：设置 → 通用 → 多标签（激活不改顺序）/ 单标签。
- **非 Markdown 文件**：知识区列出全部类型；`.html` 沙箱 iframe（截断）；其它文本等宽；二进制打开外部。Markdown 预览见 §2.3（静态 HTML，不是 live TipTap）。
- **图标**：macOS `.icns` + `icon-mac.png` = **peer 几何预裁白圆角板**（板 ~80.5% 画布 + 圆角 ~25% 板边，与 VS Code/Claude 一致）；Win/Linux/扩展为透明 mark；`setIcon` 仅 plate PNG。


## 截图与文档

产品截图真源：`docs/images/`（索引见 `docs/images/README.md`）。  
仓库默认 README 为**英文**（`README.md`）；简体中文 `README.zh-CN.md`。各模块 README 同此约定。

---

## UI/UX 审查清单（UIX-401 ~ UIX-407 · 2026-08-10）

### UIX-401：用户概念 ≤5 硬上限 ✅

界面显性概念严格限定为：**记一下 · 动态 · 专题 · 我的情况 · 交付**。

- 目的地：动态（默认）· Inbox · 交付（**侧栏主 header** `PrimaryNav variant=sidebar`；侧栏收起时 TitleBar compact；StatusBar 不含导航）
- 搜索非 PrimaryNav：⌘K 命令面板 · ⌘P 笔记全文
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

- 标题栏高度 `--density-chrome-y: 44px`（2026-09-07 三列 `.v4-column-chrome` 对齐；控件 `--density-chrome-control: 32px`）
- 状态栏高度 `--density-status-y: 26px`
- 侧栏主 header：Profile → 搜索 → 记一下；次级 header：ViewSwitcher + 树工具，无重复 border
- Landing 页噪点清理：workflow chips 已移除（2026-08-07）；brand chip 已移除（2026-08-07）

### UIX-405：建议条与 confirm 二阶段 ✅

- 专注模式浮动 `SuggestPopover`；非 focus mode 由 StatusBar 计数 chip + AI 工作区建议 pane 承担入口
- 主动 AI **只生成建议**，用户确认后才调 writeback 执行
- AI 工作区建议 pane（`SuggestPopover` 确认列表）为唯一完整确认面：接受 / 忽略 / 待确认写入三模式
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
