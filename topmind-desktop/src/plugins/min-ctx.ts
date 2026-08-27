/**
 * Shared minimal PluginContext factory for ActionSlot.run() calls invoked from
 * Skill-launching surfaces (CommandPalette). These surfaces run an
 * Action without going through a real plugin activation flow, so they need a
 * pre-built ctx that wires RPC/events to the real plumbing but leaves
 * per-action hooks no-op. Passing workspaceRoot lets an action inspect its
 * workspace (e.g. skills that need the engine root).
 */
import { invoke, subscribe } from "../services/rpc";
import { emitLocal, onLocal } from "./host";
import type { PluginContext } from "./types";
import type { Selection } from "../types";

export function makeMinCtx(workspaceRoot?: string): PluginContext {
  return {
    rpc: { invoke, subscribe },
    workspaceRoot: workspaceRoot ?? "",
    events: { emit: emitLocal, on: onLocal },
    ai: { invoke: () => Promise.resolve(), mountFile: () => {}, unmountFile: () => {}, runtimeStatus: () => Promise.resolve(null) },
    settings: { get: () => Promise.resolve({}), update: () => Promise.resolve({}) },
    register: () => () => {},
    pluginId: "__min_ctx__",
    openOverlay: (kind, context) => emitLocal("overlay:open", { kind, ...context }),
    navigate: (selection: Selection) => emitLocal("navigate:select", selection),
    toast: (message: string | { text: string; kind?: "success" | "error" | "info" }) =>
      emitLocal("toast:show", message),
  };
}
