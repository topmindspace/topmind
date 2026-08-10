/**
 * topmind-workspace — built-in plugin implementing the Category+Topic
 * filesystem workbench. Always loaded; not special-cased in the Shell.
 */
import type { Plugin } from "../types";
import { createWorkspaceDataSource } from "./data-source";
import { createWorkspaceViews } from "./views";
import { createWorkspaceActions } from "./actions";
import { createSkillActions } from "./skills";

export const manifest = {
  id: "topmind-workspace",
  name: "topmind Workspace",
  nameKey: "workspace:manifestName",
  version: "4.0.0",
  description: "Category + Topic 文件系统工作台 — 提供侧栏树导航、编辑器视图、命令面板操作和 5 个技能入口",
  descriptionKey: "workspace:manifestDescription",
  builtin: true,
};

export const activate: Plugin["activate"] = (ctx) => {
  ctx.register(createWorkspaceDataSource());

  for (const view of createWorkspaceViews()) {
    ctx.register(view);
  }

  for (const action of createWorkspaceActions()) {
    ctx.register(action);
  }

  for (const skill of createSkillActions()) {
    ctx.register(skill);
  }
};

export default { manifest, activate } satisfies Plugin;
