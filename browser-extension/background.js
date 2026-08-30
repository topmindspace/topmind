/**
 * topmind Clip service worker.
 * Supports Desktop Clip Bridge and/or workspace-local File System Access write.
 *
 * Messaging rules (MV3):
 * - Always sendResponse once, ASAP for long work (clip uses "started" + storage result).
 * - Static imports only — dynamic import() is disallowed on ServiceWorkerGlobalScope
 *   (w3c/ServiceWorker#1356); also avoids message-channel races on the hot path.
 */
import { t } from "./lib/i18n.js";
import { loadConfig, healthCheck, clipDispatch, fetchDestinations } from "./lib/bridge.js";
import { extractFromTab } from "./lib/extract.js";
import { workspaceStatus } from "./lib/workspace-fs.js";
import {
  applyTemplate,
  formatHighlights,
  getTemplateName,
  loadCustomTemplates,
  pickTemplate,
} from "./lib/templates.js";

// Global error handlers — prevent uncaught rejections from showing in chrome://extensions
self.addEventListener("error", (e) => {
  console.error("[topmind-clip] uncaught error:", e?.message || e);
});
self.addEventListener("unhandledrejection", (e) => {
  const reason = e?.reason;
  const msg = reason instanceof Error ? reason.message : String(reason || "unknown");
  console.error("[topmind-clip] unhandled rejection:", msg);
  e.preventDefault?.();
});

const HEALTH_CACHE_KEY = "healthCache";
const LAST_CLIP_KEY = "lastClipResult";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "topmind-clip",
      title: t("ctx_clip"),
      contexts: ["page", "selection", "link"],
    });
    chrome.contextMenus.create({
      id: "topmind-clip-selection",
      title: t("ctx_clip_selection"),
      contexts: ["selection"],
    });
  });
  void warmHealthCache();
});

chrome.runtime.onStartup?.addListener?.(() => {
  void warmHealthCache();
});

async function warmHealthCache() {
  try {
    const cfg = await loadConfig();
    let workspace = { configured: false };
    try {
      workspace = await workspaceStatus();
    } catch {
      /* ignore */
    }
    // Workspace-only mode: skip loopback Bridge probe (avoids false "offline").
    const bridge =
      cfg.writeMode === "workspace"
        ? { ok: false, channel: "workspace" }
        : await healthCheck(cfg, { timeoutMs: 600 });
    const packed = packHealth(bridge, cfg, workspace);
    await chrome.storage.local.set({
      [HEALTH_CACHE_KEY]: { at: Date.now(), res: packed },
    });
  } catch {
    /* ignore */
  }
}

function packHealth(bridge, cfg, workspace) {
  // Only "granted" counts as ready — configured+prompt still needs a popup click re-grant.
  const workspaceReady = Boolean(workspace.configured && workspace.permission === "granted");
  const workspaceConfigured = Boolean(workspace.configured);
  const bridgeReady = Boolean(bridge.ok && bridge.workspaceReady);
  return {
    ...bridge,
    writeMode: cfg.writeMode,
    workspaceConfigured,
    workspacePermission: workspace.permission || (workspaceConfigured ? "unknown" : "none"),
    workspaceName: workspace.name || cfg.workspaceName || "",
    anyReady: bridgeReady || workspaceReady,
    // Prefer workspace channel when only local folder is ready.
    channel: bridgeReady
      ? "bridge"
      : workspaceReady
        ? "workspace"
        : workspaceConfigured
          ? "workspace"
          : bridge.channel || "none",
  };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "topmind-clip" && tab?.id) {
    runClip(tab, { forcedSelection: info.selectionText }).catch((e) =>
      console.error("[topmind-clip] contextMenu runClip error:", e),
    );
    return;
  }
  if (info.menuItemId === "topmind-clip-selection" && tab?.id) {
    runClip(tab, { forcedSelection: info.selectionText, mode: "selection" }).catch((e) =>
      console.error("[topmind-clip] contextMenu selection runClip error:", e),
    );
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "clip-selection") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      runClip(tab).catch((e) =>
        console.error("[topmind-clip] command runClip error:", e),
      );
    }
  } catch (e) {
    console.error("[topmind-clip] command handler error:", e);
  }
});

/**
 * Ensure highlighter content script is injected.
 * @param {number} tabId
 */
async function ensureHighlighter(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/highlight.js"],
    });
  } catch {
    /* restricted pages */
  }
}

/**
 * Full clip pipeline — results go to badge + storage (not long-lived sendResponse).
 * @param {chrome.tabs.Tab} tab
 * @param {{
 *   forcedSelection?: string,
 *   mode?: string,
 *   title?: string,
 *   highlightsOnly?: boolean,
 *   dest?: { mode?: string, topicId?: string, category?: string },
 *   templateId?: string,
 * }} [opts]
 */
async function runClip(tab, opts = {}) {
  const startedAt = Date.now();
  await setBadge("…", "#0284c7");
  const forcedSelection = opts.forcedSelection;

  let extracted;
  try {
    extracted = await extractFromTab(tab.id);
  } catch (e) {
    const result = {
      ok: false,
      error: e instanceof Error ? e.message : "extract_failed",
      at: Date.now(),
      ms: Date.now() - startedAt,
    };
    await finishClip(result);
    return result;
  }

  // Collect page highlights if any
  let highlights = [];
  try {
    await ensureHighlighter(tab.id);
    const hl = await chrome.tabs.sendMessage(tab.id, { type: "mh-hl-get" });
    if (hl?.highlights?.length) highlights = hl.highlights;
  } catch {
    /* no hl */
  }

  if (opts.highlightsOnly) {
    if (!highlights.length) {
      const result = {
        ok: false,
        error: "no_highlights",
        at: Date.now(),
        ms: Date.now() - startedAt,
      };
      await finishClip(result);
      return result;
    }
    const body = formatHighlights(highlights);
    extracted = {
      ...extracted,
      content: body,
      content_html: undefined,
      mode: "highlights",
      selection: highlights.map((h) => h.text).join("\n\n"),
    };
  } else if (forcedSelection && forcedSelection.trim()) {
    extracted.selection = forcedSelection.trim();
    extracted.content = forcedSelection.trim();
    extracted.mode = "selection";
    delete extracted.content_html;
  } else if (opts.mode === "selection" && extracted.selection) {
    extracted.content = extracted.selection;
    extracted.mode = "selection";
    delete extracted.content_html;
  }

  if (!extracted?.content) {
    const result = { ok: false, error: "empty_content", at: Date.now(), ms: Date.now() - startedAt };
    await finishClip(result);
    return result;
  }

  if (opts.title && String(opts.title).trim()) {
    extracted.title = String(opts.title).trim();
  }

  // Template: pick by URL / user id; selection/highlights reshape body now.
  // Article + content_html keeps HTML for Desktop Bridge (template after MD).
  // Workspace path re-applies template after shared html-to-markdown in workspace-fs.
  const custom = await loadCustomTemplates();
  const template = pickTemplate(extracted.url || "", custom, opts.templateId);
  const hlText = formatHighlights(highlights);
  const mode = extracted.mode || "readability";
  const isPlainMode = mode === "selection" || mode === "highlights" || mode === "bookmark";
  if (isPlainMode) {
    const rendered = applyTemplate(template, {
      title: extracted.title || "",
      url: extracted.url || "",
      author: extracted.author || "",
      published: extracted.published || "",
      site: extracted.site_name || "",
      content: extracted.content || "",
      selection: extracted.selection || "",
      highlights: hlText,
      excerpt: extracted.excerpt || "",
      mode,
      clipped_at: new Date().toISOString(),
    });
    extracted.title = rendered.title || extracted.title;
    extracted.content = rendered.body || extracted.content;
  }

  const dest =
    opts.dest && typeof opts.dest === "object"
      ? opts.dest
      : { mode: "inbox" };

  const payload = {
    title: extracted.title,
    content: extracted.content,
    content_html: isPlainMode ? undefined : extracted.content_html,
    source: extracted.url,
    source_type: "external-capture",
    selection: extracted.selection,
    mode,
    author: extracted.author,
    site_name: extracted.site_name,
    excerpt: extracted.excerpt,
    published: extracted.published,
    highlights: highlights.length ? highlights.map((h) => h.text) : undefined,
    template_id: template.id,
    custom_templates: custom.length ? custom : undefined,
    dest,
    apply_template: true,
    download_images: true,
  };

  const result = await clipDispatch(payload);
  const final = {
    ...result,
    at: Date.now(),
    ms: Date.now() - startedAt,
  };
  await finishClip(final);
  return final;
}

async function finishClip(result) {
  try {
    await chrome.storage.local.set({ [LAST_CLIP_KEY]: result });
  } catch {
    /* ignore */
  }
  if (result.ok) {
    await setBadge("✓", "#1a7f53");
    setTimeout(() => setBadge("", ""), 2200);
  } else {
    const soft =
      result.error === "missing_token_and_workspace" ||
      result.error === "offline_and_no_workspace" ||
      result.error === "no_workspace_folder" ||
      result.error === "stale_workspace_folder";
    await setBadge(soft ? "!" : "✕", soft ? "#b3760e" : "#c03d2e");
  }
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* ignore */
  }
}

/**
 * Safe async response: invoke sendResponse at most once.
 * @param {function} sendResponse
 * @param {() => Promise<unknown>} work
 */
function respondAsync(sendResponse, work) {
  let done = false;
  const reply = (payload) => {
    if (done) return;
    done = true;
    try {
      sendResponse(payload);
    } catch {
      /* channel already closed — result still in storage/badge */
    }
  };
  Promise.resolve()
    .then(work)
    .then(reply)
    .catch((e) =>
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  return true;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "clip-now") {
    // Sync ack only — never hold the message channel across extract/network.
    // Result lives in lastClipResult + badge; popup polls storage.
    const startedAt = Date.now();
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          await finishClip({ ok: false, error: "no_tab", at: Date.now(), ms: 0 });
          return;
        }
        await runClip(tab, {
          mode: msg.mode,
          title: msg.title,
          highlightsOnly: Boolean(msg.highlightsOnly),
          forcedSelection: msg.forcedSelection,
          dest: msg.dest,
          templateId: msg.templateId,
        });
      } catch (e) {
        await finishClip({
          ok: false,
          error: e instanceof Error ? e.message : "clip_failed",
          at: Date.now(),
          ms: Date.now() - startedAt,
        });
      }
    })();
    try {
      sendResponse({ ok: true, status: "started", at: startedAt });
    } catch {
      /* ignore */
    }
    return false;
  }

  if (msg?.type === "extract-preview") {
    respondAsync(sendResponse, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "no_tab" };
      const extracted = await extractFromTab(tab.id);
      let highlightCount = 0;
      try {
        await ensureHighlighter(tab.id);
        const hl = await chrome.tabs.sendMessage(tab.id, { type: "mh-hl-status" });
        highlightCount = hl?.count || 0;
      } catch {
        /* ignore */
      }
      if (!extracted) return { ok: false, error: "extract_failed" };
      const preview = String(extracted.content || "").slice(0, 1200);
      const wordCount = String(extracted.content || "").replace(/\s+/gu, " ").trim().split(" ").filter(Boolean).length;
      const custom = await loadCustomTemplates();
      const template = pickTemplate(extracted.url || "", custom);
      return {
        ok: true,
        title: extracted.title,
        url: extracted.url,
        mode: extracted.mode,
        author: extracted.author,
        site_name: extracted.site_name,
        published: extracted.published,
        excerpt: extracted.excerpt,
        preview,
        wordCount,
        hasSelection: Boolean(extracted.selection && extracted.selection.length >= 20),
        highlightCount,
        templateId: template.id,
        templateName: getTemplateName(template),
      };
    });
    return true;
  }

  if (msg?.type === "fetch-destinations") {
    respondAsync(sendResponse, async () => {
      const cfg = await loadConfig();
      return fetchDestinations(cfg);
    });
    return true;
  }

  if (msg?.type === "hl-toggle" || msg?.type === "hl-status" || msg?.type === "hl-clear") {
    respondAsync(sendResponse, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "no_tab" };
      await ensureHighlighter(tab.id);
      const type =
        msg.type === "hl-toggle"
          ? "mh-hl-toggle"
          : msg.type === "hl-clear"
            ? "mh-hl-clear"
            : "mh-hl-status";
      try {
        return await chrome.tabs.sendMessage(tab.id, {
          type,
          active: msg.active,
        });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "hl_failed" };
      }
    });
    return true;
  }

  if (msg?.type === "health") {
    respondAsync(sendResponse, async () => {
      const timeoutMs = typeof msg.timeoutMs === "number" ? msg.timeoutMs : 800;
      const cfg = await loadConfig();
      let workspace = { configured: false };
      try {
        workspace = await workspaceStatus();
      } catch {
        /* ignore */
      }
      const bridge =
        cfg.writeMode === "workspace"
          ? { ok: false, channel: "workspace" }
          : await healthCheck(cfg, { timeoutMs });
      const res = packHealth(bridge, cfg, workspace);
      try {
        await chrome.storage.local.set({
          [HEALTH_CACHE_KEY]: { at: Date.now(), res },
        });
      } catch {
        /* ignore */
      }
      return res;
    });
    return true;
  }

  if (msg?.type === "get-last-clip") {
    respondAsync(sendResponse, async () => {
      const stored = await chrome.storage.local.get(LAST_CLIP_KEY);
      return stored[LAST_CLIP_KEY] || null;
    });
    return true;
  }

  return false;
});
