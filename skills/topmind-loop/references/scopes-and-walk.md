# Loop Scopes & Per-Item Walk

## Scopes

| Scope | Walks | State file |
|-------|-------|------------|
| `topics` | 每个 `{大类}/{专题}/` | `.topmind/loop/topics.md` |
| `inbox` | buffer 类别（常 00-收件箱）下条目 | `.topmind/loop/inbox.md` |
| `archive` | system 类别（常 99-归档）下条目 | `.topmind/loop/archive.md` |

默认全跑三 scope。用户可限定：`loop 一下 topics` / `loop 一下 {类别名}` / `继续 loop`。

## Per-Item Walk（agent 是裁决者）

### 1. Read

- 专题：`topic.md`（若有）+ 抽样根目录 `.md`；发现 `outline.md`/`setting.md`/`style.md` 标 drift  
- 散记：`{大类}/*.md` frontmatter + body  
- Inbox：内容与归属线索  
- Archive：README / 抽样；**默认只读**  

### 2. Semantic decide

- 信任专题自述工作流；空子目录若声明用途 → preserve  
- 对照 `topic.md` 声称 vs 实际笔记  
- 索引链接是否失效；`下一步` / 状态是否陈旧  
- Inbox：每条需路由到类别（±专题）  
- **首页偏空提示（只建议，不自动写）**：专题根 `.md` 较多（例如 ≥5，不含 topic.md）而 `topic.md` 缺失、或正文几乎只有标题/占位时 → Escalate 或回执一句：「材料不少，可用 organize 整理落盘 / 需要时 memory 写首页」。**禁止** loop 自己填稳定记忆或新建 INDEX.md  

**Architecture drift（写入 Errors / Blockers，不静默改）**：

- `YYYY-类型-项目名` 命名  
- frontmatter `project_type:`  
- 默认锚点 `outline.md` / `setting.md` / `style.md`  
- 顶层 `projects/` / `references/` / `sources/` / `library/`  
- 废弃 UTR 名（`create-project` 等；现行 `workspace-*`）  

### 3. Apply / Preserve / Escalate

- **Apply** — host 文件工具（主）或 UTR：补 frontmatter、`plan-inbox-routing` 等  
- **Preserve** — 写清为什么不动  
- **Escalate** — 需人决策时写 Errors / Blockers  

不输出「请用户批准的建议清单」当作完成态；走查日志记录**已做决策**。

### 4. Record

每项追加到 scope 状态文件（见 `state-file.md`）。

## Guardrails

- system 归档默认只读  
- 写主路径 = host 文件工具；UTR 可选加速；危险操作备份  
- 不改类别名（需 human + Desktop 重命名 / `renameCategory`；v2 `projects/` 迁移仍用 `migrate-v4`）  
- 不自动把散记升专题  
- 不写内容稿 / 不改专题目标（那是 write/memory）  
