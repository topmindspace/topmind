/**
 * Apps 菜单契约（2026-08-30）— 可选插件 / mini-app 的唯一 chrome 入口。
 *
 * 侧栏回归纯内容导航；连接器 hub（weread / x / ingest）与 mini-app
 * overlay（ledger / 外部插件）统一从标题栏 Apps 弹出（launchpad）。
 * 打开方式由插件自己注册的 ViewSlot 决定：声明了 connector hub 视图
 * 的进主画布，其余开 plugin-app overlay — 本模块不写死任何插件 id。
 */
import { useRegistry } from "../plugins/registry";
import { useViewStore } from "../stores/view-store";
import type { Selection } from "../types";
import type { AppSettings } from "../types";
import { PLUGIN_APP_KIND, type LaunchablePluginInput } from "./plugin-launcher";

/** Where a launchable plugin opens: in-canvas connector hub or plugin-app overlay. */
export type LaunchableOpenTarget =
  | { kind: "connector"; selection: Extract<Selection, { kind: "connector" }> }
  | { kind: "plugin-app" };

/**
 * Resolve how a launchable plugin opens. A plugin id `topmind-<name>` with a
 * registered ViewSlot matching `{ kind: "connector", id: <name> }` opens that
 * hub in the canvas; everything else opens the dedicated plugin-app overlay.
 * Pure — takes the view slots list, so tests can pass fixtures.
 */
export function resolveLaunchableOpenTarget(
  pluginId: string,
  viewSlots: Array<{ pluginId?: string; matches: (sel: Selection) => boolean }>,
): LaunchableOpenTarget {
  const shortId = pluginId.replace(/^topmind-/, "");
  if (shortId && shortId !== pluginId) {
    const selection = { kind: "connector" as const, id: shortId };
    for (const slot of viewSlots) {
      if (slot.pluginId !== pluginId) continue;
      try {
        if (slot.matches(selection)) return { kind: "connector", selection };
      } catch {
        // Defensive: a broken matches() must not break the menu.
      }
    }
  }
  return { kind: "plugin-app" };
}

/** Open a launchable plugin via its resolved target (hub view or plugin-app). */
export function openLaunchablePlugin(pluginId: string): void {
  const target = resolveLaunchableOpenTarget(pluginId, useRegistry.getState().viewSlots);
  if (target.kind === "connector") {
    useViewStore.getState().select(target.selection);
    return;
  }
  useViewStore.getState().openOverlay(PLUGIN_APP_KIND, { pluginId });
}

/**
 * Per-plugin readiness + where "configure" lands（Apps 菜单「待配置」引导）。
 * 与 PluginsPanel 同一判定：weread=apiKey · x=bearer/mcp；其余视作就绪。
 * 首方插件知识集中在此（菜单组件不写死插件 id），settingsTopicId 复用
 * 设置槽 id 约定 `topmind-<name>.settings`。
 */
export function pluginReadiness(
  pluginId: string,
  settings: AppSettings | null | undefined,
): { needsConfig: boolean; settingsTopicId: string | null } {
  const topicId = pluginId.startsWith("topmind-") ? `${pluginId}.settings` : null;
  if (pluginId === "topmind-weread") {
    return { needsConfig: !settings?.weread?.apiKey, settingsTopicId: topicId };
  }
  if (pluginId === "topmind-x") {
    return {
      needsConfig: !(settings?.x?.bearerToken || settings?.x?.mcpEndpoint),
      settingsTopicId: topicId,
    };
  }
  return { needsConfig: false, settingsTopicId: topicId };
}

/** Header Apps 菜单开关事件 — 命令面板 / 快捷键复用同一入口。 */
export const APPS_MENU_TOGGLE_EVENT = "titlebar:apps-toggle" as const;
