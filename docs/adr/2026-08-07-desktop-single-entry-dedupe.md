# ADR: Desktop 单入口纪律与 chrome 降噪（2026-08-07）

## 背景

Design System 2.0 落地后，用户仍反馈主界面「繁杂」。根因不是视觉风格，而是**结构重复的入口**与**条带堆叠**：

- 建议计数最多同时出现在 4 处（标题栏 💡 badge · 状态栏计数 chip · 画布顶 strip · AI 轨 chip），违反 DESIGN 自定的「禁止三处等权」
- 个人清单 3 处（标题栏 / 动态页头 / 状态栏 busy）；AI 待办 3 处（动态页头 / TodoPopover / 侧栏 StreamView）
- 默认动态视图最多 10 条水平带（TitleBar → ViewSwitcher → pins → tabs → strip → 页头 → 周期 chips → composer meta → 日分组 → 状态栏）
- composer 3 行 meta 文案（label / 计数 / kbd hint）全部与既有元素重复

## 决策

**一个功能 = 一个常驻全局入口 + 至多一个情境入口；meta 文案让位内容。**

1. **建议计数恰好两处**：标题栏 💡 badge + 画布顶 `SuggestEntryStrip`；状态栏仅保留「生成中」busy chip（常驻计数 chip 删除）
2. **个人清单单入口**：标题栏 ListTodo / ⌘⇧T；动态页头不再重复（页头保留情境动作：AI 待办 · 整理 · 刷新）
3. **状态栏中央位置 hint 仅 file 选择显示**（点击 reveal）；其余 kind 由画布 PageHeader + PrimaryNav active 自明
4. **动态 composer 无 meta 行**：placeholder 承担引导，计数在 PageHeader subtitle，kbd 在提交按钮上；卡片去 border 纯阴影（符合「卡片优先 bg + shadow」）
5. **侧栏少一条带**：我的情况（ProfileButton）上移 ViewSwitcher 行全局可达；周期 pins 行仅 timeline/tags/kanban 渲染（stream 视图由 StreamView 自带周期头承担；category 视图并入 DataSource 头行）

## 影响面

- 源码：`StatusBar.tsx` · `StreamDetailView.tsx` · `Sidebar.tsx`
- locale：zh/en 同步删除 6 个 workspace 键 + 16 个 shell 键（parity 门保持绿）
- 测试：4 个源码断言测试改写为锁定**新**契约（`todo-stream-affordance` · `suggest-surface-open` · `uiux-p0-remediation` · `uiux-wave2-remediation`），`ia-primary-nav` 的 StatusBar 断言同步更新
- 规范：`topmind-desktop/DESIGN.md` §0.0.1 / §0.0（StatusBar · 建议入口降噪 · 侧栏 pin · 动态密度）· 变更摘要

## 功能完整性证明（每个被移入口的保留路径）

| 移除 | 保留路径 |
|------|----------|
| 状态栏建议计数 chip | 标题栏 💡 badge + 画布 strip（count>0 自动出现） |
| 动态页头「清单」 | 标题栏 ListTodo · ⌘⇧T |
| 状态栏非 file 位置 hint | PageHeader 标题 + PrimaryNav active |
| composer label/hint | placeholder + 提交按钮 kbd |
| stream 侧栏 pins 行 | StreamView 自带周期头 + PrimaryNav 动态 |
| category 头行 ProfileButton | ViewSwitcher 行全局按钮 |

## 后续方向（记录，不在本次实施）

- TitleBar 左簇（brand 文案 / 前进后退）在窄窗的进一步收敛
- AI 轨 Composer 视觉层级（工具行 vs 输入区）细化
- 设置 IA 的组名白话化持续推进

---

## Round 2（同日追加）：控制塔瘦身 · badge 纪律 · 健康即沉默

Round 1 解决「同一功能多处入口」；Round 2 解决「常驻对象过多 + 非行动信号常亮」。对标 Linear / Things / Arc：标题栏对象 ≤8 且只有一个视觉焦点；badge 只在需要行动时出现；系统正常时沉默。

1. **标题栏对象 16→11**
   - 删品牌字标「topmind」（窗口标题/任务栏已标识；保留 logo chip 作身份锚）
   - 主题切换移出标题栏（低频设置行为；⌘, 设置 + 窄屏 ⋯ 菜单可达）
   - ⌘K 触发器从 ghost 按钮升级为搜索框浅井（muted well + inset shadow + kbd 右置）——标题栏视觉结构从「按钮排」变为「nav + 焦点框」
2. **badge 纪律**：移除写出来计数徽章（库存量，不构成行动）与清单数字角标（常驻非零 = 永久蓝点）；保留收件箱（分诊队列）+ 💡 建议（AI 工作待审）
3. **健康即沉默**：状态栏「工作区正常 ✓ 文本」→ 一颗绿点（详情在 tooltip）；异常才出文字
4. **视觉扁平**：标题栏去渐变 + 顶部高光（3 层效果 → 纯色 + 单 hairline）；nav active 去 inset ring（wash + semibold 自明）；capture 实心按钮补 `--shadow-button`（与主按钮同语言，不再「扁而飘忽」）

### Round 2 影响面

- 源码：`TitleBar.tsx` · `StatusBar.tsx` · `v4.css`（titlebar-glass / cmd-trigger / nav-pill / capture）
- locale：zh/en 删 `command` · `themeTip` · `themeAriaLabel` · `outputsTipActive`，增 `commandField`
- 规范：`DESIGN.md`（安静 chrome · 少硬分割线 · TitleBar 右轨分层 · StatusBar · §2.1 · 变更摘要）
- 验证：typecheck · i18n parity · dead-code 35 项 · 715 tests · 全绿

---

## Round 3（同日追加）：Design System 2.1 — Modern Warm-Neutral

**触发**：用户反馈 2.0 暖纸米黄「颜色老旧」，要求更现代、长读不疲劳。

**研判**：「老旧感」的来源不是纸感理念，而是**米黄色相 + 棕色边框/阴影**（`#f6f4ef` / `rgba(62,54,38,…)` / `rgba(42,36,24,…)`）。但 2.0 ADR 同时明确禁止回退**冷蓝灰**（无菌办公室感）。Modern 与舒适的交集 = **近中性微暖**：保留一丝暖意（hue 不变、chroma 砍半），既不是米黄也不是蓝灰——Notion `#f7f7f5` 与 Linear 净白之间的甜区。

**决策（2.1 重校准，品牌 accent 不动）**：

| 面 | 2.0（米黄/棕） | 2.1（近中性微暖） |
|----|----------------|-------------------|
| light 阶梯 | `#edeae2 → #f6f4ef → #fffefb → #fdfcf8` | `#efeeeb → #f7f6f4 → #fdfdfc → #ffffff` |
| light 文字 | `#2b2822 / #57524a / #7c766b / #a29b8d` | `#2b2b27 / #585852 / #7d7d77 / #a3a39c` |
| light 边框/阴影 | `rgba(62,54,38,…)` / `rgba(42,36,24,…)` | `rgba(60,58,50,…)` / `rgba(31,29,26,…)` |
| dark 阶梯 | `#181613 → #201e19 → #282520 → #302d26`（暖棕） | `#171715 → #1e1e1c → #262624 → #2e2e2b`（中性石墨微暖） |
| dark 文字 | `#f0ede4 / #d0cabd / #a49c8c / #847d6e` | `#ecece8 / #cbccc6 / #a3a49d / #83847e` |
| dark 边框 | `rgba(255,248,235,…)`（暖白） | `rgba(255,255,255,…)`（中性白） |

**保留**：墨蓝/teal 品牌轴（logo 锁定）· token 架构与阶梯纪律 · 编辑器 `paper`/`sepia` 暖纸色（转为**可选阅读主题**——默认清爽，暖意按需）。

**影响面**：`tokens.css`（34 处值）· `v4.css`（paper mix）· `export-markdown.ts` · `FilePreviewView` 兜底 · `browser-extension/popup.css`（23 处镜像）；测试 `uiux-p0-remediation` 边框断言同步；`DESIGN.md` §0/§5 · `ARCHITECTURE.md` 指针；2.0 ADR 标记 Superseded。
