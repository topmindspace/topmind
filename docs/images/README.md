# Desktop 媒体与截图资源索引

[简体中文](README.md) · [English](README.en.md)

本目录存放项目文档引用的**已智能压缩** UI 界面图资源。  
高清源图放在本地的 `topmind-desktop/resources/img/`，该目录已被 gitignore，不在仓库里。

> **截图隐私约定**：入库截图只用演示工作区。本机路径、人名、城市、笔名和第三方文档名一律不入图；已入库的截图里这类文字做了马赛克处理。重新截图请在干净的演示工作区里进行，不要对截图做内容改写。

> **静帧为 2026-09 三栏 chrome · Design System 4.0.5（ZCode Neutral + MD3 暖纸色）**：ActivityBar 记一下；主锚 动态 / Inbox / 交付 / 我的情况；搜索 = ⌘K / ⌘P；右栏是 AI 工作区（对话 / 建议 / 清单 / 应用）。像素 / IA 真源见 `topmind-desktop/DESIGN.md`。若某行仍沿用 2026-08 旧 chrome（TitleBar：记一下 / 💡 / 搜索 / Apps）或冷灰/深色旧主题，该行会明确标注——不要当成现行界面。
>
> 媒体策略：主截图是同一界面的中英双份压缩导出（主图为 `desktop-stream-en.jpg`，英文界面）。

---

## 媒体资源列表

### 核心图片文件

| 文档图 | 源（resources/img） | 典型用途 |
|--------|---------------------|----------|
| `desktop-stream-en.jpg` | 2026-09-30 产品截图 | **英文主截图**：三栏工作台 + AI 对话清单（check my todo） |
| `desktop-suggest-en.jpg` | 2026-09-30 产品截图 | AI 建议分面 — Inbox needs placement（确认执行） |
| `desktop-memory-todo-zh.jpg` | 2026-09-30 产品截图 | 我的情况（画像/周期/专题）+ 清单待办表 |
| `desktop-settings-general-zh.jpg` | 2026-09-30 产品截图 | 设置 · 通用（主题/色彩种子/界面色调/语言） |
| `desktop-settings-general-en.jpg` | 2026-09-30 产品截图 | Settings · General (Theme / Color seed / Language) |
| `desktop-ai-todo.jpg` | `AI清单.png` | AI 工作区**清单**分面 —— 带 AI 来源标记的待办 |
| `desktop-apps.jpg` | `AI应用.png` | AI 工作区**应用**分面 —— 知识加工 · 微信读书 · 记账 |
| `desktop-editor.jpg` | `文章查看-编辑器.png` | Quiet Paper 专注 Markdown 编辑器 |
| `desktop-ingest.jpg` | `知识加工.png` | 多源知识加工队列 Hub |
| `desktop-quick-capture.jpg` | `quicknote.png` | ⌘N / ⌘⇧N 智能识别与极速捕获 |
| `desktop-inbox.jpg` | `Stream.png` | 00-Inbox 缓冲与整理 |
| `desktop-inline-ai.jpg` | `文章查看-编辑器.png` | 行内 AI 润色与结果清洗 |
| `desktop-outputs.jpg` | `文章查看-编辑器.png` | 88-交付 / 交付成品沉淀 |

### Obsidian 插件截图

| 文档图 | 说明 |
|--------|------|
| `obsidian-stream-zh.png` | topmind Stream 插件 · 动态时间轴（中文 UI） |
| `obsidian-stream-en.png` | topmind Stream 插件 · 动态时间轴（英文 UI） |
| `obsidian-suggestions-zh.png` | 插件侧栏 AI 建议（中文 UI） |
| `obsidian-todos-zh.png` | 插件侧栏清单（中文 UI） |

除上表四个分面外的静帧多为三栏改版前导出，已在行内标注；把这些构图当规范引用前请重新截图。

## 引用位置

| 文档 | 用法 |
|------|------|
| [`../../README.md`](../../README.md) · [`README.zh-CN.md`](../../README.zh-CN.md) | 中文总览：`desktop-stream-en.jpg` 为主图 + GIF + MP4 备用 |
| [`../../README.en.md`](../../README.en.md) | 英文总览：`desktop-stream-en.jpg` 为主图，并列中文 chrome + GIF + MP4 备用 |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) · [`README.zh-CN.md`](../../topmind-desktop/README.zh-CN.md) | 富工作台：中文核心截图 + 清单/应用分面 + GIF + 功能心智表 |
| [`../../topmind-desktop/README.en.md`](../../topmind-desktop/README.en.md) | 富工作台：英文核心截图 + 同上 |

## 更新与合成流程

```bash
# 导出静帧：最长边缩到 1440px，再转 JPEG q85
sips -Z 1440 -s format jpeg -s formatOptions 85 \
  "topmind-desktop/resources/img/Stream-AI建议-en.png" --out docs/images/desktop-stream-en.jpg

# 右栏 AI 工作区窄裁图本身是 1x，无需重采样
sips -s format jpeg -s formatOptions 88 \
  "topmind-desktop/resources/img/AI清单.png" --out docs/images/desktop-ai-todo.jpg
```

导出到 `docs/images/` 不会改动源 PNG —— 一律用 `--out` 落盘。
