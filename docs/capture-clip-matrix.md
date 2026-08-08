# Capture · Clip · Ingest 能力矩阵

> 对标常见 Web Clipper + topmind 统一「收进来」体验。  
> 图片约定：[`../skills/shared/media-assets.md`](../skills/shared/media-assets.md) · 扩展说明：[`../browser-extension/README.md`](../browser-extension/README.md)

## Web Clipper（`browser-extension/`；版本见 `browser-extension/manifest.json`）

| 能力 | 状态 | 说明 |
|------|------|------|
| 页内 Readability | ✅ | Mozilla Readability 活 DOM |
| 选区剪藏 | ✅ | popup 模式 / 右键 / 自动探测 |
| 预览（标题可编辑 · 摘要） | ✅ | popup extract-preview |
| Highlighter | ✅ | 页内划选；Alt+点击取消；popup 清除高亮；剪藏高亮 |
| 精简模板 + 域名匹配 | ✅ | 内置 + **自定义 JSON 导入**（options） |
| 文章模板后处理 | ✅ | Bridge：html→md **后再**套 body 模板 |
| Desktop Bridge 高质量 MD | ✅ | 共享 `html-to-markdown` |
| 工作区直写（无 Desktop） | ✅ | FS Access + lite MD + 模板 + 下图 |
| 落点 Inbox / 类别 / 专题 | ✅ | `GET /v1/destinations` + popup 选择 |
| 图片本地化 | ✅ | Bridge + 工作区；lazy/srcset/相对 URL→绝对→下载；`images/{slug}/` 相对路径（见 `skills/shared/media-assets.md`） |
| 整理移专题 | ✅ | 笔记 + `images/{slug}/` **一并移动**；编辑器/Inbox/右键 |
| 发布交付 | ✅ | **副本**到 `88-输出/` + 资源复制；原文保留；**需确认** |
| 快捷键 ⌘⇧M | ✅ | |
| AI Interpreter | ❌ | 不对齐 |

## Desktop 知识加工 · 捕获统一

| 能力 | 状态 | 说明 |
|------|------|------|
| 统一管道 `submitIngestBatch` | ✅ | 拖放 / 选文件 / 剪贴板 / **捕获附件（主窗+浮窗）** |
| 路径引用（不预拷贝） | ✅ | 入队前不写工作区二进制 |
| 转换前确认（可选） | ✅ | `confirmBeforeConvert` 默认 **关**；浮窗强制 auto 入队 |
| 待确认列表 | ✅ | 主窗 Staging；浮窗 auto 后 `openIngestHub` |
| 浮窗文档入队 | ✅ | 入队后聚焦主窗「知识加工」队列（`system.openIngestHub`） |
| 本机工具缓存 | ✅ | 首次/手动检测；帮助/复制走缓存 |
| 内置转换 + markitdown/pandoc | ✅ | |
| 处理队列 UI | ✅ | 知识加工 Hub · 与捕获文案一致 |

### 认知模型

```text
捕获 = 入口（文本/URL/附件）
  ├─ 文本/URL → Inbox 笔记
  └─ 文档附件 → 知识加工队列 → Markdown → Inbox/专题
知识加工 Hub = 队列与工具状态（非第二套转换器）
```

### 共享队列

- 主进程 `ingest` 任务列表是唯一真源；Hub / 浮窗 / 侧栏角标共用。
- 浮窗入队后**就地**展示紧凑队列（可不打开主窗口）；可选「在主窗口打开知识加工」。
- UI 组件：`topmind-desktop/src/components/ingest/IngestQueuePanel.tsx`。

### 窗体

| 面 | Windows | macOS |
|----|---------|-------|
| 主窗 | `hidden` + `titleBarOverlay`（无双 header） | `hiddenInset` |
| 快速捕获浮窗 | 同上 + 自定义拖条 | `hiddenInset` + traffic lights |

### 编辑器行内 AI（与捕获并列的「改写」面）

| 能力 | 状态 | 说明 |
|------|------|------|
| `ai.complete` | ✅ | 无 tools / 无会话；与侧栏同模型配置 |
| `ai.cancelComplete` | ✅ | `requestId` + `AbortSignal` 真取消 |
| 选区浮条 / 工具栏 ✨ | ✅ | 同一动作集；右键 AI 改写 |
| 生成状态 / 取消 | ✅ | spinner · 文案 · Esc/取消 · 不静默卡死 |
| 切换笔记 | ✅ | 清空 UI + abort 在途请求 |
| 选区漂移保护 | ✅ | 替换前比对原文，变化则阻止覆盖 |
| Diff 预览 | ✅ | 选区结果可选行级对比 |
| 未配置 AI | ✅ | 引导设置 → AI |

## Bridge API（v2）

| 端点 | 说明 |
|------|------|
| `GET /v1/health` | 健康 + features |
| `GET /v1/destinations` | Bearer；Inbox / categories / topics |
| `POST /v1/clip` | 正文 + `dest` + `template_id` + `custom_templates` + 图片 |
