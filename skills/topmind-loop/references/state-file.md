# Loop State File Format

```text
{workspace}/.loop/
├── README.md
├── topics.md
├── inbox.md
└── archive.md
```

`.loop/` 遵循 `.obsidian` / `.git` 隐藏约定，不污染主视图。

## Template

```markdown
# Loop State — topics

last_run: 2026-07-13T12:00:00+08:00
scope: {workspace-root}/{categories}/*/
cursor: {类别}/{专题}
done: 6 / total: 11

## 本轮计划

- …

## 已完成

- [x] {类别}/2026-示例 — 无异常

## 待处理（下次继续）

- [ ] …

## Errors / Blockers

- …

## Receipts

- 2026-07-13T12:01 — plan-inbox-routing → path.md
```

## Cursor & Resume

- `继续 loop` / `从断点继续`：读 `cursor`，从该项继续  
- 用户可手改 `cursor` 跳过/重排  
- **若 `.loop/` 或 scope 文件缺失**：不报错；当作首次运行；通知用户后全跑并在 walk 中创建状态文件（不要预先写空文件）  

## Auditability

每次运行更新：`last_run` · `cursor` · `done/total` · 已完成/待处理/Errors · Receipts 路径。  
