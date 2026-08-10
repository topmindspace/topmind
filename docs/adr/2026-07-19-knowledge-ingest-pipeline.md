# ADR: Knowledge Ingest Pipeline + Unified Capture

- **Status**: Accepted（2026-07-19）；Kernel **路由** **Done**（Desktop commit 经 `resolveIngestRoute`，见 `docs/ARCHITECTURE-RESET.md` §2.2）；转换器/任务队列仍 Desktop 本地（非路由 Partial）
- **Deciders**: product + desktop 

## Context

用户需要把本地复杂知识对象（Office、PDF、邮件、文件夹）与文本/链接一起方便地收进 topmind。  
另需：剪贴板文件、捕获窗智能识别附件、类似 OneNote / 备忘录的**全局快速笔记**。

## Decision

### A. 知识加工管道

1. **Desktop 主进程** `IngestService` + 任务队列（runtime 投影，非内容真源）。  
2. **builtin 插件** `topmind-ingest`：Hub / 侧栏 / 设置 / 状态栏 / ⌘K。  
3. **写回**：md-only 默认；失败 original-fallback；可选 sidecar → `99-归档/ingest-originals/`。  
4. **转换栈**：mammoth / unpdf / xlsx / jszip pptx / mailparser / html-to-markdown；可选本机 pandoc/markitdown。  
5. **Skills**：`shared/document-ingest.md` + capture 扩展；无并列 skill 入口。  

### B. 统一捕获表面

1. **QuickCapture** 成为智能统一入口：笔记 · URL · 附件 · 复合提交。  
2. **剪贴板**：`ingest.readClipboard`（路径 + 文本 + HTML）；DOM paste FileList + 智能粘贴按钮。  
3. **全局便签**：`⌘⇧N` 默认打开 `skipTaskbar` 置顶小窗（`?surface=capture`）；设置可改为主窗 overlay。  
4. 小窗标记 **utility BrowserWindow**，不走双 Dock 销毁守卫；与 ephemeral 渲染窗区分。  

## Consequences

- 用户心智：一个「收进来」；文档重活后台队列可见。  
- 安装包增加有限 main 依赖；utility 窗需严格 allowlist 防 Dock 双图标。  
- 剪贴板文件跨平台能力不完全对称（mac 更强；Win 依赖粘贴事件）。  

## Alternatives considered

| 方案 | 否决原因 |
|------|----------|
| 捕获与文档加工永久分家 | 心智分裂、粘贴附件无处放 |
| 默认捆绑 Python MarkItDown | 打包成本 |
| 全局快捷键只 focus 主窗 | 不如便签轻量（OneNote 体验） |
| 多主窗并列 | 双 Dock / 状态分裂 |

## Appendix · Host tool resolve（2026-07-20）

可选增强工具 **不打包**，由本机安装。Desktop GUI 进程常缺用户 PATH：

- 实现：`electron/lib/host-bin.mjs` + `electron/lib/ingest/external-tools.mjs`
- PATH 合并：Python Scripts、`~/.local/bin`、Homebrew、Pandoc 安装目录等
- markitdown：`markitdown` CLI → `py -3 -m` / `python -m` / `python3 -m` → import 探测
- **probe 与 convert 共用 invocation**（cmd + argvPrefix）
- 安装引导按平台排序；Windows 优先 `pip`（非 pipx-only）
- 设置页：多命令复制 + 重新检测

## Amendment · Pipeline batch + tools cache（2026-07-21）

1. **统一管道** `submitIngestBatch`：拖放 / 选文件 / 剪贴板路径 / 捕获附件 → 路径批次 → 处理队列。  
2. **`confirmBeforeConvert`（默认 false）**：关 = 自动入队；开 = `IngestStagingSheet`（主窗 + 浮窗各挂一份，渲染进程隔离）。  
3. **路径引用**：入队前不拷贝二进制；剪贴板语义是路径列表，不是冗余原件复制。  
4. **工具检测**：`ingest-tools-cache.json` 持久缓存；首次无缓存才 probe；「重新检测」force；安装帮助/复制命令也走缓存。  
5. **预览**：`ingest.previewItems` 供 Staging 显示 kind/size/可转换性。
