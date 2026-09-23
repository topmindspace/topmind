# ADR: Obsidian Plugin Architecture

**Date**: 2026-08-07  
**Status**: Accepted  
**Supersedes**: —  

## Context

topmind 已有三个独立表面（Skills / Desktop / UTR）。用户群体中大量已使用 Obsidian 作为个人知识库。需要一种方式让这些用户在不离开 Obsidian 的情况下获得 topmind 的核心工作流（记一下 → AI 建议 → 确认后沉淀）。

## Decision

创建 Obsidian 插件作为第四个独立表面，复用 Kernel `lib/` 八引擎。

### 架构决策

1. **esbuild 打包内联 Kernel** — 不动态 import `lib/*.mjs`，而是通过 esbuild 将引擎代码打包进单一 `main.js`。原因：Obsidian 插件加载机制不支持可靠的动态 import；单文件分发更简单。

2. **ESM imports for Node.js built-ins** — TypeScript 源码使用 `import fs from "node:fs"` / `import path from "node:path"`（而非 `require("fs")`），esbuild `platform: 'node'` 自动转换为 CJS `require()` 调用。原因：类型安全；与 Kernel `lib/*.mjs` 的 ESM import 风格一致；esbuild 正确打包。`Vault.adapter` 的 `getBasePath()` 仅用于获取 Vault 根路径。

3. **fetch API 替代 Vercel AI SDK** — 不引入 AI SDK 依赖，直接用 `fetch` 调用 OpenAI-compatible / Anthropic API。原因：保持插件轻量（无重依赖）；Obsidian 环境提供 `fetch`；支持 Anthropic 原生 API 格式。

4. **Vault 根 = 工作区根** — Obsidian Vault 根目录直接映射为 topmind 工作区根目录。原因：零配置；用户文件保持原生 Obsidian 可见；不引入额外路径映射。

5. **Obsidian-native UI** — 使用 `ItemView` + DOM 而非 React。原因：不引入框架依赖；复用 Obsidian CSS 变量（自动暗色模式）；插件体积最小。

6. **esbuild shims 处理 Kernel 兼容性** — 三个 shim 插件处理：`yaml-bridge.mjs` 的动态 `createRequire`、`contract-engine.mjs` 的动态 require、`import.meta.url` 在 CJS 中的替代。原因：Kernel .mjs 文件为 ESM，插件输出为 CJS，需在打包时转换。

7. **事件驱动刷新** — 使用 `vault.on("modify" / "create")` 替代轮询。原因：避免不必要的 CPU 开销；与 Obsidian 文件变更通知机制一致。

### 不做的事

- 不重建编辑器（复用 Obsidian 原生 Markdown 编辑器）
- 不重建文件树 / 命令面板（复用 Obsidian 原生）
- 不引入 React / Tailwind / Tiptap
- 不支持移动端（与 Desktop 一致为桌面优先）
- 不实现全部 Desktop 功能（MVP 聚焦动态流 + AI 建议）

## Consequences

**正面**：
- 已使用 Obsidian 的用户零摩擦获得 topmind 核心工作流
- 插件体积小（~280KB main.js），无重依赖
- 与 Desktop / UTR 共享 Kernel 引擎，行为一致
- 同一 Vault 可同时在 Desktop 和 Obsidian 中打开

**负面**：
- 需要 esbuild shim 维护（Kernel 若新增 `createRequire` 模式需添加 shim）
- `require('fs')` 依赖 Electron 环境不支持移动端
- AI Provider 需自行维护重试逻辑（不共享 Desktop 的 AI SDK 重试）

## Compliance

- ✅ 所有写入经 `writeback-engine`（唯一写闸）
- ✅ capture 使用 Kernel `appendToPeriodBody`（不平行实现业务语义）
- ✅ `createKernelContext` 工厂模式（多工作区安全）
- ✅ 用户概念 ≤5
- ✅ 代码 Topic* / Category*
- ✅ i18n 双语（zh-CN / en-US 键集对齐）
- ✅ 版本独立（`manifest.json` 为真源）
- ✅ `generateSuggestions` 返回值与 Kernel `suggest-engine` 对齐（直接数组，非 `{ suggestions: [] }` 包装）
- ✅ `SuggestionCard.kind` 覆盖 Kernel suggest-engine 全部 kind（`inbox_review` / `stale_topic` / `catch_all` / `stream_digest` / `promote_memory` / `open_profile`）及 ai-operation-engine 建议类型（`create_topic` / `ai_summary`）
- ✅ `applySuggestion` 传递 `targetPath`（用于 inbox/stale/catch_all 归档类建议）

### 2026-08-08 优化补充

- ✅ TypeScript 源码使用 ESM imports（`import fs from "node:fs"`）替代 `require()` — 类型安全，与 Kernel 风格一致
- ✅ CSS 变量作用域限制在插件类内（不污染 `:root`）
- ✅ 跨平台 ZIP 打包（纯 Node.js `zlib` 实现，不依赖系统 `zip` 命令）
- ✅ `onunload()` 正确清理 Kernel context 和缓存
- ✅ `manifest.json` 含 `fundingUrl`（Obsidian 社区插件最佳实践）
- ✅ i18n 无硬编码中文（设置描述全部走 i18n 键）
- ✅ Quick Capture Modal 不重复处理 Escape（Obsidian Modal 原生处理）
- ✅ `.gitignore` 排除 `node_modules/` / `dist-types/` / `release/`
- ✅ 设置面板使用 `Setting.setHeading()` 而非 `createEl("h3")`（Obsidian 插件指南：避免 HTML 标题元素导致样式不一致）
- ✅ 不设置默认快捷键（Obsidian 插件指南：避免与其他插件冲突）
- ✅ 移除 `console.log` 加载/卸载日志（Obsidian 插件指南：避免不必要的控制台输出）
- ✅ 使用 DOM API 替代 `innerHTML` 清空元素（安全 + 符合指南）
- ✅ 添加 `LICENSE` 文件（Obsidian 社区插件提交必需）
- ✅ 移除 `tsconfig.json` 中未使用的 `@/*` 路径别名和 `esbuild.config.mjs` 中的空 `alias` 配置
- ✅ `obsidian:validate` 质量门顺序优化：`typecheck → build → test → pack:verify`（确保测试运行在新鲜构建产物上）
- ✅ `ai-provider.ts` 逻辑清晰化：分离 Ollama 免密钥逻辑
- ✅ `kernel-service.ts` 添加 `skipShadow` 和 `process.env` 设计决策文档注释

### 2026-08-08 正确性硬化

- ✅ TodoItem 字段对齐 Kernel `done`（修复原先误读 `completed` 导致已完成项仍显示）
- ✅ 周期选择器在 vault 刷新时保留用户选择
- ✅ `MarkdownRenderer.render` 替代已废弃的 `renderMarkdown`
- ✅ 侧边栏打开工作台复用已有 leaf；Ribbon 图标与 DESIGN 一致为 `waves`
- ✅ `open_profile` apply 后在 Obsidian 中打开笔记
- ✅ 单元测试改为 import 已发布的 `src/*.ts` 纯函数（`--experimental-strip-types`），禁止算法镜像
- ✅ 写路径结构断言 + 官方指南清单（无默认热键、无 `:root` 污染、LICENSE）
- ✅ 成功路径去掉 `console.debug`；intentional Kernel-fs 分歧写入 ARCHITECTURE §5.1

### 2026-08-08 Kernel API 对齐（skeptic）

- ✅ `resolveStreamTarget` → `periodRelPath` / `periodAbsPath`（禁止虚构 `relPath`）
- ✅ `listStreamPeriods({ workspaceRoot, engineRoot, config })` 异步 + options 对象
- ✅ `reconcilePeriodBody(body, opts)` 位置参数 + 返回 `{ changed }`
- ✅ `KernelApi` 类型面与 `lib/model-stream` / `stream-period` 对齐
- ✅ 纯写路径抽离 `kernel-workspace-ops.ts`；live Kernel 集成测试
- ✅ `mapApplySuggestionResult`：skip / ok:false / wroteFiles:false 保持失败；open-only 成功
- ✅ `mergeCaptureTags` 防止 autoTag 双重 `#tag`
- ✅ 首次 init 全量模板目录（含 `10-动态`，对齐 Desktop first-init）
