/**
 * Plugin Host — builds PluginContext, activates plugins, wires
 * the local event bus to backend RPC events.
 *
 * Supports:
 * - Built-in plugins (statically imported via BUILTIN_PLUGINS registry, always loaded)
 * - Conditional slot registration based on settings (weread/x enabled flags)
 * - Runtime activate/deactivate for connector + external plugins
 * - External plugins from Desktop home `plugins/` (discover, enable/disable, hot reload)
 * - Plugin state tracking via PluginStore
 * - Builtin plugin protection (cannot be deactivated)
 */
import { useRegistry } from "./registry";
import { usePluginStore } from "../stores/plugin-store";
import { useAiStore } from "../stores/ai-store";
import { useViewStore } from "../stores/view-store";
import { api } from "../services/api";
import { invoke, subscribe } from "../services/rpc";
import i18n from "../locales";
import type { Plugin, PluginContext, PluginEventBus, PluginRpc, PluginManifest, Slot, SlotKind } from "./types";
import type { Selection, AppSettings } from "../types";
import type { LocalEventMap, LocalEventName } from "../lib/local-events";
import {
  assertRpcAllowed,
  canRegisterSlotKind,
  normalizePermissions,
  type PermissionList,
} from "./permissions";

// Local event bus — simple pub/sub. Backend events are bridged into this bus.
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

const eventBus: PluginEventBus = {
  on(event, handler) {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch {
        // Defensive: a broken handler shouldn't break the bus.
      }
    }
  },
};

// Bridge backend events into the local bus once at module load.
void (async () => {
  subscribe("workspace:file-changed", (p) => eventBus.emit("workspace:file-changed", p));
  subscribe("ai:stream", (p) => eventBus.emit("ai:stream", p));
  subscribe("overlay:open", (p) => eventBus.emit("overlay:open", p));
  subscribe("weread:sync-progress", (p) => eventBus.emit("weread:sync-progress", p));
  subscribe("weread:sync-done", (p) => eventBus.emit("weread:sync-done", p));
  subscribe("ingest:job-updated", (p) => eventBus.emit("ingest:job-updated", p));
  subscribe("ingest:queue-changed", (p) => eventBus.emit("ingest:queue-changed", p));
  subscribe("navigate:select", (p) => {
    eventBus.emit("navigate:select", p);
    try {
      const sel = p as import("../types").Selection;
      if (sel && typeof sel === "object" && "kind" in sel) {
        useViewStore.getState().select(sel);
      }
    } catch {
      /* ignore */
    }
  });
  subscribe("update:available", (p) => eventBus.emit("update:available", p));
  subscribe("clip-bridge:clipped", (p) => {
    eventBus.emit("clip-bridge:clipped", p);
    const clipPath =
      p && typeof p === "object" && "path" in p
        ? String((p as { path?: string }).path || "")
        : "";
    eventBus.emit("workspace:file-changed", {
      ...(p && typeof p === "object" ? p : {}),
      relativePath: clipPath || undefined,
      event: "add",
      source: "clip",
      listing: true,
    });
    eventBus.emit("toast:show", {
      text: clipPath
        ? i18n.t("common:clip.bridgeSuccess", { name: clipPath.split("/").slice(-1)[0] })
        : i18n.t("common:clip.bridgeSuccessNoPath"),
      kind: "success",
    });
  });
})();

const rpc: PluginRpc = {
  invoke: (method, params) => invoke(method, params),
  subscribe,
};

/** Track active plugins and their deactivation handlers. */
const activePlugins = new Map<string, { plugin: Plugin; unsubs: Array<() => void>; source: "builtin" | "external" }>();

/**
 * Cache of successfully imported external plugins (id → module).
 * Survives disable so re-enable does not always re-import (still cache-bust on reload).
 */
const externalCache = new Map<
  string,
  {
    plugin: Plugin;
    entryUrl: string;
    manifest: PluginManifest;
    permissions: string[];
    declaredSlots: string[];
  }
>();

/* ── Builtin Plugin Registry ──
 * A single source of truth for all built-in plugins. Adding a new plugin
 * means adding one entry here — activateAll() and togglePlugin() both
 * use this map, eliminating hardcoded ID checks. */

const BUILTIN_PLUGINS: ReadonlyArray<{ id: string; load: () => Promise<{ default: Plugin }> }> = [
  { id: "topmind-workspace", load: () => import("./topmind-workspace") },
  { id: "topmind-ingest", load: () => import("./topmind-ingest") },
  { id: "topmind-weread", load: () => import("./topmind-weread") },
  { id: "topmind-x", load: () => import("./topmind-x") },
  { id: "topmind-ledger", load: () => import("./topmind-ledger") },
];

const BUILTIN_IDS = new Set(BUILTIN_PLUGINS.map((p) => p.id));

/** Look up a plugin by ID in the builtin registry. */
async function loadPluginById(pluginId: string): Promise<Plugin | null> {
  const entry = BUILTIN_PLUGINS.find((p) => p.id === pluginId);
  if (!entry) return null;
  const mod = await entry.load();
  return mod.default;
}

export interface HostOptions {
  workspaceRoot: string;
}

type ContextGate = {
  /** null = unrestricted (builtin / first-party) */
  permissions: PermissionList | null;
  declaredSlots?: readonly string[] | null;
};

/** Build a PluginContext for a specific plugin. */
function buildContext(
  pluginId: string,
  workspaceRoot: string,
  gate: ContextGate = { permissions: null },
): PluginContext {
  const gatedRpc: PluginRpc = {
    invoke: (method, params) => {
      assertRpcAllowed(gate.permissions, method);
      return rpc.invoke(method, params);
    },
    subscribe: (event, handler) => rpc.subscribe(event, handler),
  };

  const register = (slot: Slot) => {
    const check = canRegisterSlotKind(
      slot.kind as SlotKind,
      gate.permissions,
      gate.declaredSlots,
    );
    if (!check.ok) {
  // eslint-disable-next-line no-console -- intentional error log for plugin registration failures
  console.error(`[plugins] ${pluginId}: blocked slot register — ${check.reason}`);
      throw new Error(`[${pluginId}] ${check.reason}`);
    }
    return useRegistry.getState().register(slot, pluginId);
  };

  return {
    rpc: gatedRpc,
    workspaceRoot,
    events: eventBus,
    ai: {
      invoke: (params) => {
        assertRpcAllowed(gate.permissions, "ai.invoke");
        return api.ai.invoke(params as never);
      },
      // Renderer-side AI context: plugins can pin files for the chat panel.
      mountFile: (_topicId, relativePath) => {
        const name = relativePath.split("/").pop() || relativePath;
        useAiStore.getState().mountFile({ path: relativePath, name });
      },
      unmountFile: (_topicId, relativePath) => {
        useAiStore.getState().unmountFile(relativePath);
      },
      runtimeStatus: () => {
        assertRpcAllowed(gate.permissions, "ai.runtimeStatus");
        return api.ai.status();
      },
    },
    settings: {
      get: () => {
        assertRpcAllowed(gate.permissions, "system.getSettings");
        return api.sys.settings();
      },
      update: (patch) => {
        assertRpcAllowed(gate.permissions, "system.updateSettings");
        return api.sys.update(patch);
      },
    },
    pluginId,
    register,
    openOverlay: (kind, context) => {
      eventBus.emit("overlay:open", { kind, ...context });
    },
    navigate: (selection: Selection) => {
      eventBus.emit("navigate:select", selection);
    },
    toast: (message: string | { text: string; kind?: "success" | "error" | "info" }) => {
      eventBus.emit("toast:show", message);
    },
  };
}

/** Activate a single plugin. Tracks slots for clean deactivation. */
export async function activatePlugin(
  plugin: Plugin,
  workspaceRoot: string,
  source: "builtin" | "external" = "builtin",
  gate?: ContextGate,
): Promise<void> {
  const id = plugin.manifest.id;

  // Skip if already active
  if (activePlugins.has(id)) return;

  const unsubs: Array<() => void> = [];
  // External: enforce permissions; first-party: unrestricted
  const resolvedGate: ContextGate =
    gate ??
    (source === "external"
      ? {
          permissions: normalizePermissions(
            (plugin as Plugin & { permissions?: string[] }).permissions ??
              externalCache.get(id)?.permissions,
          ),
          declaredSlots: externalCache.get(id)?.declaredSlots ?? null,
        }
      : { permissions: null });

  const ctx = buildContext(id, workspaceRoot, resolvedGate);

  // Wrap register to track unsubscribers
  const originalRegister = ctx.register;
  ctx.register = (slot: Slot) => {
    const unsub = originalRegister(slot);
    unsubs.push(unsub);
    return unsub;
  };

  try {
    await plugin.activate(ctx);
    activePlugins.set(id, { plugin, unsubs, source });
    usePluginStore.getState().upsertPlugin({
      id,
      manifest: plugin.manifest,
      status: "active",
    });
  } catch (err) {
  // eslint-disable-next-line no-console -- intentional error log for plugin activation failures
  console.error(`[plugins] ${id} activation failed:`, err);
    usePluginStore.getState().upsertPlugin({
      id,
      manifest: plugin.manifest,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Deactivate a single plugin. Unregisters all its slots.
 *  Builtin plugins cannot be deactivated — this is a no-op for them. */
export async function deactivatePlugin(pluginId: string): Promise<void> {
  // Block deactivation of builtin plugins
  const entry = activePlugins.get(pluginId);
  if (!entry) {
    // Still mark disabled in store if we know about it
    const known = usePluginStore.getState().getPlugin(pluginId);
    if (known && !known.manifest.builtin) {
      usePluginStore.getState().updateStatus(pluginId, "disabled");
    }
    return;
  }
  if (entry.plugin.manifest.builtin) return;

  try {
    await entry.plugin.deactivate?.();
  } catch {
    // Best-effort deactivation
  }

  // Unregister all slots via tracked unsubscribers
  for (const unsub of entry.unsubs) {
    try {
      unsub();
    } catch {
      /* best-effort */
    }
  }

  // Also clean up via registry's plugin map as a safety net
  useRegistry.getState().unregisterPlugin(pluginId);

  activePlugins.delete(pluginId);
  usePluginStore.getState().updateStatus(pluginId, "disabled");
}

/** Check if a plugin is currently active. */
export function isPluginActive(pluginId: string): boolean {
  return activePlugins.has(pluginId);
}

/** Check if a plugin is builtin (cannot be disabled). Only workspace is true-builtin. */
export function isPluginBuiltin(pluginId: string): boolean {
  if (pluginId === "topmind-workspace") return true;
  const entry = activePlugins.get(pluginId);
  if (entry?.plugin.manifest.builtin) return true;
  const known = usePluginStore.getState().getPlugin(pluginId);
  return Boolean(known?.manifest.builtin);
}

/** Whether settings allow this external plugin id (missing key = enabled). */
export function isExternalEnabledInSettings(
  pluginId: string,
  settings: Pick<AppSettings, "plugins"> | null | undefined,
): boolean {
  const map = settings?.plugins?.externalEnabled;
  if (!map || typeof map !== "object") return true;
  return map[pluginId] !== false;
}

/**
 * Import an external plugin module from a file URL.
 * @param cacheBust — force re-read from disk (hot reload after file change)
 */
async function importExternalPlugin(
  ext: {
    id: string;
    entryUrl: string;
    manifest: {
      id?: string;
      name?: string;
      version?: string;
      description?: string;
      permissions?: string[];
      slots?: string[];
    } | null;
  },
  opts?: { cacheBust?: boolean },
): Promise<
  | {
      plugin: Plugin;
      entryUrl: string;
      permissions: string[];
      declaredSlots: string[];
    }
  | { error: string }
> {
  const baseUrl = ext.entryUrl;
  const url = opts?.cacheBust ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${Date.now()}` : baseUrl;
  try {
    // @vite-ignore — absolute file URL from Desktop plugins dir (not bundled)
    const mod = await import(/* @vite-ignore */ url);
    const plugin = (mod.default || mod.plugin || mod) as Plugin;
    if (!plugin?.manifest?.id || typeof plugin.activate !== "function") {
      return { error: "entry must default-export { manifest, activate }" };
    }
    plugin.manifest = {
      ...plugin.manifest,
      id: plugin.manifest.id || ext.id,
      name: plugin.manifest.name || ext.manifest?.name || ext.id,
      version: plugin.manifest.version || ext.manifest?.version || "0.0.0",
      description: plugin.manifest.description || ext.manifest?.description,
      builtin: false,
    };
    const permissions = normalizePermissions(ext.manifest?.permissions);
    const declaredSlots = Array.isArray(ext.manifest?.slots)
      ? ext.manifest!.slots!.map(String)
      : [];
    return { plugin, entryUrl: baseUrl, permissions, declaredSlots };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function upsertDisabledExternal(
  id: string,
  manifest: PluginManifest,
  reason?: string,
): void {
  usePluginStore.getState().upsertPlugin({
    id,
    manifest: { ...manifest, builtin: false },
    status: "disabled",
    error: reason,
  });
}

/**
 * Load third-party plugins discovered under Desktop home `plugins/`.
 * Each folder must have topmind-plugin.json + ESM entry exporting `{ default: Plugin }`.
 * Failures are isolated — one bad plugin never blocks builtins.
 * Respects settings.plugins.externalEnabled and manifest.enabled.
 */
async function activateExternalPlugins(
  workspaceRoot: string,
  opts?: { cacheBust?: boolean },
): Promise<void> {
  let settings: AppSettings | null = null;
  try {
    settings = (await api.sys.settings()) as AppSettings;
  } catch {
    settings = null;
  }

  try {
    const listed = await api.sys.listExternalPlugins();
    const plugins = listed.plugins || [];

    await Promise.all(
      plugins.map(async (ext) => {
        const id = ext.id;
        const baseManifest: PluginManifest = {
          id,
          name: ext.manifest?.name || id,
          version: ext.manifest?.version || "0.0.0",
          description: ext.manifest?.description,
          builtin: false,
        };

        if (ext.status !== "ready" || !ext.entryUrl) {
          usePluginStore.getState().upsertPlugin({
            id,
            manifest: baseManifest,
            status: "error",
            error: ext.error || ext.status || "not ready",
          });
          externalCache.delete(id);
          return;
        }

        // Manifest-level kill switch
        if (ext.manifest?.enabled === false) {
          if (activePlugins.has(id)) await deactivatePlugin(id);
          upsertDisabledExternal(id, baseManifest, "manifest.enabled=false");
          return;
        }

        // User settings kill switch (missing key = on)
        if (!isExternalEnabledInSettings(id, settings)) {
          if (activePlugins.has(id)) await deactivatePlugin(id);
          upsertDisabledExternal(id, baseManifest);
          return;
        }

        // Already active — skip re-import unless cache bust
        if (activePlugins.has(id) && !opts?.cacheBust) return;

        if (activePlugins.has(id)) {
          await deactivatePlugin(id);
        }

        let loaded = externalCache.get(id);
        if (!loaded || opts?.cacheBust || loaded.entryUrl !== ext.entryUrl) {
          const result = await importExternalPlugin(
            { id, entryUrl: ext.entryUrl, manifest: ext.manifest },
            { cacheBust: opts?.cacheBust },
          );
          if ("error" in result) {
            usePluginStore.getState().upsertPlugin({
              id,
              manifest: baseManifest,
              status: "error",
              error: result.error,
            });
            externalCache.delete(id);
            return;
          }
          loaded = {
            plugin: result.plugin,
            entryUrl: result.entryUrl,
            manifest: result.plugin.manifest,
            permissions: result.permissions,
            declaredSlots: result.declaredSlots,
          };
          externalCache.set(id, loaded);
        }

        await activatePlugin(loaded.plugin, workspaceRoot, "external", {
          permissions: loaded.permissions,
          declaredSlots: loaded.declaredSlots,
        });
      }),
    );

    // Remove store entries for external plugins that vanished from disk
    const discoveredIds = new Set(plugins.map((p) => p.id));
    for (const state of usePluginStore.getState().plugins) {
      if (BUILTIN_IDS.has(state.id)) continue;
      if (state.manifest.builtin) continue;
      if (discoveredIds.has(state.id)) continue;
      // Was external, folder gone
      if (activePlugins.has(state.id)) await deactivatePlugin(state.id);
      usePluginStore.getState().removePlugin(state.id);
      externalCache.delete(state.id);
    }
  } catch {
    // Discovery optional — missing dir / RPC failure is fine
  }
}

/** Activate all built-in plugins.
 *  Workspace first (navigation surface), then connectors in parallel.
 *  Connectors self-regulate slots from settings.
 *  Then external plugins from ~/topmind/topmind-desktop/plugins/. */
export async function activateAll(opts: HostOptions): Promise<void> {
  const workspace = BUILTIN_PLUGINS.find((p) => p.id === "topmind-workspace");
  const connectors = BUILTIN_PLUGINS.filter((p) => p.id !== "topmind-workspace");

  if (workspace) {
    const mod = await workspace.load();
    await activatePlugin(mod.default, opts.workspaceRoot, "builtin");
  }

  await Promise.all(
    connectors.map(async ({ load }) => {
      const mod = await load();
      await activatePlugin(mod.default, opts.workspaceRoot, "builtin");
    }),
  );

  await activateExternalPlugins(opts.workspaceRoot);

  eventBus.emit("plugins:state-ready", null);
}

/**
 * Re-scan plugins/ and apply enable flags without restarting the app.
 * Deactivates removed/disabled externals; activates new/enabled ones.
 */
export async function reloadExternalPlugins(
  workspaceRoot: string,
  opts?: { cacheBust?: boolean },
): Promise<void> {
  // Drop active externals first so re-import is clean when cacheBust
  const toDrop: string[] = [];
  for (const [id, entry] of activePlugins) {
    if (entry.source === "external" || (!BUILTIN_IDS.has(id) && !entry.plugin.manifest.builtin)) {
      toDrop.push(id);
    }
  }
  for (const id of toDrop) {
    await deactivatePlugin(id);
  }
  if (opts?.cacheBust !== false) {
    // Default: bust module cache so disk edits are picked up
    externalCache.clear();
  }
  await activateExternalPlugins(workspaceRoot, { cacheBust: opts?.cacheBust !== false });
  eventBus.emit("plugins:state-ready", null);
  eventBus.emit("plugins:settings-changed", null);
}

/**
 * Enable or disable one external plugin at runtime (does not write settings).
 * Caller should persist `settings.plugins.externalEnabled[id]` first.
 */
export async function setExternalPluginEnabled(
  pluginId: string,
  enabled: boolean,
  workspaceRoot: string,
): Promise<void> {
  if (isPluginBuiltin(pluginId)) return;
  if (BUILTIN_IDS.has(pluginId)) return;

  if (!enabled) {
    await deactivatePlugin(pluginId);
    const known = usePluginStore.getState().getPlugin(pluginId);
    if (known) {
      usePluginStore.getState().updateStatus(pluginId, "disabled");
    } else {
      usePluginStore.getState().upsertPlugin({
        id: pluginId,
        manifest: { id: pluginId, name: pluginId, version: "0.0.0", builtin: false },
        status: "disabled",
      });
    }
    eventBus.emit("plugins:settings-changed", null);
    return;
  }

  // Enable: try cache / re-import single plugin
  if (activePlugins.has(pluginId)) return;

  let loaded = externalCache.get(pluginId);
  if (!loaded) {
    try {
      const listed = await api.sys.listExternalPlugins();
      const ext = (listed.plugins || []).find((p) => p.id === pluginId);
      if (!ext || ext.status !== "ready" || !ext.entryUrl) {
        usePluginStore.getState().upsertPlugin({
          id: pluginId,
          manifest: {
            id: pluginId,
            name: ext?.manifest?.name || pluginId,
            version: ext?.manifest?.version || "0.0.0",
            builtin: false,
          },
          status: "error",
          error: ext?.error || "plugin not found or not ready",
        });
        return;
      }
      if (ext.manifest?.enabled === false) {
        upsertDisabledExternal(
          pluginId,
          {
            id: pluginId,
            name: ext.manifest.name || pluginId,
            version: ext.manifest.version || "0.0.0",
            builtin: false,
          },
          "manifest.enabled=false",
        );
        return;
      }
      const result = await importExternalPlugin(
        { id: pluginId, entryUrl: ext.entryUrl, manifest: ext.manifest },
        { cacheBust: true },
      );
      if ("error" in result) {
        usePluginStore.getState().upsertPlugin({
          id: pluginId,
          manifest: {
            id: pluginId,
            name: ext.manifest?.name || pluginId,
            version: ext.manifest?.version || "0.0.0",
            builtin: false,
          },
          status: "error",
          error: result.error,
        });
        return;
      }
      loaded = {
        plugin: result.plugin,
        entryUrl: result.entryUrl,
        manifest: result.plugin.manifest,
        permissions: result.permissions,
        declaredSlots: result.declaredSlots,
      };
      externalCache.set(pluginId, loaded);
    } catch (err) {
      usePluginStore.getState().upsertPlugin({
        id: pluginId,
        manifest: { id: pluginId, name: pluginId, version: "0.0.0", builtin: false },
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  await activatePlugin(loaded.plugin, workspaceRoot, "external", {
    permissions: loaded.permissions,
    declaredSlots: loaded.declaredSlots,
  });
  eventBus.emit("plugins:settings-changed", null);
}

/** Toggle a connector plugin on/off at runtime.
 *  Deactivates then re-activates so the plugin reads fresh settings
 *  and registers/unregisters interactive slots accordingly.
 *  Uses a per-plugin lock to prevent race conditions from rapid toggles.
 *  Builtin plugins are protected — toggle is a no-op for them.
 *  External plugins re-import from cache / disk. */
const toggleLocks = new Set<string>();

export async function togglePlugin(pluginId: string, workspaceRoot: string): Promise<void> {
  // Workspace (and any manifest.builtin) cannot be toggled off
  if (isPluginBuiltin(pluginId)) return;

  // Prevent overlapping toggles for the same plugin
  if (toggleLocks.has(pluginId)) return;
  toggleLocks.add(pluginId);

  try {
    // Always deactivate first to clean up all slots
    await deactivatePlugin(pluginId);

    // First-party connectors (weread/x): re-activate from static registry
    const firstParty = await loadPluginById(pluginId);
    if (firstParty) {
      await activatePlugin(firstParty, workspaceRoot, "builtin");
      eventBus.emit("plugins:settings-changed", null);
      return;
    }

    // External: only re-activate if settings still allow
    let settings: AppSettings | null = null;
    try {
      settings = (await api.sys.settings()) as AppSettings;
    } catch {
      settings = null;
    }
    if (!isExternalEnabledInSettings(pluginId, settings)) {
      eventBus.emit("plugins:settings-changed", null);
      return;
    }
    await setExternalPluginEnabled(pluginId, true, workspaceRoot);
  } finally {
    toggleLocks.delete(pluginId);
  }
}

export function emitLocal<K extends LocalEventName>(
  event: K,
  payload?: LocalEventMap[K],
): void {
  eventBus.emit(event, payload);
}

export function onLocal<K extends LocalEventName>(
  event: K,
  handler: (payload: LocalEventMap[K]) => void,
): () => void {
  return eventBus.on(event, handler as (payload: unknown) => void);
}
