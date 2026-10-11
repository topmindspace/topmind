/**
 * External plugin permission soft gates (not a sandbox).
 *
 * Builtin / first-party plugins are unrestricted.
 * External plugins declare permissions in topmind-plugin.json; the host
 * gates **only** `ctx.rpc.invoke` and `ctx.register(slot)`.
 *
 * Trust model = **trusted-by-install** (Obsidian-like): plugins load in the
 * same renderer as the app. A hostile plugin can still call
 * `window.topmind.invoke(...)` directly and bypass these gates. Permissions
 * are honest capability labels + soft host-context enforcement, not isolation.
 *
 * Enforced vocabulary:
 *   slot:dataSource | slot:view | slot:action | slot:settings |
 *   slot:overlay | slot:statusBar | slot:contextMenu | slot:*
 *   rpc:workspace | rpc:system | rpc:ai | rpc:tool | rpc:weread | rpc:x | rpc:*
 *
 * Reserved (declared in install preview only; not separately enforced):
 *   fs:read-workspace | fs:write-workspace | net:fetch
 *
 * Empty permissions on external plugins → minimal default: slot:action only
 * (no RPC via ctx). Declare what you need.
 */
import type { SlotKind } from "./types";

export const SLOT_KINDS = [
  "dataSource",
  "view",
  "action",
  "settings",
  "overlay",
  "statusBar",
  "contextMenu",
] as const satisfies readonly SlotKind[];

export const KNOWN_PERMISSIONS = new Set([
  ...SLOT_KINDS.map((k) => `slot:${k}`),
  "slot:*",
  "rpc:workspace",
  "rpc:system",
  "rpc:ai",
  "rpc:tool",
  "rpc:weread",
  "rpc:x",
  "rpc:*",
  "fs:read-workspace",
  "fs:write-workspace",
  "net:fetch",
]);

/** Minimal default when external plugin omits permissions. */
export const DEFAULT_EXTERNAL_PERMISSIONS = Object.freeze(["slot:action"] as const);

export type PermissionList = readonly string[];

/**
 * Normalize declared permissions for an external plugin.
 * Unknown tokens are kept (forward-compat) but documented ones are preferred.
 */
export function normalizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_EXTERNAL_PERMISSIONS];
  }
  const out: string[] = [];
  for (const item of raw) {
    const p = String(item || "").trim();
    if (!p) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out.length ? out : [...DEFAULT_EXTERNAL_PERMISSIONS];
}

/** Map RPC method "workspace.savePath" → permission "rpc:workspace". */
export function rpcPermissionForMethod(method: string): string {
  const domain = String(method || "").split(".")[0]?.trim() || "unknown";
  return `rpc:${domain}`;
}

export function hasPermission(permissions: PermissionList | null | undefined, need: string): boolean {
  // null/undefined = unrestricted (builtin)
  if (permissions == null) return true;
  if (permissions.includes(need)) return true;
  if (need.startsWith("rpc:") && permissions.includes("rpc:*")) return true;
  if (need.startsWith("slot:") && permissions.includes("slot:*")) return true;
  return false;
}

export function assertRpcAllowed(
  permissions: PermissionList | null | undefined,
  method: string,
): void {
  if (permissions == null) return;
  const need = rpcPermissionForMethod(method);
  if (!hasPermission(permissions, need)) {
    throw new Error(
      `Plugin permission denied: need "${need}" for ${method}. ` +
        `Declare it in topmind-plugin.json permissions.`,
    );
  }
}

/**
 * Whether a slot kind may be registered given permissions + optional declared slots list.
 * @param declaredSlots — manifest.slots; empty = any allowed by permissions
 */
export function canRegisterSlotKind(
  kind: SlotKind,
  permissions: PermissionList | null | undefined,
  declaredSlots?: readonly string[] | null,
): { ok: true } | { ok: false; reason: string } {
  if (permissions == null) return { ok: true };

  const need = `slot:${kind}`;
  if (!hasPermission(permissions, need)) {
    return {
      ok: false,
      reason: `need permission "${need}" (or slot:*) to register ${kind} slot`,
    };
  }

  if (declaredSlots && declaredSlots.length > 0) {
    const allowed = new Set(declaredSlots.map(String));
    if (!allowed.has(kind) && !allowed.has("*")) {
      return {
        ok: false,
        reason: `slot kind "${kind}" not in manifest.slots [${[...allowed].join(", ")}]`,
      };
    }
  }

  return { ok: true };
}
