/**
 * X ActionSlots — command palette.
 * Labels resolved via i18n key (overlays:command.actions.*) by CommandPalette.
 */
import type { PluginContext, ActionSlot } from "../types";
import { api } from "../../services/api";
import i18n from "../../locales";

export function createXActions(ctx: PluginContext): ActionSlot[] {
  return [
    {
      kind: "action",
      id: "x.open-hub",
      label: "X — Open hub",
      labelKey: "overlays:command.actions.xOpenHub",
      group: "sync",
      icon: "twitter",
      order: 208,
      run() {
        ctx.navigate({ kind: "connector", id: "x" });
      },
    },
    {
      kind: "action",
      id: "x.fetch-tweets",
      label: "X — Fetch / search tweets and archive",
      labelKey: "overlays:command.actions.xFetchTweets",
      group: "sync",
      icon: "twitter",
      order: 210,
      async run() {
        try {
          const status = await api.x.status();
          if (!status.ready) {
            ctx.toast(i18n.t("x:hub.notEnabled"));
            ctx.openOverlay("settings", { topicId: "topmind-x.settings" });
            return;
          }
          if (!status.canRead) {
            ctx.toast(i18n.t("x:hub.cannotReadError"));
            ctx.openOverlay("settings", { topicId: "topmind-x.settings" });
            return;
          }
          ctx.navigate({ kind: "connector", id: "x" });
          ctx.events.emit("x:open-prompt", { mode: "fetch" });
        } catch (e) {
          ctx.toast({ text: i18n.t("x:hub.errorToast", { msg: e instanceof Error ? e.message : String(e) }), kind: "error" });
        }
      },
    },
    {
      kind: "action",
      id: "x.compose-post",
      label: "X — Compose and post tweet",
      labelKey: "overlays:command.actions.xComposePost",
      group: "sync",
      icon: "twitter",
      order: 211,
      async run() {
        try {
          const status = await api.x.status();
          if (!status.canPost) {
            ctx.toast(i18n.t("x:hub.needXurl"));
            ctx.openOverlay("settings", { topicId: "topmind-x.settings" });
            return;
          }
          ctx.navigate({ kind: "connector", id: "x" });
          ctx.events.emit("x:open-prompt", { mode: "post" });
        } catch (e) {
          ctx.toast({ text: i18n.t("x:hub.errorToast", { msg: e instanceof Error ? e.message : String(e) }), kind: "error" });
        }
      },
    },
    {
      kind: "action",
      id: "x.open-settings",
      label: "X — Open settings",
      labelKey: "overlays:command.actions.xOpenSettings",
      group: "sync",
      icon: "twitter",
      order: 219,
      run() {
        ctx.openOverlay("settings", { topicId: "topmind-x.settings" });
      },
    },
  ];
}
