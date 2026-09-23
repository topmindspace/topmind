# Desktop 媒体与截图资源索引

[简体中文](README.md) · [English](README.en.md)

本目录存放项目文档引用的**已智能压缩** UI 界面图与**全流程动态演示**资源。  
高清源图在 `topmind-desktop/resources/img/`——该目录**已被 gitignore**（只存在于开发机），请把它当作本机源图库，而不是仓库路径。

> **静帧为 2026-09 三栏 chrome**：记一下在左栏 header；主锚 动态 / Inbox / 交付；搜索 = ⌘K / ⌘P；右栏是 AI 工作区（对话 / 建议 / 清单 / 应用）。若某行仍沿用 2026-08 旧 chrome（TitleBar：记一下 / 💡 / 搜索 / Apps），该行会明确标注——不要当成现行界面。
>
> 媒体策略：主截图是 `topmind-desktop/resources/img/Stream-AI建议.png`（中文）与 `Stream-AI建议-en.png`（同一界面、英文 chrome）的压缩导出版本；全流程动态演示以高保真满彩 GIF 为主显示格式（GitHub 原生支持 `<img>` 内联动画），MP4 高清视频作为备用下载源。

---

## 媒体资源列表

### 动态演示资源

| 资源文件 | 格式 | 说明 |
|----------|------|------|
| `topmind-demo.gif` | Animated GIF (800px / 12fps / two-pass palette) | **主显示格式**（GitHub `<img>` 原生内联动画，13 个独立场景平滑淡入淡出过场） |
| `topmind-demo.mp4` | MP4 (H.264 / 1080p / 30fps) | HD 高清备用下载源（GIF 无法播放时用本地播放器打开） |
| `topmind-demo.webm` | WebM (VP9) | 脚本生成的兼容备份格式（当前 README 未直接引用） |

### 核心图片文件

| 文档图 | 源（resources/img） | 典型用途 |
|--------|---------------------|----------|
| `desktop-stream.jpg` | `Stream-AI建议.png` | **中文主截图**：三栏工作台 · 动态时间轴 + 右栏 AI 建议 |
| `desktop-stream-en.jpg` | `Stream-AI建议-en.png` | **英文主截图**：同一界面，英文 chrome |
| `desktop-ai-todo.jpg` | `AI清单.png` | AI 工作区**清单**分面 —— 带 AI 来源标记的待办 |
| `desktop-apps.jpg` | `AI应用.png` | AI 工作区**应用**分面 —— 知识加工 · 微信读书 · 记账 |
| `desktop-editor.jpg` | `文章查看-编辑器.png` | Quiet Paper 专注 Markdown 编辑器 |
| `desktop-ingest.jpg` | `知识加工.png` | 多源知识加工队列 Hub |
| `desktop-quick-capture.jpg` | `quicknote.png` | ⌘N / ⌘⇧N 智能识别与极速捕获 |
| `desktop-ai-agent.jpg` | `AI建议.png` | 2026-08 旧 AI 轨静帧（非 2026-09 AI 工作区右栏） |
| `desktop-inbox.jpg` | `Stream.png` | 00-Inbox 缓冲与整理 |
| `desktop-inline-ai.jpg` | `文章查看-编辑器.png` | 行内 AI 润色与结果清洗 |
| `desktop-outputs.jpg` | `文章查看-编辑器.png` | 88-交付 / 交付成品沉淀 |
| `desktop-settings-*.jpg` | 各设置页源图 | 设置中心各分页截图 |

除上表四个分面外的静帧多为三栏改版前导出，已在行内标注；把这些构图当规范引用前请重新截图。

## 引用位置

| 文档 | 用法 |
|------|------|
| [`../../README.md`](../../README.md) | 英文总览：`desktop-stream-en.jpg` + GIF + MP4 备用 |
| [`../../README.zh-CN.md`](../../README.zh-CN.md) | 中文总览：`desktop-stream.jpg` + GIF + MP4 备用 |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) | 富工作台：核心截图 + 清单/应用分面 + GIF + 功能心智表 |
| [`../../topmind-desktop/README.zh-CN.md`](../../topmind-desktop/README.zh-CN.md) | 同上，中文版 |

## 更新与合成流程

```bash
# 导出静帧：最长边缩到 1440px，再转 JPEG q85
sips -Z 1440 -s format jpeg -s formatOptions 85 \
  "topmind-desktop/resources/img/Stream-AI建议.png" --out docs/images/desktop-stream.jpg

# 右栏 AI 工作区窄裁图本身是 1x，无需重采样
sips -s format jpeg -s formatOptions 88 \
  "topmind-desktop/resources/img/AI清单.png" --out docs/images/desktop-ai-todo.jpg

# 合成动态演示资源 topmind-demo.mp4 / webm / gif
# 使用两遍调色板优化（stats_mode=diff）确保 GIF 忠实还原视频色彩
node scripts/create-demo-video.mjs
```

导出到 `docs/images/` 不会改动源 PNG —— 一律用 `--out` 落盘。

### GIF 生成技术说明

GIF 采用 **two-pass palette** 方式生成，确保忠实还原视频内容：

1. **第一遍**：从完整视频生成最优调色板（`palettegen=stats_mode=diff:max_colors=256`）
2. **第二遍**：将调色板应用到视频帧（`paletteuse=dither=sierra2_4a:diff_mode=rectangle`）
3. **参数**：800px 宽度 / 12fps / lanczos 缩放算法

这种方式确保 GIF 的色彩与 MP4 视频保持一致，避免单遍生成时的色彩偏差。
