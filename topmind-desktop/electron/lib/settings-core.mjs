/**
 * Settings pure core — defaults, normalize, merge, secret policy.
 * No filesystem I/O. Used by settings.mjs (persistence) and unit tests.
 */
import path from "node:path";
import { normalizeExtraSkillsRoots } from "./skills-extra.mjs";
import {
  MAX_RECENT_WORKSPACES,
  dedupeRecentWorkspaceEntries,
} from "./workspace-path-id.mjs";
import {
  DEFAULT_PREFERRED_CONVERTER,
  normalizePreferredConverter,
} from "./ingest/convert-policy.mjs";

/** Valid AI provider source IDs. `""` means "auto" (no preference).
 * The set is open-ended so future providers work without a settings migration. */
const AI_SOURCE_PREFERENCES = new Set(["", "openai", "anthropic", "google", "deepseek", "moonshot", "zhipu", "minimax", "xai", "ollama", "custom"]);

const MANUAL_SECRET_KEYS = ["openAiKey", "anthropicKey", "deepseekKey", "googleKey", "moonshotKey", "zhipuKey", "minimaxKey", "xaiKey", "customKey"];
const SECURE_STORAGE_VERSION = 1;

/**
 * Secret merge policy (critical — empty string must never wipe a stored key):
 * - `undefined` → keep current
 * - `null` → explicit clear (also recorded in settings._clearSecrets for serialize)
 * - `""` → keep current (UI "leave blank to preserve")
 * - non-empty string → replace
 *
 * Side channel: `settings._clearSecrets = { openAiKey: true, wereadApiKey: true, xBearerToken: true }`
 * tells serialize to write empty ciphertext even when plaintext is blank.
 */
function resolveSecret(incoming, current) {
  if (incoming === undefined) return typeof current === "string" ? current : "";
  if (incoming === null) return "";
  if (typeof incoming !== "string") return typeof current === "string" ? current : "";
  if (incoming === "") return typeof current === "string" ? current : "";
  return incoming;
}

function markClearSecret(target, secretId) {
  if (!isObject(target)) return;
  const bag = isObject(target._clearSecrets) ? { ...target._clearSecrets } : {};
  bag[secretId] = true;
  target._clearSecrets = bag;
}

/** Merge provider secret map without clobbering existing keys with "". */
function mergeManualSecrets(baseManual, patchManual, clearSink = null) {
  const base = isObject(baseManual) ? baseManual : defaultManualSettings();
  const next = { ...defaultManualSettings(), ...base };
  if (!isObject(patchManual)) return next;
  for (const key of MANUAL_SECRET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patchManual, key)) continue;
    const incoming = patchManual[key];
    if (incoming === null) {
      next[key] = "";
      if (clearSink) markClearSecret(clearSink, key);
    } else {
      next[key] = resolveSecret(incoming, base[key]);
    }
  }
  if (patchManual.customBaseUrl !== undefined) {
    next.customBaseUrl = normalizeCustomBaseUrl(patchManual.customBaseUrl);
  } else if (typeof base.customBaseUrl === "string") {
    next.customBaseUrl = base.customBaseUrl;
  }
  if (patchManual.ollamaBaseUrl !== undefined) {
    next.ollamaBaseUrl = normalizeCustomBaseUrl(patchManual.ollamaBaseUrl);
  } else if (typeof base.ollamaBaseUrl === "string") {
    next.ollamaBaseUrl = base.ollamaBaseUrl;
  }
  return next;
}
const THEMES = new Set(["auto", "light", "dark"]);
const WRITEBACK_MODES = new Set(["auto", "confirm"]);
const EDITOR_FONT_FAMILIES = new Set(["sans", "serif", "mono"]);
const SIDEBAR_VIEWS = new Set(["stream", "category", "timeline", "tags", "kanban"]);
/** Supported UI locales. `auto` = follow OS language. */
const UI_LOCALES = new Set(["auto", "zh-CN", "en-US"]);
// MAX_RECENT_WORKSPACES imported from workspace-path-id.mjs
/** Agent multi-step loop bounds (inclusive). */
const AGENT_STEPS_MIN = 3;
const AGENT_STEPS_MAX = 50;
const AGENT_STEPS_DEFAULT = 20;

function clone(value) {
  return structuredClone(value);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function defaultManualSettings() {
  return { openAiKey: "", anthropicKey: "", deepseekKey: "", googleKey: "", moonshotKey: "", zhipuKey: "", minimaxKey: "", xaiKey: "", customBaseUrl: "", customKey: "", ollamaBaseUrl: "" };
}

function defaultWereadSettings() {
  // syncCategory "auto" → resolve via template + workspace separator + FS (never hardcode "30 阅读")
  return {
    enabled: false,
    apiKey: "",
    lastSyncAt: null,
    lastSyncSummary: null,
    syncCategory: "auto",
    /** Merge /review/list/mine personal thoughts into 划线笔记.md */
    includeThoughts: true,
    /** Soft per-run budget (minutes, 1–15). */
    syncBudgetMinutes: 4,
    /** Slim reading-stats snapshot for hub (not content truth). */
    statsCache: null,
  };
}

function defaultXSettings() {
  return {
    enabled: false,
    bearerToken: "",
    // Advisory for agent hosts; Desktop ops use Bearer + xurl (see PLUGIN.md / XService)
    mcpEndpoint: "https://api.x.com/mcp",
    syncCategory: "auto",
    autoArchivePosts: false,
  };
}

/** Third-party external plugins enable map (missing key = enabled). */
function defaultPluginsSettings() {
  return {
    externalEnabled: {},
  };
}

/**
 * Normalize plugins.externalEnabled: only boolean values; keys are plugin ids.
 * @param {unknown} value
 * @param {{ externalEnabled?: Record<string, boolean> }} [fallback]
 */
function normalizePluginsSettings(value, fallback = defaultPluginsSettings()) {
  const base = isObject(fallback) ? fallback : defaultPluginsSettings();
  if (!isObject(value)) return clone(base);
  const raw = isObject(value.externalEnabled) ? value.externalEnabled : base.externalEnabled || {};
  /** @type {Record<string, boolean>} */
  const externalEnabled = {};
  for (const [k, v] of Object.entries(raw)) {
    const id = String(k || "").trim();
    if (!id) continue;
    if (typeof v === "boolean") externalEnabled[id] = v;
  }
  return { externalEnabled };
}

/** Browser extension Clip Bridge (loopback HTTP). Off by default. */
function defaultClipBridgeSettings() {
  return {
    enabled: false,
    port: 19827,
    token: "",
    /** Download remote images into Inbox/images/ and rewrite markdown links */
    downloadImages: true,
  };
}

/** Knowledge ingest pipeline (Office/PDF/email → Markdown). */
function defaultIngestSettings() {
  return {
    enabled: true,
    keepOriginal: false,
    /** Default 80MB — PPT with images routinely exceed 25MB */
    maxFileBytes: 80_000_000,
    maxFolderFiles: 200,
    concurrency: 1,
    defaultDest: "inbox",
    preferExternalConverters: true,
    preferredConverter: DEFAULT_PREFERRED_CONVERTER,
    autoConvert: true,
    /** false = auto enqueue; true = staging confirm sheet first */
    confirmBeforeConvert: false,
    skipConfirmForSingleMd: true,
    openQueueOnEnqueue: false,
  };
}

/**
 * Unified capture UX — global quick note + smart paste.
 * globalMode: float = sticky utility window (OneNote-like); overlay = main shell.
 */
function defaultCaptureSettings() {
  return {
    /** OS global ⌘⇧N opens float sticky note or main overlay */
    globalMode: "float",
    floatAlwaysOnTop: true,
    /** Auto-detect clipboard files / HTML on paste into capture */
    smartPaste: true,
    /** After successful float capture, auto-close the sticky window */
    closeFloatOnSave: true,
    /**
     * System tray icon always visible (recommended on Windows/Linux for
     * hide-to-tray + one-click capture). When false, tray is still created
     * transiently when user chooses close→hide.
     */
    showTray: true,
  };
}

function normalizeCaptureSettings(value, fallback = defaultCaptureSettings()) {
  if (!isObject(value)) return clone(fallback);
  const mode = value.globalMode === "overlay" ? "overlay" : "float";
  return {
    globalMode: mode,
    floatAlwaysOnTop: value.floatAlwaysOnTop !== false,
    smartPaste: value.smartPaste !== false,
    closeFloatOnSave: value.closeFloatOnSave !== false,
    showTray: value.showTray !== false,
  };
}

function normalizeIngestSettings(value, fallback = defaultIngestSettings()) {
  if (!isObject(value)) return clone(fallback);
  const maxFileBytes = Number(value.maxFileBytes);
  const maxFolderFiles = Number(value.maxFolderFiles);
  const concurrency = Number(value.concurrency);
  return {
    enabled: value.enabled !== false,
    keepOriginal: value.keepOriginal === true,
    maxFileBytes:
      Number.isFinite(maxFileBytes) && maxFileBytes > 0
        ? Math.min(Math.round(maxFileBytes), 200_000_000)
        : fallback.maxFileBytes,
    maxFolderFiles:
      Number.isFinite(maxFolderFiles) && maxFolderFiles > 0
        ? Math.min(Math.round(maxFolderFiles), 2000)
        : fallback.maxFolderFiles,
    concurrency:
      Number.isFinite(concurrency) && concurrency >= 1
        ? Math.min(Math.round(concurrency), 4)
        : fallback.concurrency,
    defaultDest: value.defaultDest === "topic" ? "topic" : "inbox",
    preferredConverter: normalizePreferredConverter(
      value.preferredConverter,
      value.preferExternalConverters !== false,
    ),
    preferExternalConverters:
      normalizePreferredConverter(
        value.preferredConverter,
        value.preferExternalConverters !== false,
      ) !== "builtin",
    autoConvert: value.autoConvert !== false,
    confirmBeforeConvert: value.confirmBeforeConvert === true,
    skipConfirmForSingleMd: value.skipConfirmForSingleMd !== false,
    openQueueOnEnqueue: value.openQueueOnEnqueue === true,
  };
}

function normalizeClipBridgeSettings(value, fallback = defaultClipBridgeSettings()) {
  if (!isObject(value)) return clone(fallback);
  const portRaw = Number(value.port);
  const port =
    Number.isFinite(portRaw) && portRaw >= 1024 && portRaw <= 65535
      ? Math.round(portRaw)
      : fallback.port;
  return {
    enabled: value.enabled === true,
    port,
    token: typeof value.token === "string" ? value.token.trim() : fallback.token || "",
    /** default true unless explicitly disabled */
    downloadImages: value.downloadImages === false ? false : true,
  };
}

/** Model cache structure: stores the last live-fetched model catalog
 * so `discoverModels()` can return it instead of always falling back
 * to curated defaults. This prevents the model selector from reverting
 * to stale defaults after a settings save. */
function defaultModelCache() {
  return null; // null = no cache; { catalog: [...], fetchedAt: "..." } when populated
}

function normalizeModelCacheEntry(entry) {
  if (!isObject(entry)) return null;
  const id = typeof entry.id === "string" ? entry.id : null;
  const label = typeof entry.label === "string" ? entry.label : id || "";
  const models = Array.isArray(entry.models)
    ? entry.models
        .filter((m) => isObject(m) && typeof m.id === "string")
        .map((m) => {
          const mi = { id: String(m.id), label: typeof m.label === "string" ? m.label : String(m.id) };
          // Preserve rich metadata from models.dev
          if (typeof m.description === "string" && m.description) mi.description = m.description;
          if (typeof m.toolCall === "boolean") mi.toolCall = m.toolCall;
          if (typeof m.reasoning === "boolean") mi.reasoning = m.reasoning;
          if (typeof m.contextLimit === "number" && m.contextLimit > 0) mi.contextLimit = m.contextLimit;
          if (typeof m.costInput === "number" && m.costInput >= 0) mi.costInput = m.costInput;
          if (typeof m.costOutput === "number" && m.costOutput >= 0) mi.costOutput = m.costOutput;
          return mi;
        })
    : [];
  if (!id) return null;
  return { id, label, models, live: entry.live === true, error: typeof entry.error === "string" ? entry.error : undefined };
}

function normalizeModelCache(value) {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return null;
  const catalog = Array.isArray(value.catalog)
    ? value.catalog.map(normalizeModelCacheEntry).filter(Boolean)
    : [];
  if (catalog.length === 0) return null;
  const fetchedAt = typeof value.fetchedAt === "string" && value.fetchedAt.trim() ? value.fetchedAt : new Date().toISOString();
  return { catalog, fetchedAt };
}

const EDITOR_CONTENT_WIDTHS = new Set(["compact", "reading", "wide", "full"]);
const EDITOR_PAGE_PADDINGS = new Set(["compact", "comfortable", "spacious"]);
const EDITOR_PAPERS = new Set(["default", "soft", "paper", "sepia"]);

function defaultEditorSettings() {
  return {
    /* Long-read defaults: 16px / 1.7 (comfortable paper) */
    fontSize: 16,
    lineHeight: 1.7,
    fontFamily: "sans",
    autoSaveMs: 1500,
    /** Soft-wrap long lines in the Markdown editor. */
    wordWrap: true,
    /** multi = Chrome-style tab strip; single = one unpinned file */
    tabMode: "multi",
    /**
     * Reading column width:
     * compact ~40rem · reading ~52rem (default) · wide ~72rem · full = 100%
     */
    contentWidth: "reading",
    /** Vertical/horizontal padding around prose column */
    pagePadding: "comfortable",
    /** Edit/preview canvas tone (not global theme) */
    paper: "default",
    /** Selection-triggered inline AI panel (toolbar / context still work when false). */
    inlineAiAutoPopup: true,
  };
}

function defaultWorkspaceSettings() {
  return { recent: [] };
}

function defaultWindowSettings() {
  return { bounds: null, isMaximized: false };
}

function clampEditorFontSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultEditorSettings().fontSize;
  return Math.max(12, Math.min(24, Math.round(n)));
}

function clampEditorLineHeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultEditorSettings().lineHeight;
  return Math.max(1.2, Math.min(2.5, Math.round(n * 10) / 10));
}

function clampAutoSaveMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultEditorSettings().autoSaveMs;
  // 0.5s–5s; snap to 100ms
  return Math.max(500, Math.min(5000, Math.round(n / 100) * 100));
}

function clampMaxAgentSteps(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return AGENT_STEPS_DEFAULT;
  return Math.max(AGENT_STEPS_MIN, Math.min(AGENT_STEPS_MAX, Math.round(n)));
}

function normalizeEditorSettings(value, fallback = defaultEditorSettings()) {
  if (!isObject(value)) return clone(fallback);
  const tabModeRaw = value.tabMode !== undefined ? value.tabMode : fallback.tabMode;
  const tabMode = tabModeRaw === "single" || tabModeRaw === "multi" ? tabModeRaw : "multi";
  const widthRaw = value.contentWidth !== undefined ? value.contentWidth : fallback.contentWidth;
  const contentWidth =
    typeof widthRaw === "string" && EDITOR_CONTENT_WIDTHS.has(widthRaw) ? widthRaw : "reading";
  const padRaw = value.pagePadding !== undefined ? value.pagePadding : fallback.pagePadding;
  const pagePadding =
    typeof padRaw === "string" && EDITOR_PAGE_PADDINGS.has(padRaw) ? padRaw : "comfortable";
  const paperRaw = value.paper !== undefined ? value.paper : fallback.paper;
  const paper =
    typeof paperRaw === "string" && EDITOR_PAPERS.has(paperRaw) ? paperRaw : "default";
  return {
    fontSize: value.fontSize !== undefined ? clampEditorFontSize(value.fontSize) : fallback.fontSize,
    lineHeight: value.lineHeight !== undefined ? clampEditorLineHeight(value.lineHeight) : fallback.lineHeight,
    fontFamily:
      typeof value.fontFamily === "string" && EDITOR_FONT_FAMILIES.has(value.fontFamily)
        ? value.fontFamily
        : fallback.fontFamily,
    autoSaveMs:
      value.autoSaveMs !== undefined ? clampAutoSaveMs(value.autoSaveMs) : (fallback.autoSaveMs ?? 1500),
    wordWrap:
      value.wordWrap !== undefined
        ? value.wordWrap !== false
        : (fallback.wordWrap !== false),
    tabMode,
    contentWidth,
    pagePadding,
    paper,
    inlineAiAutoPopup:
      typeof value.inlineAiAutoPopup === "boolean"
        ? value.inlineAiAutoPopup
        : typeof fallback.inlineAiAutoPopup === "boolean"
          ? fallback.inlineAiAutoPopup
          : true,
  };
}

function normalizeWereadStatsCache(value) {
  if (!isObject(value)) return null;
  const fetchedAt =
    typeof value.fetchedAt === "string" && value.fetchedAt.trim() ? value.fetchedAt : null;
  if (!fetchedAt) return null;
  return {
    mode: typeof value.mode === "string" && value.mode.trim() ? value.mode : "monthly",
    fetchedAt,
    totalReadTime: Number.isFinite(Number(value.totalReadTime)) ? Number(value.totalReadTime) : 0,
    readDays: Number.isFinite(Number(value.readDays)) ? Number(value.readDays) : 0,
    dayAverageReadTime: Number.isFinite(Number(value.dayAverageReadTime))
      ? Number(value.dayAverageReadTime)
      : 0,
    compare: value.compare != null && Number.isFinite(Number(value.compare)) ? Number(value.compare) : null,
    preferCategoryWord: typeof value.preferCategoryWord === "string" ? value.preferCategoryWord : "",
    preferTimeWord: typeof value.preferTimeWord === "string" ? value.preferTimeWord : "",
    readStat: Array.isArray(value.readStat)
      ? value.readStat
          .filter((s) => isObject(s))
          .map((s) => ({
            stat: typeof s.stat === "string" ? s.stat : "",
            counts: typeof s.counts === "string" ? s.counts : String(s.counts ?? ""),
          }))
          .filter((s) => s.stat)
      : [],
    topBooks: Array.isArray(value.topBooks)
      ? value.topBooks
          .filter((b) => isObject(b))
          .slice(0, 8)
          .map((b) => ({
            title: typeof b.title === "string" ? b.title : "未知",
            author: typeof b.author === "string" ? b.author : "",
            readTime: Number.isFinite(Number(b.readTime)) ? Number(b.readTime) : 0,
            bookId: b.bookId != null ? String(b.bookId) : null,
          }))
      : [],
    preferCategories: Array.isArray(value.preferCategories)
      ? value.preferCategories
          .filter((c) => isObject(c))
          .slice(0, 8)
          .map((c) => ({
            title: typeof c.title === "string" ? c.title : "",
            readingTime: Number.isFinite(Number(c.readingTime)) ? Number(c.readingTime) : 0,
            readingCount: Number.isFinite(Number(c.readingCount)) ? Number(c.readingCount) : 0,
          }))
      : [],
    fromCache: value.fromCache === true,
  };
}

function normalizeWereadLastSyncSummary(value) {
  if (!isObject(value)) return null;
  return {
    synced: Number.isFinite(Number(value.synced)) ? Number(value.synced) : 0,
    skippedNoChange: Number.isFinite(Number(value.skippedNoChange))
      ? Number(value.skippedNoChange)
      : 0,
    skipped: Number.isFinite(Number(value.skipped)) ? Number(value.skipped) : 0,
    remaining: Number.isFinite(Number(value.remaining)) ? Number(value.remaining) : 0,
    total: Number.isFinite(Number(value.total)) ? Number(value.total) : 0,
    isPartial: value.isPartial === true,
  };
}

function clampSyncBudgetMinutes(value, fallback = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(15, Math.round(n)));
}

function normalizeWereadSettings(value, fallback = defaultWereadSettings()) {
  if (!isObject(value)) return clone(fallback);
  let syncCategory =
    typeof value.syncCategory === "string" && value.syncCategory.trim()
      ? value.syncCategory.trim()
      : fallback.syncCategory;
  // Legacy hardcode from pre-separator-aware builds → treat as auto so FS/separator wins
  if (syncCategory === "30 阅读" || syncCategory === "30-阅读") {
    syncCategory = "auto";
  }
  return {
    enabled: value.enabled === true,
    // Empty string is a valid cleared secret; preserve/keep policy is applied in mergeAppSettings.
    apiKey:
      value.apiKey === null
        ? ""
        : typeof value.apiKey === "string"
          ? value.apiKey
          : (typeof fallback.apiKey === "string" ? fallback.apiKey : ""),
    lastSyncAt: typeof value.lastSyncAt === "string" && value.lastSyncAt.trim()
      ? value.lastSyncAt
      : (value.lastSyncAt === null ? null : fallback.lastSyncAt),
    lastSyncSummary:
      value.lastSyncSummary !== undefined
        ? normalizeWereadLastSyncSummary(value.lastSyncSummary)
        : (fallback.lastSyncSummary ?? null),
    syncCategory,
    includeThoughts:
      value.includeThoughts !== undefined
        ? value.includeThoughts !== false
        : fallback.includeThoughts !== false,
    syncBudgetMinutes:
      value.syncBudgetMinutes !== undefined
        ? clampSyncBudgetMinutes(value.syncBudgetMinutes, fallback.syncBudgetMinutes ?? 4)
        : clampSyncBudgetMinutes(fallback.syncBudgetMinutes, 4),
    statsCache:
      value.statsCache !== undefined
        ? normalizeWereadStatsCache(value.statsCache)
        : normalizeWereadStatsCache(fallback.statsCache),
  };
}

function normalizeXSettings(value, fallback = defaultXSettings()) {
  if (!isObject(value)) return clone(fallback);
  let mcpEndpoint = fallback.mcpEndpoint;
  if (typeof value.mcpEndpoint === "string" && value.mcpEndpoint.trim()) {
    const raw = value.mcpEndpoint.trim().replace(/\/+$/, "");
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(u.hostname))) {
        mcpEndpoint = raw;
      }
    } catch {
      /* keep fallback */
    }
  }
  let syncCategory =
    typeof value.syncCategory === "string" && value.syncCategory.trim()
      ? value.syncCategory.trim()
      : fallback.syncCategory;
  if (syncCategory === "60 参考资料" || syncCategory === "60-参考资料") {
    syncCategory = "auto";
  }
  return {
    enabled: value.enabled === true,
    // Empty string is a valid cleared secret; preserve/keep policy is applied in mergeAppSettings.
    bearerToken:
      value.bearerToken === null
        ? ""
        : typeof value.bearerToken === "string"
          ? value.bearerToken
          : (typeof fallback.bearerToken === "string" ? fallback.bearerToken : ""),
    mcpEndpoint,
    syncCategory,
    autoArchivePosts: value.autoArchivePosts === true,
  };
}

function normalizeAiSettings(value, fallback) {
  const base = isObject(fallback) ? fallback : {
    sourcePreference: "",
    defaultModel: null,
    agentEnabled: true,
    skillsEnabled: true,
    autoPrepareSuggestions: true,
    autoMaintainTodos: false,
    enabledSkillIds: null,
    maxAgentSteps: AGENT_STEPS_DEFAULT,
    manual: defaultManualSettings(),
    modelCache: defaultModelCache(),
  };
  if (!isObject(value)) return clone(base);
  let enabledSkillIds = base.enabledSkillIds ?? null;
  if (value.enabledSkillIds === null) enabledSkillIds = null;
  else if (Array.isArray(value.enabledSkillIds)) {
    enabledSkillIds = value.enabledSkillIds
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim());
    if (enabledSkillIds.length === 0) enabledSkillIds = null;
  }
  let extraSkillsRoots = Array.isArray(base.extraSkillsRoots) ? base.extraSkillsRoots.slice() : [];
  if (value.extraSkillsRoots !== undefined) {
    if (value.extraSkillsRoots === null) {
      extraSkillsRoots = [];
    } else if (Array.isArray(value.extraSkillsRoots)) {
      // Keep non-existing paths so Settings can show them; runtime catalog filters existence.
      extraSkillsRoots = normalizeExtraSkillsRoots(value.extraSkillsRoots, { checkExists: false });
    }
  }
  return {
    sourcePreference:
      typeof value.sourcePreference === "string" && AI_SOURCE_PREFERENCES.has(value.sourcePreference)
        ? value.sourcePreference
        : base.sourcePreference,
    defaultModel: value.defaultModel !== undefined
      ? normalizeDefaultModel(value.defaultModel)
      : base.defaultModel,
    agentEnabled: typeof value.agentEnabled === "boolean" ? value.agentEnabled : (base.agentEnabled !== false),
    skillsEnabled: typeof value.skillsEnabled === "boolean" ? value.skillsEnabled : (base.skillsEnabled !== false),
    autoPrepareSuggestions:
      typeof value.autoPrepareSuggestions === "boolean"
        ? value.autoPrepareSuggestions
        : (base.autoPrepareSuggestions !== false),
    autoMaintainTodos:
      typeof value.autoMaintainTodos === "boolean"
        ? value.autoMaintainTodos
        : (base.autoMaintainTodos === true),
    enabledSkillIds,
    extraSkillsRoots,
    maxAgentSteps:
      value.maxAgentSteps !== undefined
        ? clampMaxAgentSteps(value.maxAgentSteps)
        : clampMaxAgentSteps(base.maxAgentSteps ?? AGENT_STEPS_DEFAULT),
    manual: isObject(value.manual)
      ? mergeManualSecrets(base.manual, value.manual, null)
      : clone(base.manual || defaultManualSettings()),
    modelCache: value.modelCache !== undefined ? normalizeModelCache(value.modelCache) : base.modelCache,
  };
}

function normalizeWritebackMode(value, fallback = "auto") {
  return typeof value === "string" && WRITEBACK_MODES.has(value) ? value : fallback;
}

function normalizeOptionalTrimmedString(value) {
  if (value === undefined || value === null) return null;
  const n = String(value).trim();
  return n || null;
}

function normalizeRecentWorkspaceEntry(value) {
  if (!isObject(value)) return null;
  const rootPath = normalizeOptionalTrimmedString(value.rootPath);
  if (!rootPath) return null;
  return {
    rootPath: path.resolve(rootPath),
    lastOpenedAt: typeof value.lastOpenedAt === "string" && value.lastOpenedAt.trim()
      ? value.lastOpenedAt
      : new Date().toISOString(),
  };
}

function normalizeRecentWorkspaceEntries(value, fallback = []) {
  const candidates = Array.isArray(value) ? value : fallback;
  const mapped = [];
  for (const item of candidates) {
    const entry = normalizeRecentWorkspaceEntry(item);
    if (entry) mapped.push(entry);
  }
  // Canonical dedupe (case / trailing-slash / resolve) — single source of truth
  return dedupeRecentWorkspaceEntries(mapped, MAX_RECENT_WORKSPACES);
}

function normalizeWorkspaceSettings(value, fallback = defaultWorkspaceSettings()) {
  if (!isObject(value)) return clone(fallback);
  return { recent: normalizeRecentWorkspaceEntries(value.recent, fallback.recent) };
}

function normalizeWindowBounds(value) {
  if (!isObject(value)) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const n = {
    width: Math.max(1180, Math.min(3840, Math.round(width))),
    height: Math.max(760, Math.min(2400, Math.round(height))),
  };
  const x = Number(value.x);
  const y = Number(value.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    n.x = Math.round(x);
    n.y = Math.round(y);
  }
  return n;
}

function normalizeWindowSettings(value, fallback = defaultWindowSettings()) {
  if (!isObject(value)) return clone(fallback);
  return {
    bounds: value.bounds !== undefined ? normalizeWindowBounds(value.bounds) : fallback.bounds,
    isMaximized: value.isMaximized === true,
  };
}

function normalizeCustomBaseUrl(value, { strict = false } = {}) {
  const n = String(value || "").trim();
  if (!n) return "";
  try {
    const parsed = new URL(n);
    const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalHttp) {
      if (strict) throw new Error("自定义 Base URL 仅允许 https://，开发调试仅允许 http://localhost。");
      return "";
    }
    return n.replace(/\/+$/, "");
  } catch {
    if (strict) throw new Error("自定义 Base URL 格式无效，请填写完整的 https:// 地址。");
    return "";
  }
}

/** `defaultModel` is a plain model-id string (e.g. "gpt-4o-mini") or null.
 * It applies to the preferred provider only — see ai-model.mjs resolveModel().
 * Handles migration from the old object format `{ source, providerId, modelId }`. */
function normalizeDefaultModel(value) {
  if (value === null || value === undefined) return null;
  // Migration: old format was { source, providerId, modelId } → extract modelId
  if (isObject(value) && typeof value.modelId === "string") return value.modelId.trim() || null;
  if (isObject(value)) return null;
  const s = String(value).trim();
  return s || null;
}

function resolvePersistenceOptions(options = {}) {
  return { secretAdapter: options.secretAdapter || null };
}

function secretAdapterAvailable(secretAdapter) {
  return Boolean(secretAdapter?.isEncryptionAvailable?.());
}

function createSecureStorageEnvelope() {
  return { version: SECURE_STORAGE_VERSION, provider: "electron-safeStorage", manual: {}, integration: {} };
}

function hydrateManualSecrets(settings, persisted, secretAdapter) {
  if (!secretAdapterAvailable(secretAdapter) || !isObject(persisted?.secureStorage)) {
    return settings;
  }
  const next = clone(settings);
  // Hydrate AI provider keys from secureStorage.manual
  if (isObject(persisted.secureStorage.manual)) {
    for (const key of MANUAL_SECRET_KEYS) {
      const encrypted = persisted.secureStorage.manual[key];
      if (typeof encrypted !== "string" || !encrypted) continue;
      try {
        next.ai.manual[key] = secretAdapter.decryptString(encrypted);
      } catch {
        next.ai.manual[key] = "";
      }
    }
  }
  // Hydrate integration keys from secureStorage.integration
  if (isObject(persisted.secureStorage.integration)) {
    if (next.weread && persisted.secureStorage.integration.wereadApiKey) {
      try { next.weread.apiKey = secretAdapter.decryptString(persisted.secureStorage.integration.wereadApiKey); } catch { next.weread.apiKey = ""; }
    }
    if (next.x && persisted.secureStorage.integration.xBearerToken) {
      try { next.x.bearerToken = secretAdapter.decryptString(persisted.secureStorage.integration.xBearerToken); } catch { next.x.bearerToken = ""; }
    }
  }
  return next;
}

/**
 * Serialize settings for disk. When encryption is available, secrets live only
 * under secureStorage; plaintext fields are blanked.
 *
 * Defense in depth: if memory has an empty secret but the previous file still
 * has an encrypted blob for that key, keep the previous blob (prevents UI/race
 * empty-string patches from wiping stored keys).
 *
 * @param {object} settings
 * @param {object|null} secretAdapter
 * @param {object|null} previousSecureStorage disk envelope from last good write
 */
function serializeSettingsForDisk(settings, secretAdapter, previousSecureStorage = null) {
  const clearSecrets = isObject(settings?._clearSecrets) ? settings._clearSecrets : {};
  const payload = clone(settings);
  delete payload._clearSecrets;
  if (!secretAdapterAvailable(secretAdapter)) {
    delete payload.secureStorage;
    return payload;
  }
  const prev = isObject(previousSecureStorage) ? previousSecureStorage : null;
  const prevManual = isObject(prev?.manual) ? prev.manual : {};
  const prevInteg = isObject(prev?.integration) ? prev.integration : {};
  const secureStorage = createSecureStorageEnvelope();

  // Encrypt AI provider keys (or preserve previous ciphertext when plaintext empty)
  for (const key of MANUAL_SECRET_KEYS) {
    const value = String(payload.ai?.manual?.[key] || "");
    if (value) {
      secureStorage.manual[key] = secretAdapter.encryptString(value);
    } else if (clearSecrets[key]) {
      secureStorage.manual[key] = "";
    } else if (typeof prevManual[key] === "string" && prevManual[key]) {
      secureStorage.manual[key] = prevManual[key];
    } else {
      secureStorage.manual[key] = "";
    }
    if (payload.ai?.manual) payload.ai.manual[key] = "";
  }

  const wereadKey = String(payload.weread?.apiKey || "");
  if (wereadKey) {
    secureStorage.integration.wereadApiKey = secretAdapter.encryptString(wereadKey);
  } else if (clearSecrets.wereadApiKey) {
    secureStorage.integration.wereadApiKey = "";
  } else if (typeof prevInteg.wereadApiKey === "string" && prevInteg.wereadApiKey) {
    secureStorage.integration.wereadApiKey = prevInteg.wereadApiKey;
  } else {
    secureStorage.integration.wereadApiKey = "";
  }
  if (payload.weread) payload.weread.apiKey = "";

  const xToken = String(payload.x?.bearerToken || "");
  if (xToken) {
    secureStorage.integration.xBearerToken = secretAdapter.encryptString(xToken);
  } else if (clearSecrets.xBearerToken) {
    secureStorage.integration.xBearerToken = "";
  } else if (typeof prevInteg.xBearerToken === "string" && prevInteg.xBearerToken) {
    secureStorage.integration.xBearerToken = prevInteg.xBearerToken;
  } else {
    secureStorage.integration.xBearerToken = "";
  }
  if (payload.x) payload.x.bearerToken = "";

  payload.secureStorage = secureStorage;
  return payload;
}

function createDefaultAppSettings(defaultWorkspaceRoot) {
  return {
    // Prefer system appearance — less surprise on first launch
    theme: "auto",
    workspaceRoot: defaultWorkspaceRoot,
    writebackMode: "auto",
    workspaces: defaultWorkspaceSettings(),
    window: defaultWindowSettings(),
    ai: {
      sourcePreference: "",
      defaultModel: null,
      agentEnabled: true,
      /** Skill-first agent: inject pack catalog + load_skill tools (default ON). */
      skillsEnabled: true,
      /**
       * Auto-prepare lifecycle/memory suggestion cards on workspace ready (default ON).
       * May call AI when a provider is configured (promote extract etc.); never
       * auto-executes high-impact writes — user still confirms apply.
       */
      autoPrepareSuggestions: true,
      /**
       * Auto-run AI todo maintain (extract / complete / update from stream).
       * Default OFF — spends tokens; user triggers via Stream ✨ / Todo panel when off.
       */
      autoMaintainTodos: false,
      /** null = all bundled skills enabled; else allow-list of skill ids */
      enabledSkillIds: null,
      /** Absolute dirs merged into skill catalog (plus topmind_SKILLS_EXTRA env) */
      extraSkillsRoots: [],
      maxAgentSteps: AGENT_STEPS_DEFAULT,
      manual: defaultManualSettings(),
      modelCache: defaultModelCache(),
    },
    weread: defaultWereadSettings(),
    x: defaultXSettings(),
    plugins: defaultPluginsSettings(),
    clipBridge: defaultClipBridgeSettings(),
    ingest: defaultIngestSettings(),
    capture: defaultCaptureSettings(),
    editor: defaultEditorSettings(),
    ui: defaultUiSettings(),
    updatedAt: new Date().toISOString(),
  };
}

const FILE_FILTER_MODES_UI = new Set(["default", "markdown", "all"]);
const CLOSE_BEHAVIORS = new Set(["ask", "quit", "hide"]);

function defaultUiSettings() {
  return {
    sidebarWidth: 240,
    sidebarCollapsed: false,
    aiPanelOpen: true,
    aiPanelWidth: 360,
    /** Default sidebar view mode (stream / category tree / timeline / tags / kanban). */
    sidebarView: "stream",
    /**
     * Workspace tree / lists file visibility:
     * default = md+html+txt+office+pdf · markdown · all
     */
    fileFilter: "default",
    /**
     * Close window behavior:
     * ask (first time prompt) · quit · hide (dock / tray keep running)
     */
    closeBehavior: "ask",
    /** UI locale: `auto` (follow OS) · `zh-CN` · `en-US`. */
    locale: "auto",
    /** Auto-check for updates on startup (default true). */
    autoCheckUpdates: true,
  };
}

function normalizeUiSettings(value, fallback = defaultUiSettings()) {
  if (!isObject(value)) return clone(fallback);
  const fileFilterRaw = value.fileFilter !== undefined ? value.fileFilter : fallback.fileFilter;
  const fileFilter =
    typeof fileFilterRaw === "string" && FILE_FILTER_MODES_UI.has(fileFilterRaw)
      ? fileFilterRaw
      : "default";
  const closeRaw = value.closeBehavior !== undefined ? value.closeBehavior : fallback.closeBehavior;
  const closeBehavior =
    typeof closeRaw === "string" && CLOSE_BEHAVIORS.has(closeRaw) ? closeRaw : "ask";
  const localeRaw = value.locale !== undefined ? value.locale : (fallback.locale || "auto");
  const locale =
    typeof localeRaw === "string" && UI_LOCALES.has(localeRaw) ? localeRaw : "auto";
  return {
    sidebarWidth: typeof value.sidebarWidth === "number" && value.sidebarWidth >= 180 && value.sidebarWidth <= 480
      ? value.sidebarWidth : fallback.sidebarWidth,
    sidebarCollapsed: value.sidebarCollapsed === true,
    aiPanelOpen: value.aiPanelOpen !== false,
    aiPanelWidth: typeof value.aiPanelWidth === "number" && value.aiPanelWidth >= 280 && value.aiPanelWidth <= 560
      ? value.aiPanelWidth : fallback.aiPanelWidth,
    sidebarView:
      typeof value.sidebarView === "string" && SIDEBAR_VIEWS.has(value.sidebarView)
        ? value.sidebarView
        : (fallback.sidebarView || "stream"),
    fileFilter,
    closeBehavior,
    locale,
    autoCheckUpdates: value.autoCheckUpdates !== false,
  };
}

function mergeAppSettings(baseSettings, patch, options = {}) {
  const next = clone(baseSettings);
  const strictValidation = Boolean(options.strictValidation);

  if (typeof patch.theme === "string" && THEMES.has(patch.theme)) next.theme = patch.theme;
  if (typeof patch.workspaceRoot === "string" && patch.workspaceRoot.trim()) next.workspaceRoot = patch.workspaceRoot;
  if (patch.writebackMode !== undefined) next.writebackMode = normalizeWritebackMode(patch.writebackMode, next.writebackMode);

  if (isObject(patch.workspaces)) {
    const currentWorkspaces = normalizeWorkspaceSettings(next.workspaces);
    const mergedRecent = Array.isArray(patch.workspaces.recent)
      ? normalizeRecentWorkspaceEntries([...patch.workspaces.recent, ...currentWorkspaces.recent])
      : currentWorkspaces.recent;
    next.workspaces = { ...currentWorkspaces, recent: mergedRecent };
  }

  if (isObject(patch.window)) next.window = normalizeWindowSettings(patch.window, next.window);

  if (isObject(patch.ai)) {
    if (typeof patch.ai.sourcePreference === "string" && AI_SOURCE_PREFERENCES.has(patch.ai.sourcePreference)) {
      next.ai.sourcePreference = patch.ai.sourcePreference;
    }
    if (patch.ai.defaultModel === null || patch.ai.defaultModel === undefined) {
      // Only clear when explicitly null; undefined means "leave unchanged"
      if (patch.ai.defaultModel === null) next.ai.defaultModel = null;
    } else {
      next.ai.defaultModel = normalizeDefaultModel(patch.ai.defaultModel);
    }
    if (typeof patch.ai.agentEnabled === "boolean") {
      next.ai.agentEnabled = patch.ai.agentEnabled;
    }
    if (typeof patch.ai.skillsEnabled === "boolean") {
      next.ai.skillsEnabled = patch.ai.skillsEnabled;
    }
    if (typeof patch.ai.autoPrepareSuggestions === "boolean") {
      next.ai.autoPrepareSuggestions = patch.ai.autoPrepareSuggestions;
    }
    if (typeof patch.ai.autoMaintainTodos === "boolean") {
      next.ai.autoMaintainTodos = patch.ai.autoMaintainTodos;
    }
    if (patch.ai.enabledSkillIds !== undefined) {
      if (patch.ai.enabledSkillIds === null) {
        next.ai.enabledSkillIds = null;
      } else if (Array.isArray(patch.ai.enabledSkillIds)) {
        const ids = patch.ai.enabledSkillIds
          .filter((id) => typeof id === "string" && id.trim())
          .map((id) => id.trim());
        next.ai.enabledSkillIds = ids.length ? ids : null;
      }
    }
    if (patch.ai.extraSkillsRoots !== undefined) {
      next.ai = normalizeAiSettings(
        { ...next.ai, extraSkillsRoots: patch.ai.extraSkillsRoots },
        next.ai,
      );
    }
    if (patch.ai.maxAgentSteps !== undefined) {
      next.ai.maxAgentSteps = clampMaxAgentSteps(patch.ai.maxAgentSteps);
    }
    // Only update modelCache when explicitly provided as a non-null value.
    // SettingsDialog spreads settings.ai (which may carry a stale null
    // modelCache from the initial load) into every patch — without this
    // guard, saving an API key would silently clear a cache that
    // fetchLiveModels just persisted. fetchLiveModels always sends a
    // non-null cachePayload, so it is unaffected.
    if (patch.ai.modelCache !== undefined && patch.ai.modelCache !== null) {
      next.ai.modelCache = normalizeModelCache(patch.ai.modelCache);
    }
    if (isObject(patch.ai.manual)) {
      const mergedManual = mergeManualSecrets(next.ai.manual, patch.ai.manual, next);
      if (patch.ai.manual.customBaseUrl !== undefined) {
        mergedManual.customBaseUrl = normalizeCustomBaseUrl(patch.ai.manual.customBaseUrl, {
          strict: strictValidation,
        });
      }
      if (patch.ai.manual.ollamaBaseUrl !== undefined) {
        mergedManual.ollamaBaseUrl = normalizeCustomBaseUrl(patch.ai.manual.ollamaBaseUrl, {
          strict: strictValidation,
        });
      }
      next.ai.manual = mergedManual;
    }
  }

  if (isObject(patch.editor)) next.editor = normalizeEditorSettings(patch.editor, next.editor);

  if (isObject(patch.ui)) {
    next.ui = normalizeUiSettings({ ...next.ui, ...patch.ui }, next.ui);
  }

  // WeRead / X — merge through normalizers so partial patches never drop fields.
  // Secrets: blank string keeps existing; null clears (see resolveSecret).
  if (isObject(patch.weread)) {
    const wereadMerged = { ...next.weread, ...patch.weread };
    if (Object.prototype.hasOwnProperty.call(patch.weread, "apiKey")) {
      if (patch.weread.apiKey === null) {
        wereadMerged.apiKey = "";
        markClearSecret(next, "wereadApiKey");
      } else {
        wereadMerged.apiKey = resolveSecret(patch.weread.apiKey, next.weread.apiKey);
      }
    } else {
      wereadMerged.apiKey = next.weread.apiKey;
    }
    next.weread = normalizeWereadSettings(wereadMerged, next.weread);
  }
  if (isObject(patch.x)) {
    const xMerged = { ...next.x, ...patch.x };
    if (Object.prototype.hasOwnProperty.call(patch.x, "bearerToken")) {
      if (patch.x.bearerToken === null) {
        xMerged.bearerToken = "";
        markClearSecret(next, "xBearerToken");
      } else {
        xMerged.bearerToken = resolveSecret(patch.x.bearerToken, next.x.bearerToken);
      }
    } else {
      xMerged.bearerToken = next.x.bearerToken;
    }
    next.x = normalizeXSettings(xMerged, next.x);
  }
  if (isObject(patch.clipBridge)) {
    next.clipBridge = normalizeClipBridgeSettings(
      { ...next.clipBridge, ...patch.clipBridge },
      next.clipBridge || defaultClipBridgeSettings(),
    );
  }
  if (isObject(patch.ingest)) {
    next.ingest = normalizeIngestSettings(
      { ...(next.ingest || defaultIngestSettings()), ...patch.ingest },
      next.ingest || defaultIngestSettings(),
    );
  }
  if (isObject(patch.capture)) {
    next.capture = normalizeCaptureSettings(
      { ...(next.capture || defaultCaptureSettings()), ...patch.capture },
      next.capture || defaultCaptureSettings(),
    );
  }

  if (isObject(patch.plugins)) {
    const prev = next.plugins || defaultPluginsSettings();
    const mergedEnabled = {
      ...(isObject(prev.externalEnabled) ? prev.externalEnabled : {}),
      ...(isObject(patch.plugins.externalEnabled) ? patch.plugins.externalEnabled : {}),
    };
    next.plugins = normalizePluginsSettings(
      { externalEnabled: mergedEnabled },
      prev,
    );
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function parseSettingsBody(raw, defaultWorkspaceRoot, secretAdapter) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const defaults = createDefaultAppSettings(defaultWorkspaceRoot);
  const merged = mergeAppSettings(defaults, parsed);
  merged.workspaces = normalizeWorkspaceSettings(parsed?.workspaces, merged.workspaces);
  merged.window = normalizeWindowSettings(parsed?.window, merged.window);
  merged.editor = normalizeEditorSettings(parsed?.editor, merged.editor);
  merged.ui = normalizeUiSettings(parsed?.ui, merged.ui);
  merged.weread = normalizeWereadSettings(parsed?.weread, merged.weread);
  merged.x = normalizeXSettings(parsed?.x, merged.x);
  merged.plugins = normalizePluginsSettings(parsed?.plugins, merged.plugins || defaultPluginsSettings());
  merged.clipBridge = normalizeClipBridgeSettings(parsed?.clipBridge, merged.clipBridge);
  merged.ingest = normalizeIngestSettings(parsed?.ingest, merged.ingest || defaultIngestSettings());
  merged.capture = normalizeCaptureSettings(parsed?.capture, merged.capture || defaultCaptureSettings());
  merged.ai = normalizeAiSettings(parsed?.ai, merged.ai);
  // Ensure new fields exist after upgrades (defense in depth)
  if (typeof merged.ai.agentEnabled !== "boolean") merged.ai.agentEnabled = true;
  if (typeof merged.ai.skillsEnabled !== "boolean") merged.ai.skillsEnabled = true;
  if (typeof merged.ai.autoPrepareSuggestions !== "boolean") merged.ai.autoPrepareSuggestions = true;
  if (typeof merged.ai.autoMaintainTodos !== "boolean") merged.ai.autoMaintainTodos = false;
  if (merged.ai.enabledSkillIds !== null && !Array.isArray(merged.ai.enabledSkillIds)) {
    merged.ai.enabledSkillIds = null;
  }
  if (typeof merged.ai.maxAgentSteps !== "number") merged.ai.maxAgentSteps = AGENT_STEPS_DEFAULT;
  if (typeof merged.editor.autoSaveMs !== "number") merged.editor.autoSaveMs = 1500;
  if (typeof merged.editor.wordWrap !== "boolean") merged.editor.wordWrap = true;
  if (typeof merged.editor.inlineAiAutoPopup !== "boolean") merged.editor.inlineAiAutoPopup = true;
  if (!merged.ui || typeof merged.ui !== "object") merged.ui = defaultUiSettings();
  if (typeof merged.ui.autoCheckUpdates !== "boolean") merged.ui.autoCheckUpdates = true;
  if (!merged.clipBridge || typeof merged.clipBridge !== "object") {
    merged.clipBridge = defaultClipBridgeSettings();
  }
  if (!merged.ingest || typeof merged.ingest !== "object") {
    merged.ingest = defaultIngestSettings();
  }
  if (!merged.capture || typeof merged.capture !== "object") {
    merged.capture = defaultCaptureSettings();
  }
  if (!merged.plugins || typeof merged.plugins !== "object") {
    merged.plugins = defaultPluginsSettings();
  }
  if (merged.writebackMode !== undefined) {
    merged.writebackMode = normalizeWritebackMode(merged.writebackMode, "auto");
  }
  if (typeof merged.theme !== "string" || !THEMES.has(merged.theme)) {
    merged.theme = "auto";
  }
  return hydrateManualSecrets(merged, parsed, secretAdapter);
}


function overlayLiveSecrets(diskBase, memorySettings) {
  if (!isObject(diskBase) || !isObject(memorySettings)) return diskBase;
  const next = clone(diskBase);
  if (isObject(memorySettings.ai?.manual) && isObject(next.ai?.manual)) {
    for (const key of MANUAL_SECRET_KEYS) {
      const mem = memorySettings.ai.manual[key];
      const disk = next.ai.manual[key];
      if (typeof mem === "string" && mem && (!disk || disk === "")) {
        next.ai.manual[key] = mem;
      }
    }
    if (
      typeof memorySettings.ai.manual.customBaseUrl === "string"
      && memorySettings.ai.manual.customBaseUrl
      && !next.ai.manual.customBaseUrl
    ) {
      next.ai.manual.customBaseUrl = memorySettings.ai.manual.customBaseUrl;
    }
    if (
      typeof memorySettings.ai.manual.ollamaBaseUrl === "string"
      && memorySettings.ai.manual.ollamaBaseUrl
      && !next.ai.manual.ollamaBaseUrl
    ) {
      next.ai.manual.ollamaBaseUrl = memorySettings.ai.manual.ollamaBaseUrl;
    }
  }
  if (isObject(memorySettings.weread) && isObject(next.weread)) {
    const mem = memorySettings.weread.apiKey;
    if (typeof mem === "string" && mem && !next.weread.apiKey) {
      next.weread.apiKey = mem;
    }
  }
  if (isObject(memorySettings.x) && isObject(next.x)) {
    const mem = memorySettings.x.bearerToken;
    if (typeof mem === "string" && mem && !next.x.bearerToken) {
      next.x.bearerToken = mem;
    }
  }
  if (isObject(memorySettings.clipBridge) && isObject(next.clipBridge)) {
    const mem = memorySettings.clipBridge.token;
    if (typeof mem === "string" && mem && !next.clipBridge.token) {
      next.clipBridge.token = mem;
    }
  }
  return next;
}

/**
 * Unlocked atomic write (must only run inside enqueueSettingsWrite).
 */


// ── Public pure API ──────────────────────────────────────────────────────────

export {
  AI_SOURCE_PREFERENCES,
  MANUAL_SECRET_KEYS,
  WRITEBACK_MODES,
  SIDEBAR_VIEWS,
  UI_LOCALES,
  AGENT_STEPS_MIN,
  AGENT_STEPS_MAX,
  AGENT_STEPS_DEFAULT,
  resolveSecret,
  mergeManualSecrets,
  createDefaultAppSettings,
  mergeAppSettings,
  normalizeEditorSettings,
  normalizeWritebackMode,
  normalizeUiSettings,
  normalizeWereadSettings,
  normalizeXSettings,
  normalizeAiSettings,
  normalizePluginsSettings,
  normalizeIngestSettings,
  normalizeCaptureSettings,
  normalizeClipBridgeSettings,
  normalizeWorkspaceSettings,
  normalizeWindowSettings,
  defaultPluginsSettings,
  defaultIngestSettings,
  defaultCaptureSettings,
  defaultClipBridgeSettings,
  defaultEditorSettings,
  defaultUiSettings,
  clampAutoSaveMs,
  clampEditorFontSize,
  clampMaxAgentSteps,
  serializeSettingsForDisk,
  hydrateManualSecrets,
  overlayLiveSecrets,
  parseSettingsBody,
  resolvePersistenceOptions,
  isObject,
  clone,
};

/** Test / advanced surface — same keys as former __settingsTest. */
export const settingsCoreTest = {
  normalizeEditorSettings,
  normalizeWritebackMode,
  normalizeUiSettings,
  normalizeWereadSettings,
  normalizeXSettings,
  normalizeAiSettings,
  normalizePluginsSettings,
  normalizeIngestSettings,
  normalizeCaptureSettings,
  normalizeClipBridgeSettings,
  defaultPluginsSettings,
  defaultIngestSettings,
  defaultCaptureSettings,
  defaultClipBridgeSettings,
  clampAutoSaveMs,
  clampEditorFontSize,
  clampMaxAgentSteps,
  createDefaultAppSettings,
  mergeAppSettings,
  resolveSecret,
  mergeManualSecrets,
  serializeSettingsForDisk,
  overlayLiveSecrets,
  parseSettingsBody,
  MANUAL_SECRET_KEYS,
  AI_SOURCE_PREFERENCES,
  WRITEBACK_MODES,
  SIDEBAR_VIEWS,
  AGENT_STEPS_MIN,
  AGENT_STEPS_MAX,
  AGENT_STEPS_DEFAULT,
  UI_LOCALES,
};
