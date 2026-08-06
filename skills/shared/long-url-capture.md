# 长 URL / 网页抓取约定

> Skills（agent host）与 Desktop `workspace.fetchUrl` 对齐。抓取是加速器，**文件系统落盘**仍是真源。

## 目标

把网页变成可审阅的 Markdown 笔记（`source_type: external-capture`），不假装「已完整镜像整站」。

## 分层策略

```text
L1  静态 HTTP fetch + Readability / 启发式     ← 默认
L2  Desktop 增强渲染（隐藏 Chromium offscreen） ← SPA 空壳 / 「增强渲染」
L3  用户粘贴 / 浏览器复制                         ← 永远可用
L3+ 浏览器扩展 → Bridge 和/或 工作区直写          ← 推荐日常剪藏
```

| 层 | 入口 | 说明 |
|----|------|------|
| L1 | `fetchUrl({ url })` | `@mozilla/readability` + `html-to-markdown`；无第二窗口 |
| L2 | `fetchUrl({ url, render: true })` | `fetch-render.mjs` + ephemeral 窗（不占 Dock） |
| L3 | 手动 | 失败回退 |
| L3+ | Extension | 页内 Readability + **预览 / 选区 / 高亮 / 模板 / 落点**；**Bridge**（高质量 MD + 图片本地化 + destinations）或 **工作区目录**（FS Access，无 Desktop）。见 ADR · `browser-extension/` · `docs/capture-clip-matrix.md` |

**复用原则**：扩展负责活 DOM 正文与高亮；Bridge 路径复用 Desktop 清洗与文章模板后处理；工作区直写用 lite MD + 同一 frontmatter 规约（降级可用）。落点：Inbox / 类别 / 专题（Bridge 在线时 popup 可选）。

Agent host 无 Electron 时停在 L1/L3；扩展 **不强制** Desktop 在线（可配置工作区直写）。

## 长度与截断

| 模式 | 上限 |
|------|------|
| 默认 | 40k 字符 |
| 完整抓取 | 200k 字符 |

**必须**在 UI 或 frontmatter 标明：截断、约字数、提取方法、清洗后 URL。用户不可见截断 = 产品缺陷。

## Frontmatter 建议

```yaml
source_type: external-capture
source: https://example.com/article
captured_at: 2026-07-13T12:00:00+08:00
fetch_method: readability   # readability | heuristic | render | selection | manual
fetch_truncated: false
word_count: 1200
```

## Desktop UX

- QuickCapture：截断 → 完整抓取；SPA → 增强渲染；保存后打开落盘路径  
- Inbox：按 `source_type` 筛选「网页/摘录」  
- AI `fetch_url` 支持 `maxLen` + `render`  

## 不要做的事

- 不把整页 HTML 当笔记正文  
- 不静默丢弃后半篇  
- 不把抓取失败写成「已成功 capture」  
- 不用常驻第二 BrowserWindow 占 Dock（仅 ephemeral 隐藏窗）  
