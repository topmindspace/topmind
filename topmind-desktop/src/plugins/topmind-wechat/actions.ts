import type { ActionSlot, PluginContext } from "../types";
import { WECHAT_CHROME_IDS, WECHAT_PLUGIN_ID, PLUGIN_APP_KIND } from "../../lib/plugin-launcher";

export function createWechatActions(_ctx: PluginContext): ActionSlot[] {
  return [
    {
      kind: "action",
      id: WECHAT_CHROME_IDS.action,
      label: "WeChat Studio",
      labelKey: "wechat:name",
      icon: "file-text",
      group: "navigate",
      order: 19,
      run: (ctx) => {
        ctx.events.emit("overlay:open", { kind: PLUGIN_APP_KIND, pluginId: WECHAT_PLUGIN_ID });
      },
    },
  ];
}
