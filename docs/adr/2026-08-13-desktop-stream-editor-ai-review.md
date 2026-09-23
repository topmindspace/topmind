# ADR: Desktop Stream / editor / AI surface review（知识工作者 / UIUX）

> **状态**：Accepted · **日期**：2026-08-13  
> **角色**：本轮整改 backlog（非平行产品规格）  
> **范围**：Desktop 工作台交互 · 动态 feed · 文件编辑器（编辑/预览/行内 AI）· Obsidian 动态页签展示 · AI 写闸诚实  
> **不重审**：2026-08-13 已落地且源码中已不在的 High（home/归档主锚、Clip lite 转换器、Obsidian 工作台/记下混用）除非本审查证明回潮

用户概念保持恰好：**记一下 · 动态 · 专题 · 我的情况 · 写出来**。  
对照锁：stream-first、记下≠记一下、写闸唯一、feed 不把 chrome 当正文。

---

## 0. 已锁 IA 对照（不是空赞美）

| 锁 | 现行可观察事实 |
|----|----------------|
| 打开 = 动态 | `view-store` 默认 `kind:"stream"`；PrimaryNav 含搜索、无归档对等锚 |
| 记下 ≠ 记一下 | Desktop 周期本 `composeSubmit=记下` / 顶栏 `capture=记一下` |
| 写闸 | `ai.invoke` **不**带 view-store `writebackMode`；`explicitWritebackMode` 仅显式 auto\|confirm；yaml 为策略 |
| Desktop 卡片 chrome | `prepareStreamMarkdown` 剥 `<!-- topmind:append -->`；单行卡 `stripListChromeForDisplay` 去子弹/时间 |
| 行内 AI 卫生 | `sanitizeInlineAiResult` 主进程 + 渲染层；空结果不落盘 |
| 建议/digest | `isPlaceholderOrPolluted` 拒占位；无 AI 不写周期反思 |

---

## Frozen High list（本轮必须落地）

| # | Finding | Verdict | Surface | Observable before → after |
|---|---------|---------|---------|---------------------------|
| **H1** | 活文档声称「编辑与预览共用同一 Tiptap 实例（`setEditable`）」；实现是 **静态 HTML** 快照（`getEditorHtml` + `dangerouslySetInnerHTML`） | rewrite docs + lock test | Desktop editor / DESIGN | DESIGN §2.3 写同一实例 → 写清：编辑 TipTap、预览静态 HTML、**同一阅读偏好**（`data-paper` / `proseStyle`）；frontmatter 仍在属性条 |
| **H2** | 多行动态卡片只对单行剥 `- HH:MM`，多行正文仍把子弹/时间当内容，与卡头时间芯片重复 | rewrite | Desktop Stream | `StreamMdBody` 对 `parts.main` **一律** `stripListChromeForDisplay`（只动首行，不回写文件） |
| **H3** | Obsidian `parseStreamEntries` 遇空行/`####`/`- `/`- [ ]` 即断 → `formatAppendBlock` 的散文与列表/待办增补从动态页签消失 | rewrite | Obsidian Stream | 非定时子弹/任务算续写；`formatAppendBlock` 列表+待办留在同一卡；展示前剥 HTML 注释 |

**AI 能力：无新 High。** confirm 泄漏、占位 digest、thinking 落盘在现行路径上已不在（见 §4）。本轮不加第六概念、不重开 2026-08-07 像素账。

Med / Low 见各表，**明确延期**。

---

## 1. Desktop 工作台 / 动态 feed

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| **H2** | 多行 moment 首行仍带 `- 10:00` | High | rewrite |
| D-keep | 单行剥 chrome；注释不进 HTML；`StreamDetailView` 走 `streamMarkdownToPreviewHtml` | — | keep |
| D-M1 | 动态卡片不跟随编辑器 paper/字号 | Med | defer（上轮 D-M4） |
| D-L1 | 年归档控件在动态页（能力对，教学距离近） | Low | defer |

## 2. 编辑器（编辑 + 预览 + 行内 AI）

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| **H1** | DESIGN 与实现（静态 HTML 预览）打架 | High | rewrite docs |
| E-keep | `proseStyle` + `data-paper` 包住预览包装；编辑 DOM 另套同一 prefs | — | keep（测试锁上） |
| E-keep | 行内 AI：sanitize、选区漂移保护、离开确认、`documentText` 整篇格式 | — | keep |
| E-M1 | `file-editor-chrome` 测试镜像 `formatFileSize`（既有剧场） | Med | defer（不扩剧场） |

## 3. Obsidian 动态页签

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| **H3** | 增补从 feed 消失；注释可当正文 | High | rewrite |
| O-keep | 时间前缀已从 `entry.text` 拆到芯片 | — | keep |
| O-M1 | 与 Desktop 双套解析（非 Kernel 共享） | Med | defer（本轮只修展示路径） |

## 4. AI 引擎与写闸

| ID | Finding | Sev | Verdict |
|----|---------|-----|---------|
| A-keep | `ai-store.invoke` 不传 `writebackMode` | — | keep |
| A-keep | `sanitizeInlineAiResult` / `isPlaceholderOrPolluted` | — | keep |
| A-M1 | skip 提示路径偶发不带 periodic 年目录 | Med | defer（2026-08-13 F5） |

## 5. 文档诚实

活 DESIGN 不得再写「预览 = 活 TipTap」。Obsidian DESIGN 动态节须承认增补展示与注释剥离。

## 6. 完成定义

1. 上表三条 High 在源码或活文档上可观察为 after。  
2. 测试打真实入口：`stream-md-preview`、`StreamMdBody` 调用点、`parseStreamEntries`/`prepareStreamEntryDisplay`、FileEditorView 预览路径 + `mergeEditorPrefs`。  
3. Med/Low 仍写在本文件。
