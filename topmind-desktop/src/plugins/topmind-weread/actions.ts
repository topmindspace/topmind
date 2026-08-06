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
      label: i18n.t("weread:sidebar.openHub"),
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
      label: i18n.t("weread:sidebar.syncNow"),
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
          _ctx.toast(i18n.t("weread:sidebar.connecting"));
          const result = await api.weread.sync();
          const bits = [
            i18n.t("weread:sidebar.syncedBooks", { count: result.synced }),
            result.skippedNoChange ? i18n.t("weread:sidebar.noChange", { count: result.skippedNoChange }) : null,
            result.remaining ? i18n.t("weread:sidebar.remaining", { count: result.remaining }) : null,
          ].filter(Boolean);
          _ctx.toast(bits.join(" · "));
          _ctx.events.emit("workspace:file-changed", null);
        } catch (e) {
          _ctx.toast(i18n.t("weread:settings.failed", { msg: e instanceof Error ? e.message : String(e) }));
        }
      },
    },
    {
      kind: "action",
      id: "weread.open-settings",
      label: i18n.t("weread:sidebar.settings"),
      group: "sync",
      icon: "book-open",
      order: 209,
      run() {
        _ctx.openOverlay("settings", { topicId: "topmind-weread.settings" });
      },
    },
  ];
}
