# 设计：工作区工具与日志（Tools & Logs）

> **状态**：Implemented (P0–P2 core) — **非现行策略真源**；写闸/授权以 `TOOLS.md` · `PROJECT-MODEL.md` · ADR `2026-09-17b/c` 为准。  
> **日期**：2026-09-16  
> **范围**：Kernel `lib/` · Desktop electron/services · Desktop UI（WorkspaceSwitcher + Overlay）· 可选 UTR 透出  
> **相关**：`docs/adr/2026-08-27-desktop-log-rotation.md` · `docs/adr/2026-08-07-engine-hardening-writeback-ai.md` · `PROJECT-MODEL.md` · `topmind-desktop/DESIGN.md`

---

## 0. 独立可读结论

1. **写闸策略与产品诉求已经对齐**：工作区内默认授权读写；普通 open 写/删零备份零回执；仅 locked 覆盖 / 核心生命周期操作才备份+回执，并已 `BACKUP_KEEP=3` · `RECEIPT_KEEP=50` 旋转。**不要扩大备份面**。
2. **回执保持轻量**：继续「仅高影响 YAML + 旋转」。普通操作用 **ops journal（环形 JSONL）** 记录可读操作日志，**不是**第二套回执/备份体系。
3. **新建一等公民 Overlay「工具与日志」**，入口在左下工作区下拉；不塞进 StatusBar（状态≠导航），不与 Settings Tools（UTR console）混为一谈。
4. **重复检测算法**：大小分组 → 首尾 4KB 摘要 → 全文流式 SHA-256。典型工作区几乎线性，避免全量哈希。
5. **先修一致性债，再做新面板**：evidence 字段诚实性、菜单日志路径 bug、Desktop checkpoint keep 对齐、UTR `skipReceipt` 偏差。

---

## 1. 现状评估（Correctness / Consistency）

### 1.1 已正确且应保持

| 项 | 结论 |
|----|------|
| 工作区围栏 | `isPathInsideWorkspace` + Desktop `assertPathWithin` + AI `fetch_url` 仅 http(s)；bash 默认不注册 |
| 默认授权模型 | 契约 `writeback.mode` 默认 `auto`；`locked` 内容可编辑（任务级首写快照）；confirm **分级**——仅删/归档 pending |
| 备份策略 | 高影响 only：locked 覆盖备份+回执；锁定/核心 delete → trash+回执；archive 是目的地迁入 |
| 日志轮转 | `main.log` 2MB × keep 3（ADR 2026-08-27） |
| Pi 混合 | `pi-agent-core` + 围栏 FS 别名 + 写闸唯一；不引入 full coding-agent |
| Skills / UTR 边界 | Skills 便携 Markdown；UTR 薄 adapter；Desktop AI 不经 UTR |

**评估**：数据规约主轴（三平面、角色发现、写闸唯一）逻辑正确。产品诉求「默认授权 + 仅关键操作备份」**不是新需求，是现状确认**——实施时勿回退为「每次写都备份」。

### 1.2 不一致 / 缺陷（应修）

| # | 问题 | 位置 | 影响 | 优先级 |
|---|------|------|------|--------|
| C1 | 菜单「打开日志目录」打开 `app.getPath("logs")`，真实日志在 `desktopStateHome/logs/` | `app-menu.mjs` L337 · `main.mjs` L97–100 | macOS 打开错误目录 | P0 |
| C2 | `toSurfaceEvidence` / Desktop `buildWritebackEvidence` 把 `receiptPath` 回退为 `backupPath` | `writeback-engine.mjs` L169 · `writeback.mjs` L211 | 无 YAML 回执时对外仍报 receipt，字段不诚实；测试甚至固化了该行为 | P0 |
| C3 | UTR 批量规范化 `skipReceipt: true` | `utr/tools/workspace-transform.mjs` L30 | locked 覆盖有备份无回执，违反「备份必有回执」 | P1 |
| C4 | Desktop `writePathCheckpoint` 默认 keep=5，Kernel 默认 3 | `writeback.mjs` L161 | 旋转语义双真源 | P1 |
| C5 | 删除 `forceBackup` 死参数（零调用方） | [x] |
| C6 | 回执写入逻辑 4 处复制 | executeWrite / Delete / Archive×2 | 改格式易漏改 | P1 |
| C7 | Desktop `category-pattern.mjs` / `path-model.mjs` 与 Kernel role 表双写 | electron/lib | 改名/扩展类易漂移（asar 约束下需生成式同步，而非运行时 monorepo import） | P1 |
| C8 | `contentHash`（sha1 截断）在 todo / suggest / ai-operation 多处复制 | lib/* | 小冗余 | P2 |
| C9 | Desktop `workspaceHealth` 未调用 `inspectContract`，契约健康与目录健康分裂 | `workspace-scan-ops.mjs` L355 | 面板/Loop 诊断不完整 | P1 |
| C10 | 无容量统计 / 重复检测 / 88·99 深度巡检 UI | 全库 | 本设计要解决的主缺口 | — |

### 1.3 不造轮子结论

- **保留自研 logger 轮转**（ADR 已接受：Win GUI 无 stderr、JSONL、体积有界）。可选换 `electron-log` 的收益不足以推翻测试与 env 契约。
- **重复检测**用 `node:crypto` 流式哈希，不引第三方 dupe 库。
- **文件监听**继续 chokidar。
- **UTR doctor / Tools console** 继续服务「确定性命令」；新面板面向**日常用户**，不复制 UTR 输入框。

---

## 2. 产品原则（写进面板文案与实现约束）

1. **工作区围栏内默认可写**：工具/AI 不弹「是否允许写工作区」；危险动作只在**跨边界、永久删除、批量清理**时确认。
2. **备份极简**：用户可见说明——「仅锁定文件覆盖与核心删除会留快照；其余直接改」。
3. **日志有界**：main.log / ops journal /（未来 AI 摘要）全部 size-cap 旋转；清理入口一键。
4. **建议不自动执行**：清理 / 去重 / 归档均为 **建议 → 预览影响 → 用户确认**。
5. **机器态可删**：ops journal、metrics 缓存放 `.topmind/` 或 `desktopStateHome`，不进内容真源。

---

## 3. 入口与信息架构

### 3.1 菜单

`WorkspaceSwitcher.tsx` 第一组（设置 / 专注）中增加：

```text
设置          ⌘,
专注模式      ⌘⌥F
工具与日志    ⌘⇧L   ← 新增（快捷键见 shortcuts.ts，与现有无撞键）
```

行为：`emitLocal("overlay:open", { kind: "tools-logs" })`。

### 3.2 Overlay：`tools-logs`

新 `OverlayKind`：`"tools-logs"`。  
组件：`src/components/overlays/ToolsLogsPanel.tsx`（lazy，与 Settings/LoopReport 同模式）。

布局：左侧竖 Tab + 右侧内容（与 SettingsLayout 视觉族一致，但**独立 overlay**，不进 Settings 深树）。

```text
┌──────────────────────────────────────────────────────┐
│  工具与日志                                         ✕ │
├────────────┬─────────────────────────────────────────┤
│  概览       │  容量 / 类型 / 角色目录卡片 + 健康摘要   │
│  操作日志   │  用户 & AI 写路径环表（可筛选）          │
│  系统日志   │  main.log 尾部 + 级别/cat 筛选          │
│  健康检查   │  契约 + 结构 + 格式 issue 列表          │
│  清理与整理 │  88/99 重点 · 规约外 · 重复文件建议     │
└────────────┴─────────────────────────────────────────┘
```

原生菜单「打开日志目录」改为打开 `path.dirname(getLogFilePath())`（修 C1）。

---

## 4. 数据模型

### 4.1 操作日志（ops journal）— 不是 receipts

| 项 | 值 |
|----|-----|
| 路径 | `{desktopStateHome}/logs/ops.jsonl`（Desktop 侧） |
| 格式 | 单行 JSON：`{ts, actor, op, ok, rel, backup?, receipt?, reason?}` |
| 写入点 | Desktop `buildWritebackEvidence` 成功/失败后追加；Kernel **不**强制写 journal（保持引擎表面无关） |
| 有界 | 复用 log 轮转：默认 1MB × keep 2（可 env `topmind_OPS_MAX_BYTES` / `topmind_OPS_KEEP`） |
| 清理 | 面板「清空操作日志」截断文件；不触碰 workspace receipts |
| 与 receipts 关系 | **独立**。receipts 仍是高影响恢复凭证；journal 是「刚才发生过什么」的浏览层 |

**为何不放工作区**：避免污染内容平面、避免用户误删恢复凭证；UTR/Obsidian 无 Desktop journal，各自可后续按需接。

### 4.2 Metrics 缓存（可选，P2）

`{desktopStateHome}/state/workspaces/{slug}/metrics-cache.json`  
字段：`scannedAt · totalBytes · fileCount · byExt · byRoleDir · largest[] · duplicatesHash`  
TTL 手动刷新 + 打开面板时若超过 15min 后台重算。可删。

---

## 5. 后端能力（IPC / Kernel）

### 5.1 RPC 面（Desktop）

挂在既有 `workspace` / `system` / `tool` 域，**不**新建第四套服务总线：

```text
workspace.workspaceStats        { scope?: "all"|"delivery"|"archive" }
workspace.workspaceDuplicates   { minSize?, includeArchive?, maxGroups? }
workspace.workspaceIssues       { deep?: boolean }   // 扩展 workspaceHealth
workspace.cleanupPreview        { targets: CleanupTarget[] }
workspace.cleanupApply          { targets, confirmed: true }

system.logTail                  { file: "main"|"ops", limit?, level?, cat?, contains? }
system.logClear                 { file: "main"|"ops" }
system.logOpenFolder            {}
```

AI 工具（只读、给 agent 用）：扩展 `workspace_health` 返回 stats 摘要 + issue；**不**注册 cleanup 写工具到默认 AI 集（清理保持用户手势，避免 agent 静默扫盘删档）。

### 5.2 统计算法（`workspace-stats`）

```text
walk(workspaceRoot)
  skip: .git · .obsidian · .topmind · *.tmp-* · shadow-draft
  optional skip: {system}/backups/**  (默认计入「归档层」桶，不混入内容统计)
aggregate:
  totalFiles / totalBytes
  byExt: count + bytes (top 15)
  byTopLevel: { name, role?, count, bytes }
  largest: top 20 by size
  delivery (role=delivery): count, bytes, oldest, newest, nonFlatDirs
  archive (role=system): backups / receipts / trash / stream-archive / other 子桶 bytes
```

实现：`electron/lib/workspace-stats.mjs`（Desktop 侧 walk，不强制进 Kernel——Obsidian 可后续复用再抽）。

### 5.3 重复检测（高性能）

```text
P1 大小桶   Map<size, path[]>           仅 size>=minSize(默认 1KB) 且 count>=2
P2 摘要     sha256( first4KB || last4KB || size )   同摘要才进 P3
P3 全文     流式 sha256(file)                      同全文 → duplicate group
输出        { hash, size, paths[], mtime[] }
限制        maxGroups 默认 50 · 单文件超 50MB 可跳过全文或仅比 size+摘要
排除        同目录 `__` 备份命名 · `.tmp-` · 空文件
```

复杂度：全盘一次顺序读元数据；仅候选子集读内容。10k 文件工作区通常秒级。

**建议动作（预览，不自动）**：
- 完全同内容：保留 mtime 最新或路径最符合规约的一条，其余「移到 99-归档/backups/trash/duplicates/」或永久删除（默认移 trash 路径，可逆）。
- 不在首版做「近重复」（编辑距离 / simhash）。

### 5.4 健康 / 格式检查（扩展 `workspaceHealth`）

在现有结构检查上合并：

| 检查 | 来源 | 严重度 |
|------|------|--------|
| required roles 目录缺失 | 现有 | error |
| `inspectContract` 非 ok | Kernel（P0 接入） | error/warn |
| inbox 积压 ≥8 | 现有 | info |
| `.DS_Store` / 根级 junk | 现有 + 扩展 | warn |
| 规约外顶层项（非 `{NN-*}` · 非 `memory` · 非 `topmind.yaml` · 非 `.topmind`） | 新 | warn |
| `topic.md` 缺失 title / 非法 frontmatter（浅解析） | 新 | warn |
| 88-交付非扁平子目录堆积 | 新 | info |
| 空目录（连续 2 层） | 新 | info |
| 超大单文件（默认 >20MB） | stats 附带 | info |

UTR `doctor-workspace` **不合并实现**；面板可展示其结果为「高级诊断」折叠区（已有 `tool.doctor`）。

### 5.5 清理目标（CleanupTarget）

```ts
type CleanupTarget =
  | { kind: "junk"; paths: string[] }           // .DS_Store 等
  | { kind: "empty-dirs"; paths: string[] }
  | { kind: "archive-old"; year: number }        // stream year → 99/stream-archive
  | { kind: "prune-backups"; beyondKeep: true }  // 强制按 KEEP 再剪
  | { kind: "duplicate-group"; keepPath: string; dropPaths: string[]; mode: "trash"|"permanent" }
```

`cleanupPreview` 返回：将影响的文件列表、释放字节、是否可逆。  
`cleanupApply` 必须 `confirmed: true`；permanent 再走二次确认（与现有 delete 文案族一致）。

清理**仍走** WorkspaceService / writeback 路径，禁止面板直接 `fs.rm` 绕过围栏与保护级别。

---

## 6. 前端模块设计

### 6.1 概览 Tab

- 顶部卡片：总文件数 · 总体积 · Inbox 待办数 · 健康灯（ok/warn/error）
- 角色条：Inbox / 内容类合计 / 88-交付 / 99-归档 / memory / .topmind（体积横条）
- 扩展名 Top 列表
- 「重新扫描」按钮 + 上次扫描时间

### 6.2 操作日志 Tab

- 表：时间 · 来源（用户/AI/连接器） · 操作 · 路径 · 备份/回执标记
- 筛选：actor / op / 是否有 backup / 文本 contains
- 空态：「暂无记录 — 普通编辑不会写快照，但会记在这里」
- 操作：打开所在目录（有 backup/receipt 时）、清空日志、导出 JSONL

### 6.3 系统日志 Tab

- 级别 chips（error/warn/info）+ cat 下拉（ai / workspace / ingest…）
- 虚拟列表尾部 200–500 行（`system.logTail`）
- 「在 Finder 中显示」「复制末 N 行」「清空当前与轮转档」

### 6.4 健康检查 Tab

- 列表按 severity 分组，每条：code · message · path · 「定位到文件」（若在工作区内）
- 顶部「运行检查」；可选「高级：UTR doctor」按钮复用现有 `api.tool.doctor`

### 6.5 清理与整理 Tab

分节卡片：

1. **99-归档占用** — backups/receipts/trash/stream-archive 体积；建议「按策略修剪」（预览 KEEP 语义）
2. **88-交付** — 条目数/体积/命名异常；建议人工浏览，提供「打开 88」
3. **规约外文件** — 列表 + 建议「移入 Inbox / 专题 / 忽略白名单」
4. **重复文件** — 「扫描」→ 分组表 → 勾选保留项 → 移至 trash / 永久删除
5. **垃圾与空目录** — 一键预览清理

所有破坏性按钮：主按钮次级样式 + 确认对话框说明可逆性（对齐「删除诚实」纪律：默认 trash 才可逆）。

---

## 7. 一致性修复包（与面板同迭代或紧前）

| ID | 动作 | 状态 |
|----|------|------|
| C1 | `open-logs` → `dirname(getLogFilePath())` | [x] |
| C2 | `receiptPath` 仅真实 YAML；undo 看 `backupPath` | [x] |
| C3 | UTR transform 去掉 `skipReceipt:true` | [x] |
| C4 | Desktop checkpoint `keep` 默认 3 | [x] |
| C5 | 删除 `forceBackup` 死参数 | [x] |
| C6 | Kernel `writeReceiptFile` 单点 | [x] |
| C7 | Desktop `category-pattern.mjs` 由 Kernel 生成 + check + 同步测试；UTR receipt 路径 import `ROLE_DIR_ALIASES` | [x] |
| C8 | `lib/content-hash.mjs` 共享 | [x] |
| C9 | `workspaceHealth` 接 `inspectContract` | [x] |

---

## 8. 明确不做（Non-goals）

- 不做全库向量检索 / 语义重复
- 不做自动「智能整理」静默执行
- 不把 ops journal 升级为第二套 writeback
- 不在首版引入 electron-log 或外部 hash CLI
- 不把面板做成 Settings 的附属 tab（用户心智：工作区维护工具，与「设置」并列）
- 不注册 AI 默认 cleanup 工具（防 agent 批量误删）

---

## 9. 实施阶段

| 阶段 | 内容 | 退出标准 |
|------|------|----------|
| **P0** | C1+C2 修复 · 菜单项 · Overlay 骨架 · 系统日志 Tail · 概览只读 stats | 质量门绿；打开日志目录指向正确；evidence 无假 receiptPath |
| **P1** | ops journal 写入 · 操作日志 Tab · workspaceHealth+contract · 健康 Tab | 写文件后 journal 可见；契约 corrupt 在面板可发现 |
| **P2** | stats 完整 · 重复检测 · 清理预览/应用 · 清理 Tab · C3–C7 | 去重 trash 可恢复；cleanup 全走 writeback |
| **P3** | C8 · 文案/i18n 完备 · Loop 报告复用 stats · 文档与 AGENTS 诚实状态更新 | `npm run desktop:quality` + docs:guard |

---

## 10. 测试与验收

- **单测**：`workspace-stats` 聚合 · 重复三阶段（同 size 不同内容 / 同内容不同路径）· journal 轮转 · evidence 字段诚实
- **行为**：cleanupApply 对 locked 文件拒写；duplicate permanent 需要 confirmed；fence：路径始终在 root 内
- **UI**：tools-logs overlay 可开关、Esc 关闭、与 settings 互不抢 focus
- **回归**：`tests/writeback-engine.test.mjs` · `log-rotation` · `ui-token-compliance` · i18n 对齐

---

## 11. 用户可感知文案（zh-CN 草案）

- 菜单：「工具与日志」
- 概览副标题：「工作区占用与结构一览」
- 操作日志空态：「普通编辑直接保存，不会留下快照；操作会记在这里，方便回看。」
- 备份说明：「只有锁定文件被覆盖、核心笔记删除时才会自动备份。」
- 清理：「建议先预览，确认后再执行。默认移入归档回收区，可恢复。」

---

## 12. 风险

| 风险 | 缓解 |
|------|------|
| 全盘 walk 卡 UI | stats 在 main 进程 async + 可取消；面板 loading；大仓跳过全文哈希 |
| 用户把 journal 当备份 | 文案明确「浏览层」；删除清空不影响 99 receipts |
| 清理误删 | 默认 trash；permanent 二次确认；locked 仍由写闸拒绝 |
| asar 内双真源再漂移 | 生成式同步 + CI diff 测试 |

---

## 附录 A — 与现有能力映射

| 用户诉求 | 落点 |
|----------|------|
| 默认授权读写 | 已有 auto + 围栏；面板只读展示，不改权限模型 |
| 仅关键操作备份 | 已有；面板「操作日志」可标记 backup/receipt |
| receipts 简单可清理 | 已有旋转；清理 Tab 提供 prune preview |
| 日志友好查看 | 新 overlay：ops + main.log |
| 文件统计/容量/类型 | `workspace.workspaceStats` |
| 88/99 重点 | stats 分桶 + 清理 Tab 专节 |
| 规约外文件 | health issue + 清理建议 |
| 重复文件 | 三阶段哈希 + trash |
| 不重复造轮子 | 扩展 writeback logger / scan-ops / Tools IPC；Pi/UTR 边界不动 |
