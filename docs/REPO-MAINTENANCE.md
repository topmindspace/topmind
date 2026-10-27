# REPO-MAINTENANCE.md — 多仓维护 · 发版 · 集成

> 配套 `PRODUCT-BOUNDARIES.md` §0（仓库边界）。本文是**维护者 runbook**。
> 回滚点：git tag `pre-split-2026-09-23`（拆分前 monorepo HEAD）。

---

## 1. 仓库职责

| 仓库 | 版本真源 | 日常发版 | 渠道 |
|------|----------|----------|------|
| [topmind](https://github.com/topmindspace/topmind) | `topmind-desktop/package.json`（UTR 跟随） | tag `v*` | GitHub Releases · Homebrew |
| [topmind-skills](https://github.com/topmindspace/topmind-skills) | `topmind-pack.json` | tag `v*` | skills.sh · npx skills · Release zip |
| [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian) | `manifest.json` | tag `<manifest-version>`（无 `v` 前缀） | 社区市场 · BRAT · Release |
| [topmind-writing-skills](https://github.com/topmindspace/topmind-writing-skills) | 根 package.json；各技能独立版本 | tag v* | npm · 独立技能 ZIP · 宿主包 ZIP |

各仓独立迭代和版本。写作包不跟随 Desktop/Obsidian 强制升号；宿主提交受验证快照和兼容关系。有改动才发相应仓库，破坏性变更明确兼容范围。

---

## 2. 变更落仓决策

```text
Kernel / Desktop / Clip / UTR 代码     → topmind
Skill 文案 / 路由 / shared / installer → topmind-skills
Vault UI / 插件壳 / esbuild            → topmind-obsidian
契约 / 用户概念 / writeback 语义        → 先 topmind 文档 → skills 断言 →（必要时）obsidian 对齐
```

**禁止**：各仓全文复制契约；在姊妹仓平行实现 writeback 语义；把用户数据放进 engine 仓。

---

## 3. 发版 Runbook

### 3.1 topmind（主仓）

1. bump `topmind-desktop/package.json`（必要时 `browser-extension/manifest.json`）
2. `npm run validate`
3. 创建 `v<desktop-version>` 标签，只推送本次标签：`git push origin refs/tags/v<desktop-version>`
4. 验收：Releases 安装包 + `brew upgrade --cask topmind --greedy`
5. 热修逃生口：`desktop-v*` / `extension-v*`（不标 Latest）

### 3.2 topmind-skills

1. 同步 bump `topmind-pack.json`、`package.json`、所有 skill frontmatter 与 `evals/evals.json` 的版本
2. `npm test && npm run pack`
3. `git tag v<pack-version> && git push origin refs/tags/v<pack-version>`
4. 验收：`npx skills add topmindspace/topmind-skills -l` · pack-aware 装后 `shared/` 可达

### 3.3 topmind-obsidian

1. bump `manifest.json` **与** `package.json`（保持一致）
2. 用 `TOPMIND_SRC` 或 sibling `../topmind` 对齐需要的主仓提交，运行 `npm run ensure-engine` 并提交 vendored `lib/`
3. `npm run typecheck && npm run lint && npm run build:verify && npm test && npm run pack && npm run pack:verify`。生产构建不设置 `TOPMIND_SRC`，先构建再测试，保证资产检查实际执行
4. 推送所需主仓提交，再推送插件 main；CI 通过后 `git tag <manifest-version> && git push origin refs/tags/<manifest-version>`（tag **必须等于** `manifest.version` 本身，如 `4.20.1`，**不要**加 `v` 前缀）
5. 验收：空白 Vault 启用；社区收录后检查市场更新

---

## 4. 跨仓集成

### 共享 Agent 契约与状态

工具名称、schema 与说明维护在 `lib/agent-tool-catalog.mjs`，预算/写回文案在 `lib/agent-policy.mjs`，工作区目标协议在 `lib/agent-goal-protocol.mjs`；文章目标、权限、澄清与执行预算由 `lib/agent-task-contract.mjs` 管理，上下文窗口、token估算与工具周期压缩由 `lib/agent-context-policy.mjs` 管理。改动后运行 `npm run sync:agent-contract`；`npm run check:agent-contract` 校验 Desktop 生成快照（任务模块仅转换本地工具清单导入路径）。不要直接修改生成文件。

记忆围栏、JSON 状态和待确认操作共用 Kernel `agent-tool-policy` / `workspace-state` / `pending-writes`。宿主只做上下文解析、调用与 UI 通知。Obsidian 改版前运行 `npm run ensure-engine` 更新 vendored `lib/`，不要手工补复制文件；正式构建只使用该快照。工作区路径每次显式传入，不能用全局变量串接不同 Vault。

状态兼容升级保留旧用户文件；损坏文件报错并原样保留。原子文件替换不等于跨进程事务，两个宿主同时写入同一内容仍需冲突管理。跨端验证包含工具参数、真实删除、执行失败保留队列、符号链接和会话迟到结果。

### 4.0 Desktop 下载/更新源（硬约定）

`topmind-desktop/electron/lib/{companion-download,update-check}.mjs` 的 `SURFACE_REPOS`：

| surface | GitHub repo |
|---------|-------------|
| desktop / extension | `topmindspace/topmind` |
| skills | `topmindspace/topmind-skills` |
| obsidian | `topmindspace/topmind-obsidian` |
| writing | `topmindspace/topmind-writing-skills` |

测试：`topmind-desktop/tests/companion-surface-repos.test.mjs`。改 repo 映射必须同步该测试。


| 通道 | 机制 | 失败降级 |
|------|------|----------|
| A. Obsidian → Kernel | esbuild：`TOPMIND_SRC` → sibling `../topmind` → CI `.topmind-src` | 明确报错，不产出坏包 |
| B. 契约对齐 | 主仓文档真源 + skills CI 断言 | PR 不合并 |
| C. Desktop 姊妹产物 | `pack:prepare`：sibling / `TOPMIND_*_SRC` / `.sister/*` staging；CI `pack-desktop` 检出姊妹仓 | 无 sister 时跳过 staging；运行时安装再走 GitHub Release 下载 |

集成测试清单：

- [ ] 主仓 `desktop:quality` 全绿
- [ ] skills pack zip 后 `shared/` 链接可达
- [ ] skills installer add/update 回执正确
- [ ] obsidian 三种 Kernel 解析均可 build
- [ ] obsidian 产物空白 Vault 启用
- [ ] Desktop 托管装 Skills / Obsidian 走 Release 成功
- [ ] 三仓 `latest.json` 形状一致

---

## 5. 文档与废弃清理

- 契约变更：主仓 PR → 同步 skills 断言/摘要 → 更新本文「版本对齐」。
- 删除废弃物：替换实现后立即删死代码/测试/脚本/文档；`dist/`、IDE 噪声不进仓。
- 旧路径（`topmind` 仓内 `skills/`、`obsidian-plugin/`）保留迁移说明 ≤30 天，之后仅链接。

---

## 5.1 GitHub Releases 保留策略（产品约定）

**默认每个仓库只保留最新 2 个 GitHub Release，更旧的发版在下一次发版时自动清理。**

- 主仓 `scripts/prune-releases.mjs` + `release.yml` `prune-releases` job
- `topmind-skills` / `topmind-obsidian` 各自 `release.yml` 末尾 prune step
- 不删 git tag；只删 Release（含 assets）。需要长期留档请另存到对象存储/制品库

---

## 6. 版本对齐备忘

版本数字**只**写在各表面真源；此处只链路径（`npm run versions` 可打印）：

| 表面 | 真源 |
|------|------|
| Desktop | `topmind-desktop/package.json` |
| Skills Pack | `topmind-skills/topmind-pack.json` |
| Clip | `browser-extension/manifest.json` |
| UTR | `utr/VERSION`（跟随 Desktop） |
| Obsidian | `topmind-obsidian/manifest.json` |

拆分迁移时以 `git tag pre-split-2026-09-23` 为回滚锚点。


## 7. 第三方关键组件（升级注意）

| 组件 | 用途 | 升级策略 |
|------|------|----------|
| `@earendil-works/pi-agent-core` / `pi-ai` | Agent 循环 | **成对 pin**（dependency-policy）；当前 **1.0.2**。Pi 1.0 从 `pi-agent-core` 移除 harness 压缩与 `formatSkillsForSystemPrompt`；Desktop 环内压缩走 `maybeCompactPiMessages`，技能目录由 Desktop 自己发 name/description/location。不依赖 `pi-coding-agent` |
| `@firecrawl/anydoc` | 文档转 MD sidecar | userData 热升级，`ANYDOC_NPM_SPEC` 无版本钉死（安装时取 latest） |
| TipTap `@tiptap/*` | 富文本编辑器 | **整套同版本**（3.31.3）；`tiptap-markdown` 0.9.0 |
| `ai` + `@ai-sdk/*` | LLM Provider | 同步升 minor/patch |
| Electron / React / Vite / Tailwind | 壳与 UI | **已升 major**（2026-09-23）：Electron 44 · React 19 · Vite 8 · TS 7 |
| esbuild（obsidian 仓） | 插件打包 | onResolve 必须返回 **绝对路径** |

验证：`topmind-desktop/scripts/check-dependency-policy.mjs` · 测试 `companion-surface-repos.test.mjs`。


### Major 升级记录（2026-09-23）

| 包 | 从 → 到 | 收益 | 风险/备注 |
|----|---------|------|-----------|
| electron | 42.7.1 → **44.4.4** | Chromium/Node 安全与性能 | 需 Node ≥22.12 运行 electron-builder；测试 1259 绿 |
| electron-builder | 26.0.12 → **26.15.3** | 与 Electron 44 对齐 | pack:verify 绿 |
| react / react-dom | 18.3.1 → **19.3.0** | 并发特性、长期支持 | TipTap 3.31 兼容；typecheck+测试绿 |
| vite + @vitejs/plugin-react | 6.4 / 4.3 → **8.3 / 6.1** | Rolldown 时代构建性能 | 构建 262ms；产物 chunk 正常 |
| typescript | 5.9.3 → **7.0.2** | 原生编译器，typecheck 显著更快 | 需 `tsconfig.types: ["node"]` + `@types/node` |
| Tailwind 4.3 | 保持 | — | 无 major 可升 |

**结论**：Electron/React/Vite/TS 的 major **收益大于成本**，已升级并全量验证。Tailwind 停在 4.x（当前 latest）。

## 写作包与宿主联合发布

1. 写作仓先运行 npm test、既有 skill gates、shared/隐私/npm pack 检查和 npm run host:pack；发布独立版本。宿主包同时提供版本化 ZIP、SHA256SUMS 与 latest.json，原单技能 CLI 保持可用。
2. 核心技能仓发布路由/能力说明。主仓显式 npm run sync:writing；插件显式 npm run sync:skills，提交快照及来源 digest；正常构建不拉取写作 HEAD。
3. 主仓同步共享工具契约，插件 ensure-engine；分别完成质量门与可复现构建。Desktop 发布必须包含写作快照和 updater metadata。
4. 先推主仓所需提交，再推插件；各仓 CI 通过后仅推本次版本标签。Obsidian tag 无 v 前缀。
5. 核对远端 tag、Release 附件和 npm registry；构建与签名成功不等于跨平台安装、微信/X 粘贴已验收，发布记录明确实际验证范围。

Desktop 本体使用 electron-updater；SHA/平台签名/宿主权限失败保留手动安装。声明式写作包整包替换，编译进宿主的 renderer 随宿主升级。Obsidian 核心代码通过原生插件发行，不下载执行新脚本。卸载或重装不删除用户稿件、工作区和模型设置。
