# ADR: Public update check + multi-skill pack root entry

**Date:** 2026-07-16  
**Status:** Accepted  
**Surfaces:** Desktop 1.0.3 · Skills pack layout · Release pipeline

## Context

1. Desktop “检查更新”走 GitHub REST API 时，公开仓库仍受 rate limit / 代理 / 地区网络影响，用户体验差。  
2. Skills Release zip 是多 skill 组合包；部分 Agent Host 按 **单 skill zip 根必须有 `SKILL.md`** 加载，报 “SKILL.md not found”。  
3. 关光编辑器标签后整窗白屏：`EditorRecentBar` 在 `fileTabs.length === 0` 时 early return 于 `useEffect` 之前，违反 Hooks 规则。  
4. 重装后侧栏目录偶发 “加载失败”，需点重试才恢复。  
5. 用户追问 Desktop 是否应捆绑 UTR、本机路径是否统一。

## Decisions

| 议题 | 决策 |
|------|------|
| 更新检查 | **Public-first**：`releases/latest/download/latest.json`；API 仅 opt-in（`topmind_UPDATE_USE_API=1` / token） |
| Skills zip 根 | 打包时生成根 **`SKILL.md` = router**（`topmind/SKILL.md` + 相对路径修正）；保留 `skills.md` 作包索引，**不**改名替代 |
| UTR 与 Desktop | **v1.0.4+ 捆绑** `topmind-engine/utr/`（Tools 控制台）；AI 写回仍不经 UTR |
| 本机路径 | 统一 `~/topmind/{topmind-workspace,topmind-desktop}`；runtime 全部在 `topmind_DESKTOP_HOME` 下 |
| 关标签白屏 | Hooks 无条件调用；关闭后回 home 视图 |

## Consequences

- Release 必须上传 `latest.json`（`release.yml` 已写）。旧 Release 无该文件时回退 tag 跳转 / 可选 API。  
- Host 仍推荐按多目录 + `shared/` 安装；根 `SKILL.md` 仅为兼容层。  
- Desktop 体积与边界清晰；需要 UTR 的用户从 monorepo / CLI 单独使用。

## References

- `topmind-desktop/electron/lib/update-check.mjs`  
- `scripts/build-pack.mjs` · `skills/shared/host-loading.md` · `skills/INSTALL.md`  
- `PRODUCT-BOUNDARIES.md` · `docs/PACKAGING.md`  
