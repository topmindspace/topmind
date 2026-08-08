---
name: topmind-write
version: 2.2.0
description: >-
  写作/润色/出稿到专题或交付层（role:delivery）。Use when 写、起草、续写、润色、出稿、交付、write、draft、deliver。
  Do NOT use for 仅捕获、仅结构整理、只写记忆、doctor/loop、社交连接器.
action_category: write
triggers:
  - 写
  - 写作
  - 起草
  - 续写
  - 修订
  - 润色
  - 交付
  - 改写
  - de-AI
  - 输出
  - 出稿
  - 定稿
  - 发布
  - 导出
  - 排版
  - write
  - draft
  - deliver
  - publish
  - export
tags: [write, draft, revise, polish, deliver]
entrypoint: false
compatibility: topmind workspace. Delivery role category (often 88-输出/).
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-08
degradation: ../shared/capability-degradation.md
---

# topmind Write

从起草到交付。输出最终内容到 **delivery 层**（role:delivery）或专题根。

## Activation checklist

1. 能定位专题时：**先读 `topic.md`（若有）**，再读焦点稿与必要笔记（不足再 organize/capture）  
2. 起草或修订；去 AI 腔 / 适配格式  
3. 落盘专题根或 `save-output` → delivery  
4. 路径回执；交付勿塞进专题内 `outputs/`  

## When NOT to use

- 记链接/想法 → `topmind-capture`  
- 整理/综合证据 → `topmind-organize`  
- 只更新 topic.md 记忆 → `topmind-memory`  
- 清理/体检/巡检 → maintain / loop  
- 发推 / 微信读书 → connectors  

## Writing Entry Points

Draft · Continue · Revise · Polish · Deliver — 按用户当前意图，不是固定流水线。

## Workflow

1. **读序（先首页再素材）**：`topic.md`（若有）→ 焦点对象 → 仅必要笔记。无 topic.md 不强制创建，照旧扫笔记。禁止一上来 dump 整专题  
2. 对齐目标、稳定记忆、风格、受众  
3. 产出可用正文，少过程旁白  
4. 按保存设置写入；锁定文件建修订副本  
5. Desktop 可选影子流式：`.shadow-*.tmp`，Commit 后再原子落盘  

## source_type

- AI 草稿默认 `ai-derived`  
- 用户原文仅排版 → `user-original`  
- 交付层文件 `source_type` 可选；专题内笔记建议必填  

## Delivery Checklist

```text
□ 格式匹配目标
□ 无内部标注 / TODO / 占位符
□ 受众与语气匹配
□ source_type 正确
□ 路径正确（交付层 save-output；专题根 capture-note）
□ 交付层文件名 YYYY-MM-DD-描述.ext
□ 回执含路径与下一步
```

不满足则在回执标注。

## Quality Bar

具体、受众向；去 AI 套话；保用户声音。`topic.md` 风格锚点优先。

## Capability Degradation

[`../shared/capability-degradation.md`](../shared/capability-degradation.md)。`inspect-topic` · `save-output` · `capture-note`。

## 保存设置

- **自动保存 (auto)**：直接写入并返回路径回执（path receipt）
- **需要审阅 (confirm)**：先进入目标路径/内容审阅入口再保存
- Host 可编码为 `writeback_mode: auto | confirm`。详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。

