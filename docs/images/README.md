# Desktop 截图索引

文档与 README 引用本目录**已压缩**导览图。高清源图在开发机  
`topmind-desktop/resources/img/`（`topmind-desktop/resources/` gitignore）。

> 全量产品 UI 导览图：JPEG · 宽边约 1280–1440 · 质量 78–80。  
> README 展示用 HTML `width` / 表格分栏控制预览占用，避免全宽占满屏幕。

## 推荐展示宽度（GitHub 预览）

| 场景 | 建议 `width` | 布局 |
|------|--------------|------|
| 英雄图（工作台总览） | **680–720** | 单列居中 |
| 横向三栏摘要 | **260–300** | 3 列表格 |
| 横向两栏 | **320–360** | 2 列表格 |
| 竖长图（AI 面板 / 设置） | **200–220** | 多列表格，限制高度感 |
| 宽条（交付 / 行内 AI） | **360–520** | 单列或跨列 |

## 文件一览

| 文档图 | 源（resources/img） | 典型用途 |
|--------|---------------------|----------|
| `desktop-home-workspace.jpg` | `首页-Stream-动态-英文版.png` | 英雄图 · 总览 |
| `desktop-stream.jpg` | `首页-Stream-AI建议.png` | 动态主表面 + AI 建议（Stream-first 叙事） |
| `desktop-inbox.jpg` | `Inbox.png` | 收件箱 |
| `desktop-quick-capture.jpg` | `智能识别和抓取.png` | 捕获 |
| `desktop-ingest.jpg` | `知识加工.png` | 知识加工 |
| `desktop-outputs.jpg` | `Outputs交付.png` | 交付 |
| `desktop-inline-ai.jpg` | `Inline AI.png` | 行内 AI |
| `desktop-ai-agent.jpg` | `AI面板和AI任务.png` | 侧栏 Agent（竖图） |
| `desktop-ai-todo.jpg` | `AI-todo.png` | **AI 待办 · 动态 · 建议** 特色图 |
| `desktop-settings-general.jpg` | `设置-通用.png` | 设置 · 通用 |
| `desktop-settings-workspace.jpg` | `设置-工作区.png` | 设置 · 工作区 |
| `desktop-settings-ingest.jpg` | `设置-知识加工.png` | 设置 · 加工 |
| `desktop-settings-skills.jpg` | `设置-Skills.png` | 设置 · Skills |
| `desktop-settings-plugins.jpg` | `设置-plugins.png` | 设置 · 插件 |
| `desktop-settings-weread.jpg` | `设置-微信读书.png` | 设置 · 微信读书 |

## 引用位置

| 文档 | 用法 |
|------|------|
| [`../../README.md`](../../README.md) | 总览：英雄图 + **AI 待办/Memory/建议** + 摘要网格 |
| [`../../README.en.md`](../../README.en.md) | 同上（英文） |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) | 完整导览 · 动态 AI 润色/待办入口说明 |

## 更新流程

```bash
# 需要 Pillow
SRC=topmind-desktop/resources/img
OUT=docs/images
# 宽边 ≤1440、JPEG progressive、quality ~78 — 见维护会话脚本或本地导出
```

导出后核对三处 README 的路径与 `width`，避免全宽无约束 `![](...)` 把竖图撑满视口。
