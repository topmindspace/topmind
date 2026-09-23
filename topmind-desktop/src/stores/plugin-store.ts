/**
 * Plugin Store — tracks plugin lifecycle state (active/disabled/error).
 * Used by the Plugins settings panel and sidebar plugin section.
 */
import { create } from "zustand";
import type { PluginState } from "../plugins/types";

interface PluginStoreState {
  plugins: PluginState[];
  setPlugins: (plugins: PluginState[]) => void;
  upsertPlugin: (state: PluginState) => void;
  updateStatus: (id: string, status: PluginState["status"], error?: string) => void;
  removePlugin: (id: string) => void;
  getPlugin: (id: string) => PluginState | undefined;
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  plugins: [],

  setPlugins: (plugins) => set({ plugins }),

  upsertPlugin: (pluginState) =>
    set((s) => {
      const exists = s.plugins.some((p) => p.id === pluginState.id);
      return {
        plugins: exists
          ? s.plugins.map((p) => (p.id === pluginState.id ? pluginState : p))
          : [...s.plugins, pluginState],
      };
    }),

  updateStatus: (id, status, error) =>
    set((s) => ({
      plugins: s.plugins.map((p) =>
        p.id === id ? { ...p, status, error } : p,
      ),
    })),

  removePlugin: (id) =>
    set((s) => ({
      plugins: s.plugins.filter((p) => p.id !== id),
    })),

  getPlugin: (id) => get().plugins.find((p) => p.id === id),
}));
