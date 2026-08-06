/**
 * ViewStore — selection + sidebar/overlay/AI panel state.
 * UI state (widths, collapsed) is persisted to settings by Shell on change.
 */
import { create } from "zustand";
import type { Selection, OverlayKind, OverlayContext } from "../types";
import { normalizeSelection } from "../types";
import type { Theme } from "../lib/theme";
import {
  DEFAULT_TREE_SORT,
  isTreeSortMode,
  type TreeSortMode,
} from "../lib/tree-sort";
import {
  wouldAbandonInlineAi,
  useInlineAiStore,
} from "../lib/inline-ai-busy";

export type SidebarViewMode = "category" | "timeline" | "tags" | "kanban" | "stream";
export type { TreeSortMode };

interface EditorSettings {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  autoSaveMs?: number;
  wordWrap?: boolean;
  tabMode?: "multi" | "single";
  contentWidth?: "compact" | "reading" | "wide" | "full";
  pagePadding?: "compact" | "comfortable" | "spacious";
  paper?: "default" | "soft" | "paper" | "sepia";
}

/** Max entries kept in the navigation history stack. */
const HISTORY_CAP = 100;
/** Max unpinned recent-file tabs (pinned are uncapped within reason). */
const FILE_TAB_CAP = 14;

export interface FileTab {
  path: string;
  pinned: boolean;
}

function expandedStorageKey(workspaceRoot: string) {
  return `topmind:expanded-nodes:${workspaceRoot}`;
}

function persistExpanded(workspaceRoot: string, next: Set<string>) {
  if (!workspaceRoot) return;
  try {
    // Always write (including empty array) so "user collapsed all" is respected
    localStorage.setItem(expandedStorageKey(workspaceRoot), JSON.stringify(Array.from(next)));
  } catch {
    /* ignore quota */
  }
}

/** Load expanded ids; hasStored=true means user has a saved preference (even if empty). */
export function loadExpandedState(workspaceRoot: string): {
  ids: Set<string>;
  hasStored: boolean;
} {
  if (!workspaceRoot) return { ids: new Set(), hasStored: false };
  try {
    const raw = localStorage.getItem(expandedStorageKey(workspaceRoot));
    if (raw == null) return { ids: new Set(), hasStored: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { ids: new Set(), hasStored: true };
    return {
      ids: new Set(parsed.filter((x) => typeof x === "string" && x)),
      hasStored: true,
    };
  } catch {
    return { ids: new Set(), hasStored: false };
  }
}

function persistFileTabs(workspaceRoot: string, tabs: FileTab[]) {
  if (!workspaceRoot) return;
  try {
    localStorage.setItem(`topmind:file-tabs:${workspaceRoot}`, JSON.stringify(tabs));
  } catch {
    /* ignore */
  }
}

function loadFileTabs(workspaceRoot: string): FileTab[] {
  if (!workspaceRoot) return [];
  try {
    const raw = localStorage.getItem(`topmind:file-tabs:${workspaceRoot}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is FileTab => t && typeof t === "object" && typeof (t as FileTab).path === "string")
      .map((t) => ({ path: t.path, pinned: Boolean(t.pinned) }));
  } catch {
    return [];
  }
}

/**
 * Open or activate a file tab.
 * Chrome-style: activating an existing tab does NOT reorder the strip.
 * New tabs append after pins (or replace-only when single-tab mode).
 */
function upsertFileTab(
  tabs: FileTab[],
  path: string,
  mode: "multi" | "single" = "multi",
): FileTab[] {
  if (mode === "single") {
    const existing = tabs.find((t) => t.path === path);
    if (existing?.pinned) {
      // Keep all pins + ensure this path is present as pin; drop unpinned
      const pins = tabs.filter((t) => t.pinned);
      return pins.some((t) => t.path === path) ? pins : [...pins, { path, pinned: true }];
    }
    // Single unpinned tab replaces previous unpinned; keep pins
    const pins = tabs.filter((t) => t.pinned);
    return [...pins, { path, pinned: false }];
  }
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    // Activate only — preserve order (Chrome tabs)
    return tabs;
  }
  const pinned = tabs.filter((t) => t.pinned);
  const unpinned = tabs.filter((t) => !t.pinned);
  const entry: FileTab = { path, pinned: false };
  const nextUnpinned = [...unpinned, entry].slice(-FILE_TAB_CAP);
  return [...pinned, ...nextUnpinned];
}

/** Structural equality for selections — used to skip pushing duplicate
 * consecutive navigations onto the history stack. */
function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "category" && b.kind === "category") return a.category === b.category;
  if (a.kind === "topic" && b.kind === "topic") return a.topicId === b.topicId;
  if (a.kind === "file" && b.kind === "file") return a.path === b.path;
  if (a.kind === "connector" && b.kind === "connector") return a.id === b.id;
  return true; // home / inbox / stream / outputs / archive are singletons
}

interface ViewState {
  /* current selection — drives EditorArea view resolution */
  selection: Selection;
  select: (sel: Selection) => void;

  /* navigation history — workbench back/forward across any Selection */
  history: Selection[];
  historyIndex: number;
  back: () => void;
  forward: () => void;

  /* recent / pinned file tabs (editor strip) */
  fileTabs: FileTab[];
  pinFileTab: (path: string) => void;
  closeFileTab: (path: string) => void;
  /** Close all unpinned tabs (pins kept). closePinned=true closes everything. */
  closeAllFileTabs: (opts?: { closePinned?: boolean }) => void;
  /** Close every tab except path (and optional pins). */
  closeOtherFileTabs: (path: string) => void;
  /** Reorder tabs by index (drag-and-drop). Pins stay sorted first after move. */
  reorderFileTabs: (fromIndex: number, toIndex: number) => void;

  /** Category-tree child sort (persisted per workspace). */
  treeSortMode: TreeSortMode;
  setTreeSortMode: (m: TreeSortMode) => void;
  /** multi = Chrome-style strip; single = one unpinned file at a time */
  editorTabMode: "multi" | "single";
  setEditorTabMode: (m: "multi" | "single") => void;

  /* sidebar */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  expandedNodeIds: Set<string>;
  toggleNode: (id: string) => void;
  /** Merge node ids into expanded set (reveal path / default expand). */
  expandNodes: (ids: string[]) => void;
  /** Replace expanded set (bootstrap default when no saved state). */
  setExpandedNodes: (ids: string[]) => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  sidebarView: SidebarViewMode;
  setSidebarView: (m: SidebarViewMode) => void;

  /* AI panel */
  aiPanelOpen: boolean;
  toggleAiPanel: () => void;
  setAiPanelOpen: (v: boolean) => void;
  aiPanelWidth: number;
  setAiPanelWidth: (w: number) => void;

  /**
   * Focus / zen mode — hide sidebar, AI rail, status bar, tab strip noise.
   * Session-only (not persisted); Esc or ⌘⌥F exits.
   */
  focusMode: boolean;
  toggleFocusMode: () => void;
  setFocusMode: (v: boolean) => void;

  /**
   * Editor vertical split — secondary file path shown beside primary selection.
   * Session-only; not a second navigation history. Clear when path closes.
   */
  splitSecondaryPath: string | null;
  /** Fraction of canvas width for the primary (left) pane, 0.3–0.7. */
  splitPrimaryRatio: number;
  setSplitSecondaryPath: (path: string | null) => void;
  setSplitPrimaryRatio: (r: number) => void;
  /** Open path on the right (adds tab if needed). Same path as primary → clear. */
  openInSplit: (path: string) => void;
  clearSplit: () => void;
  /** Swap primary selection with secondary pane. */
  swapSplitPanes: () => void;

  /* editor settings — reactive, synced from SettingsDialog */
  editorSettings: EditorSettings;
  setEditorSettings: (s: EditorSettings) => void;

  /* writeback mode — AI write permission level (auto/confirm) */
  writebackMode: "auto" | "confirm";
  setWritebackMode: (m: "auto" | "confirm") => void;
  cycleWritebackMode: () => void;

  /* theme — reactive, applied by App; synced from SettingsDialog */
  theme: Theme;
  setTheme: (t: Theme) => void;

  /* workspace root — set by Shell on mount, read by CommandPalette */
  workspaceRoot: string;
  setWorkspaceRoot: (w: string) => void;

  /* overlays */
  overlay: OverlayKind;
  /* optional payload for the active overlay (intent + target topic) */
  overlayContext: OverlayContext | null;
  openOverlay: (kind: OverlayKind, context?: OverlayContext | null) => void;
  closeOverlay: () => void;

  /**
   * Apply navigation without inline-AI leave guard (used after ConfirmDialog).
   * Prefer `select` for normal navigation.
   */
  applySelectForced: (sel: Selection) => void;
  applyHistoryForced: (dir: "back" | "forward") => void;
}

/** Shared select mutation (history + tabs). Used by select + applySelectForced. */
function commitSelect(
  s: ViewState,
  next: Selection,
): Partial<ViewState> {
  const trimmed = s.history.slice(0, s.historyIndex + 1);
  trimmed.push(next);
  const capped = trimmed.slice(-HISTORY_CAP);
  let fileTabs = s.fileTabs;
  if (next.kind === "file") {
    fileTabs = upsertFileTab(s.fileTabs, next.path, s.editorTabMode);
    persistFileTabs(s.workspaceRoot, fileTabs);
  }
  return { selection: next, history: capped, historyIndex: capped.length - 1, fileTabs };
}

export const useViewStore = create<ViewState>((set, get) => ({
  selection: { kind: "stream" },
  select: (sel) => {
    const next = normalizeSelection(sel);
    const prev = get().selection;
    if (sameSelection(prev, next)) return;

    // Hold navigation until ConfirmDialog resolves — never navigate-then-block
    if (wouldAbandonInlineAi(prev, next)) {
      useInlineAiStore.getState().requestNavConfirm({ kind: "select", next });
      return;
    }

    set((s) => commitSelect(s, next));
  },

  applySelectForced: (sel) => {
    const next = normalizeSelection(sel);
    const prev = get().selection;
    if (sameSelection(prev, next)) return;
    set((s) => commitSelect(s, next));
  },

  history: [{ kind: "stream" }],
  historyIndex: 0,
  back: () => {
    const s = get();
    if (s.historyIndex <= 0) return;
    const historyIndex = s.historyIndex - 1;
    const next = normalizeSelection(s.history[historyIndex]);
    if (wouldAbandonInlineAi(s.selection, next)) {
      useInlineAiStore.getState().requestNavConfirm({ kind: "back" });
      return;
    }
    set({ historyIndex, selection: next });
  },
  forward: () => {
    const s = get();
    if (s.historyIndex >= s.history.length - 1) return;
    const historyIndex = s.historyIndex + 1;
    const next = normalizeSelection(s.history[historyIndex]);
    if (wouldAbandonInlineAi(s.selection, next)) {
      useInlineAiStore.getState().requestNavConfirm({ kind: "forward" });
      return;
    }
    set({ historyIndex, selection: next });
  },
  applyHistoryForced: (dir) => {
    const s = get();
    if (dir === "back") {
      if (s.historyIndex <= 0) return;
      const historyIndex = s.historyIndex - 1;
      set({ historyIndex, selection: normalizeSelection(s.history[historyIndex]) });
      return;
    }
    if (s.historyIndex >= s.history.length - 1) return;
    const historyIndex = s.historyIndex + 1;
    set({ historyIndex, selection: normalizeSelection(s.history[historyIndex]) });
  },

  fileTabs: [],
  pinFileTab: (path) =>
    set((s) => {
      const fileTabs = s.fileTabs.map((t) =>
        t.path === path ? { ...t, pinned: !t.pinned } : t,
      );
      // Keep pinned first
      fileTabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
      persistFileTabs(s.workspaceRoot, fileTabs);
      return { fileTabs };
    }),
  closeFileTab: (path) =>
    set((s) => {
      const fileTabs = s.fileTabs.filter((t) => t.path !== path);
      persistFileTabs(s.workspaceRoot, fileTabs);
      const clearSplit = s.splitSecondaryPath === path ? { splitSecondaryPath: null as string | null } : {};
      // If closing the active file, jump to next tab or home
      if (s.selection.kind === "file" && s.selection.path === path) {
        const next = fileTabs[0];
        if (next) {
          const parts = next.path.split("/");
          const topicId = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
          return {
            fileTabs,
            selection: { kind: "file" as const, path: next.path, topicId },
            ...clearSplit,
          };
        }
        return { fileTabs, selection: { kind: "stream" as const }, splitSecondaryPath: null };
      }
      return { fileTabs, ...clearSplit };
    }),
  closeAllFileTabs: (opts) =>
    set((s) => {
      const closePinned = Boolean(opts?.closePinned);
      const fileTabs = closePinned ? [] : s.fileTabs.filter((t) => t.pinned);
      persistFileTabs(s.workspaceRoot, fileTabs);
      const activePath = s.selection.kind === "file" ? s.selection.path : null;
      const stillOpen = activePath && fileTabs.some((t) => t.path === activePath);
      if (stillOpen) {
        const splitStill =
          s.splitSecondaryPath && fileTabs.some((t) => t.path === s.splitSecondaryPath)
            ? s.splitSecondaryPath
            : null;
        return { fileTabs, splitSecondaryPath: splitStill };
      }
      if (fileTabs[0]) {
        const p = fileTabs[0].path;
        const parts = p.split("/");
        const topicId = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
        return {
          fileTabs,
          selection: { kind: "file" as const, path: p, topicId },
          splitSecondaryPath: null,
        };
      }
      return { fileTabs, selection: { kind: "stream" as const }, splitSecondaryPath: null };
    }),
  closeOtherFileTabs: (path) =>
    set((s) => {
      const keep = s.fileTabs.filter((t) => t.path === path || t.pinned);
      // Ensure target path is present
      const has = keep.some((t) => t.path === path);
      const fileTabs = has
        ? keep
        : [{ path, pinned: false }, ...keep.filter((t) => t.path !== path)];
      persistFileTabs(s.workspaceRoot, fileTabs);
      const parts = path.split("/");
      const topicId = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
      const splitOk =
        s.splitSecondaryPath &&
        fileTabs.some((t) => t.path === s.splitSecondaryPath) &&
        s.splitSecondaryPath !== path
          ? s.splitSecondaryPath
          : null;
      return {
        fileTabs,
        selection: { kind: "file" as const, path, topicId },
        splitSecondaryPath: splitOk,
      };
    }),
  reorderFileTabs: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex) return {};
      if (fromIndex < 0 || toIndex < 0) return {};
      if (fromIndex >= s.fileTabs.length || toIndex >= s.fileTabs.length) return {};
      const next = [...s.fileTabs];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      const pinned = next.filter((t) => t.pinned);
      const unpinned = next.filter((t) => !t.pinned);
      const fileTabs = [...pinned, ...unpinned];
      persistFileTabs(s.workspaceRoot, fileTabs);
      return { fileTabs };
    }),

  treeSortMode: (() => {
    try {
      const raw = localStorage.getItem("topmind:tree-sort");
      if (isTreeSortMode(raw)) return raw;
    } catch {
      /* */
    }
    return DEFAULT_TREE_SORT;
  })(),
  setTreeSortMode: (m) =>
    set(() => {
      try {
        localStorage.setItem("topmind:tree-sort", m);
      } catch {
        /* */
      }
      return { treeSortMode: m };
    }),

  /** Canonical persistence is settings.editor.tabMode; localStorage is migration-only bootstrap. */
  editorTabMode: (() => {
    try {
      const raw = localStorage.getItem("topmind:editor-tab-mode");
      if (raw === "single" || raw === "multi") return raw;
    } catch {
      /* */
    }
    return "multi" as const;
  })(),
  setEditorTabMode: (m) =>
    set((s) => {
      try {
        // Keep local bootstrap key in sync until settings hydrate wins
        localStorage.setItem("topmind:editor-tab-mode", m);
      } catch {
        /* */
      }
      // When switching to single, collapse unpinned to the active file only
      let fileTabs = s.fileTabs;
      if (m === "single") {
        const pins = s.fileTabs.filter((t) => t.pinned);
        const activePath = s.selection.kind === "file" ? s.selection.path : null;
        const activePin = pins.some((t) => t.path === activePath);
        fileTabs = activePath && !activePin
          ? [...pins, { path: activePath, pinned: false }]
          : pins.length
            ? pins
            : activePath
              ? [{ path: activePath, pinned: false }]
              : [];
        persistFileTabs(s.workspaceRoot, fileTabs);
      }
      return { editorTabMode: m, fileTabs };
    }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  expandedNodeIds: new Set<string>(),
  toggleNode: (id) =>
    set((s) => {
      const next = new Set(s.expandedNodeIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistExpanded(s.workspaceRoot, next);
      return { expandedNodeIds: next };
    }),
  expandNodes: (ids) =>
    set((s) => {
      if (!ids.length) return {};
      const next = new Set(s.expandedNodeIds);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (!changed) return {};
      persistExpanded(s.workspaceRoot, next);
      return { expandedNodeIds: next };
    }),
  setExpandedNodes: (ids) =>
    set((s) => {
      const next = new Set(ids);
      persistExpanded(s.workspaceRoot, next);
      return { expandedNodeIds: next };
    }),

  sidebarWidth: 240,
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  sidebarView: "stream",
  setSidebarView: (sidebarView) => set({ sidebarView }),

  aiPanelOpen: true,
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAiPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),

  aiPanelWidth: 360,
  setAiPanelWidth: (aiPanelWidth) => set({ aiPanelWidth }),

  focusMode: false,
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setFocusMode: (focusMode) => set({ focusMode }),

  splitSecondaryPath: null,
  splitPrimaryRatio: 0.5,
  setSplitSecondaryPath: (splitSecondaryPath) => set({ splitSecondaryPath }),
  setSplitPrimaryRatio: (r) =>
    set({ splitPrimaryRatio: Math.min(0.7, Math.max(0.3, r)) }),
  openInSplit: (path) =>
    set((s) => {
      if (!path) return { splitSecondaryPath: null };
      if (s.selection.kind === "file" && s.selection.path === path) {
        return { splitSecondaryPath: null };
      }
      const fileTabs = upsertFileTab(s.fileTabs, path, s.editorTabMode);
      persistFileTabs(s.workspaceRoot, fileTabs);
      return { fileTabs, splitSecondaryPath: path };
    }),
  clearSplit: () => set({ splitSecondaryPath: null }),
  swapSplitPanes: () =>
    set((s) => {
      if (!s.splitSecondaryPath) return {};
      if (s.selection.kind !== "file") return {};
      const left = s.selection.path;
      const right = s.splitSecondaryPath;
      const parts = right.split("/");
      const topicId = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
      return {
        selection: { kind: "file" as const, path: right, topicId },
        splitSecondaryPath: left,
      };
    }),

  editorSettings: {
    fontSize: 16,
    lineHeight: 1.7,
    fontFamily: "sans",
    autoSaveMs: 1500,
    wordWrap: true,
    contentWidth: "reading",
    pagePadding: "comfortable",
    paper: "default",
  },
  setEditorSettings: (editorSettings) => set({ editorSettings }),

  writebackMode: "auto",
  setWritebackMode: (writebackMode) => set({ writebackMode }),
cycleWritebackMode: () =>
set((s) => {
const modes: Array<"auto" | "confirm"> = ["auto", "confirm"];
      const idx = modes.indexOf(s.writebackMode);
      return { writebackMode: modes[(idx + 1) % modes.length] };
    }),

  theme: "auto",
  setTheme: (theme) => set({ theme }),

  workspaceRoot: "",
  setWorkspaceRoot: (workspaceRoot) =>
    set(() => {
      const { ids: nextExpanded } = loadExpandedState(workspaceRoot);
      const fileTabs = loadFileTabs(workspaceRoot);
      return { workspaceRoot, expandedNodeIds: nextExpanded, fileTabs };
    }),

  overlay: "none",
  overlayContext: null,
  openOverlay: (overlay, overlayContext = null) => set({ overlay, overlayContext }),
  closeOverlay: () => set({ overlay: "none", overlayContext: null }),
}));
