/**
 * Workbench keyboard shortcuts — single source of truth for bindings + labels.
 * OverlayHost dispatches; ActionSlots/About/Settings display the same strings.
 * `labelKey` is an i18n key (e.g. "common:shortcut.capture") resolved by consuming components.
 */
import type { Selection } from "../types";
import type { LocalEventMap, LocalEventName } from "./local-events";

export type ShortcutAction =
  | { type: "overlay"; kind: string; intent?: string; topicId?: string }
  | { type: "navigate"; selection: Selection }
  | { [K in LocalEventName]: { type: "emit"; event: K; payload?: LocalEventMap[K] } }[LocalEventName]
  | { type: "sidebar-view"; mode: "stream" | "category" | "timeline" | "tags" | "kanban" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "close-overlay" }
  | { type: "close-tab" }
  | { type: "close-all-tabs" }
  | { type: "toggle-split" }
  | { type: "toggle-focus" };

export interface ShortcutDef {
  id: string;
  /** Human label i18n key (settings / about) */
  labelKey: string;
  /** Display chord e.g. ⌘⇧I */
  display: string;
  /** Requires ⌘ / Ctrl */
  mod: boolean;
  shift?: boolean;
  alt?: boolean;
  /** KeyboardEvent.key lowercased (letters) or exact (",", "[", "]") */
  key: string;
  action: ShortcutAction;
  /** When true, only fire when no overlay is open (except Escape) */
  requireNoOverlay?: boolean;
}

/** Global (OS) shortcut is registered in main process separately: ⌘⇧N */
export const GLOBAL_SHORTCUTS = [
  { display: "⌘⇧N", labelKey: "common:shortcut.globalCapture" },
] as const;

/** In-window workbench shortcuts */
export const WORKBENCH_SHORTCUTS: ShortcutDef[] = [
  {
    id: "capture",
    labelKey: "common:shortcut.capture",
    display: "⌘N",
    mod: true,
    key: "n",
    action: { type: "overlay", kind: "quick-capture" },
  },
  {
    id: "command-palette",
    labelKey: "common:shortcut.commandPalette",
    display: "⌘K",
    mod: true,
    key: "k",
    action: { type: "overlay", kind: "command-palette" },
  },
  {
    id: "search",
    labelKey: "common:shortcut.search",
    display: "⌘P",
    mod: true,
    key: "p",
    action: { type: "overlay", kind: "search" },
  },
  {
    id: "settings",
    labelKey: "common:shortcut.settings",
    display: "⌘,",
    mod: true,
    key: ",",
    action: { type: "overlay", kind: "settings" },
  },
  {
    id: "inbox",
    labelKey: "common:shortcut.inbox",
    display: "⌘⇧I",
    mod: true,
    shift: true,
    key: "i",
    action: { type: "navigate", selection: { kind: "inbox" } },
  },
  {
    id: "todo",
    labelKey: "common:shortcut.todo",
    display: "⌘⇧T",
    mod: true,
    shift: true,
    key: "t",
    action: { type: "emit", event: "todo:toggle-popover" },
  },
  {
    id: "stream",
    labelKey: "common:shortcut.stream",
    display: "⌘⇧S",
    mod: true,
    shift: true,
    key: "s",
    action: { type: "navigate", selection: { kind: "stream" } },
  },
  {
    id: "kanban",
    labelKey: "common:shortcut.kanban",
    display: "⌘⇧B",
    mod: true,
    shift: true,
    key: "b",
    action: { type: "sidebar-view", mode: "kanban" },
  },
  {
    id: "outputs",
    labelKey: "common:shortcut.outputs",
    display: "⌘⇧O",
    mod: true,
    shift: true,
    key: "o",
    action: { type: "navigate", selection: { kind: "outputs" } },
  },
  {
    id: "archive",
    labelKey: "common:shortcut.archive",
    display: "⌘⇧A",
    mod: true,
    shift: true,
    key: "a",
    action: { type: "navigate", selection: { kind: "archive" } },
  },
  {
    id: "sidebar-stream",
    labelKey: "common:shortcut.stream",
    display: "⌘1",
    mod: true,
    key: "1",
    action: { type: "sidebar-view", mode: "stream" },
  },
  {
    id: "sidebar-category",
    labelKey: "common:shortcut.sidebarCategory",
    display: "⌘2",
    mod: true,
    key: "2",
    action: { type: "sidebar-view", mode: "category" },
  },
  {
    id: "sidebar-timeline",
    labelKey: "common:shortcut.sidebarTimeline",
    display: "⌘3",
    mod: true,
    key: "3",
    action: { type: "sidebar-view", mode: "timeline" },
  },
  {
    id: "sidebar-tags",
    labelKey: "common:shortcut.sidebarTags",
    display: "⌘4",
    mod: true,
    key: "4",
    action: { type: "sidebar-view", mode: "tags" },
  },
  {
    id: "sidebar-kanban-digit",
    labelKey: "common:shortcut.kanban",
    display: "⌘5",
    mod: true,
    key: "5",
    action: { type: "sidebar-view", mode: "kanban" },
  },
  {
    id: "task-panel",
    labelKey: "common:shortcut.taskPanel",
    display: "⌘⇧J",
    mod: true,
    shift: true,
    key: "j",
    action: { type: "emit", event: "task-panel:toggle" },
  },
  {
    id: "workspace-switcher",
    labelKey: "common:shortcut.workspaceSwitcher",
    display: "⌘⇧W",
    mod: true,
    shift: true,
    key: "w",
    action: { type: "emit", event: "titlebar:workspace-switcher-toggle" },
  },
  {
    id: "close-tab",
    labelKey: "common:shortcut.closeTab",
    display: "⌘W",
    mod: true,
    key: "w",
    action: { type: "close-tab" },
    requireNoOverlay: true,
  },
  {
    id: "close-all-tabs",
    labelKey: "common:shortcut.closeAllTabs",
    display: "⌘⌥W",
    mod: true,
    alt: true,
    key: "w",
    action: { type: "close-all-tabs" },
    requireNoOverlay: true,
  },
  {
    id: "back",
    labelKey: "common:shortcut.back",
    display: "⌘[",
    mod: true,
    key: "[",
    action: { type: "back" },
  },
  {
    id: "forward",
    labelKey: "common:shortcut.forward",
    display: "⌘]",
    mod: true,
    key: "]",
    action: { type: "forward" },
  },
  {
    id: "toggle-split",
    labelKey: "common:shortcut.toggleSplit",
    display: "⌘\\",
    mod: true,
    key: "\\",
    action: { type: "toggle-split" },
    requireNoOverlay: true,
  },
  {
    id: "focus-mode",
    labelKey: "common:shortcut.focusMode",
    display: "⌘⌥F",
    mod: true,
    alt: true,
    key: "f",
    action: { type: "toggle-focus" },
  },
];

/** Match a keyboard event to a workbench shortcut (or null). */
export function matchWorkbenchShortcut(e: KeyboardEvent): ShortcutDef | null {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  // Escape is special (no mod required) — closes overlay; if none, exits focus mode
  if (!mod && e.key === "Escape") {
    return {
      id: "escape",
      labelKey: "common:shortcut.escape",
      display: "Esc",
      mod: false,
      key: "Escape",
      action: { type: "close-overlay" },
    };
  }

  if (!mod) return null;

  // Don't steal ⌘⇧N — owned by main process global capture
  if (e.shiftKey && key === "n") return null;

  for (const s of WORKBENCH_SHORTCUTS) {
    if (Boolean(s.shift) !== Boolean(e.shiftKey)) continue;
    if (Boolean(s.alt) !== Boolean(e.altKey)) continue;
    if (s.key !== key) continue;
    if (s.mod && !mod) continue;
    // Prefer more-specific modifiers first (already ordered: shift/alt variants before plain)
    return s;
  }
  return null;
}

/** Platform-aware modifier glyph for copy/UI (⌘ on macOS, Ctrl elsewhere). */
export function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /mac|iphone|ipad/iu.test(navigator.platform || navigator.userAgent) ? "\u2318" : "Ctrl";
}
