---
name: topmind-weread
version: 2.0.7
description: >-
  同步微信读书划线/想法/统计到专题。Use when 微信读书、划线同步、weread、读书笔记。
  Do NOT use for 普通 URL 捕获、仅整理、出稿、X.
action_category: connector
triggers:
  - 微信读书
  - weread
  - 划线同步
  - 读书笔记
  - 阅读统计
  - 书架
  - weread sync
  - sync highlights
tags: [weread, reading, highlights, sync, capture]
entrypoint: false
compatibility: Requires WeRead Skill API key (wrk-*). Desktop WereadService preferred; host may call gateway manually.
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-07-28
degradation: ../shared/capability-degradation.md
---

# topmind WeRead（v1.0）

将微信读书划线/想法/统计同步为 topmind 笔记（`source_type: external-capture`）。

## When NOT to use

- 普通链接剪藏 → `topmind-capture`  
- 发推 / X → `topmind-x`  
- 无微信读书语义的整理/写作 → organize / write  

## API（官方 Gateway）

```text
POST https://i.weread.qq.com/api/agent/gateway
Authorization: Bearer wrk-xxxxxxxx
Body: { "api_name": "/…", "skill_version": "1.0.4", … }
```

Key：`https://weread.qq.com/r/weread-skills`（微信扫码）。

| 能力 | api_name |
|------|----------|
| 书架 | `/shelf/sync` |
| 搜索 | `/store/search` |
| 统计 | `/readdata/detail` |
| 书详情/进度 | `/book/info` · `/book/getprogress` |
| 有笔记的书 | `/user/notebooks`（`count` + `lastSort`） |
| 划线 | `/book/bookmarklist` |
| 想法 | `/review/list/mine` |
| 推荐 | `/book/recommend` · `/book/similar` |

## Desktop 同步策略

1. 分页拉全 notebooks（`count=100` + `lastSort`）  
2. 仅 `noteCount + reviewCount > 0`  
3. 本地条数一致 → 跳过；`note_fingerprint` 二次校验  
4. 每书：bookmarklist + 可选 reviews  
5. 写 `topic.md` + `划线笔记.md`；旧文件进 Archive 备份  
6. 软预算（默认 4 分钟）超时留下次  
7. `lastSyncAt` 仅展示，不作时间过滤  

目标类别：见 router [`../topmind/references/connector-resolution.md`](../topmind/references/connector-resolution.md)。

### 落盘形状

```text
{类别}/2026-书名/
├── topic.md      # weread_book_id, synced_at, …
└── 划线笔记.md
```

### 配置（Desktop）

`weread.enabled` · `apiKey` · `syncCategory: auto|目录` · `includeThoughts` · `syncBudgetMinutes`。

RPC：`weread.getStatus` · `testConnection` · `listNotebooks` · `syncHighlights` · stats/search 等。

## 降级

1. 无 API Key → 引导获取  
2. API 失败 → 保留上次数据 + 错误  
3. 单书超时 → 跳过继续  
4. 无 Desktop → host 可手工调 Gateway；仍遵守 PROJECT-MODEL  

## 保存设置

- **自动保存 (auto)**：直接写入并返回路径回执（path receipt）
- **需要审阅 (confirm)**：先进入目标路径/内容审阅入口再保存
- Host 可编码为 `writeback_mode: auto | confirm`。详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。

