# ADR: Surface UX review — Desktop · Obsidian · Clip（知识工作者 / UIUX）

> **状态**：Accepted · **日期**：2026-08-13  
> **角色**：本轮用户表面审查真源与 High 整改 backlog（非平行产品规格）  
> **立场**：自身知识工作者 + UIUX / 体验；对照锁：用户概念 ≤5、工作流 `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`、写闸唯一  
> **范围**：Desktop 富工作台 · Obsidian 插件 · Web Clip · 各表面与 Kernel（writeback / contract / ingest）的交接  
> **不重审**：Reset Non-goal（embedding / 全库 Ask）；不重建 Obsidian 原生编辑器/树/命令面板；不重开 2026-08-07 chrome 像素账

用户概念保持恰好：**记一下 · 动态 · 专题 · 我的情况 · 写出来**。

---

## 0. 先对照已锁 IA（不是空赞美）

2026-08-13 对抗审查（`docs/adr/2026-08-13-adversarial-first-principles-review.md`）的 H1–H5 **在现行源码中已不在实现路径上**：

| 旧 High | 现行可观察事实 |
|---------|----------------|
| H1 契约双投影 / v3 热读 | `loadContract()` 只读 `topmind.yaml`；Desktop 无 `projectConfigAliases` |
| H2 AI 默认 `auto` 击穿 yaml `confirm` | `ai-store` 不再把 view-store `writebackMode` 当 `explicitWritebackMode` |
| H3 `kind:home` | `Selection` 无 home；`HomeView.tsx` 已删；未知 kind 落到 stream |
| H4 Clip `htmlToMarkdownLite` | 扩展 `html-to-markdown.mjs` 与 Desktop 同算法；`simple-md.js` 只剩 frontmatter 封装 |
| H5 归档当主锚 | `TitleBar` PrimaryNav = 动态 / 收件箱 / 写出来 / **搜索**；无 `select({ kind: "archive" })` |

本审查不再重做上述五项。下面只冻结 **仍在用户可见路径上** 的 High。

---

## Frozen High list（本轮必须落地）

| # | Finding | Verdict | Surface | Observable before → after |
|---|---------|---------|---------|---------------------------|
| **H1** | Obsidian 把「工作台 / Workbench」教成与五概念并列的主房间 | rewrite copy | Obsidian | 页签/按钮/命令/设置组标题含「动态工作台」「工作台」→ 用户文案只用 **动态 / Stream**（内部 view id 可保留） |
| **H2** | Obsidian 记一下 / 记下 混用：动态输入栏 aria 叫「记一下」，弹窗标题「记一下」但提交写「记下」 | rewrite | Obsidian | 动态主区提交/aria = **记下 / Log it**；完整捕捉弹窗标题+提交 = **记一下 / Note it** |
| **H3** | Obsidian 底栏/命令把引擎词「记忆」当对等动词 | rewrite copy | Obsidian | 「整理记忆 / Memory」→ **整理我的情况 / Organize My profile** |
| **H4** | Clip 选项页与 i18n 仍教「轻量 HTML→MD / Bridge 质量更好」——第二套转换器谎言 | rewrite | Clip | 选项/文案承认 **同一 `html-to-markdown`**；Bridge 差在落点 API + Desktop 写闸，不是另一套算法 |
| **H5** | Desktop 活文档 UIX-401 / ARCHITECTURE 仍把「归档」写成 PrimaryNav 对等锚 | rewrite docs | Desktop docs | 「动态 · 收件箱 · 写出来 · **搜索**」；归档保持二级（⌘⇧A / 侧栏 / 命令面板） |

Med / Low 见各表，**明确延期**，本轮不改。

---

## 1. Desktop 富工作台

### 1.1 功能与工作流

打开即 **动态**（`view-store` 默认 `kind:"stream"`）。主路径：周期本「记下」→ 旧条「增补」→ 标题栏「记一下」走完整捕获 → 建议在 💡 / SuggestPopover 确认 → 写出来 / 我的情况。找回是 **搜索**（主锚 overlay），不是第四个房间。

写闸：耐久 `.md` 经 `kernelDurableWrite` / `api.ws.save`。AI 不再用 renderer 默认 `auto` 覆盖 yaml。

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| H5 | `DESIGN.md` UIX-401 仍写「主锚点 … · 归档」；`ARCHITECTURE.md` 仍写「+ 归档图标」 | High | rewrite docs |
| D-keep | 记一下 ≠ 记下；URL CTA 用记一下 | — | keep（locale 已分） |
| D-M1 | 收件箱角标每次 `workspace:file-changed` 打 IPC（700ms debounce） | Med | defer |
| D-M2 | 动态页可归档整年：能力对，但和「找回=搜索」的教学距离近 | Med | defer |
| D-L1 | TitleBar 注释仍写 “+ archive icon”（实现已是搜索） | Low | delete（本轮顺手） |

### 1.2 布局 / 交互 / 样式

2026-08-07 密度（36px 标题栏、品牌 chip 删除、建议空态隐藏）仍成立。PrimaryNav 四锚 + ⌘K；右栏 记一下 / 建议 / 待办 / 设置 / AI。标签·看板在侧栏「更多」。不重开像素账。

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| D-keep | 主锚无归档；搜索在主锚；`active` 搜索恒 false（overlay 不是房间） | — | keep |
| D-M3 | 窄屏收起文字标签后，四锚只剩图标，新用户辨识弱 | Med | defer |
| D-L2 | 搜索永不 `aria-current` | Low | defer |

### 1.3 编辑器 / 预览 / 长读

`FileEditorView`：编辑 TipTap、预览静态 HTML，**同一** `proseStyle` + `data-paper` / `data-content-width` / `data-page-padding`。Frontmatter 在属性条，不进正文。专注模式 ⌘⌥F。

动态卡片：`stream-md-preview` 剥 `<!-- topmind:append -->`、转义、任务列表；不是第二套长读编辑器。

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| D-keep | 编辑/预览共享阅读偏好；预览非 chrome 当正文 | — | keep |
| D-M4 | 动态卡片不跟编辑器 paper/字号（feed ≠ 长文） | Med | defer |
| D-L3 | `file-editor-chrome` 测试镜像 `formatFileSize`（既有） | Low | defer |

### 1.4 与 Kernel

路径/收件箱/连接器耐久写走 writeback。Clip Bridge 在线走 Desktop 管线。无新 High 集成谎言。

---

## 2. Obsidian 插件

不重建原生编辑器 / 文件树 / ⌘P。插件只应把五概念接到 Vault：动态页签、记一下弹窗、记下输入、我的情况、写出来留给 Vault 目录。

### 2.1 功能与概念

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| **H1** | 页签 `动态工作台`、按钮 `工作台`、命令 `打开动态工作台`、设置组 `工作台` —— 第六房间 | High | rewrite |
| **H2** | 动态输入 `aria-label=记一下` 但写入周期本；弹窗标题记一下、提交记下 | High | rewrite |
| **H3** | 底栏/命令 `整理记忆` 与「我的情况」脱节 | High | rewrite |
| O-M1 | 工作台画布 + 侧栏都挂建议列表（Desktop 已收到全局弹层） | Med | defer |
| O-M2 | 侧栏第五标签「任务历史」偏引擎，可接受为副驾内部 | Med | defer |
| O-L1 | Ribbon 无默认热键；README 曾写死 ⌘⇧S | Low | 文档改（本轮随 H1） |

### 2.2 布局 / 交互

三入口（动态页签 · 侧栏副驾 · 捕捉弹窗）对 Obsidian 合理。底栏动作偏多，但本轮只改教错的标签，不重排。

捕捉弹窗：目标动态/收件箱 + 标签 = **记一下** 完整捕获（Zap），不是周期本「记下」。

### 2.3 编辑 / 阅读

周期本展开走 Obsidian `MarkdownRenderer`；深度编辑 `openLinkText` 进原生编辑器。符合「不重建编辑器」。

### 2.4 与 Kernel

`capture` / `applySuggestion` / 耐久写经 Kernel；`writebackMode` 省略，用 yaml。无新写闸 High。

---

## 3. Web Clip

Companion，不是第五 Kernel 宿主。离线文件夹写 = 用户手势确认，不经 Node 写闸（Reset 已锁）。

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| **H4** | 选项 i18n / `options.html` / README / 矩阵仍写 lite 转换、Bridge「质量更好」 | High | rewrite |
| C-keep | 写入路径已 `import { htmlToMarkdown } from "./html-to-markdown.mjs"` | — | keep |
| C-keep | 落点先 `topmind.yaml` buffer role，再 `00-*`；不热读 `.topmind-config.json` | — | keep |
| C-M1 | Popup 预览仍是 Readability 纯文本切片，不是落盘 MD | Med | defer |
| C-M2 | `resolveDestDir` 对专题/类别 `create: true`（句柄仍围在已授权根内） | Med | defer |
| C-L1 | `simple-md.js` 文件名易误解（已不是转换器） | Low | defer |

---

## 4. Kernel 交接（用户可见谎言才算 High）

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| K-keep | 单契约写者、热路径不读 v3 JSON | — | keep |
| K-keep | Desktop / Obsidian 耐久 MD 走写闸 | — | keep |
| K-M1 | `applySuggestion` skip 提示路径偶发不带 periodic 年目录 | Med | defer（2026-08-13 F5） |
| A5 | Clip 离线直写 | Low | keep（companion） |

---

## 5. 文档诚实（验收条 3）

活文档不得再教：第六概念、第二套 HTML→MD、归档当主锚、「⌘⇧S 已绑定」。

本轮随 High 改：根/Desktop DESIGN · Desktop ARCHITECTURE · Obsidian DESIGN/README 双文 · Clip README · `docs/capture-clip-matrix.md` · `skills/shared/long-url-capture.md` · Clip ADR 清洗行 · `docs/ARCHITECTURE-RESET.md` 诚实行 · `docs/README.md` ADR 表。

---

## 6. 垃圾（仅引擎/表面死物）

- 过时注释（TitleBar “archive icon”、Clip `lite MD`）  
- 与源码相反的活文档句子  
- 不删用户工作区；不删 `simple-md.js`（仍提供 `buildCaptureMarkdown`）

---

## 7. 完成定义

1. 上表五条 High 在 **用户可见文案或活文档** 上可观察为 after。  
2. 测试打真实入口：Desktop IA / 词汇、Obsidian locale+调用点、Clip i18n 禁 lite 谎言、HTML→MD 同源。  
3. Med/Low 仍写在本文件，不当本轮范围。
