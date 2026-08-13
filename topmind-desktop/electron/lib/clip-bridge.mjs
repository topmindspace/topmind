/**
 * Clip Bridge — loopback HTTP API for browser extensions.
 *
 * Security:
 *  - Bind 127.0.0.1 only
 *  - Bearer token auth
 *  - Optional (off by default)
 *  - Body size cap
 *
 * See docs/adr/2026-07-13-browser-clip-extension.md
 */
import http from "node:http";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { logInfo, logWarn, logError } from "./writeback.mjs";
import { normalizeClipPayload } from "./clip-payload.mjs";
import { clipImageSlug, localizeMarkdownImages } from "./clip-images.mjs";
import { applyArticleTemplate } from "./clip-templates.mjs";
import { CLIP_DEST_MODES } from "./clip-dest-modes.mjs";

export const CLIP_BRIDGE_DEFAULT_PORT = 19827;
export const CLIP_BRIDGE_MAX_BODY = 2_000_000;

/** @type {http.Server | null} */
let server = null;
/** @type {{ port: number, token: string } | null} */
let live = null;

export function generateClipToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * Public status — never include the bearer token (use settings UI for copy).
 * @returns {{ running: boolean, port: number | null }}
 */
export function getClipBridgeLive() {
  return live
    ? { running: true, port: live.port }
    : { running: false, port: null };
}

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.token
 * @param {() => object | null} opts.getContext — RPC context with workspaceRoot
 * @param {(params: object, ctx: object) => Promise<unknown>} opts.ingest
 * @param {(ctx: object) => Promise<object>} [opts.listDestinations]
 * @param {(event: string, payload?: unknown) => void} [opts.emit]
 */
export async function startClipBridge(opts) {
  const port = clampPort(opts.port);
  const token = String(opts.token || "").trim();
  if (!token) throw new Error("clip bridge token required");

  await stopClipBridge();

  const srv = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        token,
        getContext: opts.getContext,
        ingest: opts.ingest,
        listDestinations: opts.listDestinations,
        emit: opts.emit,
      });
    } catch (e) {
      logError("clip-bridge", "request failed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) {
        json(res, 500, { ok: false, error: "internal_error" }, req);
      }
    }
  });

  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve());
  });

  server = srv;
  live = { port, token };
  logInfo("clip-bridge", "listening", { port: `127.0.0.1:${port}` });
  return getClipBridgeLive();
}

export async function stopClipBridge() {
  if (!server) {
    live = null;
    return { running: false };
  }
  const s = server;
  server = null;
  live = null;
  // Close idle keep-alives, await real close; closeAllConnections after close
  // starts sweeps any still-active sockets (order matters on Windows — the
  // reverse raced the closing handle: UV_HANDLE_CLOSING).
  s.closeIdleConnections?.();
  await new Promise((resolve) => {
    s.close(() => resolve());
    s.closeAllConnections?.();
  });
  logInfo("clip-bridge", "stopped");
  return { running: false };
}

function clampPort(p) {
  const n = Number(p) || CLIP_BRIDGE_DEFAULT_PORT;
  return Math.max(1024, Math.min(65535, Math.round(n)));
}

/** Allow browser-extension origins only (loopback bridge is not a public API). */
function corsOrigin(req) {
  const origin = String(req?.headers?.origin || "");
  if (!origin) return "null";
  if (/^chrome-extension:\/\//iu.test(origin)) return origin;
  if (/^moz-extension:\/\//iu.test(origin)) return origin;
  if (/^safari-web-extension:\/\//iu.test(origin)) return origin;
  // Dev file:// / null origin from some hosts
  if (origin === "null") return "null";
  return "null";
}

function corsHeaders(req) {
  return {
    "Access-Control-Allow-Origin": corsOrigin(req),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

function json(res, status, body, req = null) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
    ...corsHeaders(req),
  });
  res.end(raw);
}

function unauthorized(res, req = null) {
  json(res, 401, { ok: false, error: "unauthorized" }, req);
}

function readBody(req, maxLen) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxLen) {
        reject(Object.assign(new Error("body_too_large"), { code: "body_too_large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function checkAuth(req, token) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(\S+)/iu.exec(h);
  if (!m) return false;
  try {
    const a = Buffer.from(m[1]);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function handleRequest(req, res, deps) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/u, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (path === "/v1/health" || path === "/health")) {
    const ctx = deps.getContext?.();
    const ready = Boolean(ctx?.workspaceRoot);
    json(res, 200, {
      ok: true,
      service: "topmind-clip-bridge",
      version: 2,
      workspaceReady: ready,
      features: ["destinations", "templates", "images"],
    }, req);
    return;
  }

  if (req.method === "GET" && path === "/v1/destinations") {
    if (!checkAuth(req, deps.token)) {
      unauthorized(res, req);
      return;
    }
    const ctx = deps.getContext?.();
    if (!ctx?.workspaceRoot) {
      json(res, 503, { ok: false, error: "workspace_not_ready" }, req);
      return;
    }
    try {
      const data = deps.listDestinations
        ? await deps.listDestinations(ctx)
        : { inbox: true, categories: [], topics: [] };
      json(res, 200, { ok: true, ...data }, req);
    } catch (e) {
      logWarn("clip-bridge", "destinations failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      json(res, 500, { ok: false, error: "destinations_failed" }, req);
    }
    return;
  }

  if (req.method === "POST" && path === "/v1/clip") {
    if (!checkAuth(req, deps.token)) {
      unauthorized(res, req);
      return;
    }
    const ctx = deps.getContext?.();
    if (!ctx?.workspaceRoot) {
      json(res, 503, { ok: false, error: "workspace_not_ready" }, req);
      return;
    }

    let raw;
    try {
      raw = await readBody(req, CLIP_BRIDGE_MAX_BODY);
    } catch (e) {
      if (e?.code === "body_too_large") {
        json(res, 413, { ok: false, error: "body_too_large" }, req);
        return;
      }
      throw e;
    }

    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, 400, { ok: false, error: "invalid_json" }, req);
      return;
    }

    // Prefer content_html (Readability fragment) → Desktop html-to-markdown;
    // plain content / selection remain valid fallbacks.
    const normalized = normalizeClipPayload(body);
    if (!normalized.content?.trim()) {
      json(res, 400, { ok: false, error: "content_required" }, req);
      return;
    }

    let content = normalized.content;
    let title = normalized.title;
    let imagesMeta = null;

    // Article / readability: apply template AFTER conversion (body uses clean MD)
    const plainModes = new Set(["selection", "highlights", "bookmark"]);
    if (!plainModes.has(normalized.method) && body?.apply_template !== false) {
      try {
        const custom = Array.isArray(body?.custom_templates) ? body.custom_templates : [];
        const applied = applyArticleTemplate(
          content,
          {
            title,
            source: normalized.source,
            author: normalized.frontmatter?.author || body?.author,
            published: normalized.frontmatter?.published || body?.published,
            site_name: normalized.frontmatter?.site_name || body?.site_name,
            selection: body?.selection,
            excerpt: body?.excerpt,
            method: normalized.method,
          },
          {
            templateId: body?.template_id || normalized.frontmatter?.clip_template,
            customTemplates: custom,
          },
        );
        content = applied.content;
        title = applied.title || title;
        normalized.frontmatter = {
          ...normalized.frontmatter,
          ...Object.fromEntries(
            Object.entries(applied.properties || {}).filter(
              ([k]) => !["source_type", "title", "captured_at"].includes(k),
            ),
          ),
          clip_template: applied.templateId,
        };
      } catch (e) {
        logWarn("clip-bridge", "template apply failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const dest = resolveClipDest(body?.dest);
    const wantImages =
      body?.download_images !== false &&
      ctx.appSettings?.clipBridge?.downloadImages !== false &&
      !plainModes.has(normalized.method);
    // Localize whenever article mode wants images and body has any markdown image.
    // Relative / protocol-relative URLs are resolved via page source (baseUrl).
    if (wantImages && /!\[[^\]]*\]\(/u.test(content)) {
      try {
        const imageBase = await resolveImageBase(ctx, dest);
        const slug = clipImageSlug(title || "clip");
        const imagesDirAbs = path.join(imageBase.abs, "images", slug);
        // Markdown image paths are relative to the note file (same dest folder)
        const relPrefix = `images/${slug}`;
        const pageUrl = normalized.source || "";
        const loc = await localizeMarkdownImages(content, {
          imagesDirAbs,
          relPrefix,
          baseUrl: pageUrl,
          referer: pageUrl,
        });
        content = loc.markdown;
        imagesMeta = {
          downloaded: loc.downloaded,
          failed: loc.failed,
          skipped: loc.skipped,
        };
        if (loc.downloaded > 0) {
          normalized.frontmatter = {
            ...normalized.frontmatter,
            images_localized: loc.downloaded,
          };
        }
        if (loc.downloaded || loc.failed) {
          logInfo("clip-bridge", "image localize", imagesMeta);
        }
      } catch (e) {
        logWarn("clip-bridge", "image localize failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const evidence = await deps.ingest(
      {
        content,
        title,
        source: normalized.source,
        sourceType: normalized.sourceType,
        frontmatter: normalized.frontmatter,
        dest,
      },
      ctx,
    );

    deps.emit?.("workspace:file-changed", {
      relativePath: evidence?.targetPath || evidence?.path,
      event: "add",
      source: "clip",
      listing: true,
    });
    deps.emit?.("clip-bridge:clipped", {
      path: evidence?.targetPath || evidence?.path,
      title,
      source: normalized.source,
      method: normalized.method,
      dest,
    });

    json(res, 200, {
      ok: true,
      path: evidence?.targetPath || evidence?.path,
      method: normalized.method,
      dest,
      images: imagesMeta || undefined,
      evidence: {
        operation: evidence?.operation,
        targetPath: evidence?.targetPath || evidence?.path,
        backupPath: evidence?.backupPath,
      },
    }, req);
    return;
  }

  json(res, 404, { ok: false, error: "not_found" }, req);
}

/**
 * @param {unknown} raw
 * @returns {{ mode: 'inbox'|'stream'|'topic'|'category', topicId?: string, category?: string }}
 */
function resolveClipDest(raw) {
  if (!raw || typeof raw !== "object") return { mode: "inbox" };
  const d = /** @type {Record<string, string>} */ (raw);
  // Whitelist source of truth: CLIP_DEST_MODES (shared with workspace-inbox-ops).
  const mode = CLIP_DEST_MODES.includes(d.mode) ? d.mode : "inbox";
  if (mode === "topic" && d.topicId) {
    return { mode: "topic", topicId: String(d.topicId) };
  }
  if (mode === "category" && d.category) {
    return { mode: "category", category: String(d.category) };
  }
  if (mode === "stream") {
    return { mode: "stream" };
  }
  // inbox | topic/category missing id → inbox
  return { mode: "inbox" };
}

/**
 * Image root: topic/category folder or Inbox.
 * @param {object} ctx
 * @param {{ mode: string, topicId?: string, category?: string }} dest
 */
async function resolveImageBase(ctx, dest) {
  const { inboxRoot, topicRoot, categoryRoot, parseTopicId } = await import("./path-model.mjs");
  if (dest.mode === "topic" && dest.topicId) {
    const { category, topic } = parseTopicId(dest.topicId);
    if (category && topic) {
      const abs = topicRoot(ctx.workspaceRoot, category, topic);
      return { abs, rel: `${category}/${topic}` };
    }
  }
  if (dest.mode === "category" && dest.category) {
    const abs = categoryRoot(ctx.workspaceRoot, dest.category);
    return { abs, rel: dest.category };
  }
  const abs = inboxRoot(ctx.workspaceRoot);
  return { abs, rel: path.basename(abs) };
}

/** Sync bridge lifecycle to settings (idempotent). */
export async function syncClipBridgeFromSettings(settings, deps) {
  const cfg = settings?.clipBridge;
  if (!cfg?.enabled) {
    await stopClipBridge();
    return getClipBridgeLive();
  }
  const token = cfg.token || generateClipToken();
  const port = cfg.port || CLIP_BRIDGE_DEFAULT_PORT;
  try {
    return await startClipBridge({
      port,
      token,
      getContext: deps.getContext,
      ingest: deps.ingest,
      listDestinations: deps.listDestinations,
      emit: deps.emit,
    });
  } catch (e) {
    logWarn("clip-bridge", "failed to start", { error: e instanceof Error ? e.message : String(e) });
    await stopClipBridge();
    throw e;
  }
}
