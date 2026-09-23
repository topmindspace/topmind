# topmind Clip · 浏览器剪藏

[English](README.md) · [简体中文](README.zh-CN.md)

> **版本真源：** [`manifest.json`](./manifest.json)（`npm run versions`）  
> 工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`（剪藏只承担「收进来」）  
> [中文总览](../README.zh-CN.md) · [English](../README.md) · [能力矩阵](../docs/capture-clip-matrix.md)

把当前页 / 选区 / **高亮** 一键放进 topmind 工作区（Inbox · 类别 · 专题）。  
对标常见 Web Clipper 能力：预览 · 高亮 · 模板 · 落点 · 图片本地化。

### 两条写入路径（可只开一条）

| 路径 | 何时用 | 特点 |
|------|--------|------|
| **Desktop Bridge** | Desktop 正在运行 | 同一 HTML→MD · 落点 API · Desktop 写闸 · 图片本地化 |
| **本机工作区** | 不必开 Desktop | File System Access 授权文件夹后直写 |

共享的是**内容规约**（路径 · frontmatter · `external-capture`），不是 Desktop 运行态。

---

## 架构

Canonical ADR: [`../docs/adr/2026-07-13-browser-clip-extension.md`](../docs/adr/2026-07-13-browser-clip-extension.md)

```text
Extension (Mozilla Readability on live DOM)
        │
        ├─ mode=bridge / auto+online
        │     GET  /v1/destinations  → 落点列表
        │     POST /v1/clip          → normalize → template → images → inbox/dest
        │
        └─ mode=workspace / auto+offline
              File System Access → {Inbox|类别|专题}/*.md
              同一 HTML→MD · 模板 · 可选下图
```

| | Bridge | 工作区直写 |
|--|--------|------------|
| 依赖 Desktop 运行 | **是** | **否** |
| HTML→MD | 共享 `html-to-markdown` + 文章模板后处理 | 同一转换器 + 模板（不经 Node 写闸；用户手势即确认） |
| 落点 | destinations API | FS 目录（与 dest 同结构） |
| 图片 | 默认本地化到 `images/{slug}/` | 同左；需 host 权限拉 CDN |
| 安全 | 127.0.0.1 + Bearer + CSP | 用户显式授权目录 |

---

## 打包

```bash
# 仓库根
npm run pack:extension   # dist/topmind-clip-extension-<version>.zip
# 或随 pack:all（skills + extension + obsidian）
```

产品 tag `v*` 的 Latest 快照含当前扩展 zip；`extension-v*` 仅热修逃生口。版本真源：[`manifest.json`](./manifest.json)（`npm run versions`）。

---

## 安装 / 升级

### 从 Release 安装（推荐用户）

1. 下载 [Releases](https://github.com/topmindspace/topmind/releases) 中的 `topmind-clip-extension-<ver>.zip`
2. 解压到本地任意目录
3. Chrome / Edge → `chrome://extensions` → 开发者模式 → **加载已解压的扩展** → 选解压目录

### 升级

1. 下载新版 zip，解压覆盖本地扩展目录（或解压到新目录）
2. 在 `chrome://extensions` 点该扩展的 **重新加载**
3. Token / 工作区目录授权一般会保留；若 Bridge 连不上，到选项页重新粘贴 Token 并测试

### 开发安装

1. Chrome / Edge → `chrome://extensions` → 开发者模式 → **加载已解压的扩展** → 选 monorepo 内 `browser-extension/`  
2. 打开工具栏扩展：未配置时会进入 **Setup 引导**  
3. 在扩展 **选项** 配置其一或两者：  
   - **Bridge**：Desktop 设置 → 通用 → 浏览器剪藏 → 启用 → 复制 Token → 粘贴到扩展并测试  
   - **工作区**：选择工作区文件夹 → **重新授权写入**（或首次剪藏时确认浏览器权限）  
4. 写入模式：`自动`（默认）| `仅 Bridge` | `仅工作区`

**本机模式权限说明：** Chromium 把目录句柄存进 IndexedDB 后，跨会话权限常为 `prompt`。  
Service Worker **不能**弹授权框；须在 **options / 弹窗点击** 下调用 `requestPermission`。  
本扩展：选文件夹后立刻再确认一次；弹窗点「剪藏」前也会自动确认。

---

## 使用

- 工具栏 popup：可编辑标题 · **预览** · 模式 · **落点** ·「高亮模式」
- 高亮：页面拖选标记；**Alt+点击**取消单条；popup「清除高亮」一键清空；再选「高亮」模式剪藏
- 右键菜单 · `⌘⇧M` / `Ctrl+Shift+M`  
- 成功：徽章 ✓ · 路径回执；失败徽章 ✕ / 未配置 `!`

### 模板

内置：`article` · `selection` · `bookmark` · `github` / `zhihu`。  
自定义：选项页 **导入/导出 JSON**（`chrome.storage`）。  
Bridge 与工作区：正文都 **先走同一 HTML→MD 再套模板**。Bridge 另走 Desktop 落点 API 与写闸。

### 性能要点

- Popup 首屏只读 tab 元数据；空闲后再 extract-preview  
- Readability 同页会话内复用注入  
- 受限协议（`chrome://` 等）快速失败，不注入脚本  
- auto 模式使用 health cache；剪藏结果双写 storage，避免 *message channel closed*

---

## 国际化

Chrome 原生 i18n：`_locales/` + `chrome.i18n.getMessage()`。  
当前：`zh_CN` · `en_US`。

---

## 排障

| 现象 | 建议 |
|------|------|
| 设置页按钮无响应 | 重新加载扩展；查看 options 错误提示 |
| 「选择工作区文件夹」无反应 | 使用 Chrome/Edge 86+；确认非企业策略禁用 File System Access |
| Bridge 连不上 | Desktop 已启用剪藏、Token 一致、本机 127.0.0.1 未被拦截 |
| 图片未本地化 | Bridge 在线且有图权限；工作区模式需 host 权限访问图片 CDN |

---

## 安全

- Bridge **仅**绑定 `127.0.0.1`，Bearer Token  
- 不在扩展源码中提交真实 Token  
- 详见 [`../SECURITY.md`](../SECURITY.md)

返回总览：[`../README.zh-CN.md`](../README.zh-CN.md)
