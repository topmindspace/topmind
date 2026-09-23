/**
 * Custom protocol topmind-asset://local/<workspace-relative-path>
 * Serves note-local images (and other binary assets) into the renderer securely.
 *
 * registerSchemesAsPrivileged MUST run before app.ready.
 * registerMediaProtocolHandler runs after ready (and after workspace ctx exists).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolveUnderRoot } from "./platform.mjs";
import { assertPathWithin } from "./path-safety.mjs";
import { resolveDataRoot } from "./path-model.mjs";
import { logWarn } from "./writeback.mjs";

export const MEDIA_SCHEME = "topmind-asset";

/**
 * Call before app.ready.
 * @param {{ protocol: { registerSchemesAsPrivileged: Function } }} electron
 */
export function registerMediaSchemePrivileged(electron) {
  try {
    electron.protocol.registerSchemesAsPrivileged([
      {
        scheme: MEDIA_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
          bypassCSP: true,
        },
      },
    ]);
  } catch (e) {
    // Already registered (hot reload) — ignore
    logWarn("media-protocol", "registerSchemesAsPrivileged", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * @param {{ protocol: { handle: Function }, net: { fetch: Function } }} electron
 * @param {() => object | null} getCtx — returns current RPC ctx with workspaceRoot
 */
export function registerMediaProtocolHandler(electron, getCtx) {
  const { protocol, net } = electron;
  try {
    protocol.handle(MEDIA_SCHEME, async (request) => {
      try {
        const u = new URL(request.url);
        // topmind-asset://local/00-Inbox/images/foo/x.png
        // host = local, pathname = /00-Inbox/images/...
        let rel = decodeURIComponent((u.pathname || "").replace(/^\/+/u, ""));
        if (u.hostname && u.hostname !== "local" && u.hostname !== "") {
          // some URL parsers put first segment in hostname
          rel = path.posix.join(u.hostname, rel);
        }
        rel = rel.replace(/\\/gu, "/").replace(/^\/+/u, "");
        if (!rel || rel.includes("\0")) {
          return new Response("bad path", { status: 400 });
        }
        const ctx = typeof getCtx === "function" ? getCtx() : null;
        // getCtx may return WorkspaceContext or RPC ctx { workspaceRoot: WorkspaceContext }
        const ws =
          ctx && typeof ctx === "object" && ctx.userWorkspaceRoot
            ? ctx
            : ctx?.workspaceRoot;
        if (!ws) return new Response("no workspace", { status: 503 });
        const root = resolveDataRoot(ws);
        const abs = resolveUnderRoot(root, rel);
        await assertPathWithin(root, abs, { allowMissing: true });
        if (!existsSync(abs)) return new Response("not found", { status: 404 });
        return net.fetch(pathToFileURL(abs).href);
      } catch (e) {
        logWarn("media-protocol", "serve failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        return new Response("error", { status: 500 });
      }
    });
  } catch (e) {
    logWarn("media-protocol", "handle register failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
