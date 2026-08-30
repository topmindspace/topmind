/**
 * topmind-ingest — knowledge processing pipeline (builtin).
 * Drop / pick files → convert to Markdown → Inbox or topic.
 * （chrome 入口统一在标题栏 Apps 菜单 + 状态栏 chip；侧栏插件行已移除 2026-08-30）
 */
import type { Plugin } from "../types";
import { createIngestHubView } from "./hub-view";
import { createIngestActions } from "./actions";
import { createIngestStatusBarSlot } from "./status-bar-slot";
import { createIngestSettingsSlot } from "./settings-slot";

export const manifest = {
  id: "topmind-ingest",
  name: "知识加工",
  nameKey: "ingest:title",
  version: "1.0.0",
  description: "本地文档知识加工管道：类型探测 → Markdown → 收件箱/专题 · 后台队列",
  descriptionKey: "ingest:manifestDescription",
  builtin: true,
  icon: "file-input",
} as const;

export const activate: Plugin["activate"] = (ctx) => {
  ctx.register(createIngestHubView(ctx));
  ctx.register(createIngestSettingsSlot(ctx));
  ctx.register(createIngestStatusBarSlot(ctx));
  for (const action of createIngestActions(ctx)) {
    ctx.register(action);
  }
};

export default { manifest, activate } satisfies Plugin;
