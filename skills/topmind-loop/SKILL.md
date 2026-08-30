---
name: topmind-loop
version: 3.5.4
description: >-
  可中断的工作区语义巡检（走专题/Inbox，.loop 断点续跑）。Use when 跑一遍 loop、巡检、整体体检、复盘、
  继续 loop、audit。Do NOT use for 快速 doctor（→maintain）、单专题整理、捕获、写作、仅记忆.
action_category: loop
triggers:
  - 跑一遍 loop
  - loop 一下
  - 整体体检
  - 工作区复盘
  - 把工作区跑一遍
  - 巡检
  - 继续 loop
  - 从断点继续
  - 全面检查
  - 复盘
  - review
  - audit
  - walk
tags: [loop, audit, walk, resumable, cyclic]
entrypoint: false
compatibility: topmind workspace. Progress under .topmind/loop/*. Host LLM runs the walk; UTR optional.
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-15
degradation: ../shared/capability-degradation.md
---

# topmind Loop

```text
topmind-loop = SKILL.md + agent host LLM + .topmind/loop/*.md
```

不是 CLI、不是独立 runtime。独立 skill（不再是 maintain 子动作）。

## Activation checklist

1. 确认是**整体/可恢复**巡检（非快速 doctor）  
2. 读/建 `.topmind/loop/*.md` 进度；可中断续跑  
3. 步内可调用 capture/organize/… **语义**，不改类别名  
4. 结束写摘要回执  

## When NOT to use

- 快速体检 / doctor / 修复索引 → `topmind-maintain`  
- 整理当前专题笔记 → `topmind-organize`  
- 存新材料 → `topmind-capture`  
- 出稿 → `topmind-write`  
- 沉淀「我的情况」/ 周期反思 → `topmind-memory`  
- 发推 / 微信读书 → connectors  

## When to Invoke

```text
跑一遍 loop                 → topics + inbox + archive
loop 一下 topics|inbox|archive
loop 一下 {类别名}          → 该大类专题
整体体检 / 巡检 / 复盘      → 全跑
继续 loop / 从断点继续      → 读 .topmind/loop cursor
```

## Three Pieces

1. **本 skill** — 规约  
2. **Agent host** — 执行与语义判断（无第二套 LLM 配置）  
3. **`.topmind/loop/*.md`** — 进度真账  

Scopes、walk、guardrails 细节：[`references/scopes-and-walk.md`](references/scopes-and-walk.md)。  
状态文件格式与 resume：[`references/state-file.md`](references/state-file.md)。  
设计取舍：[`DESIGN.md`](DESIGN.md)。

## Minimal Workflow

1. 解析 scope（默认全跑）  
2. 读或创建 `.topmind/loop/{scope}.md`（缺失则首次运行，不报错）  
3. 从 `cursor` 起逐项：Read → Decide → Apply/Preserve/Escalate → Record  
4. 更新 `last_run` / `done/total` / `cursor` / Receipts  

## What Loop Does NOT Do

- 不写交付正文（write）  
- 不改专题目标/记忆（memory）  
- 不 capture 新材料  
- 不重复 maintain 的确定性检查（可调用其结果作证据，再加语义层）  
- 不擅自改类别名、不自动升专题  
- **不**为「补知识结构」自动写 topic.md / 建 INDEX.md / 建实体目录  

材料多而首页空时：只在日志/回执**建议** organize 或 memory（见 scopes-and-walk），不代写。

**Drift 信号**（详见 scopes-and-walk）：`YYYY-类型-项目名` · `project_type:` · outline/setting/style 默认锚点 · 顶层 projects/references/sources/library · 废弃命令 `create-project` / `inspect-project` 等。

## Capability Degradation

见 [`../shared/capability-degradation.md`](../shared/capability-degradation.md)。常用：`workspace-read.*` · `workspace-transform.*` · `workspace-maintain.*`；无 UTR 则 host 文件遍历 + 同样回执语义。

## Composite Trigger

用户面仍经 `topmind` router。Router Action Map 直达本 skill，不经 maintain 中转。

## 保存设置

- **自动保存 (auto)**：直接写入并返回路径回执（path receipt）
- **需要审阅 (confirm)**：先进入目标路径/内容审阅入口再保存
- Host 可编码为 `writeback_mode: auto | confirm`。详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。

Loop 写状态文件与可逆修复时同样适用；危险操作先备份。

