# topmind UTR — optional CLI / MCP

[English](README.md) · [简体中文](README.zh-CN.md) · [Root README](../README.md) · [TOOLS.md](../TOOLS.md)

> **Boundary:** UTR is an **optional** CLI / MCP **adapter** over Kernel (`lib/`).  
> Skills main path = host file tools. Desktop main path = WorkspaceService → Kernel `writeback-engine`.  
> UTR is **not** content truth (the workspace filesystem is). Write modes: **auto | confirm** only.  
> Workflow: `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`  
> See [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) · [`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md).

UTR (Unified Tool Runtime) exposes **deterministic workspace commands**. The only CLI entry is `topmind-cli`.

**6 条核心规约** ([`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) §3):

1. **大类不重叠**  
2. **专题自然涌现**  
3. **动态类特殊**  
4. **兜底类清理**  
5. **参考资料定位**  
6. **大类命名稳定**

---

## Command surface

```text
workspace-read · workspace-write · workspace-transform · workspace-maintain
contract · memory · lifecycle · derived
```

**8 域 / 28 命令** · MCP default **19** (primary + danger) · advanced 9 folded (`topmind_MCP_ALL=1` opens all)

| Kind | Primary / Danger | Advanced |
|------|------------------|----------|
| `workspace-read` | `list-categories` · `list-topics` · `inspect-topic` · `list-topic-files` · `list-inbox` | `list-recent-captures` · `list-safety-receipts` |
| `workspace-write` | `create-topic` · `capture-note` · `save-output` | `update-topic` |
| `workspace-transform` | `plan-inbox-routing` | `normalize-note-metadata` · `migrate-v4` |
| `workspace-maintain` | `doctor-workspace` · danger: `archive-topic` · `archive-stream-year` · `restore-safety-receipt` | `cleanup-empty-dirs` |
| `contract` | `validate` · danger: `reseed` | `ensure` |
| `memory` | `promote` · `digest` · `append-profile` · `append-topic` | — |
| `lifecycle` | — | `scan` |
| `derived` | — | `rebuild` |

Full contracts: [`../TOOLS.md`](../TOOLS.md).

---

## Layout

| Path | Role |
|------|------|
| `utr/contracts/*/*.json` | Domains, commands, risk, review policy (authoritative) |
| `utr/core/` | Paths, envelopes, doctor, writeback helpers |
| `utr/bin/topmind-cli.mjs` | CLI: `doctor` · `tool <list\|inspect\|preview\|run>` |
| `utr/server/topmind-mcp.mjs` | MCP server |
| `utr/tools/*` | Command implementations (Kernel-backed writes) |

- Runtime: **Node only** (`execution.runtime`).  
- Desktop does **not** hard-depend on UTR (Tools console may soft-load the same tree).  
- Durable `.md` writes go through Kernel `lib/writeback-engine.mjs`.  
- `writeback-safety.mjs` = executor transactional snapshots only (not a second content gate).  
- `safety-receipt-paths.mjs` = list/restore path shapes for `99-Archive` backups/trash/legacy.

---

## Content truth

```text
User workspace filesystem  (categories / topics / memory / archive)
```

Engine share: monorepo `lib/` + `templates/*.json` (no Desktop runtime required).

---

## Verify

```bash
# From repo root
npm run utr:test
npm run utr:doctor:engine
npm run utr:doctor
npm run utr:list

node utr/bin/topmind-cli.mjs tool inspect workspace-read
node utr/bin/topmind-cli.mjs tool preview workspace-read list-categories
```

---

## Call conventions

- Identity: `kind` + `command` (e.g. `workspace-write.capture-note`) — 操作命令面  
- Writes use separate `category` + `topic` fields (not a single `projectId`)  
- Type is expressed by **physical category path** — no `project_type` input  
- Writeback: `writebackMode: auto | confirm`  
- **操作执行审阅:** under `confirm`, high-risk writes return a review plan; under `auto`, execute + receipt  
- **操作结果审查:** all writes return `affectedFiles` + `receipt`（回执）; dangerous changes go through `99-Archive/`  
- `list-safety-receipts` / `restore-safety-receipt` understand Kernel `backups/trash` and legacy trash layouts  

Maintenance policy: [`ROADMAP.md`](./ROADMAP.md).

## Version

Truth source: [`utr/VERSION`](./VERSION) — use `npm run versions`.

Desktop **bundles** the same tree under `topmind-engine/utr/` for Settings → Tools and doctor (pathContext shares engineRoot + userWorkspaceRoot). AI durable writes still use WorkspaceService → Kernel, not UTR `executeTool`.  
Subprocess runtime: `core/node-runtime.mjs` (never raw Electron without `ELECTRON_RUN_AS_NODE`).
