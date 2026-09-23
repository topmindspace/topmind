/**
 * ConnectorBridge — shared helpers for Desktop connector services (weread / x / future).
 *
 * A connector service is an object of RPC methods `(params, ctx) => result` that
 * syncs an external source into the workspace. This module extracts the common
 * contract so each service only implements its API specifics:
 *
 * - settings access with secret hydration (`loadConnectorSettings`)
 * - persisted per-connector settings patches (`persistConnectorPatch`)
 * - durable note writes through the kernel write gate (`writeConnectorNote`)
 * - throttle helper (`sleep`)
 *
 * Category resolution stays in `connector-category.mjs` (already shared).
 */
import { loadAppSettings, updateAppSettings } from "../settings.mjs";
import { kernelDurableWriteAbs } from "./kernel-api.mjs";
import { injectFrontmatter } from "./frontmatter.mjs";

/** Secret adapter carried on the RPC ctx (safeStorage-backed), or null. */
export function secretAdapterFromCtx(ctx) {
  return ctx?.secretAdapter || null;
}

/** Load app settings with connector secrets hydrated from the secret store. */
export async function loadConnectorSettings(ctx) {
  return loadAppSettings(
    ctx.workspaceStatePaths.settingsFilePath,
    ctx.workspaceRoot?.userWorkspaceRoot || "",
    { secretAdapter: secretAdapterFromCtx(ctx) },
  );
}

/**
 * Merge a patch into one connector's settings section (e.g. key "weread")
 * and refresh the in-memory settings snapshot when the host exposes it.
 */
export async function persistConnectorPatch(ctx, connectorKey, patch) {
  const current = await loadConnectorSettings(ctx);
  await updateAppSettings(
    ctx.workspaceStatePaths.settingsFilePath,
    current,
    { [connectorKey]: patch },
    { secretAdapter: secretAdapterFromCtx(ctx) },
  );
  if (typeof ctx.updateAppSettingsInMemory === "function") {
    const updated = await loadConnectorSettings(ctx);
    ctx.updateAppSettingsInMemory(updated);
  }
}

/**
 * Durable connector note write: frontmatter injection + kernel write gate
 * (actor user, confirmed). `operation` is "create" | "update".
 */
export async function writeConnectorNote(ctx, { absPath, body, frontmatter, operation = "update" }) {
  await kernelDurableWriteAbs(
    { absPath, content: injectFrontmatter(body, frontmatter) },
    ctx,
    { actor: "user", confirmed: true, operation, frontmatter },
  );
}

/** Throttle helper for paginated external APIs. */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
