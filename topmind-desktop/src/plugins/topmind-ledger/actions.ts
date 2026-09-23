import type { ActionSlot, PluginContext } from "../types";
import { LEDGER_CHROME_IDS, LEDGER_PLUGIN_ID, PLUGIN_APP_KIND } from "../../lib/plugin-launcher";

export function createLedgerActions(_ctx: PluginContext): ActionSlot[] {
  return [
    {
      kind: "action",
      id: LEDGER_CHROME_IDS.action,
      label: "Bookkeeping",
      labelKey: "overlays:command.actions.ledgerOpen",
      icon: "wallet",
      group: "navigate",
      order: 18,
      run: (ctx) => {
        ctx.events.emit("overlay:open", { kind: PLUGIN_APP_KIND, pluginId: LEDGER_PLUGIN_ID });
      },
    },
  ];
}
