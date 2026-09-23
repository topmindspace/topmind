/**
 * topmind Clip client — Bridge (Desktop) + config shared with workspace-local mode.
 * Contract: docs/adr/2026-07-13-browser-clip-extension.md
 * Workspace-local: docs/adr + README (File System Access, no Desktop runtime).
 *
 * Static imports only: dynamic import() is disallowed on ServiceWorkerGlobalScope
 * (background.js is an MV3 service worker). See w3c/ServiceWorker#1356.
 */

import { writeClipToWorkspace, loadWorkspaceHandle } from "./workspace-fs.js";

const DEFAULTS = {
  port: 19827,
  token: "",
  /** bridge | workspace | auto (try bridge, fall back to workspace folder) */
  writeMode: "auto",
};

export async function loadConfig() {
  const stored = await chrome.storage.local.get(["port", "token", "writeMode", "workspaceName"]);
  const mode = ["bridge", "workspace", "auto"].includes(stored.writeMode)
    ? stored.writeMode
    : DEFAULTS.writeMode;
  return {
    port: Number(stored.port) || DEFAULTS.port,
    token: typeof stored.token === "string" ? stored.token : "",
    writeMode: mode,
    workspaceName: typeof stored.workspaceName === "string" ? stored.workspaceName : "",
  };
}

export async function saveConfig(partial) {
  const cur = await loadConfig();
  const next = { ...cur, ...partial };
  const bag = {
    port: next.port,
    token: next.token,
    writeMode: next.writeMode,
  };
  if (partial.workspaceName !== undefined) bag.workspaceName = partial.workspaceName;
  await chrome.storage.local.set(bag);
  return loadConfig();
}

function baseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

/**
 * @param {{ port: number, token?: string }} cfg
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function healthCheck(cfg, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 800;
  try {
    const res = await fetch(`${baseUrl(cfg.port)}/v1/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, channel: "bridge" };
    const data = await res.json();
    return {
      ok: Boolean(data.ok),
      workspaceReady: Boolean(data.workspaceReady),
      error: data.workspaceReady ? undefined : "workspace_not_ready",
      channel: "bridge",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "offline",
      channel: "bridge",
    };
  }
}

/**
 * @param {object} cfg
 * @param {object} payload
 */
export async function postClip(cfg, payload) {
  if (!cfg.token) {
    return { ok: false, error: "missing_token", channel: "bridge" };
  }
  try {
    const body = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => {
        if (v === undefined || v === null || v === "") return false;
        return true;
      }),
    );
    const res = await fetch(`${baseUrl(cfg.port)}/v1/clip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `http_${res.status}`,
        status: res.status,
        channel: "bridge",
      };
    }
    return {
      ok: true,
      path: data.path,
      evidence: data.evidence,
      method: data.method,
      dest: data.dest,
      images: data.images,
      channel: "bridge",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network_error",
      channel: "bridge",
    };
  }
}

/**
 * List Inbox / categories / topics for clip destination picker.
 * @param {object} cfg
 */
export async function fetchDestinations(cfg) {
  if (!cfg.token) {
    return { ok: false, error: "missing_token", inbox: true, categories: [], topics: [] };
  }
  try {
    const res = await fetch(`${baseUrl(cfg.port)}/v1/destinations`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `http_${res.status}`,
        inbox: true,
        categories: [],
        topics: [],
      };
    }
    return {
      ok: true,
      inbox: data.inbox !== false,
      categories: Array.isArray(data.categories) ? data.categories : [],
      topics: Array.isArray(data.topics) ? data.topics : [],
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network_error",
      inbox: true,
      categories: [],
      topics: [],
    };
  }
}

/**
 * Unified clip dispatch: bridge and/or workspace-local.
 * @param {object} payload
 */
export async function clipDispatch(payload) {
  const cfg = await loadConfig();
  const mode = cfg.writeMode || "auto";

  if (mode === "workspace") {
    return writeClipToWorkspace(payload);
  }

  if (mode === "bridge") {
    return postClip(cfg, payload);
  }

  // auto: bridge when healthy (use short health; skip when recent cache says ready)
  if (cfg.token) {
    let skipHealth = false;
    try {
      const bag = await chrome.storage.local.get("healthCache");
      const cache = bag.healthCache;
      if (
        cache &&
        typeof cache === "object" &&
        cache.at &&
        Date.now() - cache.at < 12_000 &&
        cache.res?.ok &&
        cache.res?.workspaceReady
      ) {
        skipHealth = true;
      }
    } catch {
      /* ignore */
    }
    if (skipHealth) {
      const r = await postClip(cfg, payload);
      if (r.ok) return r;
    } else {
      const h = await healthCheck(cfg, { timeoutMs: 700 });
      if (h.ok && h.workspaceReady) {
        const r = await postClip(cfg, payload);
        if (r.ok) return r;
      }
    }
  }
  const handle = await loadWorkspaceHandle();
  if (handle) {
    return writeClipToWorkspace(payload);
  }
  if (!cfg.token) {
    return { ok: false, error: "missing_token_and_workspace", channel: "none" };
  }
  return { ok: false, error: "offline_and_no_workspace", channel: "none" };
}
