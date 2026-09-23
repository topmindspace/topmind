/**
 * Mini-app plugin entry contract (pure).
 *
 * Overlay kind: plugin-app — dedicated plugin surface（命令面板 / 应用 pane 打开；
 * close 返回主画布）。launchpad 在 AI 工作区 · 应用 pane（`AppsLaunchList`）
 * （2026-08-30，launcher overlay 删除）。
 *
 * Not a PrimaryNav user concept. First-party optional plugins (settingsKey)
 * appear only when enabled; external plugins appear when active.
 */
import type { OverlayKind } from "../types";

export const PLUGIN_APP_KIND = "plugin-app" as const satisfies OverlayKind;
export const LEDGER_PLUGIN_ID = "topmind-ledger";
export const WECHAT_PLUGIN_ID = "topmind-wechat";

/** Chrome / command ids the shell consumes to open 记账 (registered only when enabled). */
export const LEDGER_CHROME_IDS = Object.freeze({
  action: "topmind-ledger.open",
  statusBar: "topmind-ledger.statusbar",
});

/** Chrome / command ids for 公众号创作 (registered only when enabled). */
export const WECHAT_CHROME_IDS = Object.freeze({
  action: "topmind-wechat.open",
  statusBar: "topmind-wechat.statusbar",
});

export type LaunchablePluginInput = {
  id: string;
  status?: string;
  manifest?: {
    builtin?: boolean;
    launchable?: boolean;
    settingsKey?: string;
    name?: string;
    nameKey?: string;
    description?: string;
    descriptionKey?: string;
    icon?: string;
  };
};

function isExternalCandidate(plugin: LaunchablePluginInput): boolean {
  if (plugin.manifest?.builtin) return false;
  if (plugin.manifest?.settingsKey) return false;
  if (plugin.id === "topmind-workspace") return false;
  return true;
}

/**
 * First-party 应用 pane 候选：声明 launchable 的 mini-app、带 settingsKey 的
 * 可选连接器（weread / x / ledger）、builtin 管道（ingest）。workspace 除外。
 */
function isFirstPartyCandidate(plugin: LaunchablePluginInput): boolean {
  if (plugin.id === "topmind-workspace") return false;
  return (
    plugin.manifest?.launchable === true ||
    Boolean(plugin.manifest?.settingsKey) ||
    Boolean(plugin.manifest?.builtin)
  );
}

export function isPluginEnabledForLauncher(
  plugin: LaunchablePluginInput,
  settings: Record<string, unknown> | null | undefined,
): boolean {
  const key = plugin.manifest?.settingsKey;
  if (key) {
    const block = settings?.[key];
    if (block && typeof block === "object" && "enabled" in block) {
      return (block as { enabled?: boolean }).enabled === true;
    }
    // Missing settings block: optional mini-apps (ledger / wechat) default on;
    // other optional plugins off.
    return plugin.id === LEDGER_PLUGIN_ID || plugin.id === WECHAT_PLUGIN_ID;
  }
  // Builtin pipeline without settingsKey (topmind-ingest): on unless
  // `settings.<id-suffix>.enabled === false`（与其 interactive slots 同一开关）。
  if (plugin.manifest?.builtin) {
    const block = settings?.[plugin.id.replace(/^topmind-/, "")];
    return !(block && typeof block === "object" && (block as { enabled?: boolean }).enabled === false);
  }
  if (plugin.status === "disabled" || plugin.status === "error") return false;
  const map = (settings?.plugins as { externalEnabled?: Record<string, boolean> } | undefined)?.externalEnabled;
  if (map && map[plugin.id] === false) return false;
  return plugin.status === "active" || plugin.status == null;
}

/**
 * Launchpad list for the AI workspace 应用 pane：已启用的首方候选（可选连接器 /
 * mini-app / builtin 管道）+ 活跃外部插件。未配置的连接器也会列出，
 * 由菜单标注「待配置」并引导到设置（数据来自调用方传入的实时 settings）。
 */
export function listLaunchablePlugins(
  plugins: LaunchablePluginInput[],
  settings: Record<string, unknown> | null | undefined,
): LaunchablePluginInput[] {
  return (plugins || []).filter((p) => {
    if (!p) return false;
    const candidate = isFirstPartyCandidate(p) || isExternalCandidate(p);
    if (!candidate) return false;
    return isPluginEnabledForLauncher(p, settings);
  });
}
