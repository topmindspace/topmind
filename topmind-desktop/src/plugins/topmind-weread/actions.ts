/**
 * Weread ActionSlots — command palette.
 */
import type { PluginContext, ActionSlot } from "../types";
import { api } from "../../services/api";
import i18n from "../../locales";

export function createWereadActions(_ctx: PluginContext): ActionSlot[] {
  return [
    {
      kind: "action",
      id: "weread.open-hub",
      label: "WeRead — Open hub",
      labelKey: "overlays:command.actions.wereadOpenHub",
      group: "sync",
      icon: "book-open",
      order: 199,
      run() {
        _ctx.navigate({ kind: "connector", id: "weread" });
      },
    },
    {
      kind: "action",
      id: "weread.sync",
      label: "WeRead — Sync now",
      labelKey: "overlays:command.actions.wereadSync",
      group: "sync",
      icon: "book-open",
      order: 200,
      async run() {
        try {
          const status = await api.weread.status();
          if (!status.ready) {
            _ctx.toast(i18n.t("weread:hub.notEnabledHint"));
            _ctx.openOverlay("settings", { topicId: "topmind-weread.settings" });
            return;
          }
          _ctx.toast(i18n.t("weread:hub.connecting"));
          const result = await api.weread.sync();
          const bits = [
            i18n.t("weread:hub.syncedBooksToast", { count: result.synced }),
            result.skippedNoChange ? i18n.t("weread:hub.noChangeToast", { count: result.skippedNoChange }) : null,
            result.remaining ? i18n.t("weread:hub.remainingToast", { count: result.remaining }) : null,
          ].filter(Boolean);
          _ctx.toast({ text: bits.join(" · "), kind: "success" });
          _ctx.events.emit("workspace:file-changed", null);
        } catch (e) {
          _ctx.toast({ text: i18n.t("weread:settings.failed", { msg: e instanceof Error ? e.message : String(e) }), kind: "error" });
        }
      },
    },
    {
      kind: "action",
      id: "weread.open-settings",
      label: "WeRead — Open settings",
      labelKey: "overlays:command.actions.wereadOpenSettings",
      group: "sync",
      icon: "book-open",
      order: 209,
      run() {
        _ctx.openOverlay("settings", { topicId: "topmind-weread.settings" });
      },
    },
  ];
}
