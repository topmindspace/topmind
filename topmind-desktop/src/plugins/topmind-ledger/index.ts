/**
 * topmind-ledger — optional first-party 记账 mini-app.
 * Books live on the memory plane ({memory.dir}/ledgers/{role}.md).
 * （chrome 入口统一在标题栏 Apps 菜单 + 状态栏 chip；侧栏插件行已移除 2026-08-30）
 */
import { defineConnectorPlugin } from "../connector";
import { createLedgerSettingsSlot } from "./settings-slot";
import { createLedgerOverlaySlot } from "./ledger-app";
import { createLedgerActions } from "./actions";
import { createLedgerStatusBarSlot } from "./status-bar-slot";

export const manifest = {
  id: "topmind-ledger",
  name: "记账",
  nameKey: "ledger:name",
  version: "1.0.0",
  description: "通用记账：默认个人账本，用户自建账本与分类",
  descriptionKey: "ledger:manifestDescription",
  icon: "wallet",
  settingsKey: "ledger",
  launchable: true,
} as const;

export default defineConnectorPlugin(manifest, {
  settingsKey: "ledger",
  settingsSlot: createLedgerSettingsSlot,
  interactiveSlots: [
    createLedgerOverlaySlot,
    (ctx) => createLedgerActions(ctx),
    createLedgerStatusBarSlot,
  ],
});
