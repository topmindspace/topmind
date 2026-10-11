# ADR: Browser Clip Extension → topmind Desktop

## Status

Accepted · 2026-07-13 · **Amended 2026-07-19**（工作区直写通道）

## Context

用户常在浏览器阅读长文 / SPA，需要一键剪藏进 topmind Inbox（`source_type: external-capture`），且：

- 内容可能很长（> URL 长度上限）
- Desktop 已有 `WorkspaceService.ingestInbox` + 备份链
- 不得引入第二内容真源、不得默认依赖 UTR
- **不强制** Desktop 进程必须运行

## Decision

> **2026-08-24 勘误**：下方并行路径的两处原始表述已过时——(1)「HTML→MD 用扩展内 lite（降级）」：2026-08-13 对抗式评审后扩展统一携带与 Desktop 同源的 `html-to-markdown.mjs`（不再是 lite 降级版），Bridge 不可达时的本地产出与 Bridge 同质；(2)「{00-收件箱|config buffer}」：目的地解析以现场 `topmind.yaml` v4 的 buffer role 目录为准（英文/改名工作区如 `00-Inbox` 同样命中），不再表述为读 config。见 2026-08-13-adversarial-first-principles-review 与本文 2026-07-21 修订。

### 主路径：扩展 + Desktop Clip Bridge（高质量）

```text
Browser Extension (MV3)
        │  页内 Mozilla Readability（活 DOM）
        │  POST http://127.0.0.1:<port>/v1/clip
        │  Authorization: Bearer <token>
        ▼
Desktop Clip Bridge → normalizeClipPayload → ingestInbox
```

### 并行路径：工作区直写（无 Desktop 运行态）

```text
扩展选项页 showDirectoryPicker → 授权 topmind-workspace 根
        │  handle 存 IndexedDB
        ▼
clip 时 FileSystemDirectoryHandle 写 {00-收件箱|config buffer}/*.md
        │  frontmatter 对齐 capture（clip_channel: extension-workspace）
        │  HTML→MD 用扩展内 lite（降级；Bridge 仍优先）
```

**写入模式**（扩展 options）：`auto`（默认：Bridge 可达则 Bridge，否则工作区）| `bridge` | `workspace`。

共享的是 **PROJECT-MODEL 规约**（路径 · frontmatter · source_type），**不是** Desktop IPC/运行态。

### 为什么不是其他方案

| 方案 | 结论 |
|------|------|
| `topmind://clip?body=…` 自定义协议 | ❌ 长文/HTML 会撞 URL 长度 |
| Native Messaging | ⚠️ 未来可选；安装宿主成本高，不作为默认 |
| 云同步 | ❌ 违背本地优先 |
| 扩展无授权乱写盘 | ❌ 安全不可控；**必须**用户显式目录授权 |
| 仅 Bridge | ⚠️ 强迫 Desktop 常开 — 故增加工作区直写 |

### 安全边界

1. **仅绑定 `127.0.0.1`**（禁止 `0.0.0.0`）  
2. **Bearer token**（Desktop 生成；设置页可轮换；扩展本地存储）  
3. **CORS**：仅允许 extension 来源的简单 POST；预检返回最小头  
4. **Body 上限**（默认 2MB，与 ingest 一致）  
5. **无工作区时**返回 503，不静默写盘  
6. **默认关闭** Clip Bridge；用户在设置中启用  

### 扩展职责边界

| 扩展做 | 扩展不做 |
|--------|----------|
| 读选区 / 当前页 URL / 标题 | 不维护第二知识库 |
| **Mozilla Readability** 页内正文（与 Desktop 同引擎）+ 启发式回退 | 不自维护 HTML→Markdown 转换器 |
| 调 Bridge + 展示成功/失败 | 不跑完整 topmind router / 不替代 Desktop AI / Skills |

长文 SPA：扩展在**用户已打开的活 DOM**上跑 Readability（通常优于 L1 静态 fetch）；POST `content_html`，由 Clip Bridge 复用 Desktop `html-to-markdown` / `normalizeClipPayload` 清洗。不足时仍可在 Desktop QuickCapture「增强渲染」。

### 版本与分发

- 扩展源码：`browser-extension/`（MV3，Chrome / Edge / Chromium；Firefox 后续 manifest 适配）  
- Desktop 设置：`clipBridge.enabled` · `port` · `token`  
- 打包：扩展不进 electron-builder 主包；文档说明「加载已解压扩展」开发模式 + 可选商店发布  

## Consequences

- Desktop 增加可选本地 HTTP 服务（进程内，随 app 启停）  
- 设置页增加「浏览器剪藏」面板  
- Skills `topmind-capture` / `long-url-capture.md` 引用扩展为 L3+ 入口  
- 测试：协议 JSON schema 单测 + Bridge 单元（mock server 可选）  

## Alternatives rejected (detail)

- **Native Messaging only**：安装 `nmh` 宿主 + 注册表/plist 脆弱，跨平台维护重  
- **WebSocket**：对「单次 POST 剪藏」过度；HTTP 更易调试与 CORS  

## Related

- `PRODUCT-BOUNDARIES.md` — Desktop 独立写回  
- `skills/shared/long-url-capture.md` — 抓取分层  
- `topmind-desktop/electron/lib/clip-bridge.mjs` — Bridge HTTP  
- `topmind-desktop/electron/lib/clip-payload.mjs` — payload 规范化（复用清洗）  
- `topmind-desktop/electron/lib/fetch-article.mjs` · `html-to-markdown.mjs` — 抽取 / 转换  
- `browser-extension/` — MV3 源码（`lib/vendor/Readability.js`）  

## Amendment · Performance & messaging（2026-07-20）

| 问题 | 对策 |
|------|------|
| Popup 慢 / 引导弱 | 首屏只读 tab 元数据；未配置显示 Setup 卡；options 总览 + deep-link |
| 剪藏慢 | Readability 同页复用注入；article/main 优先 clone；auto 模式 health cache 跳过重复探测 |
| `message channel closed` | 剪藏 **立即 ack**（`status:started`），结果只写 `lastClipResult` + badge；popup 轮询 storage；health 仍 `respondAsync` |
| 配置 | Desktop General 三步说明；扩展 options Bridge/工作区双路径 |

## Amendment · Obsidian-parity core（2026-07-21 · extension v1.2）

| 能力 | 实现 |
|------|------|
| 预览 | popup `extract-preview` + 可编辑标题 + 字数/模式徽章 |
| Highlighter | `lib/highlight.js`；拖选高亮；模式 `highlights`；空高亮不误剪整页 |
| 精简模板 | 内置 + 域名匹配 + **自定义 JSON**（options 导入/导出） |
| 元数据 | author / published / `clip_template` / `images_localized` |
| 落点 | `GET /v1/destinations` + popup；`dest: inbox \| topic \| category` |
| 清洗 | Bridge 与工作区直写共用 Desktop `html-to-markdown`（`simple-md.js` 只封装 frontmatter，不是第二套转换器） |
| 文章模板 | Bridge：html→md **之后** `applyArticleTemplate`（`clip-templates.mjs`） |
| 图片 | Bridge + 工作区；笔记旁 `images/{slug}/` 相对路径；设置可关 |
| API | Bridge **v2**：health.features · destinations · clip(dest/template/images) |
