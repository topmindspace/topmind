/**
 * Built-in workspace actions — navigation + app commands for ⌘K.
 * Shortcuts match src/lib/shortcuts.ts (dispatched by OverlayHost).
 * Labels are resolved via i18n key (overlays:command.actions.*) by CommandPalette.
 */
import type { ActionSlot } from "../types";
import type { Selection } from "../../types";

function gotoAction(
  id: string,
  labelKey: string,
  fallbackLabel: string,
  order: number,
  selection: Selection,
  shortcut?: string,
): ActionSlot {
  return {
    kind: "action",
    id,
    label: fallbackLabel,
    labelKey,
    group: "goto",
    order,
    shortcut,
    run: (ctx) => ctx.events.emit("navigate:select", selection),
  };
}

export function createWorkspaceActions(): ActionSlot[] {
  return [
    // Single stream goto (⌘⇧S / ⌘⇧T both land on 动态 — no duplicate Home action)
    gotoAction("topmind-workspace.goto.stream", "overlays:command.actions.gotoStream", "Go to · Stream", 10, { kind: "stream" }, "⌘⇧S"),
    gotoAction("topmind-workspace.goto.inbox", "overlays:command.actions.gotoInbox", "Go to · Inbox", 12, { kind: "inbox" }, "⌘⇧I"),
    gotoAction("topmind-workspace.goto.outputs", "overlays:command.actions.gotoOutputs", "Go to · Outputs", 13, { kind: "outputs" }, "⌘⇧O"),
    gotoAction("topmind-workspace.goto.archive", "overlays:command.actions.gotoArchive", "Go to · Archive", 14, { kind: "archive" }, "⌘⇧A"),
    {
      kind: "action",
      id: "topmind-workspace.action.kanban",
      label: "Sidebar · Kanban view",
      labelKey: "overlays:command.actions.kanban",
      shortcut: "⌘⇧B",
      group: "navigate",
      order: 15,
      run: (ctx) => {
        ctx.events.emit("sidebar:set-view", "kanban");
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.todo",
      label: "Todo list",
      labelKey: "overlays:command.actions.todo",
      shortcut: "⌘⇧T",
      group: "navigate",
      order: 16,
      run: (ctx) => {
        ctx.events.emit("todo:toggle-popover");
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.global-search",
      label: "Global search notes",
      labelKey: "overlays:command.actions.globalSearch",
      shortcut: "⌘P",
      group: "navigate",
      order: 20,
      run: (ctx) => {
        ctx.events.emit("overlay:open", { kind: "search" });
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.settings",
      label: "Open settings",
      labelKey: "overlays:command.actions.settings",
      shortcut: "⌘,",
      group: "navigate",
      order: 30,
      run: (ctx) => {
        ctx.events.emit("overlay:open", { kind: "settings" });
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.command-palette",
      label: "Command palette",
      labelKey: "overlays:command.actions.commandPalette",
      shortcut: "⌘K",
      group: "navigate",
      order: 5,
      run: (ctx) => {
        ctx.events.emit("overlay:open", { kind: "command-palette" });
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.task-panel",
      label: "Tasks · Organize period",
      labelKey: "overlays:command.actions.taskPanel",
      shortcut: "⌘⇧J",
      group: "navigate",
      order: 22,
      run: (ctx) => {
        ctx.events.emit("task-panel:open");
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.open-ai",
      label: "Open AI panel",
      labelKey: "overlays:command.actions.openAi",
      group: "navigate",
      order: 23,
      run: (ctx) => {
        ctx.events.emit("ai-panel:open");
      },
    },
    {
      kind: "action",
      id: "topmind-workspace.action.organize-week",
      label: "Organize this week",
      labelKey: "overlays:command.actions.organizeWeek",
      group: "navigate",
      order: 21,
      run: (ctx) => {
        // Full product path: stream + reconcile task + AI rail for suggestions
        ctx.events.emit("organize:week");
      },
    },
  ];
}
