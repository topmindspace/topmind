# topmind Loop — Design

> Companion to [`SKILL.md`](./SKILL.md). Design rationale and constraints only.

## Why Loop Exists

UTR 提供 **8 域 / 27** 条确定性命令；`doctor-workspace` 做规则健康检查。Loop 在之上增加**语义层**：阅读 `topic.md` 与笔记、对照 skill 契约、再调用 UTR 修复。

## Design Choice — Skill + Agent + State File, Not CLI

Three pieces, no more:

```text
loop = SKILL.md (规约) + agent host (自带 LLM) + .topmind/loop/*.md (进度落盘)
```

### Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| Independent CLI binary (`topmind-loop ...`) | Adds another install shape, breaks topmind's single-frontend principle (only `topmind` is a daily entry). |
| TUI panel | Premature. `.topmind/loop/*.md` files already give visibility via any markdown viewer; TUI duplicates that. |
| Provider-configurable LLM | The agent host already has LLM context. Adding a provider config layer = double work + new failure modes. |
| JSON `LoopReport` | Markdown state files are human-readable AND machine-parseable (frontmatter-style fields at top). JSON hides what loop did from the user. |
| Loop as `topmind-maintain` sub-action | Loses the independent identity; users lose the single keyword `loop` as a verb. |
| Per-category state files (`.topmind/loop/categories/10-动态.md`) | Explodes file count; one `.topmind/loop/topics.md` with category-prefixed cursors is more readable and still auditable. |

### Why `.topmind/loop/` (not in scope root)

Three reasons:

1. `.obsidian/` / `.git/` precedent — hidden directory convention is already established.
2. Workspace-spec §1.1 says scopes hold topic material only. State files are loop runtime, not topic material.
3. Obsidian / Finder / VS Code ignore hidden directories by default — loop state doesn't pollute the user's main views.

### Why cursor + done/total

A cyclic loop must be resumable. Two competing approaches:

- **Checkpoint per item** (e.g. `.topmind/loop/topics/02-研究/2026-示例研究.state`) — more granular but explodes file count.
- **Single state file with `cursor` field** (chosen) — coarse but readable. User can hand-edit cursor to skip or reorder, which is more useful than per-item checkpoints for an audit/cleanup loop.

Trade-off accepted: if the loop is interrupted mid-item, that item starts over on resume. Loop semantics are idempotent (read → judge → fix → log), so this is safe.

## Scope × File Matrix

```text
.topmind/loop/topics.md    ← loop walks topmind-workspace/{NN 大类}/{YYYY-专题}/
                     (大类+专题递归，category 通过 path prefix 识别)
.topmind/loop/inbox.md     ← loop walks topmind-workspace/{buffer role category}/*
.topmind/loop/archive.md   ← loop walks topmind-workspace/{system archive category}/*
```

Adding a new scope (e.g. a user-created category) = no schema migration, the topics scope auto-covers it. The cursor and walk log just inherit the new category prefix.

## Conformance Rules (Hard Limits)

Loop is aggressive but never breaks these:

- System archive category is read-only by default. Mutations require explicit user opt-in per run.
- Writes: host file tools first (primary); optional UTR accelerate. Always leave path receipts.
- Destructive operations (archive, delete, normalize metadata) leave receipts in `.topmind/loop/{scope}.md → Receipts` and in `list-safety-receipts`.
- Topic naming must stay `YYYY-主题` (kebab-case); loop **suggests** rename but does **not** force it without explicit user approval in the same turn.
- **Category naming is forbidden to change in loop.** Categories are stable; renames require human + Desktop/`renameCategory`（`topmind.yaml` schema v4）。Legacy `projects/` → categories still uses UTR `migrate-v4`.
- `state.json` is always rebuildable; loop never treats it as content truth.
- **Sparse home hint only**：many topic notes + missing/empty `topic.md` → suggest organize/memory in the walk log; **never** auto-fill Stable Memory or create `INDEX.md`.
- **architecture drift signals** (must flag, never auto-fix): `YYYY-类型-项目名` residues, `project_type` fields, default anchor files (`outline.md` / `setting.md` / `style.md`), v2.x command names in skill/UTR calls, top-level `projects/` / `references/` / `sources/` / `library/` roots, physical reserved-slot directories.

## Relationship to Other Skills

| Skill | Relationship to loop |
|---|---|
| `topmind-maintain` | Loop's deterministic sibling. Calls the same UTR commands. Loop adds semantic understanding on top. |
| `topmind-organize` | Consumes loop output. When loop finds `merge-candidates.md` entries, organize can do the deeper synthesis. |
| `topmind-capture` | Feeds loop. New captures drop into inbox → next loop run auto-processes. |
| `topmind-write` / `topmind-memory` | Loop does NOT touch content. Write/memory are still explicit user-driven. |

## Extension Notes

- Inbox 新捕获由下次 loop 处理  
- 跨专题合并建议可写 `.topmind/loop/merge-candidates.md`，再交 `topmind-organize`  
- 触发方式可变（对话 / cron / watcher），契约仍是本 SKILL.md  
