# topmind Desktop

[English](README.md) · [简体中文](README.zh-CN.md)

> 本地优先**富工作台** — 动态流 · 深度编辑 · AI 副驾 · 可逆写回。  
> **版本真源：** 本目录 [`package.json`](./package.json)（`npm run versions`）。  
> **内容真源：** 始终是**工作区文件夹**；不硬依赖 UTR。  
> 用户概念 ≤5：**记一下 · 动态 · 专题 · 我的情况 · 写出来**  
> 工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`

[产品总览](../README.zh-CN.md) · [English overview](../README.md) · IA / 像素：[`DESIGN.md`](./DESIGN.md) · 架构：[`ARCHITECTURE.md`](./ARCHITECTURE.md) · 实施锁：[`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md)

---

## 为什么选 Desktop

| 痛点 | 解决路径 |
|------|----------|
| 灵感没空分类 | ⌘N / ⌘⇧N -> 默认**本周动态** |
| Office / PDF 散落 | 拖入**知识加工**队列 |
| 润色要切聊天 | **行内 AI** + 侧栏 Agent（结果已清洗） |
| 换工具丢格式 | 纯 Markdown · 文件自由 |

1. **动态优先导航** — 概念不堆砌；收件箱 / 写出来 / 我的情况清晰可达  
2. **Quiet Paper** — 字号 / 行距 / 栏宽 / 纸张 · 专注 ⌘⌥F  
3. **AI 副驾** — skill-first · `auto | confirm` 写回 · 建议默认可生成、确认后执行；多路 AI 时 prep 串行、对话独立（见 `DESIGN.md` §0.0.3）  
4. **多源加工** — 默认 anydoc（Word · PDF · Excel · PPT · ODF · RTF · EPUB · CSV）+ 内置邮件/HTML → Markdown；可选 markitdown / pandoc  
5. **可组合** — 与 Skills / 剪藏扩展 / 可选 UTR 共享内容约定，无强制运行时绑定。微信读书走官方 Agent Gateway；增量按条数与指纹跳过；无划线/想法的书不建专题。  
6. **捕获词汇** — **记一下**（完整捕获 · EN Note it）≠ **记下**（动态主区 · EN Log it）  
7. **本地化 AI** — UI 语言与工作区 `locale` 驱动 Agent / 行内 AI / 待办 / 建议的中英提示与结果  
8. **管理与更新** — 设置内探测 Agent 宿主 · 浏览器 · Obsidian，支持 Skills / 剪藏 / 插件的安装升级卸载（浏览器侧为引导加载，不静默注入）；统一更新检查与健康诊断
9. **可选记账** — 启用后小应用（`memory/ledgers/`；Apps 菜单 / 状态栏 / ⌘K）。不是第六个用户概念，也不是 PrimaryNav

---

## 界面导览与演示

截图已压缩整理（原始高分辨率图仅在开发机的 `resources/img/`——该目录不入库；全局图片库见 [`../docs/images/`](../docs/images/README.md)）。

### 1. 核心工作台表面（`Stream` 与 AI 建议）

默认三栏：**导航 -> 内容 -> AI 副驾**。主叙事是动态时间轴。

<p align="center">
  <img src="../docs/images/desktop-stream.jpg" alt="Topmind Desktop 主表面 · Stream 与 AI 建议" width="760" />
</p>

### 2. 全流程动态演示

<p align="center">
  <img src="../docs/images/topmind-demo.gif" alt="Topmind Desktop 完整功能演示动画" width="820" />
</p>

<p align="center">
  <sub>如果环境无法自动播放，可直接下载或播放 <a href="../docs/images/topmind-demo.mp4">HD MP4 高清演示视频</a>。</sub>
</p>

### 3. 核心功能与交互心智

| 入口 | 作用（单一心智） |
|------|------------------|
| 顶栏 **记一下** ⌘N | **唯一**完整捕获（笔记 / 链接 / 附件） |
| 全局浮窗 ⌘⇧N | 随时随地快捷速记，提交至捕获队列 |
| 动态 **记下** | 把输入框追加到本周周期本 |
| 动态 **AI 润色** | 行内清洗与润色，只改输入框 · 不落盘 |
| 动态 / 侧栏 **AI 待办** | 自动提取待办 · 检测完成 · 确认更新 |
| AI 面板 **ActionBar** | 建议 + 待确认写入；确认后再过 Kernel 写闸 |
| 侧栏 **我的情况** | 记忆平面浏览（画像 / 周期反思 / 专题记忆）；点开条目仍落文件 |
| **知识加工 Hub** | 默认 anydoc 转 Markdown（Word / PPT / Excel / ODF / RTF / EPUB / PDF / CSV）；可选 markitdown / pandoc；邮件走内置 |

- **阅读 Aa**：字号 / 行距 / 字族 / 栏宽 / 边距 / 纸张（编辑与预览共用同一阅读偏好；预览是静态 HTML 快照，不是 live TipTap）  
- **文件**：`.md` 走 Markdown 编辑器（主画布与分屏同一路由）；其它文件走 `FilePreviewView`（HTML 沙箱 / 文本 / 打开外部）  
- **行内 AI / 动态润色**：`ai.complete`（`action: "polish"` 等）· 结果清洗后再展示  
- **Agent**：`load_skill` · 写回 auto/confirm · ActionBar（建议 + 待确认写入）  
- **待办**：`memory/todo.md` · 写闸 · AI maintain（extract / detect done / force）  
- 专注模式 ⌘⌥F · 多标签 / 单标签  

---

## 心智模型

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

```text
~/topmind/
├── topmind-workspace/     # 内容真源（用户数据）
└── topmind-desktop/       # runtime（state / plugins / logs）
```

- 类别 + 专题：[`../PROJECT-MODEL.md`](../PROJECT-MODEL.md)  
- AI skill-first：引擎 `skills/` + 可选 `skills-extra/`  
- AI 供应商：OpenAI · Anthropic · Google · xAI · DeepSeek · Moonshot · Zhipu · MiniMax · Ollama（本地）· Custom；官方 list-models + models.dev 社区目录 + 精选回退
- 四体边界：[`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md)  

---

## 国际化 · 本地化 AI

- UI 默认 `auto`：按 OS / `navigator.language` 匹配 `zh-CN` 或 `en-US`  
- 主窗与 `CaptureSurface` 浮窗同步切换；语言包：`src/locales/{zh-CN,en-US}/`  
- **工作区 locale**（`topmind.yaml` 的 `locale` / `workspace.locale`）在宿主 UI 为 `auto` 时作为最后一档  
- **文档 AI**（行内改写 / Agent 写入打开的笔记）：本轮明确要求 → 原文 → 工作区 locale。不会因为 UI 是英文就把中文笔记改写成英文。  
- **产品 AI**（建议条、待办抽取/维护、记忆整理）：本轮明确要求 → Desktop UI 语言（非 `auto`）→ 工作区 locale。Obsidian 用插件/应用语言，同一规则。  
- 解析：`lib/ai-output-locale.mjs`（`resolveOutputLanguage` 与 `resolveProductAiLanguage`）

---

## 安装 / 升级 / 管理

### 安装 Desktop

#### 方式一：Homebrew 安装（macOS 推荐 · 一键解隔离）
```bash
brew install topmindspace/tap/topmind
```
*通过 Homebrew 安装会自动清理 macOS `quarantine` 属性，免去未签名应用的“已损坏无法打开”报错。*

#### 方式二：手动下载安装包
1. 从 [Releases](https://github.com/topmindspace/topmind/releases) 下载对应系统安装包：`topmind-<ver>-<os>-<arch>.{dmg,exe,AppImage,deb}`  
   （日常产品 tag `v*` 构建 Desktop 矩阵；`desktop-v*` 仅热修逃生口）
2. 安装并打开；首次选择或创建本地工作区文件夹（内容真源）  
   *（macOS 若手动安装提示损坏打不开，可在终端运行：`sudo xattr -rd com.apple.quarantine /Applications/Topmind.app`）*
3. 可选：设置 -> AI 配置 Provider；设置 -> 通用 -> 浏览器剪藏 启用 Clip Bridge

### 设置 -> 管理与更新
| 能力 | 行为 |
|------|------|
| **Agent Skills** | 探测 Claude Code / Codex / Hermes / OpenCode / CodeBuddy 等；安装到宿主全局 skills 根；独立路径 `npm run skills:install`（仓库脚本）与社区 `npx skills add topmindspace/topmind` 仍然有效 |
| **剪藏扩展** | 解压到本机托管目录 + 引导“加载已解压的扩展”——**不能**静默写入 Chrome；支持卸载（清理托管目录） |
| **Obsidian 插件** | 支持官方社区插件库安装（发布审核中） / BRAT 插件 / 直装 `plugins/topmind-stream/` |
| **独立路径** | CLI `npm run skills:install`（仓库脚本）/ 社区 `npx skills` / pack zip 仍然有效，与 Desktop 不互斥 |
| **安装前版本校验** | 每次安装/升级 companion 模块前自动校验 GitHub 最新版；若捆绑版本非最新，自动下载最新版安装（网络失败则回退捆绑版） |

首次打开工作区后 onboarding 会提示可选安装模块（不阻塞主路径）。

### 升级
| 方式 | 操作 |
|------|------|
| Homebrew | 终端运行 `brew upgrade topmind` 检查并自动升级至最新版本 |
| 应用内检查 | 管理与更新 -> **检查更新**（Desktop / Skills / Clip / Obsidian 多表面；读公开 `latest.json`，无需 GitHub token） |
| 内联升级 | 管理与更新 -> 对 Skills / Clip / Obsidian 点下载按钮，直接从 GitHub Releases 下载并安装最新包（无需升级 Desktop 本身） |
| 模块升级 | 设置 -> 管理与更新 -> 对各宿主 / 插件点升级 |
| 手动安装包 | 下载新版 installer，覆盖安装；工作区文件夹与 `app-settings.json` 保留 |
| 源码开发 | `git pull` -> `npm run desktop:dev`；版本真源本目录 `package.json` |

工作区 Markdown / `topmind.yaml` / `memory/` **不**随 Desktop 升级被覆盖。Skills · UTR · 剪藏扩展 · Obsidian 插件均随 Desktop engine 打包（`resources/topmind-engine/`），设置内可从本地源直接安装。UTR 版本跟随 Desktop。各表面独立版本号，内联升级直接从 GitHub Releases 下载最新包安装（无需升级 Desktop 本身）。详见 [`../docs/PACKAGING.md`](../docs/PACKAGING.md)。

---

## 开发

```bash
# 本目录
npm run dev
npm run check:quality    # 完整质量门

# 仓库根
npm run desktop:dev
npm run desktop:quality
npm run desktop:pack:mac # 或 :linux / :win
```

| 文档 | 用途 |
|------|------|
| [`DESIGN.md`](./DESIGN.md) | 产品交互 · 行内 AI 对抗场景 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | RPC · 服务 · AI 管线 |
| [`PLUGIN.md`](./PLUGIN.md) | 插件槽位 |
| [`../docs/PACKAGING.md`](../docs/PACKAGING.md) | 打包与安装包命名 |

返回总览：[`../README.zh-CN.md`](../README.zh-CN.md)
