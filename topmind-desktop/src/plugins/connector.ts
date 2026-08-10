/**
 * Shared connector plugin helpers — keep weread/x (and future connectors)
 * on one lifecycle pattern without duplicating activate boilerplate.
 */
import type { Plugin, PluginContext, Slot } from "./types";
import type { AppSettings } from "../types";

export type ConnectorSlotFactory = (ctx: PluginContext) => Slot | Slot[];

export interface ConnectorActivateOptions {
  /** AppSettings key that holds { enabled: boolean, ... } */
  settingsKey: keyof AppSettings;
  /** Always registered (so users can configure while disabled). */
  settingsSlot: ConnectorSlotFactory;
  /** Registered only when enabled === true. */
  interactiveSlots: ConnectorSlotFactory[];
}

/**
 * Standard connector activate:
 * 1. Always register settings
 * 2. If settings[key].enabled, register interactive slots
 * @returns whether interactive slots were registered
 */
export async function activateConnector(
  ctx: PluginContext,
  opts: ConnectorActivateOptions,
): Promise<boolean> {
  const settingsSlot = opts.settingsSlot(ctx);
  for (const s of Array.isArray(settingsSlot) ? settingsSlot : [settingsSlot]) {
    ctx.register(s);
  }

  const settings = (await ctx.settings.get()) as AppSettings;
  const block = settings[opts.settingsKey] as { enabled?: boolean } | undefined;
  const enabled = Boolean(block?.enabled);
  if (!enabled) return false;

  for (const factory of opts.interactiveSlots) {
    const slots = factory(ctx);
    for (const s of Array.isArray(slots) ? slots : [slots]) {
      ctx.register(s);
    }
  }
  return true;
}

/** Build a Plugin that only needs manifest + connector activate options. */
export function defineConnectorPlugin(
  manifest: Plugin["manifest"],
  opts: ConnectorActivateOptions,
): Plugin {
  return {
    manifest,
    activate: async (ctx) => {
      await activateConnector(ctx, opts);
    },
  };
}
