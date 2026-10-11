/**
 * Plugin Registry — single in-memory store for all registered slots.
 * Shell components subscribe to registry state via `useRegistry` hook.
 */
import { create } from "zustand";
import type {
  DataSourceSlot, ViewSlot, ActionSlot,
  SettingsSlot, OverlaySlot, StatusBarSlot, ContextMenuSlot,
  Slot,
} from "./types";
import type { Selection } from "../types";

interface RegistryState {
  dataSources: DataSourceSlot[];
  viewSlots: ViewSlot[];
  actions: ActionSlot[];
  settingsSlots: SettingsSlot[];
  overlaySlots: OverlaySlot[];
  statusBarSlots: StatusBarSlot[];
  contextMenuSlots: ContextMenuSlot[];
  /** Track which plugin registered which slots (for clean deactivation). */
  pluginSlotMap: Map<string, Set<string>>;
  register: (slot: Slot, pluginId?: string) => () => void;
  unregister: (id: string) => void;
  unregisterPlugin: (pluginId: string) => void;
  resolveView: (sel: Selection) => ViewSlot | null;
  resolveOverlay: (kind: string) => OverlaySlot | null;
}

const DEFAULT_ORDER = 100;

function sortByOrder<T extends { order?: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
}

function removeFrom<T extends { id: string }>(arr: T[], id: string): T[] {
  return arr.filter((s) => s.id !== id);
}

export const useRegistry = create<RegistryState>((set, get) => ({
  dataSources: [],
  viewSlots: [],
  actions: [],
  settingsSlots: [],
  overlaySlots: [],
  statusBarSlots: [],
  contextMenuSlots: [],
  pluginSlotMap: new Map(),

  register: (slot, pluginId?) => {
    const id = slot.id;
    const pid = pluginId ?? slot.pluginId;
    const normalized = { ...slot, order: slot.order ?? DEFAULT_ORDER, pluginId: pid };

    set((state) => {
      // Track slot → plugin mapping
      const map = new Map(state.pluginSlotMap);
      if (pid) {
        const slotSet = map.get(pid) ?? new Set<string>();
        slotSet.add(id);
        map.set(pid, slotSet);
      }

      switch (slot.kind) {
        case "dataSource":
          return { pluginSlotMap: map, dataSources: sortByOrder([...removeFrom(state.dataSources, id), normalized as DataSourceSlot]) };
        case "view":
          return { pluginSlotMap: map, viewSlots: sortByOrder([...removeFrom(state.viewSlots, id), normalized as ViewSlot]) };
        case "action":
          return { pluginSlotMap: map, actions: sortByOrder([...removeFrom(state.actions, id), normalized as ActionSlot]) };
        case "settings":
          return { pluginSlotMap: map, settingsSlots: sortByOrder([...removeFrom(state.settingsSlots, id), normalized as SettingsSlot]) };
        case "overlay":
          return { pluginSlotMap: map, overlaySlots: sortByOrder([...removeFrom(state.overlaySlots, id), normalized as OverlaySlot]) };
        case "statusBar":
          return { pluginSlotMap: map, statusBarSlots: sortByOrder([...removeFrom(state.statusBarSlots, id), normalized as StatusBarSlot]) };
        case "contextMenu":
          return { pluginSlotMap: map, contextMenuSlots: sortByOrder([...removeFrom(state.contextMenuSlots, id), normalized as ContextMenuSlot]) };
      }
    });

    return () => get().unregister(id);
  },

  unregister: (id) => {
    set((state) => ({
      dataSources: removeFrom(state.dataSources, id),
      viewSlots: removeFrom(state.viewSlots, id),
      actions: removeFrom(state.actions, id),
      settingsSlots: removeFrom(state.settingsSlots, id),
      overlaySlots: removeFrom(state.overlaySlots, id),
      statusBarSlots: removeFrom(state.statusBarSlots, id),
      contextMenuSlots: removeFrom(state.contextMenuSlots, id),
    }));
  },

  unregisterPlugin: (pluginId) => {
    const slotIds = get().pluginSlotMap.get(pluginId);
    if (!slotIds) return;
    for (const id of slotIds) {
      get().unregister(id);
    }
    set((state) => {
      const map = new Map(state.pluginSlotMap);
      map.delete(pluginId);
      return { pluginSlotMap: map };
    });
  },

  resolveView: (sel) => {
    const slots = get().viewSlots;
    for (const slot of slots) {
      try {
        if (slot.matches(sel)) return slot;
      } catch {
        // Defensive: a broken matches() shouldn't break view resolution.
      }
    }
    return null;
  },

  resolveOverlay: (kind) => {
    const slots = get().overlaySlots;
    for (const slot of slots) {
      try {
        if (slot.matches(kind)) return slot;
      } catch {
        // Defensive
      }
    }
    return null;
  },
}));

/** Read-only accessors for non-React code (e.g. command palette builder). */
export const registry = {
  dataSources: () => useRegistry.getState().dataSources,
  viewSlots: () => useRegistry.getState().viewSlots,
  actions: () => useRegistry.getState().actions,
  settingsSlots: () => useRegistry.getState().settingsSlots,
  overlaySlots: () => useRegistry.getState().overlaySlots,
  statusBarSlots: () => useRegistry.getState().statusBarSlots,
  contextMenuSlots: () => useRegistry.getState().contextMenuSlots,
  resolveView: (sel: Selection) => useRegistry.getState().resolveView(sel),
  resolveOverlay: (kind: string) => useRegistry.getState().resolveOverlay(kind),
};
