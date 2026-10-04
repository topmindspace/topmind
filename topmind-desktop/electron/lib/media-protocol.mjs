/**
 * Custom protocol topmind-asset://
 *   local/<workspace-relative-path>  — note-local images / binaries
 *   remote/<url-encoded-http-url>    — proxied remote images (CSP-safe + cached)
 *
 * registerSchemesAsPrivileged MUST run before app.ready.
 * registerMediaProtocolHandler runs after ready (and after workspace ctx exists).
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { existsSync, promises as fs } from "node:fs";
import { resolveUnderRoot } from "./platform.mjs";
import { assertPathWithin } from "./path-safety.mjs";
import { resolveDataRoot } from "./path-model.mjs";
import { logWarn } from "./writeback.mjs";
import { rememberDesktopFetchMedia } from "./runtime-bounds.mjs";

export const MEDIA_SCHEME = "topmind-asset";
const REMOTE_CACHE_DIR = ".topmind/media-cache";
const REMOTE_MAX_BYTES = 15 * 1024 * 1024;

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
        // topmind-asset://remote/<url-encoded remote http(s) URL>
        if (u.hostname === "remote") {
          return await serveRemoteImage(u, getCtx, net);
        }
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

/**
 * Proxy remote images through topmind-asset://remote/…
 * - keeps renderer CSP tight (img-src topmind-asset: only would suffice)
 * - caches under workspace .topmind/media-cache so captures persist offline
 * @param {URL} u
 * @param {() => object | null} getCtx
 * @param {{ fetch: Function }} net
 */
async function serveRemoteImage(u, getCtx, net) {
  const raw = decodeURIComponent((u.pathname || "").replace(/^\/+/u, ""));
  if (!raw || !/^https?:\/\//iu.test(raw)) {
    return new Response("bad remote url", { status: 400 });
  }
  let remoteUrl;
  try {
    remoteUrl = new URL(raw);
  } catch {
    return new Response("bad remote url", { status: 400 });
  }
  if (remoteUrl.protocol !== "http:" && remoteUrl.protocol !== "https:") {
    return new Response("bad scheme", { status: 400 });
  }

  const ctx = typeof getCtx === "function" ? getCtx() : null;
  const ws =
    ctx && typeof ctx === "object" && ctx.userWorkspaceRoot
      ? ctx
      : ctx?.workspaceRoot;
  const root = ws ? resolveDataRoot(ws) : null;
  const cacheDir = root ? path.join(root, REMOTE_CACHE_DIR) : null;
  const key = createHash("sha1").update(remoteUrl.href).digest("hex");
  const cachePath = cacheDir ? path.join(cacheDir, key) : null;

  if (cachePath && existsSync(cachePath)) {
    try {
      return net.fetch(pathToFileURL(cachePath).href);
    } catch {
      /* fall through to network */
    }
  }

  const res = await net.fetch(remoteUrl.href, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: remoteUrl.origin + "/",
    },
    redirect: "follow",
  });
  if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) {
    return new Response("not image", { status: 502 });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > REMOTE_MAX_BYTES) {
    return new Response("bad size", { status: 502 });
  }
  rememberDesktopFetchMedia({ id: cachePath || remoteUrl.href, bytes: buf.length });

  if (cachePath) {
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachePath, buf);
    } catch {
      /* cache is best-effort */
    }
  }

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": ct || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/** Build a CSP-safe topmind-asset remote proxy URL for a remote image. */
export function remoteAssetUrl(href) {
  const h = String(href || "").trim();
  if (!/^https?:\/\//iu.test(h)) return h;
  return `${MEDIA_SCHEME}://remote/${encodeURIComponent(h)}`;
}
