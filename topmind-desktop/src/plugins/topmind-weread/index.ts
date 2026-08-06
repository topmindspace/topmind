/**
 * topmind-weread — WeRead (微信读书) connector plugin.
 *
 * Registers:
 * - SettingsSlot (always)
 * - When enabled: Sidebar · Hub View · Actions · StatusBar
 */
import { defineConnectorPlugin } from "../connector";
import { createWereadSidebarSlot } from "./sidebar-slot";
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
    createWereadSidebarSlot,
    createWereadHubView,
    (ctx) => createWereadActions(ctx),
    createWereadStatusBarSlot,
  ],
});
