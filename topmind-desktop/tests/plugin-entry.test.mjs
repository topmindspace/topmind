/**
 * Mini-app plugin entry + optional 记账 launcher contract.
 * 2026-08-30: launchpad 已统一到标题栏 Apps 菜单（lib/apps-menu +
 * shell/AppsMenu）；launcher overlay 与侧栏插件行删除，本文件驱动
 * listLaunchablePlugins / open-target 解析 / chrome 注册契约。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  normalizeManifest,
  exampleManifest,
} from "../electron/lib/external-plugins.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const launcherUrl = pathToFileURL(path.join(root, "src/lib/plugin-launcher.ts")).href;
const appsMenuUrl = pathToFileURL(path.join(root, "src/lib/apps-menu.ts")).href;

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const WORKSPACE = {
  id: "topmind-workspace",
  status: "active",
  manifest: { builtin: true, name: "Workspace" },
};

const EXTERNAL = {
  id: "example-hello",
  status: "active",
  manifest: { name: "Hello", builtin: false },
};

test("launcher lists optional 记账 when enabled and omits it when toggled off", async () => {
  const {
    listLaunchablePlugins,
    LEDGER_CHROME_IDS,
    LEDGER_PLUGIN_ID,
    PLUGIN_APP_KIND,
  } = await import(launcherUrl);
  const ledgerMod = await import(
    pathToFileURL(path.join(root, "src/plugins/topmind-ledger/index.ts")).href
  );
  const ledgerPlugin = {
    id: ledgerMod.manifest.id,
    status: "active",
    manifest: ledgerMod.manifest,
  };

  assert.equal(ledgerMod.manifest.id, LEDGER_PLUGIN_ID);
  assert.equal(ledgerMod.manifest.launchable, true);
  assert.equal(ledgerMod.manifest.settingsKey, "ledger");

  const on = listLaunchablePlugins([WORKSPACE, ledgerPlugin, EXTERNAL], {
    ledger: { enabled: true },
  });
  assert.ok(on.some((p) => p.id === LEDGER_PLUGIN_ID));
  assert.ok(on.some((p) => p.id === "example-hello"));
  assert.ok(!on.some((p) => p.id === "topmind-workspace"));

  const off = listLaunchablePlugins([WORKSPACE, ledgerPlugin, EXTERNAL], {
    ledger: { enabled: false },
  });
  assert.ok(!off.some((p) => p.id === LEDGER_PLUGIN_ID));
  assert.ok(off.some((p) => p.id === "example-hello"));

  // 记账 chrome ids: action + status bar（sidebar 入口已随 Apps 菜单移除）
  assert.deepEqual(Object.values(LEDGER_CHROME_IDS).sort(), [
    "topmind-ledger.open",
    "topmind-ledger.statusbar",
  ]);
  assert.equal(PLUGIN_APP_KIND, "plugin-app");
});

test("launcher lists enabled first-party connectors and builtin pipelines by settings", async () => {
  const { listLaunchablePlugins } = await import(launcherUrl);
  const weread = { id: "topmind-weread", status: "active", manifest: { id: "topmind-weread", name: "微信读书", settingsKey: "weread" } };
  const x = { id: "topmind-x", status: "active", manifest: { id: "topmind-x", name: "X", settingsKey: "x" } };
  const ingest = { id: "topmind-ingest", status: "active", manifest: { id: "topmind-ingest", name: "知识加工", builtin: true } };

  // weread enabled=true（即使未配置 API Key 也列出——菜单标注「待配置」引导设置）
  const on = listLaunchablePlugins([WORKSPACE, weread, x, ingest], {
    weread: { enabled: true },
    x: { enabled: false },
    ingest: { enabled: true },
  });
  assert.ok(on.some((p) => p.id === "topmind-weread"));
  assert.ok(on.some((p) => p.id === "topmind-ingest"), "builtin ingest pipeline must be listed when enabled");
  assert.ok(!on.some((p) => p.id === "topmind-x"));
  assert.ok(!on.some((p) => p.id === "topmind-workspace"));

  const off = listLaunchablePlugins([WORKSPACE, weread, x, ingest], {
    weread: { enabled: false },
    x: { enabled: false },
    ingest: { enabled: false },
  });
  assert.ok(!off.some((p) => p.id === "topmind-weread"));
  assert.ok(!off.some((p) => p.id === "topmind-ingest"), "ingest honors settings.ingest.enabled=false");
});

test("apps-menu resolves connector hub vs plugin-app overlay without hardcoded ids", async () => {
  const { resolveLaunchableOpenTarget, pluginReadiness } = await import(appsMenuUrl);

  const hubView = (pluginId, id) => ({
    pluginId,
    matches: (sel) => sel.kind === "connector" && sel.id === id,
  });

  // Connector plugins open their hub in the canvas (id = topmind-<suffix>)
  for (const [pid, id] of [
    ["topmind-weread", "weread"],
    ["topmind-x", "x"],
    ["topmind-ingest", "ingest"],
  ]) {
    const target = resolveLaunchableOpenTarget(pid, [hubView(pid, id)]);
    assert.equal(target.kind, "connector", pid);
    assert.deepEqual(target.selection, { kind: "connector", id });
  }

  // Mini-app / external plugins open the dedicated overlay
  const overlayTarget = resolveLaunchableOpenTarget("topmind-ledger", [hubView("topmind-weread", "weread")]);
  assert.deepEqual(overlayTarget, { kind: "plugin-app" });
  const externalTarget = resolveLaunchableOpenTarget("example-hello", []);
  assert.deepEqual(externalTarget, { kind: "plugin-app" });

  // A broken matches() must not crash resolution — falls back to overlay
  const broken = resolveLaunchableOpenTarget("topmind-weread", [
    { pluginId: "topmind-weread", matches: () => { throw new Error("boom"); } },
  ]);
  assert.deepEqual(broken, { kind: "plugin-app" });

  // Readiness: weread/x mirror PluginsPanel semantics; settings slot id convention
  assert.deepEqual(pluginReadiness("topmind-weread", { weread: { apiKey: "" } }), {
    needsConfig: true,
    settingsTopicId: "topmind-weread.settings",
  });
  assert.equal(pluginReadiness("topmind-weread", { weread: { apiKey: "wrk-" } }).needsConfig, false);
  assert.equal(pluginReadiness("topmind-x", { x: { bearerToken: "", mcpEndpoint: "https://api.x.com/mcp" } }).needsConfig, false);
  assert.deepEqual(pluginReadiness("topmind-ledger", null), {
    needsConfig: false,
    settingsTopicId: "topmind-ledger.settings",
  });
  assert.deepEqual(pluginReadiness("example-hello", null), {
    needsConfig: false,
    settingsTopicId: null,
  });
});

test("view-store open/close plugin-app overlay returns to canvas", async () => {
  const { PLUGIN_APP_KIND, LEDGER_PLUGIN_ID } = await import(launcherUrl);
  const { useViewStore } = await import(pathToFileURL(path.join(root, "src/stores/view-store.ts")).href);
  const prev = { overlay: useViewStore.getState().overlay, overlayContext: useViewStore.getState().overlayContext };
  try {
    useViewStore.getState().openOverlay(PLUGIN_APP_KIND, { pluginId: LEDGER_PLUGIN_ID });
    assert.equal(useViewStore.getState().overlay, PLUGIN_APP_KIND);
    assert.equal(useViewStore.getState().overlayContext?.pluginId, LEDGER_PLUGIN_ID);
    useViewStore.getState().closeOverlay();
    assert.equal(useViewStore.getState().overlay, "none");
    assert.equal(useViewStore.getState().overlayContext, null);

    // plugin-app without a target is ignored (no fallback shell)
    useViewStore.getState().openOverlay(PLUGIN_APP_KIND, {});
    assert.equal(useViewStore.getState().overlay, "none");
  } finally {
    useViewStore.setState(prev);
  }
});

test("install/enable map regressions still hold", () => {
  const ok = normalizeManifest(exampleManifest());
  assert.equal(ok.ok, true);
  const reserved = normalizeManifest({
    id: "topmind-workspace",
    name: "X",
    version: "1.0.0",
  });
  assert.equal(reserved.ok, false);
  assert.match(reserved.error, /reserved/i);
});

test("OverlayHost + host register plugin-app / topmind-ledger; apps menu is the launchpad", () => {
  const host = read("src/plugins/host.ts");
  assert.match(host, /topmind-ledger/);
  assert.match(host, /BUILTIN_PLUGINS/);

  const overlayHost = read("src/components/shell/OverlayHost.tsx");
  assert.match(overlayHost, /plugin-app/);
  assert.match(overlayHost, /PluginAppSurface/);
  assert.doesNotMatch(overlayHost, /PluginLauncher/);

  const types = read("src/types.ts");
  assert.match(types, /plugin-app/);
  assert.doesNotMatch(types, /plugin-launcher/);

  assert.ok(existsSync(path.join(root, "src/plugins/topmind-ledger/index.ts")));
  assert.ok(existsSync(path.join(root, "src/plugins/topmind-ledger/ledger-app.tsx")));
  assert.ok(!existsSync(path.join(root, "src/plugins/topmind-ledger/sidebar-slot.tsx")));
  assert.ok(!existsSync(path.join(root, "src/plugins/topmind-weread/sidebar-slot.tsx")));
  assert.ok(!existsSync(path.join(root, "src/components/overlays/PluginLauncher.tsx")));
  const ledgerIndex = read("src/plugins/topmind-ledger/index.ts");
  assert.match(ledgerIndex, /launchable:\s*true/);
  assert.match(ledgerIndex, /settingsKey:\s*["']ledger["']/);
  assert.match(ledgerIndex, /createLedgerStatusBarSlot/);
  assert.match(ledgerIndex, /createLedgerActions/);

  const titleBar = read("src/components/shell/TitleBar.tsx");
  assert.match(titleBar, /key:\s*"stream"/);
  assert.match(titleBar, /key:\s*"inbox"/);
  assert.match(titleBar, /key:\s*"outputs"/);
  assert.match(titleBar, /key:\s*"search"/);
  assert.match(titleBar, /AppsMenu/);
  assert.doesNotMatch(titleBar, /key:\s*"ledger"/);
  assert.doesNotMatch(titleBar, /key:\s*"plugin"/);
  assert.doesNotMatch(titleBar, /topmind-ledger/);

  const statusBar = read("src/components/shell/StatusBar.tsx");
  assert.match(statusBar, /statusBarSlots/);
  const palette = read("src/components/overlays/CommandPalette.tsx");
  assert.match(palette, /registry\.actions\(\)/);
  const ledgerStatus = read("src/plugins/topmind-ledger/status-bar-slot.tsx");
  assert.match(ledgerStatus, /data-ledger-open/);
  assert.match(ledgerStatus, /PLUGIN_APP_KIND/);
  const ledgerActions = read("src/plugins/topmind-ledger/actions.ts");
  assert.match(ledgerActions, /LEDGER_CHROME_IDS\.action/);
  assert.match(ledgerActions, /PLUGIN_APP_KIND/);

  const api = read("src/services/api.ts");
  assert.match(api, /workspace\.listLedgers/);
  assert.match(api, /workspace\.captureLedgerPhrase/);
  const ws = read("electron/workspace-service.mjs");
  assert.match(ws, /async listLedgers/);
  assert.match(ws, /async captureLedgerPhrase/);
});

test("PLUGIN.md still documents trusted-by-install and the Apps-menu launchpad", () => {
  const doc = read("PLUGIN.md");
  assert.match(doc, /trusted-by-install|用户自装|信任模型/);
  assert.match(doc, /plugin-app/);
  assert.match(doc, /AppsMenu|Apps 菜单/);
  assert.match(doc, /topmind-ledger|记账/);
  assert.match(doc, /如何打开/);
  assert.match(doc, /账本路径/);
  assert.match(doc, /memory\.dir.*ledgers|ledgers\/\{id\}/);
  assert.match(doc, /刻意不做[\s\S]{0,120}iframe 沙箱|not a sandbox|trusted-by-install/i);
});
