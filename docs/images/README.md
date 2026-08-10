# Desktop 媒体与截图资源索引

本目录存放项目文档引用的**已智能压缩** UI 界面图与**全流程动态演示**资源。  
高清源图在开发机 `topmind-desktop/resources/img/`。

> 媒体策略：以 `topmind-desktop/resources/img/Stream-AI建议.png` 压缩导出版本为主要核心截图；全流程动态演示以高保真满彩 GIF 为主显示格式（GitHub 原生支持 `<img>` 内联动画），MP4 高清视频作为备用下载源。

## 媒体资源列表

### 动态演示资源 (Product Demo Media)

| 资源文件 | 格式 | 说明 |
|----------|------|------|
| `topmind-demo.gif` | Animated GIF (800px / 12fps / two-pass palette) | **主显示格式**（GitHub `<img>` 原生内联动画，13 个独立场景平滑淡入淡出过场） |
| `topmind-demo.mp4` | MP4 (H.264 / 1080p / 30fps) | HD 高清备用下载源（GIF 无法播放时用本地播放器打开） |
| `topmind-demo.webm` | WebM (VP9) | 脚本生成的兼容备份格式（当前 README 未直接引用） |

### 核心图片文件

| 文档图 | 源（resources/img） | 典型用途 |
|--------|---------------------|----------|
| `desktop-stream.jpg` | `Stream-AI建议.png` | **核心主要截图**：Stream 动态主表面 + AI 整理与建议 |
| `desktop-home-workspace.jpg` | `Stream.png` | Stream 动态时间轴全貌 |
| `desktop-editor.jpg` | `文章查看-编辑器.png` | Quiet Paper 专注 Markdown 编辑器 |
| `desktop-ingest.jpg` | `知识加工.png` | 多源知识加工队列 Hub |
| `desktop-quick-capture.jpg` | `quicknote.png` | ⌘N / ⌘⇧N 智能识别与极速捕获 |
| `desktop-ai-agent.jpg` | `AI建议.png` | 侧栏 Agent · 待办与写闸确认 |
| `desktop-ai-todo.jpg` | `AI建议.png` | AI 待办自动维护 |
| `desktop-inbox.jpg` | `Stream.png` | 00-收件箱缓冲与整理 |
| `desktop-inline-ai.jpg` | `文章查看-编辑器.png` | 行内 AI 润色与结果清洗 |
| `desktop-outputs.jpg` | `文章查看-编辑器.png` | 88-输出 / 交付成品沉淀 |
| `desktop-settings-*.jpg` | 各设置页源图 | 设置中心各分页截图 |

## 引用位置

| 文档 | 用法 |
|------|------|
| [`../../README.md`](../../README.md) | 总览：**主要截图 (Stream-AI建议)** + **GIF 演示动画** + MP4 备用下载 |
| [`../../README.en.md`](../../README.en.md) | 英文总览：**Primary Screenshot** + **GIF Demo** + MP4 fallback |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) | 富工作台：核心截图 + GIF 演示 + 功能心智表 |

## 更新与合成流程

```bash
# 压缩图片并导出 JPG/PNG 资源
node -e '
  import { execSync } from "child_process";
  execSync("sips -Z 1440 topmind-desktop/resources/img/*.png");
  execSync("sips -s format jpeg -s formatOptions 85 topmind-desktop/resources/img/Stream-AI建议.png --out docs/images/desktop-stream.jpg");
'

# 合成动态演示资源 topmind-demo.mp4 / webm / gif
# 使用两遍调色板优化（stats_mode=diff）确保 GIF 忠实还原视频色彩
node scripts/create-demo-video.mjs
```

### GIF 生成技术说明

GIF 采用 **two-pass palette** 方式生成，确保忠实还原视频内容：

1. **第一遍**：从完整视频生成最优调色板（`palettegen=stats_mode=diff:max_colors=256`）
2. **第二遍**：将调色板应用到视频帧（`paletteuse=dither=sierra2_4a:diff_mode=rectangle`）
3. **参数**：800px 宽度 / 12fps / lanczos 缩放算法

这种方式确保 GIF 的色彩与 MP4 视频保持一致，避免单遍生成时的色彩偏差。
