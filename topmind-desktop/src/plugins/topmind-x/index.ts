/**
 * topmind-x — X (Twitter) connector plugin.
 *
 * Registers:
 * - SettingsSlot (always)
 * - When enabled: Sidebar · Hub View · Actions · StatusBar
 */
import { defineConnectorPlugin } from "../connector";
import { createXSidebarSlot } from "./sidebar-slot";
import { createXSettingsSlot } from "./settings-slot";
import { createXActions } from "./actions";
import { createXStatusBarSlot } from "./status-bar-slot";
import { createXHubView } from "./hub-view";

export const manifest = {
  id: "topmind-x",
  name: "X / Twitter",
  nameKey: "x:name",
  version: "1.3.0",
  description: "Bearer 只读抓取归档 · xurl 发帖 · 预览勾选 · Agent 用官方 MCP",
  descriptionKey: "x:manifestDescription",
  icon: "twitter",
  settingsKey: "x",
} as const;

export default defineConnectorPlugin(manifest, {
  settingsKey: "x",
  settingsSlot: createXSettingsSlot,
  interactiveSlots: [
    createXSidebarSlot,
    createXHubView,
    (ctx) => createXActions(ctx),
    createXStatusBarSlot,
  ],
});
