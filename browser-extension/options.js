import { t, applyI18n } from "./lib/i18n.js";
import { loadConfig, saveConfig, healthCheck } from "./lib/bridge.js";
import {
  pickWorkspaceFolder,
  clearWorkspaceHandle,
  workspaceStatus,
  ensureWorkspaceWritable,
} from "./lib/workspace-fs.js";
import {
  loadCustomTemplates,
  saveCustomTemplates,
  parseCustomTemplates,
  BUILTIN_TEMPLATES,
} from "./lib/templates.js";

// Apply static translations
applyI18n();

// Version truth: manifest.json (AGENTS.md). Inject into header placeholder.
try {
  const versionEl = document.getElementById("version-tag");
  if (versionEl && typeof chrome !== "undefined" && chrome?.runtime?.getManifest) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }
} catch {
  /* ignore */
}

// Mark module as loaded for fallback timeout check
window.__topmindOptionsReady = true;

const portEl = document.getElementById("port");
const tokenEl = document.getElementById("token");
const modeEl = document.getElementById("writeMode");
const msgEl = document.getElementById("msg");
const wsStatusEl = document.getElementById("ws-status");
const overviewEl = document.getElementById("overview");
const tplStatusEl = document.getElementById("tpl-status");
const tplJsonEl = document.getElementById("tpl-json");

function setMsg(text, kind) {
  msgEl.textContent = text || "";
  msgEl.className = kind ? `status-line ${kind}` : "status-line";
}

async function refreshWsStatus() {
  const st = await workspaceStatus();
  if (!st.configured) {
    wsStatusEl.textContent = t("options_ws_status_unconfigured");
    wsStatusEl.className = "status-line";
    return;
  }
  const perm =
    st.permission === "granted"
      ? t("options_ws_perm_granted")
      : st.permission === "prompt"
        ? t("options_ws_perm_prompt")
        : t("options_ws_perm_unknown");
  wsStatusEl.textContent = t("options_ws_status_format", st.name || "✓", perm);
  wsStatusEl.className = st.permission === "granted" ? "status-line ok" : "status-line";
}

async function refreshOverview() {
  if (!overviewEl) return;
  const cfgNow = await loadConfig();
  const hasToken = Boolean(cfgNow.token);
  const st = await workspaceStatus();
  const parts = [];
  let bridgeOk = false;
  if (hasToken) {
    const h = await healthCheck(cfgNow, { timeoutMs: 600 });
    bridgeOk = Boolean(h.ok && h.workspaceReady);
    parts.push(bridgeOk ? t("overview_bridge_ok") : h.ok ? t("overview_bridge_warn") : t("overview_bridge_fail"));
  } else {
    parts.push(t("overview_bridge_none"));
  }
  if (st.configured) {
    parts.push(
      st.permission === "granted"
        ? t("overview_ws_ok", st.name || "✓")
        : t("overview_ws_warn", st.name || "✓"),
    );
  } else {
    parts.push(t("overview_ws_none"));
  }
  const ready = bridgeOk || (st.configured && st.permission === "granted");
  overviewEl.textContent = parts.join(" · ");
  overviewEl.className = ready ? "status-line ok" : "status-line";
}

async function refreshTplStatus() {
  if (!tplStatusEl) return;
  const list = await loadCustomTemplates();
  tplStatusEl.textContent = t("options_tpl_status_format", String(list.length), String(BUILTIN_TEMPLATES.length));
  tplStatusEl.className = list.length ? "status-line ok" : "status-line";
}

try {
  const cfg = await loadConfig();
  if (portEl) portEl.value = String(cfg.port || 19827);
  if (tokenEl) tokenEl.value = cfg.token || "";
  if (modeEl) modeEl.value = cfg.writeMode || "auto";
  await refreshWsStatus();
  await refreshOverview();
  await refreshTplStatus();
} catch (e) {
  // Initialization failed — still wire up buttons so user can retry
  console.error("[topmind-clip] options init error:", e);
  if (msgEl) {
    msgEl.textContent = "初始化失败 — " + (e instanceof Error ? e.message : String(e));
    msgEl.className = "status-line err";
  }
}

// Deep-link
if (location.hash === "#workspace" || location.hash === "#workspace-reauth") {
  document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" });
} else if (location.hash === "#bridge") {
  document.getElementById("bridge")?.scrollIntoView({ behavior: "smooth" });
} else if (location.hash === "#templates") {
  document.getElementById("templates")?.scrollIntoView({ behavior: "smooth" });
}

document.getElementById("save").addEventListener("click", async () => {
  const port = Number(portEl.value) || 19827;
  const token = tokenEl.value.trim();
  const writeMode = modeEl.value;
  if (port < 1024 || port > 65535) {
    setMsg(t("options_port_range_error"), "err");
    return;
  }
  const next = await saveConfig({ port, token, writeMode });
  const tokenPart = token ? ` · Token ✓` : "";
  setMsg(t("options_saved_msg", next.writeMode, String(next.port), tokenPart), "ok");
  await refreshOverview();
});

modeEl.addEventListener("change", async () => {
  await saveConfig({ writeMode: modeEl.value });
  setMsg(t("options_mode_changed", modeEl.value), "ok");
});

document.getElementById("test").addEventListener("click", async () => {
  const port = Number(portEl.value) || 19827;
  const token = tokenEl.value.trim();
  if (port < 1024 || port > 65535) {
    setMsg(t("options_port_range_error"), "err");
    return;
  }
  setMsg(t("options_testing"));
  const next = await saveConfig({ port, token, writeMode: modeEl.value });
  if (!next.token) {
    setMsg(t("options_need_token"), "err");
    return;
  }
  const h = await healthCheck(next);
  if (h.ok && h.workspaceReady) setMsg(t("options_bridge_ok"), "ok");
  else if (h.ok) setMsg(t("options_bridge_no_ws"), "err");
  else setMsg(t("options_bridge_fail", h.error || "offline"), "err");
});

document.getElementById("pick-ws").addEventListener("click", async () => {
  setMsg(t("options_picking"));
  try {
    const r = await pickWorkspaceFolder();
    await refreshWsStatus();
    await refreshOverview();
    if (r.ok) {
      const again = await ensureWorkspaceWritable();
      await refreshWsStatus();
      if (again.ok) {
        setMsg(t("options_pick_ok", r.name), "ok");
      } else {
        setMsg(t("options_pick_need_reauth", r.name), "err");
      }
    } else if (r.error === "cancelled") setMsg(t("options_cancelled"), "");
    else if (r.error === "unsupported_browser")
      setMsg(t("options_unsupported_browser"), "err");
    else if (r.error === "permission_denied")
      setMsg(t("options_perm_failed"), "err");
    else setMsg(t("options_pick_fail", String(r.error)), "err");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("showDirectoryPicker") || err.includes("is not a function")) {
      setMsg(t("options_unsupported_browser"), "err");
    } else {
      setMsg(t("options_pick_fail", err), "err");
    }
    await refreshWsStatus();
    await refreshOverview();
  }
});

document.getElementById("reauth-ws")?.addEventListener("click", async () => {
  setMsg(t("options_requesting_perm"));
  const r = await ensureWorkspaceWritable();
  await refreshWsStatus();
  await refreshOverview();
  if (r.ok) setMsg(t("options_perm_ok", r.name || "✓"), "ok");
  else if (r.error === "no_workspace_folder") setMsg(t("options_perm_need_folder"), "err");
  else setMsg(t("options_perm_failed"), "err");
});

document.getElementById("clear-ws").addEventListener("click", async () => {
  await clearWorkspaceHandle();
  await chrome.storage.local.remove(["workspaceName", "workspaceGrantedAt"]);
  await refreshWsStatus();
  await refreshOverview();
  setMsg(t("options_cleared"), "ok");
});

document.getElementById("tpl-import")?.addEventListener("click", async () => {
  const raw = tplJsonEl?.value || "";
  const parsed = parseCustomTemplates(raw);
  if (!parsed.ok) {
    setMsg(t("options_tpl_invalid", parsed.error), "err");
    return;
  }
  const existing = await loadCustomTemplates();
  const byId = new Map(existing.map((tp) => [tp.id, tp]));
  for (const tp of parsed.templates) byId.set(tp.id, tp);
  const merged = Array.from(byId.values());
  await saveCustomTemplates(merged);
  await refreshTplStatus();
  setMsg(t("options_tpl_imported", String(parsed.templates.length), String(merged.length)), "ok");
});

document.getElementById("tpl-export")?.addEventListener("click", async () => {
  const list = await loadCustomTemplates();
  const text = JSON.stringify({ templates: list }, null, 2);
  if (tplJsonEl) tplJsonEl.value = text;
  try {
    await navigator.clipboard.writeText(text);
    setMsg(t("options_tpl_exported_clipboard", String(list.length)), "ok");
  } catch {
    setMsg(t("options_tpl_exported", String(list.length)), "ok");
  }
});

document.getElementById("tpl-clear")?.addEventListener("click", async () => {
  await saveCustomTemplates([]);
  await refreshTplStatus();
  if (tplJsonEl) tplJsonEl.value = "";
  setMsg(t("options_tpl_cleared"), "ok");
});
