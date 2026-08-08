# ADR: Comprehensive Design Optimization (2026-08-07)

> **状态**：Accepted  
> **日期**：2026-08-07  
> **范围**：Desktop UI/UX 全面优化 — 标题栏、状态栏、侧栏、Landing、CSS 令牌、交互体验  
> **前置**：Design System 2.1（`2026-08-02-design-system-2-paper-mind.md`）、Single Entry Dedupe（`2026-08-07-desktop-single-entry-dedupe.md`）

## 背景

用户反馈整体仍然「繁杂」——布局、功能组织、层次、认知习惯不够方便好用。UIUX 需要更有层次感、更优雅现代化、交互体验更好。

### 核心问题诊断

| 维度 | 问题 | 影响 |
|------|------|------|
| **标题栏密度** | 40px 内塞入 ~15+ 交互元素（5 左 + 6 中 + 5-7 右） | 认知过载；焦点涣散 |
| **状态栏噪音** | 26px 内 10+ 元素竞争（health + path + slots + selection + update + 4 busy chips + AI pill） | 信息淹没 |
| **侧栏头部碎片化** | ViewSwitcher 行 + 条件 PeriodPill 行 + 树头行（PeriodPill + toolbar + refresh）= 3 条 header | 空间浪费；视觉断裂 |
| **分隔线过多** | chrome-sep / border-b / divider 叠加，多处 hairline 叠阴影 | 视觉噪音 |
| **Badge/chip 泛滥** | 标题栏 3 处 badge + 状态栏 4 处 chip + 画布 strip | 等权竞争注意力 |
| **品牌 chip 冗余** | 标题栏品牌 chip 仅装饰（窗口/任务栏已标识应用） | 占用黄金位置 |
| **路径常驻** | 状态栏路径按钮与标题栏 workspace switcher tooltip 重复 | 信息冗余 |

## 决策

### 1. 标题栏精简（Clean TitleBar）

**原则**：每侧最多 1 个功能组；中间为导航核心。

| 区域 | 之前 | 之后 |
|------|------|------|
| 左 | sidebar toggle + back/forward + brand chip + workspace switcher | sidebar toggle + back/forward + workspace switcher |
| 中 | PrimaryNav + command palette trigger | PrimaryNav + command palette trigger（不变） |
| 右 | capture + suggest + todo + search + settings + theme/overflow + AI | capture + AI（L1 常显）+ suggest/todo（L2 安静）+ overflow（L3 收纳） |

**移除**：品牌 chip（`v4-icon-chip-accent`）——窗口标题和任务栏已标识应用。

**简化**：右轨默认仅 capture + AI + L2 安静图标对（suggest/todo）；search/settings/theme/task 全部进 overflow `⋯`，窄屏自动切换。

### 2. 状态栏降噪（Quiet StatusBar）

**原则**：健康即沉默；路径不常驻；busy 单路径。

| 区域 | 之前 | 之后 |
|------|------|------|
| 左 | health dot + left slots + **path button** + divider | health dot + left slots |
| 中 | selection hint | selection hint（不变） |
| 右 | right slots + update + 4 busy chips + AI pill | right slots + update + **最多 1 busy chip** + AI pill |

**移除**：状态栏路径按钮——workspace switcher tooltip 已承担；减少 chrome-sep 数量。

**合并**：busy chips 保持单路径（`deriveStatusBarBusy`），视觉上进一步弱化——统一为 accent-bg-faint + progress dot，不使用不同颜色区分。

### 3. 侧栏头部统一（Unified Sidebar Header）

**原则**：一条 header band 包含所有控制。

| 之前 | 之后 |
|------|------|
| Row 1: ViewSwitcher + ProfileButton（ cramped） | Row 1: ViewSwitcher（全宽）+ ProfileButton（icon-only 右侧） |
| Row 2: PeriodPill（仅 timeline/tags/kanban） | （合并到树头行） |
| Row 3: PeriodPill + spacer + TreeToolbar + Refresh | Row 2: PeriodPill（条件）+ spacer + TreeToolbar + Refresh |

**移除**：ViewSwitcher 行和树头行之间的 `border-b`——改用留白分隔。

### 4. CSS 令牌精炼（Refined Tokens）

| Token | 之前 | 之后 | 理由 |
|-------|------|------|------|
| `--shadow-card` | `0 1px 2px rgba(31,29,26,0.04)` | `0 1px 3px rgba(31,29,26,0.05), 0 0 0 0.5px rgba(31,29,26,0.03)` | 更有「浮起」感 |
| `--shadow-sm` | 双层 | 单层简化 | 减少 paint 成本 |
| `--color-border-subtle-dim` | `rgba(60,58,50,0.065)` | `rgba(60,58,50,0.055)` | 更安静 |
| `--density-chrome-y` | `38px` → token 声明 `40px` | `38px`（实际）| 减少 chrome 高度 |
| `--color-surface-hover` | `surface-muted` | `color-mix(surface-muted 70%, transparent)` | 更柔和 hover |

### 5. v4.css 交互打磨

- **hover 过渡**：统一用 `duration-quick`(100ms) 而非 `duration-fast`(140ms) for color-only transitions
- **active 反馈**：`scale(0.985)` 保留但更轻微 `scale(0.992)`
- **nav-pill active**：用更柔和的 `accent-bg-faint` + `font-weight: 500`（非 600）
- **titlebar-btn hover**：更柔和的 `surface-hover` 而非 `surface-muted`
- **divider**：减少 full-width 分割线，优先用 spacing 分隔

### 6. Landing 优化

- 移除 workflow chips 行（用户已熟悉工作流，不需要每次教育）
- 更大、更优雅的间距
- 更现代的卡片 hover 效果
- 底部文案精简

## 实施清单

| 文件 | 改动 |
|------|------|
| `src/styles/tokens.css` | 精炼 shadow/border/hover tokens |
| `src/styles/v4.css` | 打磨交互过渡、hover、active |
| `src/components/shell/TitleBar.tsx` | 移除品牌 chip；简化右轨；精炼间距 |
| `src/components/shell/StatusBar.tsx` | 移除路径常驻；降噪 busy chips |
| `src/components/shell/Sidebar.tsx` | 统一头部；减少碎片化 |
| `src/components/shell/OnboardingScreen.tsx` | 精简 workflow chips；更现代间距 |
| `DESIGN.md` | 更新 §0 视觉原则 |
| `ARCHITECTURE.md` | 更新 Shell 结构 |

## 不变项

- 三栏 Shell 架构（sidebar | canvas | AI）
- PrimaryNav 三锚点（动态/收件箱/写出来）
- ViewSwitcher 五视图（stream/category/timeline/tags/kanban）
- 专注模式 ⌘⌥F
- 命令面板 ⌘K
- 捕获 ⌘N / ⌘⇧N
- 写回 auto|confirm
- 建议全局 SuggestPopover
- 个人清单 TodoPopover

## 验收

> **2026-08-08**：下列项已合闸（Shipped）— 实现见 `tokens.css`（chrome-y 36 / status-y 24）、`TitleBar` / `StatusBar` / `Sidebar`、DESIGN §0；质量门以 `npm run desktop:quality` / `validate` 为准。

- [x] 标题栏视觉元素 ≤10（之前 ~15）— 品牌 chip 移除；L1/L2/L3 分层
- [x] 状态栏视觉元素 ≤6（之前 ~10）— 路径常驻移除；busy 单路径
- [x] 侧栏头部 band ≤2（之前 3）— ViewSwitcher + 树头统一
- [x] 分隔线总数减少 ≥30% — border-b 改留白；chrome-sep 纤细
- [x] 质量门通过（`npm run desktop:quality`）