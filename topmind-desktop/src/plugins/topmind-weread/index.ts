/**
 * topmind-weread — WeRead (微信读书) connector plugin.
 *
 * Registers:
 * - SettingsSlot (always)
 * - When enabled: Hub View · Actions · StatusBar
 *   （chrome 入口统一在标题栏 Apps 菜单 + 状态栏 chip；侧栏插件行已移除 2026-08-30）
 */
import { defineConnectorPlugin } from "../connector";
import { createWereadSettingsSlot } from "./settings-slot";
import { createWereadActions } from "./actions";
import { createWereadStatusBarSlot } from "./status-bar-slot";
import { createWereadHubView } from "./hub-view";

export const manifest = {
  id: "topmind-weread",
  name: "微信读书",
  nameKey: "weread:name",
  version: "1.2.0",
  description: "同步微信读书划线、想法与阅读统计到工作区",
  descriptionKey: "weread:manifestDescription",
  icon: "book-open",
  settingsKey: "weread",
} as const;

export default defineConnectorPlugin(manifest, {
  settingsKey: "weread",
  settingsSlot: createWereadSettingsSlot,
  interactiveSlots: [
    createWereadHubView,
    (ctx) => createWereadActions(ctx),
    createWereadStatusBarSlot,
  ],
});
