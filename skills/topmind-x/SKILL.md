---
name: topmind-x
version: 2.15.0
description: >-
  X/Twitter：归档/搜索（Bearer）、发帖（xurl）、Agent 可用官方 MCP。Use when 发推、推特、twitter、x.com。
  Do NOT use for 微信读书、非 X 捕获、doctor、长文交付.
action_category: connector
triggers:
  - 发推
  - 推特
  - twitter
  - x.com
  - 发帖
  - 推文
  - post tweet
  - x platform
tags: [x, twitter, social, mcp, agent]
entrypoint: false
compatibility: Desktop needs Bearer (read) and/or xurl (post). Agent hosts use official X MCP + xurl bridge.
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-10
degradation: ../shared/capability-degradation.md
---

# topmind X / Twitter

分清两个平面：

| 平面 | 接入 | 能力 |
|------|------|------|
| Agent 宿主 | 官方 MCP `https://api.x.com/mcp` + `xurl mcp` | 搜索/用户/书签等（随 scope） |
| Desktop 只读 | App-only Bearer → API v2 | 搜索/时间线 → 归档笔记 |
| Desktop 发帖 | 本机 `xurl`（用户 OAuth） | 发布；失败草稿进 Inbox |

文档：https://docs.x.com/tools/mcp

## When NOT to use

- 微信读书 → `topmind-weread`  
- 非 X 的剪藏 → `topmind-capture`  
- 长文交付（非推文）→ `topmind-write`  

## 认证

- **Bearer**：只读；不能发帖  
- **xurl OAuth**：Desktop 发帖  
- **官方 MCP**：Agent 宿主；Desktop **不**内嵌 OAuth 桥  

```bash
npx -y @xdevplatform/xurl mcp https://api.x.com/mcp
brew install --cask xdevplatform/tap/xurl && xurl auth oauth2
```

## 与笔记整合

类别解析：[`../topmind/references/connector-resolution.md`](../topmind/references/connector-resolution.md)。

推文笔记：`source_type: external-capture`，含链接与可选 AI 摘要分隔。

## 发布工作流

起草（可 write）→ **用户确认**（即使 `writeback_mode: auto`）→ xurl 或 MCP 发布 → 可选归档。

## Desktop RPC

`x.getStatus` · `probeTools` · `testConnection` · `searchTweets` · `getTimeline` · `syncToNotes` · `postTweet`。

设置：`x.enabled` · `bearerToken` · `mcpEndpoint` · `syncCategory` · `autoArchivePosts`。

## 降级

1. 无 Bearer → 不能搜索/时间线  
2. 无 xurl → 不能发帖（草稿 Inbox）  
3. Agent 完整能力 → 宿主接 MCP  
4. 无通道 → 仅编辑器起草  

## 安全

Bearer 加密存储；不自动关注/点赞/转发；遵守 X API 规则。

## 保存设置

- **自动保存 (auto)**：直接写入并返回路径回执（path receipt）
- **需要审阅 (confirm)**：先进入目标路径/内容审阅入口再保存
- Host 可编码为 `writeback_mode: auto | confirm`。详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。

发布动作始终二次确认（即使 auto）。

