# ADR: Adversarial first-principles review (2026-08-13)

> **状态**：Accepted · **日期**：2026-08-13  
> **角色**：对抗性审查真源（本轮 High  backlog）· 实施后 Reset/DESIGN 诚实表对齐  
> **范围**：架构 · 设计理念 · 工作流 · 功能 · 模块 · UIUX · 基础设施 · AI 引擎与能力  
> **立场**：第一性原理 + 用户体验 + 架构师；**不保留**仅为旧代码编译的兼容层

## 北极星（不重审）

最低摩擦个人动态流。文件是真源。写闸唯一。AI 建议、高影响须确认。用户概念 ≤5。

审查不问「文档是否声称 Done」，只问：**可观察的双轨、确认泄漏、概念超标、过时实现是否仍在跑。**

---

## Frozen High list（本轮必须落地）

| # | Finding | Verdict | Surface |
|---|---------|---------|---------|
| **H1** | 契约双投影 + v3 JSON 热路径 + 第二 YAML 写者 | rewrite / delete | Kernel + Desktop |
| **H2** | AI 写回策略被 view-store 默认 `auto` 覆盖，可击穿 yaml `confirm` | rewrite / delete | Desktop AI |
| **H3** | `kind:home` soft-heal 仍在类型系统与命令加权里 | delete | Desktop UI |
| **H4** | Clip 第二套 HTML→MD 转换器 + v3 inbox 回退 | delete / replace | Clip + Desktop converter |
| **H5** | PrimaryNav 把「归档」升成与动态/收件箱/写出来同级；「搜索」（找回）藏在 L3 | rewrite | Desktop chrome |

Med/Low 明确延期，见各维表格。不在本轮改 embedding / Phase D / 主进程 TS。

---

## 1. Architecture

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| H1 | Kernel `loadContract()` 已干净 v4，但 Desktop `projectConfigAliases` 再注 flat 键；`loadWorkspaceConfigLocal` 热读 `.topmind-config.json`；`saveWorkspaceConfig` 直接 `writeFileSync` 绕过 `writeContract`/`sanitizeContract`。三套契约面。 | High | rewrite | 每个调用方写 `config.template \|\| config.workspace?.template`；YAML 坏时 silently 用 v3 JSON 当行为真源且不落盘迁移 |
| H2 | 「yaml 是写回真源」与实现相反：`ai-store` 每次 invoke 把 view-store `writebackMode`（默认 `auto`）当作 `explicitWritebackMode`。缓存未水合或默认 auto 时，confirm 工作区被 AI 直接写。 | High | rewrite | `view-store.writebackMode: "auto"` 启动默认；`ai.invoke({ writebackMode })` 无条件带上 |
| A3 | `toSurfaceEvidence` 同时吐 snake_case + camelCase；`WritebackEvidence` 仍留 `ok/path/newPath` | Med | defer | 调用方两套字段都能活；不导致错写 |
| A4 | Desktop `writeback.mjs` 与 Kernel 两套备份文件名（`MMDD-HHMM` vs ISO）共居 `99-归档/backups/` | Med | defer | 二进制/设置检查点，非内容主写 |
| A5 | Clip 离线 File System Access 写 markdown 不经 writeback | Low | keep | Companion 无法加载 Node Kernel；用户手势即确认。Dest 解析必须诚实（H4） |
| A6 | `derived-builder` 写 `.derived/` 不经写闸 | Low | keep | 可删可重建衍生层（Reset 已锁） |

**第一性原理**：一个工作区一个契约文件、一个投影函数、一个写者。热路径读 v3 JSON 而不 `ensure` 落盘 = 两份真源。

---

## 2. Design philosophy

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| D1 | 产品声称 ≤5 概念，但 chrome 同时教「归档」为第四主锚，把「找回」做成保险库而非搜索 | High | rewrite | 见 H5；根 DESIGN §2.2 主锚含搜索，不含归档 |
| D2 | 待办 / 建议 / 后台 Task 三套「AI 在做事」对用户可分，但词汇易混 | Med | defer | 2026-08-07 已分图标与入口；无新 High 误写 |
| D3 | `shortcut.home` 与 `shortcut.stream` 同义并存 | Low | delete | 仅 locale + 测试引用，实现已走 stream |

理念本身（文件真源、建议后确认、口语）**keep**。破坏理念的是残存「工作台/Home」与「归档当找回」。

---

## 3. Workflows

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| W1 | 工作流第四步「找回/调整」在标题栏落成 Archive，搜索进溢出菜单 | High | rewrite | H5；用户找笔记先点归档 |
| W2 | 记一下 / 记下 词汇已分，主路径清楚 | — | keep | Stream composer + 顶栏 CTA |
| W3 | 建议确认后 `applySuggestion` 用 `actor:"user"` | — | keep | 用户已点接受；再走 confirm 会二次询问 |
| W4 | `cycleWritebackMode` 存在于 view-store 但无 UI 调用 | Low | delete | 死符号；若被接上会在不写 yaml 的情况下翻转 AI 策略 |

---

## 4. Feature design

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| H4 | 架构锁「不维护第二套 HTML→MD」；Clip `htmlToMarkdownLite` 与 Desktop `htmlToMarkdown` 分叉（表格/代码围栏/截断不一致） | High | delete Lite | `browser-extension/lib/simple-md.js` vs `electron/lib/html-to-markdown.mjs` |
| F2 | Clip dest 仍读 `.topmind-config.json` | High | delete | `workspace-fs.js` `getFileHandle(".topmind-config.json")` |
| F3 | 标签/看板为二级且藏在「更多」 | — | keep | 符合「扩展不抢主路径」 |
| F4 | 关键词搜索截断已诚实；无 embedding | — | keep | Reset Non-goal |
| F5 | `applySuggestion` skip 回执路径写成 `memory/periodic/${period}.md`，忽略年目录 | Med | defer | 实际 `writePeriodDigest` 走年目录；仅提示路径撒谎 |

---

## 5. Module design

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| M1 | Desktop `path-model.resolveDirByRole` 用 flat 别名自己解析类别，与 Kernel `resolveWorkspaceModel` 并行 | High | refactor | 属 H1：同步路径改读 v4 嵌套键，不再投影 |
| M2 | `normalizeConfig` 仍在 Kernel 内给 model 用 flat 别名 | Med | keep (internal) | 只允许 `lib/model-core.mjs` 作为唯一投影；禁止 Desktop 再写一份 |
| M3 | UTR / Desktop 各有一份 `WRITEBACK_MODES` + copy | Med | defer | 语义已对齐 auto\|confirm；非双策略 |
| M4 | `system-service.mjs` / `suggest-engine.mjs` 体量过大 | Med | defer | 无行为缺陷，本轮不拆文件 |
| M5 | Obsidian 遗留 `aiProvider` 单字段与 multi-provider 双写 | Med | defer | 插件设置同步，不改写闸 |
| M6 | `TEMPLATE_ALIASES`（simple→stream 等） | Low | keep | 仅模板 ID 一次映射；打开仍写 v4 |

---

## 6. UIUX

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| H3 | `normalizeSelection` 特判 `kind==="home"`；CommandPalette 对 id 含 `home` 加权 | High | delete | `types.ts:180`；palette boost 把旧命令抬到动态之上 |
| H5 | PrimaryNav = 动态/收件箱/写出来 + **归档图标**；搜索在 L3 XOR 溢出 | High | rewrite | `TitleBar.tsx` PrimaryNav 末尾 `RotateCcw` → archive |
| U3 | 2026-08-07 chrome 密度（36px 标题栏、品牌 chip 删除、建议降噪） | — | keep | 无新密度缺陷；本轮不重开像素账 |
| U4 | 标题栏 inbox 计数每次 `workspace:file-changed` 打 IPC | Med | defer | 700ms debounce；非错误，属性能 |
| U5 | 我的情况仅侧栏图标，符合「二级」 | — | keep | 全局可达 |

**用户视角**：打开应用应看见动态，想找回按搜索，归档是恢复动作不是第四房间。

---

## 7. Infrastructure

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| I1 | 质量门完整（typecheck · dead-code · i18n · test · pack:verify） | — | keep | 本轮用同一门禁验收 |
| I2 | `loadContract` 在缺 yaml 时内存迁移 v3 且不写盘 | High | rewrite | 属 H1：热读只认 `topmind.yaml`；迁移仅 `ensureContract` 一次落盘 |
| I3 | workspace-history 用 `.topmind-config.json` **发现**旧文件夹 | Low | keep | 发现 ≠ 行为求值；打开仍走 ensure |
| I4 | Electron 服务巨型文件 | Med | defer | 无打包错误 |

---

## 8. AI engines and capabilities

| ID | Finding | Sev | Verdict | Observable defect |
|----|---------|-----|---------|-------------------|
| H2 | 见上：session override 被当成默认策略 | High | rewrite | 系统提示在 override 缺失时写死「自动保存」 |
| AI2 | 建议 / 待办 / 周期反思已走真实 LLM + sanitize + 失败不写占位 | — | keep | 活动窗口 + fingerprint skip 正确 |
| AI3 | 多路 AI（agent 独立 · prep 串行 · StatusBar 诚实） | — | keep | DESIGN §0.0.3 |
| AI4 | 行内 AI / Agent / 建议 三套提示词，能力够用但难演进 | Med | defer | 无错误输出缺陷 |
| AI5 | `cycleWritebackMode` 死代码 | Low | delete | 与 H2 一并删 |
| AI6 | 全库 Ask / embedding | — | out | Reset Non-goal |

---

## 实施约束（本 ADR）

1. High 项删除双轨，不留 facade「以后再用」。
2. v3 → v4 **只**允许 `ensureContract` 一次迁移并写 `topmind.yaml`（坏文件先备份）。用户内容目录不删。
3. 写闸伦理不替换：markdown 耐久写仍经 `executeWrite`；AI 高影响仍须确认。H2 是修复击穿，不是改伦理。
4. Clip 离线写仍直写文件系统（无 Node Kernel），但 dest 只认 `topmind.yaml` + `00-*`；转换器与 Desktop 同一算法。
5. 归档仍可通过 ⌘⇧A / 命令面板 / 侧栏到达。

## 完成定义

五个 High 在源码中可观察为新行为，且旧符号在实现路径上 **0 命中**（测试可断言缺席；本 ADR 与注释可提及旧名）。
