---
name: topmind-memory
version: 3.2.1
description: >-
  更新「我的情况」或专题结论。Use when 记住这个、更新我的情况、加到专题记忆、写进 topic.md、
  沉淀结论。Do NOT use for 捕获、仅总结（→organize）、整理本周正文、出稿、doctor/loop.
action_category: memory
triggers:
  - 写入专题记忆
  - 更新我的情况
  - stable memory
  - 追加确认结论
  - 写进 topic.md
  - 更新专题真源
  - 记住这个
  - 记住我
  - 加到专题记忆
  - 更新首页
  - 沉淀结论
  - 提炼到记忆
  - update project
  - memory
tags: [memory, stable, project-md, core-profile, 我的情况]
entrypoint: false
compatibility: topmind topic topic.md + workspace core profile (memory/profile.md).
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-10
degradation: ../shared/capability-degradation.md
---

# topmind Memory

**默认记忆模型（产品真理）**：

| 层 | 路径 | 用途 |
|----|------|------|
| **主 memory** | `memory/profile.md` | 「我的情况」— 偏好 / 目标 / 关系 / 进行中 |
| **周期子 memory** | `memory/periodic/{YYYY}/{period}.md` | 周期反思（stream_digest / ai_summary 确认后） |

**建立/归入专题**（内容大类夹）→ **organize / topic_classify**，路径 `{大类}/{YYYY-主题}/topic.md`。  
**不是**默认写入 `memory/topics/`。

| 用户意图 | 写哪里 |
|----------|--------|
| 关于**我** | `memory/profile.md` |
| **周期反思** | `memory/periodic/{YYYY}/` |
| **开/并专题**（长期主题夹） | 内容大类下专题（organize 建议 · 确认后 create_topic） |
| 明确说「把结论写进专题记忆层」 | 可选 `memory/topics/{slug}.md`（语义平面 · **非默认**） |

## Activation checklist

1. 判目标：关于我 → profile；周期反思 → periodic；开专题 → **交 organize / 内容大类**（勿默认 memory/topics）  
2. 筛 **confirmed · stable · reusable · scoped**  
3. Core：`memory.append-profile`；周期反思：digest 路径；仅用户明说专题语义记忆时才 `memory.append-topic`  
4. 整文替换需可逆备份  

## 核心画像（Core Profile）

- 路径：`memory/profile.md`（语义平面；原 `我的情况.md`）  
- `topmind.yaml` → `memory.layers.global.file`（默认 `profile.md`）  
- 推荐段落：`## 偏好` · `## 当前目标` · `## 关键的人与协作` · `## 进行中的事`  
- 缺失时创建模板后追加  

```text
UTR: memory.append-profile --content "…"
Host: 读 profile → 段落下 append → 写回（先备份）
```

## 周期反思（Periodic）

- 路径：`memory/periodic/{YYYY}/{YYYY-Www}.md` 等  
- 来源：活动窗口 AI 建议（`stream_digest` / `ai_summary`）**确认后**写入  
- **反思非摘要**：不是「本周发生了什么」，而是「本周揭示了什么」——关注焦点、知识与见解、行为信号、偏好变化、线索  
- 与 profile 同属记忆平面；**不是**专题目录  

## 可选：专题语义记忆（非默认）

仅当用户**明确**要求「写到专题记忆 / memory topics」时，才写入 `memory/topics/{topic-slug}.md`。  
日常「这个值得开个专题」→ 内容大类下 `{YYYY-主题}/`，不是 memory 平面。

## When NOT to use

- 存材料 → capture  
- 理顺本周流水 / 建议开专题 → organize「整理本周」（活动窗口）  
- 分析/整理笔记（不写记忆）→ organize  
- 起草/交付 → write  
- 体检/巡检 → maintain / loop  

## 守门

- **禁止**因 capture / 剪藏 / 导入 自动改 profile 或 `memory/topics/`  
- **禁止**整理过程中顺手狂写（organize 只可**建议**候选；topic 建议进**内容大类**）  
- 仅用户明确「记住 / 更新我的情况 / 写进专题记忆」或当轮确认  

## Role-aware density

- 日常事实 → 周期本或「我的情况」  
- 反复主题 → 建议内容大类专题，不默认 memory/topics  
- buffer / delivery / system 通常不适用  

## Capability Degradation

[`../shared/capability-degradation.md`](../shared/capability-degradation.md)。  
`memory.append-profile` · `memory.append-topic` · `inspect-topic`。

## 保存设置

- **自动保存 (auto)**：默认；写回执  
- **需要审阅 (confirm)**：先预览  
- 见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。
