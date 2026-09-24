# 套件评审（2026-09-24）

本次阅读的是当前工作区，不是旧 ADR 的复述。交付面仍是三仓：`topmind`（Kernel `lib/`、Desktop、UTR、Clip `browser-extension`）、`topmind-skills`（Skills pack）、`topmind-obsidian`（Obsidian plugin）。解决方案根上的 `index.html` 不在任何一仓里。

判定依据是文件系统为内容真源、用户概念不超过五个、高影响写入等确认、交付面等于仓库、领域逻辑只在 Kernel。每一节只用一个处置词。

## 技能

处置：fixed

Skills pack 把内容真源写成不存在的嵌套目录 categories-and-topics。`PRODUCT-BOUNDARIES.md` 的本机布局里，标成内容真源的目录是工作区根本身，下面直接是三平面。OpenCode 插件、六个 install target、两仓的宿主说明都在重复这个路径。宿主若按字面建目录，会偏离 `PROJECT-MODEL.md`。

同一次核对还看到：`../topmind-skills/README.md` 漏了已打包的 topmind-wechat；`../topmind-skills/evals/evals.json` 把循环状态写成已经迁移走的旧隐藏目录，并把技能总数写成 10，而 `../topmind-skills/topmind-pack.json` 的 skills 数组更长；Codex 说明写了过期的模块个数；技能仓里的安装链接指向仓内不存在的 skills/INSTALL 路径。

改动：`../topmind-skills/topmind-pack.json`、`../topmind-skills/README.md`、`../topmind-skills/evals/evals.json`、`../topmind-skills/integrations/codex/README.md`、`../topmind-skills/integrations/opencode/plugins/topmind-plugin.ts`、`integrations/opencode/plugins/topmind-plugin.ts`。守卫：`tests/canon-claim-guards.test.mjs`、`../topmind-skills/tests/package-manifest.test.mjs`、`../topmind-skills/tests/portable-surfaces-contract.test.mjs`。这些测试从 `PRODUCT-BOUNDARIES.md` 读出内容真源目录名，再拿去对比 pack，不把目录名写死在断言里。

## 工具

处置：non-goal

UTR 仍是 Kernel 的薄适配。`TOOLS.md` 与 `utr/tests/unit/contract-registry.test.mjs` 都锁在 8 域 / 28 命令，MCP 默认暴露 primary 加 danger。Desktop 命名工具清单在 `topmind-desktop/tests/ai-tools-inventory.test.mjs` 里对照 `TOOLS.md`。这次没有发现命令表和注册表打架，所以不改工具面。Clip 的工具边界仍是剪藏，不实现第二套写闸，见 `browser-extension/README.md`。

## 工作流

处置：non-goal

用户路径仍是「收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整」，五个概念仍是记一下、动态、专题、我的情况、交付。`docs/ARCHITECTURE-RESET.md` 的决策锁 A–D 与 `scripts/check-redesign-contract.mjs` 已经在挡旧流程文案。高影响写入等确认、普通编辑直接落盘，这是锁里的分级确认，不是缺口。这次不改用户可见流程。

## 整体方案

处置：discussion

问题：解决方案根上的 `../index.html`、`../app.js`、`../styles.css`、`../obsidian-plugin-account.png` 是一份标了「AI生成」的界面预览，不在三仓的交付面里。要不要删掉，还是留在本机当对照？

选项：删掉预览，只留三仓；或继续放在解决方案根，明确它不是产品。

建议：留下，不把它收成第四个仓库，也不写进安装说明。

在你回答之前保持不变：不删除这些文件，不把它们链进 `README.md`，不把它当成 Desktop 或 Obsidian 的运行时。

## 共享层

处置：fixed

`SKILL-ARCHITECTURE.md` 的共享目录树列出了并不存在的 media-assets 文件。技能仓共享目录里没有它，包测试要求的共享文件名单也不含它。`PROJECT-MODEL.md`、`SECURITY.md`、`docs/capture-clip-matrix.md` 和 Desktop 的媒体注释都指向这份不存在的约定。图片约定的正文已经在剪藏矩阵里：笔记旁的图片目录随笔记移动。

改动：`SKILL-ARCHITECTURE.md`、`PROJECT-MODEL.md`、`SECURITY.md`、`docs/capture-clip-matrix.md`、`topmind-desktop/electron/lib/workspace-note-media.mjs`。共享树现在只列 pack 里真实存在的文件，例如 `../topmind-skills/shared/document-ingest.md`。守卫：`tests/canon-claim-guards.test.mjs` 解析架构文档的共享树，再对技能仓共享目录做存在性检查。

## 引擎

处置：non-goal

领域逻辑仍只在 Kernel `lib/`：contract、workspace-model、stream、memory、writeback、lifecycle、ingest、derived，加上卫星 `lib/todo-engine.mjs` 与 `lib/ledger-engine.mjs`。评审开始时 Obsidian 的 `lib/`、`templates/` 与本仓逐文件相同，这次没有改这两棵树，所以没有刷新副本。模板入口仍是 `templates/stream.json`。Obsidian 侧对应副本是 `../topmind-obsidian/lib/kernel-api.mjs`。没有新的平行写闸要删。

## 设计规约

处置：fixed

`topmind-desktop/src/plugins/types.ts` 的槽位是七种，侧栏插件槽已删除。`topmind-desktop/ARCHITECTURE.md` 的全景图仍把 Sidebar 算进插件槽，连接器表也还写 Sidebar 同步。同一页开头的源文件数量（约 195 / 104）和现在的 `topmind-desktop/src`、`topmind-desktop/electron` 对不上。

改动：`topmind-desktop/ARCHITECTURE.md`。全景图与 `SlotKind` 对齐，源文件计数改成测试当场数出来的数字。守卫：`tests/canon-claim-guards.test.mjs` 与 `topmind-desktop/tests/contract.test.mjs`。计数的期望值来自目录遍历，不写死。

## 数据规约

处置：fixed

内容真源是工作区文件系统：工作区根契约加三平面。技能包的 content_truth 却是一个嵌套路径，既不是 `PRODUCT-BOUNDARIES.md` 里的工作区根，也不包含语义平面。这和「同一路径、同一契约」冲突。数据落点没有改，改的是宿主契约字符串，让它等于本机布局里标了内容真源的那个目录名。

改动：`../topmind-skills/topmind-pack.json`、`../topmind-skills/install-targets/universal.json`、`../topmind-skills/evals/evals.json`。判定依据是 `PRODUCT-BOUNDARIES.md`。循环状态的现行说明是 `../topmind-skills/topmind-loop/references/state-file.md`，评测期望已从旧的隐藏目录改到这里写的位置。守卫与「技能」一节相同。

## CI/CD

处置：fixed

`docs/REPO-MAINTENANCE.md` 写明修剪发布时不删 git tag，只删 Release。`scripts/prune-releases.mjs` 和 Obsidian 的发布流程遵守这一点。技能仓的发布流程和 `../topmind-skills/INSTALL.md` 原先会把旧 tag 一起删掉，和手册不一致。现在两边都只删 Release。

Obsidian 发布检出 Kernel 时带了 `continue-on-error`。手册要求这条通道失败就停，不能打出一份悄悄用旧副本的包。`../topmind-obsidian/scripts/ensure-engine.mjs` 在没有实时引擎时会接受已提交的 `lib/`，那是社区干净构建的需要；维护者发版必须先拿到本仓引擎。

改动：`../topmind-skills/.github/workflows/release.yml`、`../topmind-skills/INSTALL.md`、`../topmind-obsidian/.github/workflows/release.yml`。守卫：`tests/release-workflow.test.mjs` 与 `../topmind-skills/tests/portable-surfaces-contract.test.mjs`。它们读已提交的发布定义，断言修剪步骤的代码里没有删除 tag 的请求，并断言 Obsidian 的引擎检出步骤没有 continue-on-error。

## 脚本

处置：non-goal

根脚本 `scripts/check-redesign-contract.mjs`、`scripts/sync-category-pattern.mjs`、`scripts/prune-releases.mjs` 与手册一致：文档守卫能通过，类别正则与 Kernel 同步，修剪脚本不删 tag。没有发现脚本宣称的命令在 `package.json` 里缺失。这次不改脚本行为。

## 依赖

处置：fixed

本仓 `package.json` 与技能仓 `../topmind-skills/package.json` 的 engines.node 都是 20.11 这一下限。技能包元数据却把可选 UTR 写成更旧的 18。那是过期的下限，和两边的引擎字段矛盾。

改动：`../topmind-skills/topmind-pack.json`。守卫：`../topmind-skills/tests/package-manifest.test.mjs` 用 `package.json` 的 engines 字段去匹配这段文字，所以版本号不是测试里的第二份常量。Desktop 的 Electron 44、React 19、Vite 8、TypeScript 7 与 `docs/REPO-MAINTENANCE.md` 的升级记录一致，没有再改。Obsidian 插件仍用自己的 TypeScript 5 工具链，那是插件壳，不是 Kernel。

## 文档

处置：fixed

`docs/README.md`、`docs/README.en.md`、`docs/README.zh-CN.md` 把 Skills 的中文说明和安装文档链到本仓 skills 目录。拆仓之后那里只剩迁移短文 `skills/README.md`，没有中文跳转，也没有安装说明。这三份导览现在改链到技能仓的 GitHub 地址，和 Obsidian 那一行一样。Clip 的本仓文档 `browser-extension/README.md` 链接是好的。历史 ADR 仍可能出现拆仓前的路径，它们记录当时的决定，这次不改写。

改动：`docs/README.md`、`docs/README.en.md`、`docs/README.zh-CN.md`，以及「共享层」里已经改掉的失效共享文件引用。守卫：`tests/canon-claim-guards.test.mjs` 检查这三份导览的相对链接都能在本仓打开。

## 整体结构

处置：discussion

问题：`integrations/codex/README.md` 与 `../topmind-skills/integrations/codex/README.md` 是两份宿主说明；Obsidian 提交一整份 Kernel 副本，CI 有时又改成符号链接。要不要收成单份，避免以后再漂？

选项：删掉本仓 `integrations/`，只留技能仓；或把 Obsidian `lib/` 改成子模块。另一头是维持现在的形状：技能仓是 Skills 的交付面，本仓留下一份宿主说明供 Desktop 打包树使用；Obsidian 继续提交副本，因为社区干净构建没有 sibling。

建议：维持形状。副本和双份说明都留着。本次只纠正两边都写错的内容真源字符串，不合并仓库，不改链接方式。

在你回答之前保持不变：不删除 `integrations/`，不把 `../topmind-obsidian/lib` 改成符号链接提交，不合并三仓，不把解决方案根的预览算进发布。
