---
name: topmind
version: 2.14.0
description: >-
  topmind 总入口与多意图路由（类别/专题/笔记/交付）。Use when 用户说 topmind、意图模糊、或需要
  收→整→写 分步。单意图明确时直接用 topmind-capture|organize|write|memory|maintain|loop|weread|x。
  Do NOT invent parallel front doors; do NOT skip a matching sub-skill.
action_category: router
triggers:
  - topmind
  - 知识库
  - 工作区
tags: [router, entrypoint, topmind]
entrypoint: true
compatibility: >-
  topmind workspace with {NN-Name}/ categories. Host file tools primary; UTR optional.
  Install with shared/ sibling for progressive disclosure links.
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-10
degradation: ../shared/capability-degradation.md
---

# topmind Router

唯一日常入口：`topmind`。子 skill 是**实现模块**（可被 host 单独激活），不是产品第二前台。

## Activation checklist（激活后立即做）

1. 确认工作区根（host 提供；不硬编码绝对路径）  
2. 扫 `{NN}[- ]{Name}/` 或 UTR `list-categories`（WorkspaceModel：role / hidden / source）  
3. 读 `topmind.yaml`（contract_version **4**）若存在  
4. 推断：**category · topic · object · action · writeback_mode**（auto|confirm）  
5. 派生子 skill 语义（逻辑路由；不假装进程内调用 API）  
6. 回执含路径；**不**自动链式下一 skill；记忆/提升类建议须用户确认  


## Quick Reference

```text
用户说什么              → 路由到哪            → 目标位置
─────────────────────────────────────────────────────────────
记/存/收/链接/想法       → topmind-capture     → 动态周期本 / 专题 / 收件箱
整理本周/理顺流水        → topmind-organize    → 活动窗口就地理顺 + 建议（确认后写）
整理/分析/研究/总结/对比 → topmind-organize    → 当前专题 / Inbox 路由 / 活动窗口
写/改/稿/交付/导出       → topmind-write       → delivery 或专题根
记住我/更新我的情况      → topmind-memory      → memory/profile.md（主 memory）
周期反思                 → topmind-memory      → memory/periodic/{YYYY}/（周期反思）
开/并专题（内容夹）      → topmind-organize    → {大类}/{YYYY-主题}/（非 memory/topics）
记住/专题语义记忆        → topmind-memory      → 仅用户明说 → 可选 memory/topics/
快速体检/诊断/修复/清理  → topmind-maintain    → 工作区确定性检查
loop/整体体检/巡检       → topmind-loop        → .topmind/loop/ 可恢复
微信读书/同步划线        → topmind-weread      → connector 解析类别
发推/推特/x.com          → topmind-x           → connector 解析类别
不确定 / 多意图          → 本 router 拆步      → 先 capture 再建议
```

English: capture → capture · weekly review/organize (activity window) → organize · write → write · about me → memory/profile · period reflection → memory/periodic/{YYYY}/ · new topic folder → organize (content category) · doctor → maintain · loop → loop.

读配置：`stream.packing`（默认 weekly）· `stream.year_dir`（默认 true）· `memory.layers.global.file`（`profile.md`）。  
**活动窗口**（Desktop/Kernel 与 organize 共用）：近期周期本 ∪ 近期改动笔记 ∪ 增补锚定的原文——不只「最新周期文件名」。

## Core Model

```text
User experience:     capture-first
Data organization:   category-first + topic-emerges
Object model:        category → topic → object
Actions:             capture | organize | write | memory | maintain | loop | connector
Save settings:       auto | confirm
```

内容约定：[`../shared/project-model-brief.md`](../shared/project-model-brief.md)（**6 条核心规约**）。  
类别角色 / 扩展：[`references/template-categories.md`](references/template-categories.md)。  
Host 加载说明：[`../shared/host-loading.md`](../shared/host-loading.md)。

## Routing Question

```text
Which category? Which topic (or loose note)? Which object? Which action? Which save setting?
```

不要让用户选内部模块名。从自然语言推断。

### Capture-first

- 高信心类别+专题 → `{大类}/{专题}/`  
- 高信心类别、中信心专题 → 写入专题 + 回执 `route_reason`  
- 高信心类别、无专题 → `{大类}/*.md`，建议是否升级专题  
- 低信心类别 → **role:buffer**（常为 `00-收件箱/`）  
- 跳过 `hidden` 类别  

### Minimum Context

1. 扫描 `{workspace-root}/` → `{NN}[- ]{Name}/`  
2. 读 `topmind.yaml`（template · `categories.extensions` · `categories.overrides` · separator）  
3. 有 UTR → 优先 `list-categories`  
4. 强推断专题时再读 `topic.md`（出稿/问答同样：**有则先读首页**，不强制创建）  
5. **默认不加载整工作区**  

### 复利纪律（不改结构）

- **organize**：整理/总结默认落盘专题笔记，不只回话  
- **write**：先 `topic.md`（若有）再必要笔记  
- **memory**：仅用户明确沉淀；capture **禁止**改 topic.md  
- **禁止**硬索引 `INDEX.md`、平行 wiki 树、entities/ 默认目录 

## Disambiguation & Multi-Intent

真源：[`../shared/trigger-disambiguation.md`](../shared/trigger-disambiguation.md)。  
多意图：[`references/multi-intent.md`](references/multi-intent.md)。  
Connector：[`references/connector-resolution.md`](references/connector-resolution.md)。

## Sub-Skill Receipt Chaining

- 子 skill **不得**自动 dispatch 下一 skill  
- 下一步由 Router 再裁决或用户显式发起  
- 例外：回执可**建议**「稍后 organize / loop」——仅用户面  

## Tool Boundary

主路径：host 文件工具 + project-model-brief。  
降级：[`../shared/capability-degradation.md`](../shared/capability-degradation.md)。

UTR 可选（MCP primary+danger）：`list-categories` · `list-topics` · `inspect-topic` · `list-topic-files` · `list-inbox` · `create-topic` · `capture-note` · `save-output` · `contract.validate` · `memory.promote` · `memory.digest` · `memory.append-profile` · `memory.append-topic` · `doctor-workspace` · `plan-inbox-routing` · `archive-topic` · `restore-safety-receipt`。

字段始终独立 **`category` + `topic`**（真实目录名，非写死编号）。

## 保存设置

- **auto**：直接写 + 路径回执（危险动作可逆）  
- **confirm**：先审阅再写  

详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。  
**6 条核心规约**：见 [`../shared/project-model-brief.md`](../shared/project-model-brief.md)。

## Error Handling

写入失败时：
- 磁盘满 / 权限不足 → 报错 + 已备回复制位置；不静默丢数据
- 路径过长 / 非法字符 → 提示用户缩短专题名
- protection:locked → 拒绝写入 + 建议fork修订版
- 工作区不存在 topmind.yaml → 按默认契约解释 + 回执标注「默认契约」



`source_type`: `user-original` | `external-capture` | `ai-derived`。可选 `status` / `priority` / `method`。

## Workspace Shape

```text
{workspace-root}/
├── topmind.yaml             # v4 行为契约
├── memory/                 # 语义平面（profile / periodic/{YYYY}/ / topics）
├── .topmind/               # 系统平面（index / loop / logs，可重建）
├── {NN}-{Name}/               # buffer / loose-stream / deep-work / …
├── {NN}-Outputs/              # role: delivery（常 88-输出）
└── {NN}-Archive/              # role: system（常 99-归档）
```

专题：`topic.md?` + `*.md` + `images/?`。散记可在大类根。

## Multi-Workspace

只操作**当前 active** 工作区根。切换由 Desktop/host 负责。
