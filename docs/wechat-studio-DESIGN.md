# 公众号创作 · 方案设计（技能子包 + Desktop 应用 + 移动伴面）

> **定位**：**实验伴面**设计稿，产物在 [`experiments/wechat-studio/`](./experiments/wechat-studio/)。  
> 非产品核心交付面；现行技能真源见 `topmind-skills/topmind-wechat/`。勿把本文件当现行产品规范。


> 状态：**已实施（含审计修复）**；下列「本期不做」仍有效  
> 真源能力：`skills/topmind-wechat/scripts/*.py`（自 workbuddy 沉淀移植）+ 工作区交付包约定  
> 业界对照：doocs/md · gzh-design-skill · md2wechat-skill · wechat-article-skills · Humanizer-zh · qu-ai-wei

---

## 0. 问题与目标

把 workbuddy / topmind-workspace 沉淀的公众号全生命周期能力：

1. **技能化** → 进入 `topmind` skills 包，作为 **write 族子技能**（不新增第 11 个并列前台入口）
2. **应用化** → topmind Desktop 可选 mini-app「**公众号创作**」（AI 工作区 · 应用 pane）
3. **可视化工作流** → 单文件移动 `index.html`（手机模拟器可试用），承载流程 UI + 质检 + 微信预览 + 导出

北极星仍是对齐 `docs/ARCHITECTURE-RESET.md`：最低摩擦个人动态流；Desktop 永非内容真源；写回走 Kernel writeback。

---

## 1. 调研结论（压缩）

### 1.1 已有沉淀（不重造）

| 资产 | 路径 | 采纳方式 |
|------|------|----------|
| 全生命周期技能 | `wechat-article-format` SKILL.md + 6 scripts + 4 themes + 3 references | **移植进 pack**，路径参数化 |
| 去 AI 味 | `qu-aiwei-zh/scripts/scan_ai_flavor.py` + patterns | **子技能依赖调用**（可选），规则写入 references |
| 交付包约定 | `40-创作/2026-公众号/` + frontmatter 状态机 | 写入 skill 约定；Desktop/移动端对齐 |
| 坑清单 | embed-images / basename 撞名 / Edit 部分落盘 / `::: stat` 管道行 | 全部写入 skill「已知坑」+ 质检规则 |

### 1.2 业界（只学/只引，不重复造）

| 不重造 | 说明 |
|--------|------|
| MD→公众号内联 HTML | 对齐 doocs/md / gzh-design 的约束清单；Python `md2wechat.py` 为 pack 内真源 |
| 主题组件库 | 沿用 4 套 JSON themes；不引入 AGPL 组件库源码 |
| 去 AI 味 pattern | 沿用 qu-aiwei-zh / Humanizer-zh 规则集 |
| 微信草稿 API 直发 | **本期不做**（复制粘贴仍是主通道）；预留 settings 钩子 |

### 1.3 必须自研（topmind 绑定）

1. 子技能包结构 + pack / router 登记（`topmind-wechat`）
2. 交付包落在 **契约类别**（默认创作/专题类 `YYYY-公众号/`），终稿可 `save-output` → delivery
3. Desktop mini-app 工作流 UI（选题包 → 改稿 → 三关 → 排版 → 导出）
4. 移动端单文件伴面（离线质检 + 微信预览 + 复制 HTML）
5. 质量门与 i18n / dead-code / undeclared 接入

---

## 2. 总体架构

```text
                    ┌─────────────────────────────┐
                    │  topmind skills pack        │
                    │  topmind (router)           │
                    │    └─ topmind-write ────────┼─► topmind-wechat (子技能)
                    │         scripts/*.py 真源   │     references/* · themes/*
                    └──────────────┬──────────────┘
                                   │ 同一 writeback 契约
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
 ┌─────────────────┐    ┌─────────────────────┐   ┌──────────────────┐
 │ Desktop mini-app│    │ Workspace 内容平面   │   │ 移动 index.html  │
 │ 「公众号创作」   │───►│ {类别}/YYYY-公众号/  │   │ wechat-studio    │
 │ plugin-app 遮罩 │    │  交付包 + 88-交付    │   │ 手机模拟器伴面    │
 └─────────────────┘    └─────────────────────┘   └──────────────────┘
```

| 面 | 角色 | 内容真源 |
|----|------|----------|
| Skill `topmind-wechat` | Agent 可调用的流程/脚本/规则真源 | 否（能力包） |
| Desktop「公众号创作」 | 可视化工作流 + 写回编排 | 否（UI 伴面） |
| 移动 `index.html` | 离线试用 / 通勤改稿 / 质检预览 | 否（本地草稿箱） |
| Workspace 文件 | 公众号稿 / HTML / 图片包 / 交付 | **是** |

---

## 3. 子技能设计 `skills/topmind-wechat`

### 3.1 定位

- `action_category: write` · `entrypoint: false` · pack `role: write` · `optional: true` · `human_facing: false`
- **不是**并列前台：用户说「公众号 / 微信排版 / 定稿 / 发公众号」时由 `topmind-write` / router 转入
- description 含 Use when / Do NOT use（不抢 capture/organize/小红书）

### 3.2 目录

```text
skills/topmind-wechat/
├── SKILL.md
├── DESIGN.md                 # 本设计的技能侧摘要
├── references/
│   ├── workflow.md           # 两条路径 + 交付包 + 状态机
│   ├── writing-quality.md    # 三关（事实/逻辑/文字）
│   ├── typography-rules.md   # 阅读节奏 / 容器 / 体例
│   ├── wechat-constraints.md # 公众号 HTML 约束
│   └── known-pits.md         # embed-images / basename / Edit 落盘…
├── assets/themes/            # minimal-ink · tech-blue · newsprint · graphite
└── scripts/
    ├── new-article.py
    ├── lint-wechat.py
    ├── md2wechat.py
    ├── sync-status.py
    ├── sync-mapping.py
    ├── push-to-topstream.py  # 可选；无 topstream 时 no-op 提示
    └── scan_ai_flavor.py     # 从 qu-aiwei-zh 便携副本（或 PATH 解析）
```

### 3.3 路径策略（去硬编码）

| 用途 | 解析顺序 |
|------|----------|
| 工作区根 | CLI `--workspace` → env `TOPMIND_WORKSPACE` → 契约发现（cwd / 父目录 `topmind.yaml`） |
| 交付包根 | CLI `--package-root` → 设置 `wechat.packageRoot` → 默认 `{创作或专题类}/YYYY-公众号/` |
| 底稿仓库 | CLI `--source-root` → env `TOPSTREAM_ROOT` → 可选；缺失则 forward 路径降级为「粘贴底稿」 |
| 去 AI 味 | 同目录 `scan_ai_flavor.py` → `~/.workbuddy/skills/qu-aiwei-zh/scripts/…` |

### 3.4 工作流（沿用沉淀，不改语义）

```text
forward: 底稿 → 审校改写 → 三关 → 定稿 → 排版 → 发布
reverse: 选题包 → 调研/素材 → 多轮改稿 → 三关 → 定稿 → 排版 → 发布 →（可选）回推
```

**质量三关（定稿硬门）**

1. **事实关**：承重数字回一手来源；多口径拆开；外部改稿先核数再改文  
2. **逻辑关**：反方证据；结构一致；同口径同值  
3. **文字关**：`scan_ai_flavor ≥ 85`；再过「报告腔四症状」人工复查（满分≠有人味）

**排版关**：`lint-wechat.py` 0 error；`md2wechat.py --embed-images` 合规自检无 ✗。

### 3.5 与 Desktop / 移动面的契约

| 能力 | Skill | Desktop | 移动端 |
|------|-------|---------|--------|
| 建包 / 状态 | scripts | 调 scripts 或镜像状态机 | 本地草稿箱状态机 |
| 去 AI 味 | scan_ai_flavor.py | 同规则 TS 子集 + AI 润色 | 同规则 JS 子集 |
| 排版体检 | lint-wechat.py | TS 子集 | JS 子集 |
| MD→微信 HTML | md2wechat.py（真源） | 预览用约束子集；导出优先脚本 | 约束子集（粘贴级） |
| 写回 | UTR workspace-write | `api.ws.save` 回执 | 导出文件 / 复制 |

> 移动端与 Desktop **不维护第二套完整转换器真源**；只实现「预览 + 粘贴」所需约束子集，完整语义以 `md2wechat.py` 为准。

---

## 4. Desktop 应用「公众号创作」

### 4.1 插件形态（first-party optional mini-app）

照 `topmind-ledger`：

| 项 | 值 |
|----|-----|
| id | `topmind-wechat` |
| settingsKey | `wechat` |
| launchable | `true` |
| overlay | `plugin-app:topmind-wechat` |
| 打开 | AI 工作区 · 应用 pane · ⌘K「公众号创作」· Settings → Plugins |

**不写死 id**：`apps-menu.resolveLaunchableOpenTarget` 自动走 overlay；`pluginReadiness` 不需要配置密钥（默认就绪）。

### 4.2 UI 工作流（单面板四步 + 导出闭环）

```text
[包列表] → [改稿 公众号稿.md] → [质检三关] → [排版预览/导出]
```

Desktop 已按 DS 4.2 统一：sticky 状态条 · 每步一个主 CTA · 脏稿 close-guard · 定稿 ConfirmDialog · edit/preview 填满布局 · 包搜索/缺稿 · 插入容器工具条 · 预览与复制同源 embed。

1. **包列表**：扫描 `{packageRoot}/*/`，显示 `status` / 字数 / 更新时间；新建包（调 skill 骨架）  
2. **改稿**：编辑 frontmatter + 正文；保存走 `api.ws.save`（path receipt）  
3. **质检**：事实勾选清单（人工）+ AI 味分 + lint 警告；一键「AI 去味改写」（`ctx.ai`）  
4. **排版预览**：主题切换（4 themes）；微信阅读栏宽预览；图片/容器检查  
5. **导出**：生成/刷新 `*-公众号版.html`（`--embed-images`）+ `图片上传清单.md`；「复制正文」；定稿 `sync-status --set 定稿`

### 4.3 能力边界

- 写盘：仅 `api.ws.save` / `savePath`  
- 读盘：`api.ws.read` / list  
- AI：`ctx.ai` + 输出语言纪律（`lib/ai-output-locale`）  
- 禁止：裸 fs、平行 truth store、PrimaryNav 占位、侧栏插件行、第二套内容根  

### 4.4 代码落点

```text
src/plugins/topmind-wechat/{index,wechat-app,settings-slot,actions,status-bar-slot}.ts(x)
src/lib/wechat-quality.ts      # lint + AI 味子集（与 skill 规则同源注释）
src/lib/wechat-format.ts       # 微信约束 HTML 子集（预览/粘贴）
src/types.ts · electron/lib/settings-core.mjs · host.ts · locales/{zh-CN,en-US}/wechat.json
AppsLaunchList ICON_MAP · plugin-launcher 常量（无硬编码就绪特例）
测试：plugin-entry 式 + i18n 对齐 + token 合规
```

---

## 5. 移动伴面 `wechat-studio/index.html`

**形态**：单文件、内联 CSS/JS、移动优先、无网络依赖；手机模拟器直接打开。

### 5.1 信息架构

```text
底部 Tab：草稿箱 · 写作 · 质检 · 预览 · 我的
```

| Tab | 能力 |
|-----|------|
| 草稿箱 | 本地包列表（localStorage）；新建/导入 md；状态 待改/待发/已发 |
| 写作 | Markdown 编辑 + 插入容器（stat/pull/warn…）+ 字数/图数密度 |
| 质检 | 三关清单 + AI 味扫描（JS 子集）+ 排版 lint 子集 + 逐条跳转 |
| 预览 | 微信样式预览 + 主题切换 + 复制 HTML（粘贴后台）+ 导出 .html/.md |
| 我的 | 偏好（主题/目标分）、技能说明、与 Desktop/skill 协同说明 |

### 5.2 设计方向（设计锁）

- **锚点**：微信读书 / 即刻移动内容工具的「纸面 + 墨色」阅读工具感，不是后台 SaaS  
- **色**：底 `#F7F4EF` 纸色 · 墨 `#1C1B19` · 次文 `#6B6560` · 强调砖红 `#A6524A`（与 minimal-ink 主题同源）· 成功 `#3D6B4F` · 警告 `#A67C3A` · 错误 `#A6524A`；token 见 CSS 变量  
- **字**：`-apple-system, "PingFang SC", "Noto Sans SC", sans-serif`；标题 22/18；正文 15/1.75；数字用等宽  
- **布局**：单列 390 优先；顶栏 52px；底 Tab 56px；卡片圆角 12、细线描边；密度偏紧（创作工具）  
- **签名时刻**：① 质检仪表（三关环 + AI 味分）② 微信预览纸面滑入  

### 5.3 实现约束

- 全部内联；`<input type=range>` 等原生控件  
- 不请求 CDN；图片用 CSS/SVG 占位  
- 复制用 `navigator.clipboard` + `execCommand` 兜底  
- 数据：`localStorage["wechat-studio.v1"]`；可导出 JSON 备份  

---

## 6. 数据与状态机

```text
status: 草稿 | 定稿 | 已发布
directory: YYYY-MM-DD-<中文短名>[-released]
frontmatter: status · direction · source_file · target_file · word_count
```

- `word_count` = 纯中文字 `\[一-鿿\]`  
- 目录后缀 `-released` ⇔ `定稿|已发布`  
- 移动端状态仅本地镜像；**回写工作区以 Desktop / skill 为准**

---

## 7. 明确不做（本期）

- 微信草稿箱 API / 多账号直发（预留）  
- 小红书 / 知乎排版  
- 插件市场 / 原生手机 App  
- 并行内容真源 / 向量检索  
- 完整 md2wechat 的 TS 重写（只做约束子集）  
- Desktop 内直接 shell 调 Python 脚本（导出用 TS 约束子集 + `readBinary` embed；完整导出仍以 skill 脚本为准）

## 7.1 实施状态（审计后）

| 能力 | Skill | Desktop | 移动 |
|------|-------|---------|------|
| 建包 / 状态机 | `new-article` / `sync-status` | 建包 + 定稿（status+`-released`） | 本地状态 |
| 质检 AI 味（词面+结构） | `scan_ai_flavor.py` | `wechat-quality.structuralDeduction` | 同规则 JS |
| lint max-item **70** | 真源 | `WECHAT_MAX_ITEM=70` | 同 |
| stat 管道行 | md2wechat | wechat-format 同 | 同 |
| embed-images + 上传清单 | `--embed-images` | **skill 脚本优先**，否则 `readBinary` + 清单 | data URL / 占位 |
| AI 去味改写 | 人工/宿主模型 | `api.ai.complete` polish | 人工 |
| 导出真源旁路 | `md2wechat.py` | `WechatService.exportViaScript`（Python+脚本可用时） | — |
| 合规自检回执 | stdout `合规自检` | 解析进状态条 + warn | 提示文案 |
| `{slug}-公众号版.html` | 真源 | 已对齐 | 导出文件名对齐 |

---

## 8. 验收

| 面 | 验收 |
|----|------|
| Skill | topmind-skills 仓 `npm test`；frontmatter schema；pack 登记；脚本 `--help` 可跑 |
| Desktop | `npm run desktop:quality` 相关门（i18n / undeclared / dead-code / typecheck）；应用 pane 可开；保存有回执 |
| 移动端 | 手机宽度 390 下五 Tab 可用；质检可跑；预览可复制 HTML |
| 回归 | 报回前 grep：`wechat` 在 pack / host / locales / router 一致 |

---

## 9. 版本

| 层 | 真源 | 策略 |
|----|------|------|
| Skill pack | `topmind-skills` 仓 `topmind-pack.json` | 随 pack minor |
| Desktop | `topmind-desktop/package.json` | 独立；本特性 minor |
| 移动伴面 | 文件头注释 version | 1.0.0 |
