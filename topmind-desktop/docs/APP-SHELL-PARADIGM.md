# 窗体 · 卡槽 · 布局 · 交互现代范式（App Shell Paradigm）

> 状态：设计锁（DS 4.2+）· 适用：plugin-app mini-app · connector hub · 未来新 APP  
> 原则：**现代 · 优雅 · 减负**——不堆步骤、不叠 chrome、不做老式「表单向导」。

---

## 0. 设计锁

| 维度 | 锁 |
|------|-----|
| 风格锚点 | ZCode Neutral + MD3-informed；**工具感**而非后台 SaaS、非 Windows 95 对话框 |
| 窗体 | 浅遮罩 `scrim-mini` + 圆角 elevated sheet；**工作台可读**（不全黑蒙层） |
| 卡槽 | 统一 `AppSlot`：surface 卡、细线、`radius-lg`、一区一主张 |
| 色 | token only；语义色坐自有 `-bg`；禁幽灵类 / 语义色透明度 |
| 字 | 工具 chrome `text-sm/3xs`；正文工具 3xs–xs；**不做营销大标题** |
| 密度 | 紧凑专业（chip 28–30px）；触控 ≥32px；留白靠 slot 间距不是空旷 |
| 交互 | **一步到位主路径**；高级操作 progressive disclosure；键盘 `⌘S` / `←→` / Esc |
| 复杂度 | **禁止**多层向导 >4 步；禁止每步「下一步/上一步」导航条像安装器 |

---

## 1. 窗体（Window / Sheet）

```text
scrim-mini (工作台可见)
└─ v4-plugin-app-sheet  (圆角 · elevated · max-h 88vh)
   ├─ PluginAppHeader   (icon chip · 标题/副题 · tools · meta · close)
   ├─ AppModeTabs       (模式/步骤 chip · 非安装器 stepper)
   ├─ AppStatusStrip    (布局吸顶 · ✓/✗ 容器色)
   └─ Body (step 感知: fill | scroll)
```

- **不做**：三栏嵌套对话框、向导式「Step 1 of 5」进度条、满屏 modal
- **要做**：单面板 + chip 导航 + 内容区自适应高度

## 2. 卡槽（Slot）

| Slot | 形态 | 用途 |
|------|------|------|
| `AppSlot` | surface 卡 + 可选 title 行 + 体 | 表单/清单/指标 |
| `StatSlot` | 大数字 + 标签 | 余额、AI 分、字数 |
| `ListSlot` | `listRowClass` 行列表 | 包/流水/书 |
| `EmptySlot` | `EmptyState` 一因一 CTA | 空态 |
| `ActionSlot` | 右对齐按钮组（一 default） | 主次动作 |

规则：卡内 **一主张**；卡间距 12px；禁止卡中卡中卡。

## 3. 布局范式

| 场景 | 布局 |
|------|------|
| 列表/管理 | 顶部工具行（搜索/筛选/新建）→ 滚动列表 |
| 编辑/预览 | 工具条 + **fill** 画布；元信息脚注行 |
| 仪表/质检 | 2 列卡（窄屏单列）+ 底部动作条 |
| 录入 | 常驻录入区（ledger 快捷）或一键 FAB 语义 |

**禁止**老式：左树右表全屏资源管理器、九宫格图标桌面、多页 Tab 向导。

## 4. 交互范式

| 范式 | 约定 |
|------|------|
| 主路径 | 打开 → 直接干活（录入/改稿/搜索）；**无 splash 页** |
| 确认 | 近发布/丢稿 `ConfirmLeaveDialog`；禁 `window.confirm` |
| 状态 | 吸顶 `AppStatusStrip`，3–5s 可保留；错误可操作 |
| 键盘 | `⌘S` 保存 · `←/→` 切模式 · Esc 关层 · 输入框不抢键 |
| 反馈 | `softDisabled` 忙；`toastWriteback` 回执；工具 chip 显示能力 |
| 减负 | 默认折叠高级（上传清单/合规明细）；一键导出脚本优先 |

## 5. 迁移清单（既有 APP）

- [x] ledger / wechat → `PluginAppHeader` + `AppModeTabs` + `AppStatusStrip`
- [x] 禁 `window.confirm` → `ConfirmLeaveDialog`
- [x] busy → `softDisabled`
- [x] weread 书列表 → listRowClass
- [x] ingest 队列空态 → EmptyState
- [x] 统一 AppSlot / StatSlot / ListRow / AppCheckbox
- [ ] 降低向导感：wechat 步骤 chip 保持 4 模式而非 5 向导（已满足）

## 6. 反模式（禁止回潮）

1. 安装器式 Next/Back 全宽底栏  
2. 每步独立全屏页 + 进度百分比  
3. 卡套卡套卡  
4. 同一区域两个实心 CTA  
5. 裸 `window.confirm` / 裸错误红字无容器  
6. 自写第二套 header / toast / 空态  
7. 中文业务字面量比较（用枚举）  
8. 硬编码 `⌘` 字形（用 `formatChord`）
