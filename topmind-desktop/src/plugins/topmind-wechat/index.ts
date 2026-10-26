/**
 * topmind-wechat — optional first-party 公众号创作 mini-app.
 * 交付包落在契约类别（默认 {创作类}/YYYY-公众号/），写回走 api.ws.save。
 * （chrome 入口统一在 AI 工作区应用 pane + 状态栏 chip；无侧栏插件行）
 */
import { defineConnectorPlugin } from "../connector";
import { createWechatSettingsSlot } from "./settings-slot";
import { createWechatOverlaySlot } from "./wechat-app";
import { createWechatActions } from "./actions";
import { createWechatStatusBarSlot } from "./status-bar-slot";

export const manifest = {
  id: "topmind-wechat",
  name: "写作与交付",
  nameKey: "wechat:name",
  version: "1.1.0",
  description: "当前文档 → 写作动作 → 平台排版 → 复制与导出",
  descriptionKey: "wechat:manifestDescription",
  icon: "file-text",
  settingsKey: "wechat",
  launchable: true,
} as const;

export default defineConnectorPlugin(manifest, {
  settingsKey: "wechat",
  settingsSlot: createWechatSettingsSlot,
  interactiveSlots: [
    createWechatOverlaySlot,
    (ctx) => createWechatActions(ctx),
    createWechatStatusBarSlot,
  ],
});
