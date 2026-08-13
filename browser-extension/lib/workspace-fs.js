/**
 * Workspace-local write path — no Desktop process required.
 * Uses File System Access API (Chromium) + IndexedDB-persisted directory handle.
 * Writes Markdown into buffer category (00-Inbox / config) per topmind conventions.
 *
 * Permission note (Chrome):
 * - Handles restored from IndexedDB usually report permission "prompt".
 * - requestPermission() only works in a window with a user gesture (options / popup click).
 * - Service workers can only queryPermission; they cannot re-grant. Popup must call
 *   ensureWorkspaceWritable() under the clip click before SW write.
 */

import { buildCaptureMarkdown, captureFilename } from "./simple-md.js";
import { htmlToMarkdown } from "./html-to-markdown.mjs";
import {
  applyTemplate,
  formatHighlights,
  loadCustomTemplates,
  pickTemplate,
} from "./templates.js";
import { imageSlug, localizeMarkdownImagesInDir } from "./localize-images.js";

const IDB_NAME = "topmind-clip-fs";
const IDB_STORE = "handles";
const IDB_KEY = "workspaceRoot";

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb_open_failed"));
  });
}

/**
 * @param {FileSystemDirectoryHandle} handle
 */
export async function saveWorkspaceHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("idb_put_failed"));
  });
}

/**
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function loadWorkspaceHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearWorkspaceHandle() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/**
 * True when running in a Window (options / popup), not ServiceWorker.
 */
function hasWindowContext() {
  return typeof window !== "undefined" && typeof Window !== "undefined";
}

/**
 * Query + optional requestPermission (window + user-gesture only).
 * @param {FileSystemDirectoryHandle} handle
 * @param {{ request?: boolean }} [opts]
 * @returns {Promise<'granted'|'prompt'|'denied'|'unknown'>}
 */
export async function resolveHandlePermission(handle, opts = {}) {
  const request = opts.request !== false;
  try {
    let state = await handle.queryPermission({ mode: "readwrite" });
    if (state === "granted") return "granted";
    if (!request || !hasWindowContext() || typeof handle.requestPermission !== "function") {
      return state === "prompt" || state === "denied" ? state : "unknown";
    }
    state = await handle.requestPermission({ mode: "readwrite" });
    return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Lightweight handle validity check — resolves the root directory handle
 * to verify it still points to an existing folder.
 * Stale handles (folder moved/renamed/deleted) throw NotFoundError.
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>}
 */
async function isHandleValid(handle) {
  try {
    // .values() is the cheapest way to probe a directory handle without
    // creating files — if the folder is gone, this throws NotFoundError.
    const iter = handle.values();
    await iter.next();
    return true;
  } catch (e) {
    if (e && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) {
      return false;
    }
    // Other errors (security, permission) don't necessarily mean invalid handle
    return true;
  }
}

/**
 * Ensure workspace handle is writable. Call from popup/options under a user gesture
 * (e.g. clip button click) so Chrome can show the permission prompt if needed.
 * @returns {Promise<{ ok: boolean, permission?: string, name?: string, error?: string }>}
 */
export async function ensureWorkspaceWritable() {
  const handle = await loadWorkspaceHandle();
  if (!handle) {
    return { ok: false, error: "no_workspace_folder", permission: "none" };
  }
  // Check handle validity before requesting permission — a stale handle
  // (folder moved/deleted) will fail with NotFoundError during write.
  if (!(await isHandleValid(handle))) {
    await clearWorkspaceHandle();
    return { ok: false, error: "stale_workspace_folder", permission: "none", name: handle.name };
  }
  const permission = await resolveHandlePermission(handle, { request: true });
  if (permission === "granted") {
    return { ok: true, permission, name: handle.name };
  }
  return {
    ok: false,
    permission,
    name: handle.name,
    error: "permission_denied",
  };
}

/**
 * Pick workspace root (must be called from a user-gesture window context).
 * @returns {Promise<{ ok: boolean, name?: string, error?: string, permission?: string }>}
 */
export async function pickWorkspaceFolder() {
  // Check showDirectoryPicker availability (Chrome 86+, Edge, Opera)
  // In some contexts (Firefox, Safari, private mode) this is undefined.
  // In ES modules, showDirectoryPicker is on window/globalThis, not in module scope.
  const picker =
    typeof globalThis?.showDirectoryPicker === "function"
      ? globalThis.showDirectoryPicker
      : typeof window?.showDirectoryPicker === "function"
        ? window.showDirectoryPicker
        : null;
  if (!picker) {
    return { ok: false, error: "unsupported_browser" };
  }
  try {
    const handle = await picker({
      id: "topmind-workspace",
      mode: "readwrite",
      startIn: "documents",
    });
    // Explicit readwrite grant in this same user gesture
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return { ok: false, error: "permission_denied", permission: perm };

    await saveWorkspaceHandle(handle);

    // Persist config: prefer workspace when user explicitly picked a folder
    const bag = await chrome.storage.local.get(["writeMode"]);
    const writeMode =
      bag.writeMode === "bridge" ? "auto" : bag.writeMode === "workspace" ? "workspace" : "auto";
    await chrome.storage.local.set({
      workspaceName: handle.name,
      writeMode,
      workspaceGrantedAt: Date.now(),
    });

    // Probe: open Inbox (create if needed) so first real clip is less surprising
    try {
      await resolveInboxHandle(handle);
    } catch {
      /* non-fatal — clip path will surface write errors */
    }

    // Re-query (should stay granted in this window session)
    const permission = await resolveHandlePermission(handle, { request: false });
    return { ok: true, name: handle.name, permission };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, error: "cancelled" };
    if (e && (e.name === "SecurityError" || e.name === "NotAllowedError")) {
      return { ok: false, error: "permission_denied", permission: "denied" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "pick_failed" };
  }
}

/**
 * Ensure we can write. In SW: query only. In window: may request.
 * @param {FileSystemDirectoryHandle} handle
 */
async function ensurePermission(handle) {
  const state = await resolveHandlePermission(handle, {
    request: hasWindowContext(),
  });
  return state === "granted";
}

/**
 * Resolve buffer (Inbox) directory from workspace root.
 * @param {FileSystemDirectoryHandle} root
 */
async function resolveInboxHandle(root) {
  /** @type {string[]} */
  const candidates = [];
  /** Prefer topmind.yaml (schema v4) buffer role, then 00-* dirs. */
  try {
    const yamlFile = await root.getFileHandle("topmind.yaml");
    const file = await yamlFile.getFile();
    const text = await file.text();
    // Minimal YAML parse: categories.<dir>.role: buffer|inbox
    const catBlock = text.match(/^categories:\s*\n([\s\S]*?)(?=^\w|\Z)/m);
    if (catBlock) {
      let currentDir = null;
      for (const line of catBlock[1].split("\n")) {
        const dirMatch = line.match(/^\s{2}([\w\u4e00-\u9fff][^:]*):\s*$/);
        if (dirMatch) {
          currentDir = dirMatch[1].trim();
          continue;
        }
        if (currentDir && /role:\s*(buffer|inbox)\b/.test(line)) {
          candidates.push(currentDir);
          currentDir = null;
        }
      }
    }
  } catch {
    /* no topmind.yaml */
  }
  // Enumerate root for 00-* buffer-like dirs
  try {
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "directory" && /^00[\s-]/.test(name)) {
        candidates.push(name);
      }
    }
  } catch {
    /* enumerate failed */
  }
  candidates.push("00-收件箱", "00-Inbox", "00 Inbox");

  const seen = new Set();
  for (const name of candidates) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    try {
      return await root.getDirectoryHandle(name, { create: false });
    } catch {
      /* try next */
    }
  }
  return root.getDirectoryHandle("00-Inbox", { create: true });
}

/**
 * Resolve write directory from dest payload.
 * @param {FileSystemDirectoryHandle} root
 * @param {{ mode?: string, topicId?: string, category?: string } | undefined} dest
 * @returns {Promise<{ dir: FileSystemDirectoryHandle, rel: string }>}
 */
async function resolveDestDir(root, dest) {
  if (dest?.mode === "topic" && dest.topicId) {
    const parts = String(dest.topicId).split("/").filter(Boolean);
    if (parts.length >= 2) {
      let cur = root;
      for (const p of parts) {
        cur = await cur.getDirectoryHandle(p, { create: true });
      }
      return { dir: cur, rel: parts.join("/") };
    }
  }
  if (dest?.mode === "category" && dest.category) {
    const name = String(dest.category);
    const dir = await root.getDirectoryHandle(name, { create: true });
    return { dir, rel: name };
  }
  const inbox = await resolveInboxHandle(root);
  return { dir: inbox, rel: inbox.name };
}

/**
 * Write a clip note into workspace Inbox / category / topic.
 * @param {object} payload — same shape as bridge postClip body
 * @returns {Promise<{ ok: boolean, path?: string, error?: string, channel: 'workspace' }>}
 */
export async function writeClipToWorkspace(payload) {
  const handle = await loadWorkspaceHandle();
  if (!handle) {
    return { ok: false, error: "no_workspace_folder", channel: "workspace" };
  }
  // Verify handle validity before anything else — stale handles produce
  // confusing NotFoundError messages during write.
  if (!(await isHandleValid(handle))) {
    await clearWorkspaceHandle();
    return {
      ok: false,
      error: "stale_workspace_folder",
      channel: "workspace",
      hint: "need_reauthorize",
    };
  }
  try {
    if (!(await ensurePermission(handle))) {
      return {
        ok: false,
        error: "permission_denied",
        channel: "workspace",
        // Hint for UI: reopen popup and click clip once (gesture) or re-authorize in options
        hint: "need_user_gesture",
      };
    }
  } catch {
    return { ok: false, error: "permission_denied", channel: "workspace", hint: "need_user_gesture" };
  }

  const mode0 = String(payload.mode || "readability");
  const plainMode0 =
    mode0 === "selection" || mode0 === "highlights" || mode0 === "bookmark";
  let body = String(payload.content || "").trim();
  // Prefer content_html for article modes so images (lazy/srcset) survive.
  // Plain text from Readability has NO img tags — never skip HTML when present.
  if (payload.content_html && !plainMode0) {
    body = htmlToMarkdown(String(payload.content_html), {
      baseUrl: String(payload.source || ""),
      alreadyIsolated: true,
    });
  }
  if (payload.mode === "highlights" && Array.isArray(payload.highlights) && payload.highlights.length) {
    body = formatHighlights(payload.highlights.map((t) => ({ text: String(t) })));
  } else if (payload.selection && payload.selection.length >= 20 && payload.mode === "selection") {
    body = String(payload.selection);
  }
  if (!body) {
    return { ok: false, error: "empty_content", channel: "workspace" };
  }

  const url = String(payload.source || "");
  const custom = await loadCustomTemplates();
  const template = pickTemplate(url, custom, payload.template_id);
  const vars = {
    title: String(payload.title || ""),
    url,
    author: String(payload.author || ""),
    published: String(payload.published || ""),
    site: String(payload.site_name || ""),
    content: body,
    selection: String(payload.selection || ""),
    highlights: formatHighlights(
      Array.isArray(payload.highlights)
        ? payload.highlights.map((t) => ({ text: String(t) }))
        : [],
    ),
    excerpt: String(payload.excerpt || "").slice(0, 500),
    mode: String(payload.mode || "readability"),
    clipped_at: new Date().toISOString(),
  };
  const rendered = applyTemplate(template, vars);
  const finalTitle = rendered.title || payload.title;
  let finalBody = rendered.body || body;

  try {
    const { dir: destDir, rel: destRel } = await resolveDestDir(handle, payload.dest);
    // Optional image localization (article-like modes only)
    const plainMode =
      payload.mode === "selection" ||
      payload.mode === "highlights" ||
      payload.mode === "bookmark";
    let imagesMeta = null;
    if (!plainMode && payload.download_images !== false && /!\[[^\]]*\]\(/u.test(finalBody)) {
      try {
        const loc = await localizeMarkdownImagesInDir(
          finalBody,
          destDir,
          imageSlug(finalTitle || "clip"),
          { baseUrl: url },
        );
        finalBody = loc.markdown;
        imagesMeta = {
          downloaded: loc.downloaded,
          failed: loc.failed,
          skipped: loc.skipped,
        };
        if (loc.downloaded > 0) {
          rendered.properties = {
            ...rendered.properties,
            images_localized: String(loc.downloaded),
          };
        }
      } catch {
        /* non-fatal */
      }
    }

    if (payload.dest?.mode === "topic" && payload.dest.topicId) {
      const parts = String(payload.dest.topicId).split("/");
      if (parts[0]) rendered.properties = { ...rendered.properties, category: parts[0] };
      if (parts[1]) rendered.properties = { ...rendered.properties, topic: parts.slice(1).join("/") };
    } else if (payload.dest?.mode === "category" && payload.dest.category) {
      rendered.properties = { ...rendered.properties, category: payload.dest.category };
    }

    const md = buildCaptureMarkdown({
      title: finalTitle,
      body: finalBody,
      source: payload.source,
      mode: payload.mode,
      author: payload.author,
      site_name: payload.site_name,
      published: payload.published,
      properties: rendered.properties,
      template_id: template.id,
      word_count: finalBody.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean).length,
    });

    let name = captureFilename(finalTitle || "capture");
    try {
      await destDir.getFileHandle(name);
      // Short readable timestamp for conflict resolution (MMDD-HHMM)
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      name = name.replace(/\.md$/iu, `-${stamp}.md`);
    } catch {
      /* free */
    }
    const fileHandle = await destDir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(md);
    await writable.close();
    const rel = `${destRel}/${name}`.replace(/\\/gu, "/");
    return {
      ok: true,
      path: rel,
      channel: "workspace",
      images: imagesMeta || undefined,
      dest: payload.dest || { mode: "inbox" },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write_failed";
    const errName = e instanceof Error ? e.name : "";
    // NotFoundError: handle or target directory no longer exists (folder moved/deleted)
    if (errName === "NotFoundError" || /not found|could not be found/iu.test(msg)) {
      await clearWorkspaceHandle();
      return {
        ok: false,
        error: "stale_workspace_folder",
        channel: "workspace",
        hint: "need_reauthorize",
      };
    }
    // NotAllowedError often means permission revoked mid-write
    if (/NotAllowed|Permission|security/iu.test(msg) || errName === "NotAllowedError") {
      return { ok: false, error: "permission_denied", channel: "workspace", hint: "need_user_gesture" };
    }
    return {
      ok: false,
      error: msg,
      channel: "workspace",
    };
  }
}

export async function workspaceStatus() {
  const handle = await loadWorkspaceHandle();
  if (!handle) return { configured: false };
  // Check if handle is still valid (folder not moved/deleted)
  if (!(await isHandleValid(handle))) {
    await clearWorkspaceHandle();
    return { configured: false, stale: true };
  }
  let permission = "unknown";
  try {
    // Never request here — status must not pop permission dialogs
    permission = await resolveHandlePermission(handle, { request: false });
  } catch {
    permission = "unknown";
  }
  return {
    configured: true,
    name: handle.name,
    permission,
    /** true only when SW/popup can write without another grant prompt */
    writable: permission === "granted",
  };
}
