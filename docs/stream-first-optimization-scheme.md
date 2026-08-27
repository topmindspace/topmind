# Stream-first 个人动态流 — 现行产品真理与决策记录

> **状态**：**Shipped** · **日期**：2026-08-03  
> **角色**：理想使用态 + 现行产品真理  
> **基线真源**：`docs/ARCHITECTURE-RESET.md` · `DESIGN.md` · `topmind-desktop/DESIGN.md`  
> **实现**：`lib/activity-window.mjs` · suggest/todo/ai-ops · Desktop `StreamDetailView` / `ActionStore.runActivityOps` / `organize-week`

---

## 0. 现行产品真理

| 能力 | 现状 |
|------|------|
| 整理范围 | **活动窗口**（近期周期 ∪ mtime ∪ 增补 parent）— 非「仅最新周期文件名」 |
| 条目增补 | 动态卡片续写 · 同 Markdown · `<!-- topmind:append -->` |
| AI 在动态 | 标题栏 💡 + 有条目时状态栏计数 chip（空则隐藏）→ `openSuggestSurface` → **SuggestPopover** 确认面（无第二套列表；不埋 AI 聊天轨） |
| 整理按钮 | reconcile 任务 + `runActivityOps`（suggest + memory_organize + topic_classify） |
| memory | **profile + periodic + topic memory**（浏览面；写入仍 confirm） |
| topic | **内容大类 `create_topic`**（confirm · 不进 `memory/topics`） |
| 写闸 | 全部 apply 经 writeback / applySuggestion + high-impact gate |
| 展示净化 | feed 对 `\[ \]` / `\-` 等转义做 **display-only** normalize（不静默写回用户文件） |
| 待办 complete 匹配 | maintain 完成/更新用语义/实质短语匹配（禁单 token 拉丁误完成）；见 `matchTodoMaintainText` |

---

## 1. 理想使用模型

### 1.1 日常节奏

用户打开 topmind，**默认就在「动态」**——像打开个人时间线，而不是文件夹管理器。

```text
打开 → 看见最近动态 feed
  → 随时「记下」一条（最低摩擦）
  → 有时回到某条旧记录上「增补/评论」几句（延续，不是新开平行叙事）
  → 系统根据「近期活动」准备整理建议（待办 / 记忆 / 笔记 / 主题）
  → 用户在 feed 附近一眼看见建议，点头确认 → 沉淀到待办 / 我的情况 / 专题 / 写出来
  → 文件永远是真源；随时可在 Finder / Obsidian 打开同一工作区
```

### 1.2 用户心智闭环

```text
记 → 动态 feed → 在动态上增补 → AI 建议/整理（在动态语境里显眼）→ 确认沉淀
  → 专题 / 记忆 / 待办 / 写出来（二级深工，不抢主路径）
```

### 1.3 「评论式增补」

- 用户对**已经记录过的一条内容**追加后续（进度、更正、相关链接、一句感想）  
- 时间线上**仍能读到完整脉络**：原内容 + 后续增补  
- 该动作使 **原条目重新进入最新整理范围**——不仅处理 delta 本身

### 1.4 AI 职责边界

| AI 做什么 | AI 不做什么 |
|-----------|-------------|
| 从**活动窗口**提取待办、记忆候选、主题建议、笔记归位 | 静默改 locked / 未经确认的高影响批写 |
| 在动态语境中**显眼且可忽略**地展示建议 | 逼用户先学会打开 AI 轨才能完成「整理」 |
| 对「旧文被增补」整包再理解（原文 + 增补） | 只扫最新周期文件名 |
| 维护查看形式（摘要、分组、健康提示） | 把 Desktop 会话态写成内容真源 |

### 1.5 活动窗口语义

```text
activity_window =
    时间带内的动态条目
  ∪ 时间带内 mtime/内容变更的笔记与专题文件
  ∪ 对旧条目的增补所锚定的「关联原文 / 原文所在文件」
  ∪ 用户显式钉住的范围（可选）
```

**关键规则**：用户评论/增补一条很久以前的笔记时，**整段关联知识进入最新整理窗口**。

### 1.6 成功体感

1. 「我主要就是在刷/写动态」  
2. 「补一句就像回自己」  
3. 「AI 会看着我最近动过的东西，问我要不要整理」  
4. 「我点头之后，待办/记忆/专题才变」  
5. 「文件还在磁盘上，结构一眼能懂」

---

## 2. 合闸实施记录（Wave S\* · Done）

| 产出 | 验收 |
|------|------|
| 活动窗口引擎 | `lib/activity-window.mjs` — 周期 ∪ mtime ∪ 增补 parent；默认 21 天 / 30 文件 / 6 周期；语料 suggest 16K · todo extract 16K · maintain 12K |
| 条目增补 UI | `appendStreamEntry` + StreamDetailView 按日分组 + cohesion |
| 安静建议 chip | 标题栏 💡 + 状态栏计数 chip（空则隐藏）→ SuggestPopover |
| organize activity ops | `runActivityOps`（suggest + memory_organize + topic_classify）合入 ActionBar |
| memory_organize | profile + periodic only（confirm） |
| topic_classify | 内容大类 `create_topic`（confirm · 不进 `memory/topics`） |
| 文档诚实 | ARCHITECTURE-RESET §2.3 Wave S\* 行；本文精简为现行真理 |
