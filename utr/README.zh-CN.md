# topmind UTR — 可选 CLI / MCP

[English](README.md) · [简体中文](README.zh-CN.md) · [根目录 README](../README.zh-CN.md) · [TOOLS.md](../TOOLS.md)

> **边界：** UTR 是 Kernel（`lib/`）之上的**可选** CLI / MCP **适配器**。  
> Skills 主路径 = Host 文件工具。Desktop 主路径 = WorkspaceService → Kernel `writeback-engine`。  
> UTR **不是**内容真源（工作区文件系统才是）。写入模式仅 **auto | confirm**。  
> 工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`  
> 见 [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) · [`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md)。

UTR（Unified Tool Runtime）暴露**确定性工作区命令**。唯一 CLI 入口是 `topmind-cli`。

**6 条核心规约**（[`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) §3）：

1. **大类不重叠**  
2. **专题自然涌现**  
3. **动态类特殊**  
4. **兜底类清理**  
5. **参考资料定位**  
6. **大类命名稳定**

---

## 命令面

```text
workspace-read · workspace-write · workspace-transform · workspace-maintain
contract · memory · lifecycle · derived
```

**8 域 / 28 命令** · MCP 默认 **19**（primary + danger）· advanced 9 折叠（`topmind_MCP_ALL=1` 全开）

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

完整契约：[`../TOOLS.md`](../TOOLS.md)。

---

## 目录布局

| 路径 | 角色 |
|------|------|
| `utr/contracts/*/*.json` | 域、命令、风险、审阅策略（权威） |
| `utr/core/` | 路径、信封、doctor、写回辅助 |
| `utr/bin/topmind-cli.mjs` | CLI：`doctor` · `tool <list\|inspect\|preview\|run>` |
| `utr/server/topmind-mcp.mjs` | MCP 服务器 |
| `utr/tools/*` | 命令实现（写入走 Kernel） |

- 运行时：**仅 Node**（`execution.runtime`）。  
- Desktop **不**硬依赖 UTR（工具控制台可软加载同一棵树）。  
- 耐久 `.md` 写入走 Kernel `lib/writeback-engine.mjs`。  
- `writeback-safety.mjs` = 执行器事务快照（不是第二套内容闸口）。  
- `safety-receipt-paths.mjs` = `99-归档` backups/trash/legacy 的列出/恢复路径形状。

---

## 内容真源

```text
用户工作区文件系统  (categories / topics / memory / archive)
```

引擎共享：monorepo `lib/` + `templates/*.json`（不要求 Desktop 运行时）。

---

## 校验

```bash
# 仓库根
npm run utr:test
npm run utr:doctor:engine
npm run utr:doctor
npm run utr:list

node utr/bin/topmind-cli.mjs tool inspect workspace-read
node utr/bin/topmind-cli.mjs tool preview workspace-read list-categories
```

---

## 调用约定

- 身份：`kind` + `command`（例如 `workspace-write.capture-note`）— 操作命令面  
- 写入使用分开的 `category` + `topic` 字段（不是单个 `projectId`）  
- 类型由**物理类别路径**表达 — 无 `project_type` 输入  
- 写回：`writebackMode: auto | confirm`  
- **操作执行审阅：** `confirm` 下高风险写入返回审阅计划；`auto` 下执行 + 回执  
- **操作结果审查：** 所有写入返回 `affectedFiles` + `receipt`（回执）；危险改动走 `99-归档/`  
- `list-safety-receipts` / `restore-safety-receipt` 理解 Kernel `backups/trash` 与遗留 trash 布局  

维护政策：[`ROADMAP.md`](./ROADMAP.md)。

## 版本

真源：[`utr/VERSION`](./VERSION) — 使用 `npm run versions`。

Desktop 把同一棵树打包进 `topmind-engine/utr/`，供设置 → 工具 与 doctor 使用（pathContext 共享 engineRoot + userWorkspaceRoot）。AI 耐久写入仍走 WorkspaceService → Kernel，不走 UTR `executeTool`。  
子进程运行时：`core/node-runtime.mjs`（没有 `ELECTRON_RUN_AS_NODE` 时不要直接跑 Electron）。
