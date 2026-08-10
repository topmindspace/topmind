/**
 * Popup UI — keep first paint instant.
 * Clip: wait for SW result with timeout + storage fallback (no channel-close panic).
 */

// ── i18n helpers (inline since popup.js is a classic script) ─────────────────
function t(key, ...subs) {
  if (!key) return "";
  const subsArg = subs.length ? subs : undefined;
  try {
    if (typeof chrome !== "undefined" && chrome?.i18n?.getMessage) {
      const msg = chrome.i18n.getMessage(key, subsArg);
      if (msg) return msg;
    }
  } catch {
    /* fallback */
  }
  return key;
}

function applyI18n(root = document.body) {
  if (!root) return;
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) el.textContent = translated;
    }
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) el.placeholder = translated;
    }
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) el.title = translated;
    }
  }
  for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
    const key = el.getAttribute("data-i18n-aria-label");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) el.setAttribute("aria-label", translated);
    }
  }
}

// Apply static translations on load
applyI18n();

const statusEl = document.getElementById("status");
const msgEl = document.getElementById("msg");
const clipBtn = document.getElementById("clip");
const pageCard = document.getElementById("page-card");
const pageTitleInput = document.getElementById("page-title-input");
const pageUrlEl = document.getElementById("page-url");
const hintEl = document.getElementById("hint");
const optsLink = document.getElementById("opts");
const setupCard = document.getElementById("setup-card");
const openSetupBtn = document.getElementById("open-setup");
const kbdEl = document.getElementById("kbd");
const metaRow = document.getElementById("meta-row");
const metaMode = document.getElementById("meta-mode");
const metaWords = document.getElementById("meta-words");
const metaAuthor = document.getElementById("meta-author");
const previewBox = document.getElementById("preview-box");
const previewText = document.getElementById("preview-text");
const hlToggleBtn = document.getElementById("hl-toggle");
const hlClearBtn = document.getElementById("hl-clear");
const modeBtns = Array.from(document.querySelectorAll(".mode-btn"));
const destSelect = document.getElementById("dest-select");
const destHint = document.getElementById("dest-hint");

const HEALTH_CACHE_KEY = "healthCache";
const LAST_CLIP_KEY = "lastClipResult";
const HEALTH_CACHE_TTL_MS = 15_000;
const DEST_PREF_KEY = "clipDestPref";

/** @type {"article"|"selection"|"highlights"} */
let clipMode = "article";
let hlActive = false;
/** @type {string} */
let selectedTemplateId = "";

function parseDestValue(v) {
  const s = String(v || "inbox");
  if (s === "inbox") return { mode: "inbox" };
  if (s.startsWith("topic:")) return { mode: "topic", topicId: s.slice(6) };
  if (s.startsWith("cat:")) return { mode: "category", category: s.slice(4) };
  return { mode: "inbox" };
}

async function loadDestinations() {
  if (!destSelect) return;
  // Show loading state
  destSelect.innerHTML = `<option value="inbox" disabled>${t("dest_loading")}</option>`;
  const res = await sendMessageSafe({ type: "fetch-destinations" }, 5000);
  const prefBag = await chrome.storage.local.get(DEST_PREF_KEY);
  const pref = prefBag[DEST_PREF_KEY] || "inbox";

  const opts = [`<option value="inbox">${t("dest_inbox")}</option>`];
  if (res?.ok) {
    if (destHint) destHint.hidden = true;
    for (const c of res.categories || []) {
      const id = c.id || c.name;
      if (!id) continue;
      opts.push(`<option value="cat:${id}">${t("dest_category", id)}</option>`);
    }
    for (const tp of res.topics || []) {
      if (!tp.id) continue;
      opts.push(`<option value="topic:${tp.id}">${t("dest_topic", tp.id)}</option>`);
    }
  } else if (destHint) {
    destHint.hidden = false;
    destHint.textContent = res?.error
      ? t("dest_hint_offline")
      : t("dest_hint_generic");
  }
  destSelect.innerHTML = opts.join("");
  if ([...destSelect.options].some((o) => o.value === pref)) {
    destSelect.value = pref;
  } else {
    destSelect.value = "inbox";
  }
}

const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
if (kbdEl) kbdEl.textContent = isMac ? "⌘⇧M" : "Ctrl+Shift+M";

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `pill ${cls}`;
}

function setMsg(text, kind) {
  msgEl.textContent = text || "";
  msgEl.className = kind ? `msg ${kind}` : "msg";
}

function openOptions(hash) {
  const url = chrome.runtime.getURL(`options.html${hash || ""}`);
  if (chrome.runtime.openOptionsPage && !hash) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url });
  }
}

/** Mirror of Desktop cleanCaptureTitle (kept small for popup). */
function cleanTitle(raw) {
  let t2 = String(raw || "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!t2) return "";
  const sepRe = /\s*[|»›·•]\s*|\s+[-–—]\s+/u;
  if (sepRe.test(t2)) {
    const parts = t2.split(sepRe).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const left = parts[0];
      const right = parts[parts.length - 1];
      if (left.length >= 8 && right.length <= 36 && left.length >= right.length) {
        t2 = left;
      }
    }
  }
  t2 = t2.replace(/^(Home|首页|主页)\s*[>|/›»-]+\s*/iu, "").trim();
  if (t2.length > 100) t2 = `${t2.slice(0, 99).trim()}…`;
  return t2;
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    const path = x.pathname === "/" ? "" : x.pathname;
    const hostPath = `${x.host}${path}`;
    return hostPath.length > 48 ? `${hostPath.slice(0, 47)}…` : hostPath;
  } catch {
    return String(u || "").slice(0, 48);
  }
}

function applyHealthUi(res, hasToken, workspaceConfigured) {
  const configured = hasToken || workspaceConfigured || res?.workspaceConfigured;
  const wsPerm = res?.workspacePermission;
  const wsWritable =
    wsPerm === "granted" || Boolean(res?.anyReady && res?.channel === "workspace");
  if (setupCard) setupCard.hidden = Boolean(configured);
  if (clipBtn) clipBtn.hidden = !configured;
  if (pageCard && !configured) pageCard.hidden = true;

  if (!configured) {
    setStatus(t("status_not_configured"), "warn");
    setMsg(t("msg_not_configured"), "err");
    if (hintEl) hintEl.textContent = t("hint_configured_once");
    return;
  }

  // Configured workspace but FS permission not yet re-granted this session
  if (
    (workspaceConfigured || res?.workspaceConfigured) &&
    !hasToken &&
    wsPerm &&
    wsPerm !== "granted" &&
    !res?.ok
  ) {
    setStatus(t("status_needs_auth"), "warn");
    setMsg(t("msg_ws_needs_auth"), "");
    if (hintEl) hintEl.textContent = t("hint_needs_auth");
    return;
  }

  if (res?.anyReady || (res?.ok && res?.workspaceReady) || wsWritable) {
    setStatus(res.channel === "workspace" || (!res.ok && workspaceConfigured) ? t("status_workspace") : t("status_online"), "ok");
    return;
  }
  if (workspaceConfigured || res?.workspaceConfigured) {
    setStatus(t("status_workspace"), "ok");
    setMsg(t("msg_will_write_ws"), "");
    return;
  }
  if (!hasToken) {
    setStatus(t("status_not_configured"), "warn");
    setMsg(t("msg_set_token_or_ws"), "err");
    return;
  }
  if (res?.ok && res.workspaceReady) setStatus(t("status_online"), "ok");
  else if (res?.ok) setStatus(t("status_no_workspace"), "warn");
  else setStatus(t("status_offline"), "bad");
}

/**
 * Before SW write: re-grant FS Access from popup (user gesture).
 * IndexedDB handles usually return permission "prompt" until requestPermission in a window.
 */
async function ensureWorkspacePermissionForClip() {
  try {
    const mod = await import(chrome.runtime.getURL("lib/workspace-fs.js"));
    const st = await mod.workspaceStatus();
    if (!st.configured) return { ok: true, skipped: true };
    if (st.permission === "granted") return { ok: true, granted: true };
    const r = await mod.ensureWorkspaceWritable();
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "perm_check_failed" };
  }
}

function setClipMode(mode) {
  clipMode = mode;
  for (const btn of modeBtns) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  if (mode === "article") {
    hintEl.textContent = t("hint_article");
  } else if (mode === "selection") {
    hintEl.textContent = t("hint_selection");
  } else {
    hintEl.textContent = t("hint_highlights");
  }
}

/** Instant preview from tab metadata only — no script injection. */
async function loadActiveTabPreviewFast() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const rawTitle = tab.title || "";
    const title = cleanTitle(rawTitle) || rawTitle || t("no_title");
    const url = tab.url || "";
    if (pageTitleInput) pageTitleInput.value = title;
    pageUrlEl.textContent = url && !url.startsWith("chrome") ? shortUrl(url) : url || "";
    pageCard.hidden = false;
    if (hlToggleBtn) hlToggleBtn.hidden = false;
    hintEl.textContent = t("hint_default");
    return tab;
  } catch {
    pageCard.hidden = true;
    return null;
  }
}

/** Deferred: extract preview (Readability) for richer UI. */
async function loadExtractPreview(tab) {
  if (!tab?.id) return;
  const url = tab.url || "";
  if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(url)) return;
  const res = await sendMessageSafe({ type: "extract-preview" }, 8000);
  if (!res?.ok) return;
  if (pageTitleInput && res.title) {
    pageTitleInput.value = cleanTitle(res.title) || res.title;
  }
  if (metaRow) metaRow.hidden = false;
  if (metaMode) {
    const modeKey = res.mode === "readability" ? "mode_label_readability"
      : res.mode === "heuristic" ? "mode_label_heuristic"
      : res.mode === "selection" ? "mode_label_selection"
      : null;
    metaMode.textContent = modeKey ? t(modeKey) : (res.mode || t("mode_label_readability"));
  }
  if (metaWords) metaWords.textContent = res.wordCount ? t("word_count", String(res.wordCount)) : "";
  if (metaAuthor) {
    if (res.author) {
      metaAuthor.hidden = false;
      metaAuthor.textContent = res.author;
    } else {
      metaAuthor.hidden = true;
    }
  }
  if (previewBox && previewText && res.preview) {
    previewBox.hidden = false;
    previewText.textContent = res.preview;
  }
  if (res.hasSelection) {
    setClipMode("selection");
    const selBtn = document.getElementById("mode-selection");
    if (selBtn) selBtn.disabled = false;
  }
  if (res.highlightCount > 0) {
    const hlBtn = document.getElementById("mode-highlights");
    if (hlBtn) hlBtn.disabled = false;
    if (metaWords) metaWords.textContent += t("highlight_count_suffix", String(res.highlightCount));
    // Show clear button if highlights exist
    if (hlClearBtn) hlClearBtn.hidden = false;
  }
  if (res.templateId) {
    selectedTemplateId = res.templateId;
    if (metaMode && res.templateName) {
      metaMode.title = t("template_tooltip", res.templateName, res.templateId);
    }
  }
  // Sync highlighter status
  const hl = await sendMessageSafe({ type: "hl-status" }, 1500);
  if (hl && typeof hl.active === "boolean") {
    hlActive = hl.active;
    if (hlToggleBtn) {
      hlToggleBtn.classList.toggle("active", hlActive);
      hlToggleBtn.textContent = hlActive ? t("btn_exit_highlight") : t("btn_highlight");
    }
  }
}

async function refreshHealth(opts = {}) {
  const { force = false } = opts;
  const stored = await chrome.storage.local.get(["token", "workspaceName", "writeMode", HEALTH_CACHE_KEY]);
  const hasToken = Boolean(stored.token && String(stored.token).trim());
  const wsConfigured = Boolean(stored.workspaceName);

  const cache = stored[HEALTH_CACHE_KEY];
  if (cache && typeof cache === "object" && cache.at && Date.now() - cache.at < HEALTH_CACHE_TTL_MS) {
    applyHealthUi(cache.res, hasToken, wsConfigured || cache.res?.workspaceConfigured);
    if (!force && (hasToken || wsConfigured)) {
      void revalidateHealth(hasToken, wsConfigured);
      return;
    }
  } else if (!hasToken && !wsConfigured) {
    applyHealthUi(null, false, false);
    return;
  } else {
    setStatus(t("status_detecting"), "muted");
  }

  await revalidateHealth(hasToken, wsConfigured);
}

function sendMessageSafe(message, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const tm = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ _timeout: true });
    }, timeoutMs);
    try {
      chrome.runtime.sendMessage(message, (r) => {
        if (done) return;
        done = true;
        clearTimeout(tm);
        if (chrome.runtime.lastError) {
          resolve({ _error: chrome.runtime.lastError.message });
          return;
        }
        resolve(r);
      });
    } catch (e) {
      clearTimeout(tm);
      resolve({ _error: e instanceof Error ? e.message : "error" });
    }
  });
}

async function revalidateHealth(hasToken, wsConfigured) {
  if (!hasToken && !wsConfigured) {
    applyHealthUi(null, false, false);
    return;
  }
  const res = await sendMessageSafe({ type: "health", timeoutMs: 800 }, 900);
  if (res?._timeout || res?._error) {
    applyHealthUi(
      { ok: false, error: res._error || "timeout", workspaceConfigured: wsConfigured },
      hasToken,
      wsConfigured,
    );
    return;
  }
  applyHealthUi(res, hasToken, wsConfigured || res?.workspaceConfigured);
  try {
    await chrome.storage.local.set({
      [HEALTH_CACHE_KEY]: { at: Date.now(), res },
    });
  } catch {
    /* ignore */
  }
}

function formatClipError(err) {
  if (err === "missing_token" || err === "missing_token_and_workspace") {
    return t("err_missing_token");
  }
  if (err === "offline_and_no_workspace" || err === "no_workspace_folder") {
    return t("err_offline_no_ws");
  }
  if (err === "offline" || String(err).includes("fetch") || String(err).includes("Failed")) {
    return t("err_bridge_unreachable");
  }
  if (err === "empty_content") return t("err_empty_content");
  if (err === "no_highlights") return t("err_no_highlights");
  if (err === "no_tab") return t("err_no_tab");
  if (err === "permission_denied") {
    return t("err_permission_denied");
  }
  if (err === "stale_workspace_folder") {
    return t("err_stale_workspace");
  }
  if (String(err).includes("import()") || String(err).includes("ServiceWorker")) {
    return t("err_extension_internal");
  }
  return t("err_failed", String(err));
}

function applyClipResult(res) {
  clipBtn.disabled = false;
  if (res?.ok) {
    const path = res.path ? String(res.path).split("/").pop() : "";
    const via = res.channel === "workspace" ? t("status_workspace") : "Bridge";
    const ms = typeof res.ms === "number" ? ` · ${Math.round(res.ms)}ms` : "";
    setMsg(path ? t("clip_success_path", via, path, ms) : t("clip_success_no_path", via, ms), "ok");
    setStatus(res.channel === "workspace" ? t("status_workspace") : t("status_online"), "ok");
    void chrome.storage.local.set({
      [HEALTH_CACHE_KEY]: {
        at: Date.now(),
        res: { ok: true, workspaceReady: true, anyReady: true, channel: res.channel },
      },
    });
  } else {
    const err = res?.error || "failed";
    setMsg(formatClipError(err), "err");
    // Keep status meaningful: workspace/config issues ≠ "offline"
    if (
      String(err).includes("token") ||
      String(err).includes("workspace") ||
      err === "permission_denied" ||
      err === "no_workspace_folder" ||
      err === "stale_workspace_folder"
    ) {
      setStatus(t("status_not_configured"), "warn");
    } else if (res?.channel === "workspace") {
      setStatus(t("status_workspace"), "warn");
    } else if (res?.channel === "bridge") {
      setStatus(t("status_offline"), "bad");
    } else {
      setStatus(t("status_failed"), "bad");
    }
  }
}

optsLink.addEventListener("click", (e) => {
  e.preventDefault();
  openOptions();
});

openSetupBtn?.addEventListener("click", () => openOptions("#setup"));

async function waitForClipResult(clipStarted, maxMs = 45_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const bag = await chrome.storage.local.get(LAST_CLIP_KEY);
    const last = bag[LAST_CLIP_KEY];
    if (last && typeof last.at === "number" && last.at >= clipStarted - 200) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

clipBtn.addEventListener("click", async () => {
  clipBtn.disabled = true;
  setMsg(t("msg_preparing"));

  // User gesture: re-grant workspace FS permission so SW can write (local mode).
  const stored = await chrome.storage.local.get(["token", "workspaceName", "writeMode"]);
  const hasToken = Boolean(stored.token && String(stored.token).trim());
  const wsConfigured = Boolean(stored.workspaceName);
  const mode = stored.writeMode || "auto";
  const needsWorkspace =
    mode === "workspace" || (mode === "auto" && (wsConfigured || !hasToken));

  if (needsWorkspace && wsConfigured) {
    setMsg(t("msg_confirm_perm"));
    const perm = await ensureWorkspacePermissionForClip();
    if (!perm.ok && perm.error === "permission_denied") {
      clipBtn.disabled = false;
      setStatus(t("status_needs_auth"), "warn");
      setMsg(formatClipError("permission_denied"), "err");
      return;
    }
    if (!perm.ok && perm.error === "stale_workspace_folder") {
      clipBtn.disabled = false;
      setStatus(t("status_not_configured"), "warn");
      setMsg(formatClipError("stale_workspace_folder"), "err");
      return;
    }
    if (!perm.ok && perm.error === "no_workspace_folder") {
      clipBtn.disabled = false;
      setStatus(t("status_not_configured"), "warn");
      setMsg(formatClipError("no_workspace_folder"), "err");
      return;
    }
  }

  setMsg(t("msg_clipping"));
  const clipStarted = Date.now();
  const titleOverride = pageTitleInput?.value?.trim() || undefined;
  // SW replies immediately with { status: "started" }; result is polled from storage
  const destVal = destSelect?.value || "inbox";
  try {
    await chrome.storage.local.set({ [DEST_PREF_KEY]: destVal });
  } catch {
    /* ignore */
  }
  // Build the clip message once so the permission_denied retry below
  // reuses the exact same user choices (mode / title / dest / template).
  const buildClipMsg = () => ({
    type: "clip-now",
    mode: clipMode === "selection" ? "selection" : undefined,
    highlightsOnly: clipMode === "highlights",
    title: titleOverride,
    dest: parseDestValue(destVal),
    templateId: selectedTemplateId || undefined,
  });
  const ack = await sendMessageSafe(buildClipMsg(), 2500);

  if (ack && !ack._timeout && !ack._error && ack.status === "error") {
    applyClipResult(ack);
    return;
  }
  if (ack?._error && !String(ack._error).includes("message channel") && !String(ack._error).includes("Receiving end")) {
    // Unexpected — still poll once in case SW wrote result
  }

  const last = await waitForClipResult(clipStarted, 45_000);
  if (last) {
    // If SW still hit permission_denied, try one more grant+retry under same click session
    if (!last.ok && last.error === "permission_denied" && needsWorkspace) {
      const perm2 = await ensureWorkspacePermissionForClip();
      if (perm2.ok) {
        const retryStarted = Date.now();
        await sendMessageSafe(buildClipMsg(), 2500);
        const last2 = await waitForClipResult(retryStarted, 45_000);
        if (last2) {
          applyClipResult(last2);
          return;
        }
      }
    }
    applyClipResult(last);
    return;
  }
  clipBtn.disabled = false;
  setMsg(t("msg_clipping_bg"), "");
});

// Mode chips — click + keyboard navigation (arrow keys)
for (const btn of modeBtns) {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    setClipMode(btn.dataset.mode || "article");
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = modeBtns.indexOf(btn);
    const next = e.key === "ArrowLeft" ? (idx - 1 + modeBtns.length) % modeBtns.length : (idx + 1) % modeBtns.length;
    const target = modeBtns[next];
    if (target && !target.disabled) {
      target.focus();
      setClipMode(target.dataset.mode || "article");
    }
  });
}

// Highlighter toggle
hlToggleBtn?.addEventListener("click", async () => {
  const res = await sendMessageSafe({ type: "hl-toggle", active: !hlActive }, 2000);
  if (res && typeof res.active === "boolean") {
    hlActive = res.active;
    hlToggleBtn.classList.toggle("active", hlActive);
    hlToggleBtn.textContent = hlActive ? t("btn_exit_highlight") : t("btn_highlight");
    if (hlActive) {
      setClipMode("highlights");
      setMsg(t("hl_start_hint"), "");
    } else {
      setMsg(res.count ? t("hl_count_msg", String(res.count)) : "", "");
    }
    // Show/hide clear button based on highlight count
    if (hlClearBtn) hlClearBtn.hidden = !hlActive || !res.count;
  } else {
    setMsg(t("hl_unsupported"), "err");
  }
});

// Clear highlights button
hlClearBtn?.addEventListener("click", async () => {
  const res = await sendMessageSafe({ type: "hl-clear" }, 2000);
  if (res?.ok) {
    if (hlClearBtn) hlClearBtn.hidden = true;
    setMsg(res.count != null ? t("hl_clear_done", String(res.count)) : t("hl_clear_done", "0"), "");
    // Re-check highlight status to update toggle button
    const hl = await sendMessageSafe({ type: "hl-status" }, 1500);
    if (hl && typeof hl.active === "boolean") {
      hlActive = hl.active;
      if (hlToggleBtn) {
        hlToggleBtn.classList.toggle("active", hlActive);
        hlToggleBtn.textContent = hlActive ? t("btn_exit_highlight") : t("btn_highlight");
      }
    }
  } else {
    setMsg(t("hl_unsupported"), "err");
  }
});

// ── Boot: paint tab meta → health (cached) → destinations → extract preview ────
void (async () => {
  const tab = await loadActiveTabPreviewFast();
  void refreshHealth({ force: false });
  const defer =
    typeof requestIdleCallback === "function"
      ? (fn) => requestIdleCallback(fn, { timeout: 600 })
      : (fn) => setTimeout(fn, 80);
  defer(() => {
    void loadDestinations();
    if (tab) void loadExtractPreview(tab);
  });
})();
