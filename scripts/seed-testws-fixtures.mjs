#!/usr/bin/env node
/**
 * Seed a topmind workspace with synthetic stream-first demo fixtures.
 *
 * Usage:
 *   node scripts/seed-testws-fixtures.mjs /path/to/workspace
 *   TOPMIND_SEED_WS=/path/to/workspace node scripts/seed-testws-fixtures.mjs
 *
 * Does NOT hardcode production defaults to a personal path. Safe synthetic content only.
 * Workspace must live outside the engine tree (user data).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  periodFileStem,
  daySectionHeading,
  periodParts,
} from "../lib/stream-period.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, "..");

const rootArg = process.argv[2] || process.env.TOPMIND_SEED_WS;
if (!rootArg) {
  console.error("Usage: node scripts/seed-testws-fixtures.mjs <workspace-root>");
  process.exit(2);
}

const workspaceRoot = path.resolve(rootArg);
if (workspaceRoot === ENGINE_ROOT || workspaceRoot.startsWith(ENGINE_ROOT + path.sep)) {
  console.error("Refusing to seed inside engine root:", ENGINE_ROOT);
  process.exit(2);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(rel, content) {
  const abs = path.join(workspaceRoot, rel);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, content, "utf8");
  return rel;
}

const now = new Date();
const weekStem = periodFileStem("weekly", now) || "2026-W32";
const prev = new Date(now);
prev.setDate(now.getDate() - 7);
const prevStem = periodFileStem("weekly", prev) || "2026-W31";

// Build day headings for current + previous days within current week where possible
const dayNow = daySectionHeading(now);
const d1 = new Date(now);
d1.setDate(now.getDate() - 1);
const dayY = daySectionHeading(d1);

const yaml = `contract_version: 4
workspace:
  name: TestWS 演示工作区
  locale: zh-CN
  template: stream
  category_separator: "-"
categories:
  extensions: {}
  overrides: {}
stream:
  packing: weekly
  append_heading: day
  default_view: stream
memory:
  dir: memory
  layers:
    global:
      file: profile.md
      update: on-suggest
    periodic:
      dir: periodic
      cadence: weekly
      style: brief
    topics:
      dir: topics
      auto_create: false
  promotion:
    enabled: true
    min_occurrences: 2
    require_confirm: true
protection:
  defaults:
    by_role:
      buffer: open
      loose-stream: open
      deep-work: open
      delivery: open
      system: locked
lifecycle:
  inbox:
    review_after_days: 7
  catch_all:
    retention_days: 30
  stream:
    digest_after_periods: 4
  topic:
    stale_after_days: 90
    suggest_archive: true
writeback:
  mode: auto
  shadow: true
  backup_to: 99-归档/backups
  receipts: 99-归档/receipts
ingest:
  default_dest: stream
`;

const periodCurrent = `---
title: ${weekStem} 动态
source_type: user-original
protection: open
---

# ${weekStem} 动态

## 进行中

- [ ] 完成 Stream AI 整理路径走查
- [ ] 给演示专题补一篇阅读笔记

## 记录

${dayY}
- 09:30 打开 TestWS，确认动态主表面可用
- 11:00 记下：活动窗口应包含近期改动笔记，不只最新周期文件名
- 14:20 对「知识管理」专题草稿做了增补想法：需要条目级续写

${dayNow}
- 10:00 今日目标：验证 记下 → 增补 → 整理 → 建议确认
- 10:45 偏好：界面保持安静 chrome，建议用 chip 提示而非第二套列表
- 15:00 待办：把演示 inbox 里的剪藏路由到专题或归档
`;

const periodPrev = `---
title: ${prevStem} 动态
source_type: user-original
protection: open
---

# ${prevStem} 动态

## 进行中

- [x] 搭好测试工作区骨架

## 记录

## 07-28 周二
- 16:00 初始化 topmind 测试工作区目录约定
- 17:30 记录：topic 应落在内容大类，不进 memory/topics 默认路径

## 07-30 周四
- 11:00 写了一段关于个人动态流心智模型的草稿
`;

const profile = `---
title: 我的情况
memory_layer: global
source_type: user-original
protection: open
---

# 我的情况

> 演示用合成画像，非真实隐私。

## 偏好

- 喜欢安静、低噪音的工作台界面
- 笔记默认落在动态周期本，深度工作再升专题

## 当前目标

- 验证 topmind 动态主路径：记 → 增补 → 整理 → 确认沉淀
- 保持文件真源与 ≤5 用户概念

## 进行中的事

- （${periodParts(now).ymd}）走查 Stream AI 活动窗口与建议确认面
`;

const periodic = `---
title: ${prevStem} 周期反思
memory_layer: periodic
source_type: ai-derived
protection: open
---

# ${prevStem} 周期反思

### 本周要点
- 建立了测试工作区三平面骨架
- 明确 topic 归内容大类、memory 以 profile + periodic 为主

### 进行中的事
- Stream-first 产品路径走查
`;

const topicMd = `---
title: 知识管理演示
category: 20-专题
topic: 2026-知识管理演示
status: active
source_type: user-original
protection: open
---

# 知识管理演示

## 概述

这是 TestWS 中的演示专题，用于验证：
- 专题首页 \`topic.md\`
- 活动窗口可收录专题笔记的 mtime 变更
- AI 建议「开/并专题」落在内容大类而非 memory/topics

## 笔记

见同目录其他 markdown。
`;

const topicNote = `---
title: 活动窗口笔记
category: 20-专题
topic: 2026-知识管理演示
source_type: user-original
protection: open
---

# 活动窗口笔记

整理范围不应只看「最新周期文件名」。

当用户对很久以前的笔记做增补时，**原文整体**应进入最新整理窗口。

## 要点

- 近期周期本
- 近期 mtime 变更
- 增补锚定 parent
`;

const inboxNote = `---
title: 待路由剪藏
source_type: external-capture
protection: open
---

# 待路由剪藏

演示收件箱条目：一篇关于个人知识管理的链接摘要。

- 来源：示例 URL
- 建议：路由到 20-专题/2026-知识管理演示 或归档
`;

const deliveryNote = `---
title: 演示交付稿
published_at: "${periodParts(now).ymd}"
source_type: user-original
protection: open
---

# 演示交付稿

这是 88-输出 中的示例成品，用于验证「写出来」列表与发布标记。

## 摘要

topmind 以动态流为默认主表面，AI 建议确认后再沉淀。
`;

const written = [];
written.push(writeFile("topmind.yaml", yaml));
written.push(writeFile("00-收件箱/2026-08-03-待路由剪藏.md", inboxNote));
written.push(writeFile(`10-动态/${weekStem}.md`, periodCurrent));
written.push(writeFile(`10-动态/${prevStem}.md`, periodPrev));
written.push(writeFile("20-专题/2026-知识管理演示/topic.md", topicMd));
written.push(writeFile("20-专题/2026-知识管理演示/活动窗口笔记.md", topicNote));
written.push(writeFile("88-输出/2026-08-03-演示交付稿.md", deliveryNote));
written.push(writeFile("memory/profile.md", profile));
written.push(writeFile(`memory/periodic/${prevStem}.md`, periodic));
// ensure empty system dirs exist
ensureDir(path.join(workspaceRoot, "99-归档", "backups"));
ensureDir(path.join(workspaceRoot, "99-归档", "receipts"));
ensureDir(path.join(workspaceRoot, "memory", "topics"));
ensureDir(path.join(workspaceRoot, ".topmind"));

console.log(JSON.stringify({
  ok: true,
  workspaceRoot,
  files: written,
  streamPeriods: [weekStem, prevStem],
}, null, 2));
