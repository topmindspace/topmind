/**
 * v4 Plugin Contract — extensible slot system powering the entire Shell.
 *
 * 8 slot kinds:
 *   DataSource    — sidebar tree section (built-in: Category+Topic filesystem)
 *   SidebarSlot   — sidebar entries (rich render or simple label+icon)
 *   ViewSlot      — editor area content when matches(selection) is true
 *   ActionSlot    — command palette (⌘K), context menus, shortcuts
 *   SettingsSlot  — settings dialog tab with custom panel
 *   OverlaySlot   — custom modal/overlay layer
 *   StatusBarSlot — status bar contributions
 *   ContextMenuSlot — tree view right-click menu items
 *
 * Built-in `topmind-workspace` plugin implements the core slots; additional
 * plugins (weread, x, accounting, web-resources) register their own.
 */
import type { ReactNode } from "react";
import type { Selection } from "../types";

/* ── Plugin Manifest ── */

export interface PluginManifest {
  id: string;
  name: string;
  /** i18n key for display name (e.g. "ingest:name"). When set, UI resolves via t() instead of using name. */
  nameKey?: string;
  version: string;
  description?: string;
  /** i18n key for description (e.g. "ingest:desc"). When set, UI resolves via t() instead of using description. */
  descriptionKey?: string;
  author?: string;
  icon?: string;
  /** Built-in plugins are always loaded and cannot be disabled. */
  builtin?: boolean;
  /** Settings key that controls this plugin's enabled state (e.g. "weread", "x"). */
  settingsKey?: string;
}

/* ── Plugin Context ── */

export interface PluginContext {
  /** Typed RPC client (invoke/subscribe). */
  rpc: PluginRpc;
  /** Current workspace root (absolute fs path). */
  workspaceRoot: string;
  /** Local event bus; bridges to backend events (workspace:file-changed, ai:stream). */
  events: PluginEventBus;
  /** AI client wrapper. */
  ai: PluginAi;
  /** Settings accessor. */
  settings: PluginSettings;
  /** Slot registration helper. Returns an unsubscribe. */
  register: (slot: Slot) => () => void;
  /** Plugin id (set by host). */
  pluginId: string;
  /** Open an overlay by kind. Built-in: quick-capture, settings, search, command-palette. */
  openOverlay(kind: string, context?: Record<string, unknown>): void;
  /** Navigate to a selection. */
  navigate(selection: Selection): void;
  /** Show a transient toast message (plain text or structured payload with kind). */
  toast(message: string | { text: string; kind?: "success" | "error" | "info" }): void;
}

export interface PluginRpc {
  invoke(method: string, params?: unknown): Promise<unknown>;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
}

export interface PluginEventBus {
  on(event: string, handler: (payload: unknown) => void): () => void;
  emit(event: string, payload?: unknown): void;
}

export interface PluginAi {
  invoke(params: unknown): Promise<unknown>;
  mountFile(topicId: string, relativePath: string): void;
  unmountFile(topicId: string, relativePath: string): void;
  runtimeStatus(): Promise<unknown>;
}

export interface PluginSettings {
  get(): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
}

export interface Plugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/* ── Plugin Lifecycle State ── */

export type PluginStatus = "active" | "disabled" | "error";

export interface PluginState {
  id: string;
  manifest: PluginManifest;
  status: PluginStatus;
  error?: string;
}

/* ── Slots ── */

export type SlotKind =
  | "dataSource"
  | "sidebar"
  | "view"
  | "action"
  | "settings"
  | "overlay"
  | "statusBar"
  | "contextMenu";

export interface SlotBase {
  kind: SlotKind;
  id: string;
  /** Plugin id that registered this slot. Set by registry, not by plugins. */
  pluginId?: string;
  /** Lower order sorts first. Default 100. */
  order?: number;
}

/* ── DataSource slot ──
 * A DataSource owns a tree (rendered as a sidebar section) plus read/write
 * semantics for its nodes. The built-in workspace plugin's DataSource walks
 * the Category+Topic filesystem. Future plugins implement their own tree. */

export type TreeNodeKind =
  | "root"
  | "group"
  | "category"
  | "topic"
  | "folder"
  | "file"
  | "custom";

export interface TreeNode {
  id: string;
  label: string;
  kind: TreeNodeKind;
  icon?: string;
  children?: TreeNode[];
  /** Selection produced when this node is clicked. If omitted, non-selectable. */
  selection?: Selection;
  meta?: Record<string, unknown>;
}

export interface DataSourceSlot extends SlotBase {
  kind: "dataSource";
  label: string;
  icon?: string;
  /** Fetch the tree root. The Sidebar renders this as a collapsible section. */
  getTree(): Promise<TreeNode[]>;
  /** Optional: refresh the tree. Default: re-call getTree. */
  refresh?(): Promise<void>;
  /** Subscribe to tree changes; returns unsubscribe. Payload carries optional relativePath for targeted refresh. */
  watch?(cb: (payload?: unknown) => void): () => void;
}

/* ── Sidebar slot ──
 * Non-tree sidebar entries. Two modes:
 * 1. Simple: provide label + icon + onSelect → default rendering.
 * 2. Rich: provide render(props) → full custom rendering (sync buttons, status, etc.).
 * Rich mode is used by connector plugins (weread, x) that need interactive controls. */

export interface SidebarSlot extends SlotBase {
  kind: "sidebar";
  label: string;
  /** i18n key — when set, Sidebar resolves via t() instead of using label. */
  labelKey?: string;
  icon?: string;
  /** Simple mode: called when the entry is clicked. */
  onSelect?(): void;
  /** Rich mode: full custom render. Replaces default label+icon rendering.
   *  The plugin captures ctx in closure during activate(). */
  render?(): ReactNode;
  /** Simple mode: static status text shown below the label. */
  statusText?: string;
  /** Simple mode: whether the plugin is configured (affects UI). */
  isConfigured?: boolean;
  /** Simple mode: primary action (e.g. sync). */
  onAction?(ctx: PluginContext): void | Promise<void>;
}

/* ── View slot ──
 * Renders content in the EditorArea when its `matches(sel)` returns true.
 * The first matching slot (lowest order) wins. Built-in views cover all
 * Selection kinds; a plugin can override by registering with lower order. */

export interface ViewSlot extends SlotBase {
  kind: "view";
  matches(sel: Selection): boolean;
  render(props: { sel: Selection }): ReactNode;
}

/* ── Action slot ──
 * Surfaces an action in the Command Palette (⌘K), context menus, and
 * keyboard shortcuts. The 5 skills are registered as ActionSlots. */

export interface ActionSlot extends SlotBase {
  kind: "action";
  label: string;
  /** i18n key — when set, CommandPalette resolves via t() instead of using label. */
  labelKey?: string;
  icon?: string;
  shortcut?: string;
  /** Optional grouping tag for UI (e.g. "skill", "file", "topic"). */
  group?: string;
  /** Whether the action is currently available for the given selection. */
  available?(sel: Selection): boolean;
  run(ctx: PluginContext, sel: Selection): void | Promise<void>;
}

/* ── Settings slot ──
 * Registers a tab in the Settings dialog. The render function receives
 * the current settings and an update callback. */

export interface SettingsSlot extends SlotBase {
  kind: "settings";
  label: string;
  /** i18n key (e.g. "weread:name") — when set, SettingsDialog resolves via t() instead of using label. */
  labelKey?: string;
  icon?: string;
  /** Render the settings panel content. SettingsDialog passes current settings + update. */
  render(props: { settings: unknown; update: (patch: Record<string, unknown>) => void }): ReactNode;
}

/* ── Overlay slot ──
 * Registers a custom modal/overlay layer. When OverlayHost receives an
 * overlay kind that doesn't match built-in ones, it checks registered
 * OverlaySlots for a match. */

export interface OverlaySlot extends SlotBase {
  kind: "overlay";
  /** Returns true if this slot handles the given overlay kind. */
  matches(kind: string): boolean;
  render(): ReactNode;
}

/* ── StatusBar slot ──
 * Contributes content to the StatusBar. Rendered between the built-in
 * left (engine health) and right (AI/selection) groups. */

export interface StatusBarSlot extends SlotBase {
  kind: "statusBar";
  /** "left" renders after engine health; "right" renders before selection hint. */
  align?: "left" | "right";
  render(): ReactNode;
}

/* ── ContextMenu slot ──
 * Contributes items to the TreeView right-click context menu. The `matches`
 * function determines which tree nodes this item applies to. */

export interface ContextMenuSlot extends SlotBase {
  kind: "contextMenu";
  label: string;
  icon?: string;
  /** Whether this menu item applies to the given tree node. */
  matches(node: TreeNode): boolean;
  /** Whether this item is currently available (e.g. requires configuration). */
  available?(node: TreeNode): boolean;
  run(ctx: PluginContext, node: TreeNode): void | Promise<void>;
}

export type Slot =
  | DataSourceSlot
  | SidebarSlot
  | ViewSlot
  | ActionSlot
  | SettingsSlot
  | OverlaySlot
  | StatusBarSlot
  | ContextMenuSlot;
