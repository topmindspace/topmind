---
name: topmind-maintain
version: 3.5.0
description: >-
  确定性体检/清理/结构修复/回执恢复。Use when 快速体检、诊断、doctor、清理、修复、workspace check。
  Do NOT use for 整体巡检 loop、内容整理、捕获、写作、记忆.
action_category: maintain
triggers:
  - 快速体检
  - 体检
  - 诊断
  - doctor
  - 健康检查
  - 清理
  - 修复
  - 快速检查
  - 检查
  - 状态
  - workspace check
  - scan
  - fix
  - maintain
tags: [maintain, doctor, cleanup, audit, health-check]
entrypoint: false
compatibility: topmind engine and/or workspace. Prefer read-only diagnostics first.
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-15
degradation: ../shared/capability-degradation.md
---

# topmind Maintain

系统与工作区**确定性**健康。不重塑内容、不写交付稿。

## Activation checklist

1. 只读诊断优先（`doctor-workspace` / 扫盘）  
2. 自定义 `{NN-Name}/` 合法；用 WorkspaceModel，不硬编码槽位  
3. 清理/归档必须可逆（role:system 备份 + 回执）  
4. 语义全库巡检 → 转 **loop**  

## When NOT to use

- 整理笔记 / 证据 → organize  
- 存材料 → capture  
- 起草/输出 → write  
- 沉淀记忆 → memory  
- 全工作区语义巡检 / 整体体检 / 从断点继续 → **loop**  
- 发推 / 微信读书 → connectors  

## Use For

- UTR / CLI / MCP doctor 与 smoke  
- 工作区清理预览与可逆清理  
- skills/docs 漂移审计、evals  
- 过时文件、架构漂移  
- v2 `projects/` → 类别：`migrate-v4`（advanced，dry-run + 可逆）  
- 一级类重命名 / 角色：Desktop 或 `renameCategory` / topmind.yaml（**不**在 maintain 静默改名）  
- 撤销/恢复：`list-safety-receipts` → `restore-safety-receipt`  

## Workflow

1. 定 scope：workspace / topic / skills / UTR / Desktop  
2. 先只读诊断：`list-categories`（WorkspaceModel）或 `doctor-workspace`  
3. 清理/归档必须可逆（备份现场 **role:system** 目录，常为 `99-归档/` / `99-Archive/`，路径回执）  
4. **不**把 `state.json` / `.topmind/workspace-map.json` 当内容真源  
5. 自定义类合法；禁止用固定槽位表否定用户目录  
6. 记录证据与 follow-up  

备份链实现细节属 Desktop runtime（`writeback.mjs`）；skill 只保证**写入可逆**。

## Recovery

用户说「撤销 / 找回误删」：

1. `list-safety-receipts`（扫描现场 system 目录的 `backups/`、`backups/trash/`、legacy `trash/`、归档专题、delivery 修订版）  
2. 匹配 `relativePath` / category / topic  
3. `restore-safety-receipt`（不覆盖已有文件；写 `-restored-` 副本）  

## Architecture Drift（发现即报）

- `YYYY-类型-项目名`  
- 默认锚点 outline/setting/style  
- 强制 6 大 section topic.md  
- 顶层 `projects/` / `references/` / `sources/` / `library/`  
- 硬编码槽位 / 把自定义 `{NN-Name}/` 判为非法  
- `project_type:`  
- 废弃命令名 `create-project` 等（现行 `workspace-*`）  
- ensure 时复活用户已删的可选模板类  

## Capability Degradation

[`../shared/capability-degradation.md`](../shared/capability-degradation.md)。`workspace-maintain.*` · `migrate-v4`。

## 保存设置

- **自动保存 (auto)**：直接写入并返回路径回执（path receipt）
- **需要审阅 (confirm)**：先进入目标路径/内容审阅入口再保存
- Host 可编码为 `writeback_mode: auto | confirm`。详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。

