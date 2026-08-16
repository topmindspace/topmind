# topmind Desktop — Plugin architecture

> Aligns with `PRODUCT-BOUNDARIES.md`: Desktop is a personal workbench. Plugins extend connectors and UI surfaces; they must not replace the filesystem content truth. Version: `package.json`.

## 1. Positioning

```text
Shell (layout) ← slots ← Plugin.activate(ctx)
                              │
                              ├─ topmind-workspace (builtin)
                              ├─ topmind-ingest (builtin · 知识加工管道)
                              ├─ topmind-weread (connector)
                              ├─ topmind-x (connector)
                              └─ external/*  (third-party under plugins/)
```

| Kind | Load | Disable |
|------|------|---------|
| **builtin** | Always | No (`manifest.builtin`)；ingest UI 可由 `settings.ingest.enabled` 弱化 |
| **connector** | Always activate; interactive slots only when `settings[key].enabled` | Settings → Plugins 开关 |
| **external** | Scanned from `{desktopHome}/plugins/` at start + 重新加载 | UI 开关（`settings.plugins.externalEnabled`）· 卸载 · 或 manifest `enabled: false` |

### topmind-ingest（知识加工）

- **服务**：主进程 `IngestService`（`ingest.*` RPC）+ 任务队列；转换不在 renderer  
- **入口**：侧栏 · Hub · ⌘K · 全局拖放 · 状态栏；**统一捕获**（⌘N / ⌘⇧N）智能附件  
- **剪贴板**：`ingest.readClipboard` / `enqueueFromClipboard`  
- **写回**：Markdown → Inbox 或专题；失败 original-fallback；可选原件 `99-归档/ingest-originals/`  
- **转换**：默认 anydoc sidecar（userData 热升级）；可选 markitdown / pandoc；内置 JS 兜底  
- **约定**：`skills/shared/document-ingest.md` · ADR `docs/adr/2026-07-19-knowledge-ingest-pipeline.md`

### Connector Hub UI（共享）

Weread / X / Ingest 中心页共用 `src/plugins/connector-ui.tsx`：

| 原语 | 用途 |
|------|------|
| `ConnectorHubHeader` | 页头：icon · title · subtitle · meta · actions |
| `ConnectorStatusPill` | 连接/能力状态；`badTone="muted"` 表示可选能力关闭 |
| `ConnectorToastBanner` | 进度/结果条；可嵌 children（如同步路径） |
| `ConnectorToolChip` | 本机工具可用性（anydoc / markitdown / pandoc） |

**禁止**在 hub 内复制第三套 header/toast。UI 规范：`DESIGN.md` · 架构：`ARCHITECTURE.md` §连接器 Hub UI。

WeRead 统计卡：`WereadStatsPanel.tsx` + `weread-format.ts`（展示用，非内容真源）。

### WeRead official sync (Desktop `WereadService`)

- Endpoint: `POST https://i.weread.qq.com/api/agent/gateway` · `Authorization: Bearer wrk-*` · `skill_version` + **flat** business params (not nested under `params`).
- Notebooks: `/user/notebooks` with `count` + `lastSort`. Thoughts: `/review/list/mine` with `synckey`.
- Skip books with no exportable 划线/想法 (`noteCount + reviewCount == 0`, or empty after fetch). Incremental skip via local count / `note_fingerprint` — `lastSyncAt` is display-only.
- Settings: `includeThoughts` (default true) · `syncBudgetMinutes` (1–15, default 4) · `syncCategory: auto`. Soft budget leaves remaining books for the next run.
- `upgrade_info` is surfaced; a newer official zip is not a hard fail by itself.

## 2. Slot contract (`src/plugins/types.ts`)

| Slot | Purpose |
|------|---------|
| `dataSource` | Sidebar tree section |
| `sidebar` | Bottom sidebar (rich render or label+icon) |
| `view` | Editor area when `matches(selection)` |
| `action` | ⌘K commands / shortcuts |
| `settings` | Settings tab |
| `overlay` | Custom modal |
| `statusBar` | Status bar item |
| `contextMenu` | Tree right-click items |

**PluginContext:** `rpc` · `workspaceRoot` · `events` · `ai` · `settings` · `register` · `openOverlay` · `navigate` · `toast`

## 3. Lifecycle

1. `activateAll({ workspaceRoot })` loads builtins, then external plugins  
2. `activate(ctx)` → `ctx.register(slot)`  
3. **Connectors** `togglePlugin(id)` = deactivate → re-activate (reads `settings[key].enabled`)  
4. **External** enable map: `settings.plugins.externalEnabled[id]` (`false` = off; missing = on)  
5. `setExternalPluginEnabled(id, on)` — runtime without restart  
6. `reloadExternalPlugins(wsRoot)` — re-scan `plugins/`, cache-bust ESM import, apply enable map  
7. Unload: unregister all slots + optional `deactivate()`

## 4. First-party connectors

Use `defineConnectorPlugin` / `activateConnector` (`src/plugins/connector.ts`):

```ts
export default defineConnectorPlugin(manifest, {
  settingsKey: "x",
  settingsSlot: createXSettingsSlot,   // always registered
  interactiveSlots: [ /* only when enabled */ ],
});
```

Secrets stay in main process (`safeStorage`). Writes go through WorkspaceService path-safety + `99-归档` backups.

### Connector layering (X example)

| Layer | Who uses it | Capability |
|-------|-------------|------------|
| **Agent MCP** | Cursor / Claude / Grok host | Official `https://api.x.com/mcp` + `xurl mcp` OAuth bridge |
| **Desktop API** | In-app | App-only **Bearer** → read-only (search / timeline) |
| **Desktop CLI** | In-app | Local **xurl** → read + post (user OAuth in `~/.xurl`) |

Desktop does **not** embed the official MCP browser OAuth flow (that is the agent host’s job).  
`topmind-x` settings document MCP for agents; in-app actions use API/CLI.

### X official API / xurl (Desktop `XService`)

- Read: official v2 `GET /2/tweets/search/recent` and `GET /2/users/{id}/tweets` (Bearer or `xurl /2/…`). No unofficial `timeline --user`.
- Post: official `xurl -X POST /2/tweets` (shortcut `xurl post` as fallback). App-only Bearer cannot write; failed posts save an Inbox draft.
- Archive: preview + select first; `append` skips tweet ids already in the note (`tweet_ids` / status URLs). `writeConnectorNote` create/update does not backup.

## 5. Third-party plugins (industry-aligned folder model)

Similar spirit to VS Code extensions / Obsidian community plugins: **folder + manifest + entry module**.

### Install location

```text
~/topmind/topmind-desktop/plugins/     # override: topmind_DESKTOP_HOME
  my-connector/
    topmind-plugin.json                # required
    index.mjs                          # default main (ESM)
    README.md                          # optional
```

Settings → **Plugins** → “打开 plugins 文件夹” creates the directory and opens it in the OS file manager.

### Manifest schema (`topmind-plugin.json`)

```json
{
  "id": "example-hello",
  "name": "Hello Plugin",
  "version": "0.1.0",
  "description": "Minimal third-party scaffold",
  "author": "you",
  "main": "index.mjs",
  "homepage": "https://example.com/my-plugin",
  "permissions": ["slot:action"],
  "slots": ["action"],
  "enabled": true
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | kebab-case; **must not** start with `topmind-` (reserved for first-party) |
| `name` | yes | Display name |
| `version` | yes | Semver string |
| `main` | no | Relative entry, default `index.mjs` (no `..`) |
| `permissions` | no | Soft-gate list for `ctx.rpc` / `ctx.register` (see trust model below) |
| `slots` | no | Declared slot kinds for UI listing |
| `enabled` | no | Default `true`; `false` skips load |

### Entry module contract

```js
// index.mjs — ESM, default export
/** @type {import('topmind-desktop').Plugin} */
export default {
  manifest: {
    id: "example-hello",
    name: "Hello Plugin",
    version: "0.1.0",
    description: "Adds a command palette action",
  },
  async activate(ctx) {
    ctx.register({
      kind: "action",
      id: "example-hello.ping",
      pluginId: ctx.pluginId,
      label: "Hello · Ping",
      run: async () => {
        ctx.toast("Hello from external plugin");
      },
    });
  },
  deactivate() {
    // optional cleanup
  },
};
```

Rules:

1. **ESM only** (`.mjs` or `"type":"module"` package).  
2. Default export must include `manifest` + `activate(ctx)`.  
3. Prefer `ctx.rpc` / `ctx.settings` / `ctx.toast` — do not store secrets in renderer.  
4. Do not write outside the workspace without going through workspace RPC.  
5. After install/update: Settings → Plugins → **重新加载**（无需重启应用）。也可开关单个插件。

### Load path

```text
activateAll
  → builtins (workspace, weread, x)
  → system.listExternalPlugins()
  → dynamic import(entryUrl) for status=ready
  → activatePlugin (errors isolated per plugin)
```

Discovery / install RPC: `listExternalPlugins` · `openPluginsDir` · `previewExternalPlugin*` · `installExternalPlugin*` · `uninstallExternalPlugin` · `scaffoldExamplePlugin`  
Implementation: `electron/lib/external-plugins.mjs` + `plugin-install.mjs`.

### Trust model（trusted-by-install）

```text
User installs folder/zip → Desktop copies under plugins/ → same renderer as app
```

| Layer | What it does | What it does **not** do |
|-------|----------------|-------------------------|
| **Install preview** | Risk rank from declared `rpc:*` / `slot:*` | Isolate or sandbox the plugin |
| **Soft gate** | Host wraps `ctx.rpc.invoke` + `ctx.register` | Block direct `window.topmind.invoke` |
| **Zip extract** | Path containment under temp unpack | Code signing / malware scan |
| **Uninstall** | Park under `plugins/.trash/` | Secure wipe |

**Enforced permissions** (host context only): `slot:*`, `rpc:workspace|system|ai|tool|weread|x|*`  
**Reserved (preview only)**: `fs:read-workspace`, `fs:write-workspace`, `net:fetch` — not separate runtime gates today.

A high-risk label means “this plugin asks for powerful **ctx** capabilities” — **not** “the app has sandboxed it.” Only install plugins you trust (Obsidian / VS Code extension spirit).

Official minimal sample: `examples/desktop-plugin-hello/`.

### Maturity（够用边界）

**已满足日常使用**：本地第三方插件安装（文件夹 / Zip）· 权限预览 · 开关 · 热加载 · 可恢复卸载；first-party 连接器热切换；ctx 软门控。

**刻意不做**（当前产品规模）：插件市场、代码签名、iframe 沙箱、远程 git 一键装插件、renderer 进程级隔离。

### Development workflows

| Path | When |
|------|------|
| **A. First-party in monorepo** | Ship with Desktop: add under `src/plugins/`, register in `host.ts` `BUILTIN_PLUGINS` |
| **B. External folder** | Community / private plugins in `plugins/<id>/` without rebuilding Desktop |
| **C. Hybrid** | Develop in monorepo, ship zip of folder to users’ `plugins/` |

Recommended local loop for B:

1. Scaffold folder under `plugins/example-hello/`  
2. Write `topmind-plugin.json` + `index.mjs`  
3. Launch Desktop, open workspace  
4. Settings → Plugins → **重新加载** → status `active`  
5. Toggle off/on without restart; persist in `settings.plugins.externalEnabled`  

### Enable persistence

```json
// app-settings.json (fragment)
"plugins": {
  "externalEnabled": {
    "example-hello": false
  }
}
```

Missing key = enabled (still respects `topmind-plugin.json` `"enabled": false`).

### Install / uninstall (Desktop UI + RPC)

| Action | How |
|--------|-----|
| From folder | Settings → Plugins → **从文件夹** → **权限预览确认** → 安装 |
| From zip | **从 Zip** → 同样先 preview risk，再确认 |
| Scaffold | **生成示例** → `example-hello` |
| Uninstall | 确认对话框 → `plugins/.trash/<id>-<timestamp>` |
| Repo example | `topmind-desktop/examples/desktop-plugin-hello/` |

Preview RPC（不写盘）：`system.previewExternalPluginFromFolder` / `FromZip`  
返回 `risk: low|medium|high`、`permissions`、`replaces`、`existingVersion`。

### Security model

| Practice | Status |
|----------|--------|
| Reserved `topmind-*` ids | Enforced |
| Manifest validation | Enforced |
| Permission strings on external plugins | **Enforced** on `ctx.rpc.invoke` + `ctx.register` (empty → `slot:action` only) |
| Sandbox / CSP for third-party UI | Same renderer as app (still trusted-by-install) |
| Code signing of plugins | No |

Treat third-party code as **trusted by install** (Obsidian-like). Do not install plugins from untrusted sources.

### Permissions vocabulary (enforced for external)

```text
slot:dataSource | slot:sidebar | slot:view | slot:action | slot:settings |
slot:overlay | slot:statusBar | slot:contextMenu
rpc:workspace | rpc:system | rpc:ai | rpc:tool | rpc:weread | rpc:x
fs:read-workspace | fs:write-workspace
net:fetch
```

## 6. Backend services (main process)

Connectors may register Electron services via RPC:

| Convention | Detail |
|------------|--------|
| Method | `domain.method` (e.g. `x.searchTweets`) |
| Secrets | settings + safeStorage |
| Workspace writes | path-safety + archive backups |
| Failures | throw string; UI toast |

UTR is **not** required.

## 7. What plugins must not do

- Change content-truth model (categories / topics stay workspace-owned)  
- Treat agent session state as content truth  
- Silently post / like / follow on social connectors  
- Store API keys in renderer or plugin files  
- Use reserved `topmind-*` ids for third-party packs  

## 8. Related files

| Path | Role |
|------|------|
| `src/plugins/types.ts` | Slot + Plugin contract |
| `src/plugins/host.ts` | activateAll · toggle · `reloadExternalPlugins` · `setExternalPluginEnabled` |
| `src/plugins/registry.ts` | Slot registry |
| `src/plugins/connector.ts` | Connector helper |
| `electron/lib/external-plugins.mjs` | Discover + validate |
| `electron/lib/plugin-install.mjs` | preview · risk · install · uninstall · scaffold |
| `src/plugins/permissions.ts` | runtime gate (`rpc` / `register`) |
| `electron/settings.mjs` | `plugins.externalEnabled` |
| `electron/system-service.mjs` | discovery + install RPC |
| Settings → Plugins | preview · install · toggle · reload · uninstall |
| `examples/desktop-plugin-hello/` | copy-ready sample |

---
