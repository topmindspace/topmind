# REPO-MAINTENANCE.md — 三仓维护 · 发版 · 集成

> 配套 `PRODUCT-BOUNDARIES.md` §0（仓库边界）。本文是**维护者 runbook**。
> 回滚点：git tag `pre-split-2026-09-23`（拆分前 monorepo HEAD）。

---

## 1. 三仓职责

| 仓库 | 版本真源 | 日常发版 | 渠道 |
|------|----------|----------|------|
| [topmind](https://github.com/topmindspace/topmind) | `topmind-desktop/package.json`（UTR 跟随） | tag `v*` | GitHub Releases · Homebrew |
| [topmind-skills](https://github.com/topmindspace/topmind-skills) | `topmind-pack.json` | tag `v*` | skills.sh · npx skills · Release zip |
| [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian) | `manifest.json` | tag `v*`（**必须 = manifest.version**） | 社区市场 · BRAT · Release |

大版本对齐（breaking → 全体 X.0）；小版本只 bump 有改动的表面。

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
3. `git tag v$(node -p "require('./topmind-desktop/package.json').version") && git push --tags`
4. 验收：Releases 安装包 + `brew upgrade topmind`
5. 热修逃生口：`desktop-v*` / `extension-v*`（不标 Latest）

### 3.2 topmind-skills

1. bump `topmind-pack.json`（+ skill frontmatter 版本如需）
2. `npm test && npm run pack`
3. `git tag v<pack-version> && git push --tags`
4. 验收：`npx skills add topmindspace/topmind-skills -l` · pack-aware 装后 `shared/` 可达

### 3.3 topmind-obsidian

1. bump `manifest.json` **与** `package.json`（保持一致）
2. 设置 `TOPMIND_SRC` 或 sibling `../topmind`，对齐引用的主仓 tag
3. `npm run typecheck && npm test && npm run build && npm run pack:verify`
4. `git tag v<manifest-version> && git push --tags`（tag 必须等于 manifest.version）
5. 验收：空白 Vault 启用；社区收录后检查市场更新

---

## 4. 跨仓集成

### 4.0 Desktop 下载/更新源（硬约定）

`topmind-desktop/electron/lib/{companion-download,update-check}.mjs` 的 `SURFACE_REPOS`：

| surface | GitHub repo |
|---------|-------------|
| desktop / extension | `topmindspace/topmind` |
| skills | `topmindspace/topmind-skills` |
| obsidian | `topmindspace/topmind-obsidian` |

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
| `@earendil-works/pi-agent-core` / `pi-ai` | Agent 循环 | **成对 pin**（dependency-policy）；当前 0.87.1 |
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
