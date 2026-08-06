/**
 * v4 Unified Types — replaces 15 type files.
 * All domain entities, selection model, AI, and settings in one file.
 */

/* ── Workspace Entities ── */

export interface Category {
  name: string;
  directory?: string;
  slot?: string;
  role?: string;
  specialBehavior?: string;
  catchAll?: boolean;
  referenceOnly?: boolean;
  required?: boolean;
  hidden?: boolean;
  source?: string;
}

/** Resolved category descriptor from WorkspaceModel / listCategories */
export type CategoryDescriptor = Category & {
  directory: string;
  slot: string;
  role: string;
};

export interface TopicFile {
  name: string;
  size: number;
  mtime: string;
  /** From note frontmatter when available */
  title?: string | null;
  relativePath?: string;
}

/** One-level workspace directory entry (file or folder). */
export interface DirEntry {
  kind: "file" | "dir";
  name: string;
  relativePath: string;
  mtime: string;
  size?: number;
  title?: string | null;
  childCount?: number;
  ext?: string;
}

export type FileFilterMode = "default" | "markdown" | "all";
export type CloseBehavior = "ask" | "quit" | "hide";

export interface Topic {
  id: string;          // "10 Category/2024-TopicName"
  name: string;        // "2024-TopicName"
  fileCount: number;
  files: TopicFile[];
  /** Directory mtime (ISO) — sidebar sort */
  mtime?: string;
}

export interface LooseNote {
  name: string;
  relativePath: string;
  mtime?: string;
}

export interface InboxFile {
  name: string;
  relativePath: string;
  size: number;
  mtime: string;
  /** From note frontmatter when available */
  source_type?: string | null;
  source?: string | null;
  title?: string | null;
}
export interface InboxFolder { name: string; fileCount: number; files: TopicFile[]; }
export interface InboxData { files: InboxFile[]; folders: InboxFolder[]; inboxName?: string; outputsName?: string; }

export interface OutputFile { name: string; relativePath: string; size: number; mtime: string; }
export interface ArchiveItem { name: string; relativePath: string; size: number; mtime: string; }
export interface SearchResult {
  relativePath: string;
  preview: string;
  nameMatch?: boolean;
  line?: number;
}

/** Keyword search response — never treat count as full-library census when truncated. */
export interface SearchResponse {
  results: SearchResult[];
  count?: number;
  filesScanned?: number;
  truncated?: boolean;
  scope?: string | null;
  includeArchive?: boolean;
  note?: string;
}

/** Note with parsed frontmatter — used by Timeline/Tags/Kanban sidebar views. */
export interface NoteMeta {
  path: string;
  name: string;
  category: string | null;
  topic: string | null;
  mtime: string;
  size: number;
  title: string | null;
  tags: string[];
  status: string | null;
  priority: string | null;
  /** Optional ISO date or YYYY-MM-DD from frontmatter.due / deadline */
  due?: string | null;
  source_type: string | null;
}

export interface AllNotesResult {
  notes: NoteMeta[];
  /** Count of notes in this projection (≤ scan cap when truncated). */
  total: number;
  /** Notes returned in this response (usually === notes.length). */
  returned?: number;
  /**
   * Full eligible .md census when known.
   * Equals total when complete; when truncated, ≥ total (lightweight FS count, no FM parse).
   */
  scannedTotal?: number;
  /** Walk hit limit early — total is not a full-workspace census. */
  truncated?: boolean;
  complete?: boolean;
  cached?: boolean;
  builtAt?: number;
}

/** Multi-file write receipt from a multi-write AI turn (not a writebackMode). */
export interface BatchEvidenceSummary {
  writebackMode?: string;
  writeCount: number;
  targetPaths?: string[];
  backupPaths?: string[];
  message?: string;
  items?: Array<Record<string, unknown>>;
}

/** File metadata result — frontmatter + preview without full content read. */
export interface FileMetaResult {
  frontmatter: Record<string, unknown>;
  bodyPreview: string;
  size: number;
  mtime: string | null;
}

/* ── Selection Model ── */
/* Sidebar selection drives editor content. No view router needed.
   Files are addressed by workspace-relative path — the filesystem is the truth,
   so one `file` kind covers topic notes, category loose notes, inbox, outputs,
   and archive uniformly (topicId is an optional hint; readOnly guards previews). */

export type Selection =
  | { kind: 'inbox' }
  | { kind: 'stream' }
  | { kind: 'category'; category: string }
  | { kind: 'topic'; topicId: string }
  | {
      kind: 'file';
      path: string;
      topicId?: string;
      readOnly?: boolean;
      /** Optional: scroll/focus this ## heading after open (stream browser → period note). */
      focusHeading?: string;
    }
  | { kind: 'outputs' }
  | { kind: 'archive' }
  /** Connector hub views (weread / x) — light center pages, not a second truth store. */
  | { kind: 'connector'; id: string };

/** Migrate persisted/legacy selection shapes → stream (no living home product). */
export function normalizeSelection(sel: Selection | { kind: string } | null | undefined): Selection {
  if (!sel || typeof sel !== "object" || !("kind" in sel)) return { kind: "stream" };
  if ((sel as { kind: string }).kind === "home") return { kind: "stream" };
  return sel as Selection;
}

/* ── AI ── */

export interface AiSession { id: string; title?: string; updatedAt?: string; }
export type AiRole = 'user' | 'assistant' | 'system';
/** One tool invocation during an agent turn (shown as a card in chat). */
export interface AiToolCall {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  /** Workspace-relative paths for one-click open (from tool result). */
  paths?: string[];
  /** Raw tool output (for diff display in edit_file, etc.). */
  output?: Record<string, unknown>;
}
export interface AiMessage {
  role: AiRole;
  content: string;
  reasoning?: string;
  toolCalls?: AiToolCall[];
}
export interface AiRuntimeStatus { ready: boolean; message: string; providers?: ProviderInfo[]; }
export interface ProviderInfo { id: string; label: string; models: ModelInfo[]; live?: boolean; error?: string; }
export interface ModelInfo {
  id: string;
  label: string;
  /** Short description from models.dev (e.g. "Higher-accuracy GPT-5.2 variant") */
  description?: string;
  /** Supports tool/function calling */
  toolCall?: boolean;
  /** Reasoning/thinking model */
  reasoning?: boolean;
  /** Context window size in tokens */
  contextLimit?: number;
  /** Input cost per million tokens (USD) */
  costInput?: number;
  /** Output cost per million tokens (USD) */
  costOutput?: number;
}

/* ── Settings ── */

export interface ModelCacheEntry {
  id: string;
  label: string;
  models: ModelInfo[];
  live?: boolean;
  error?: string;
}

export interface ModelCache {
  catalog: ModelCacheEntry[];
  fetchedAt: string;
}

export interface WereadStatsCache {
  mode: string;
  fetchedAt: string;
  totalReadTime: number;
  readDays: number;
  dayAverageReadTime: number;
  compare: number | null;
  preferCategoryWord: string;
  preferTimeWord: string;
  readStat: { stat: string; counts: string }[];
  topBooks: { title: string; author: string; readTime: number; bookId: string | null }[];
  preferCategories: { title: string; readingTime: number; readingCount: number }[];
  fromCache?: boolean;
}

export interface WereadLastSyncSummary {
  synced: number;
  skippedNoChange: number;
  skipped: number;
  remaining: number;
  total: number;
  isPartial: boolean;
}

export interface WereadSettings {
  enabled: boolean;
  apiKey: string;
  lastSyncAt: string | null;
  lastSyncSummary?: WereadLastSyncSummary | null;
  syncCategory: string;
  /** Include personal thoughts/reviews from /review/list/mine (default true). */
  includeThoughts?: boolean;
  /** Soft per-run budget in minutes (1–15, default 4). */
  syncBudgetMinutes?: number;
  /** Cached slim reading stats for hub UI. */
  statsCache?: WereadStatsCache | null;
}

export interface WereadNotebookBook {
  bookId: string;
  title: string;
  author: string;
  cover?: string;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
  remoteExportableCount: number;
  readingStatus?: string;
  sort?: number;
}

export interface WereadSyncResult {
  ok: boolean;
  synced: number;
  skipped: number;
  skippedNoChange?: number;
  skippedNoHighlights?: number;
  total: number;
  totalHighlights?: number;
  totalThoughts?: number;
  remaining?: number;
  lastSyncAt?: string;
  syncCategory?: string;
  isPartial?: boolean;
  message?: string;
  paths?: string[];
  skillVersion?: string;
  errors?: { bookId?: string; title?: string; error: string }[];
}

export interface XSettings {
  enabled: boolean;
  /** App-only Bearer — read-only for Desktop Direct API. */
  bearerToken: string;
  /**
   * Advisory: official MCP URL for agent hosts (`https://api.x.com/mcp`).
   * Desktop does not embed the OAuth MCP bridge; use Bearer + xurl instead.
   */
  mcpEndpoint: string;
  /** Target category for tweet archives; `auto` = discover reference-like category. */
  syncCategory: string;
  autoArchivePosts: boolean;
}

/** Browser extension → Desktop loopback Clip Bridge. */
export interface ClipBridgeSettings {
  /** When true, Desktop listens on 127.0.0.1:port */
  enabled: boolean;
  port: number;
  /** Bearer token required by extension; empty until first enable/rotate */
  token: string;
  /** Download remote images into Inbox/images/ and rewrite markdown (default true) */
  downloadImages?: boolean;
}

/** Knowledge ingest pipeline (Office / PDF / email → Markdown). */
export interface IngestSettings {
  enabled: boolean;
  /** Keep original under 99-Archive/ingest-originals/ after convert */
  keepOriginal: boolean;
  maxFileBytes: number;
  maxFolderFiles: number;
  concurrency: number;
  defaultDest: "inbox" | "topic";
  preferExternalConverters: boolean;
  autoConvert: boolean;
  /**
   * When true, path batches open a confirm sheet before enqueue.
   * Default false = auto enter the processing queue (same speed as legacy drop).
   */
  confirmBeforeConvert?: boolean;
  /** In confirm mode, a single .md/.txt may skip the sheet. */
  skipConfirmForSingleMd?: boolean;
  /** After auto-enqueue, navigate to knowledge-ingest hub. */
  openQueueOnEnqueue?: boolean;
}

/** One path in an ingest pipeline batch (path reference; no binary copy yet). */
export interface IngestBatchItem {
  absolutePath: string;
  name: string;
  size?: number;
  kind?: string;
  convertible?: boolean;
  selected?: boolean;
  isDirectory?: boolean;
  warning?: string;
}

/** Unified capture UX (overlay + global sticky float). Partial on disk / patches OK. */
export interface CaptureSettings {
  /** OS global shortcut (⌘⇧N): float sticky note or main overlay */
  globalMode?: "float" | "overlay";
  floatAlwaysOnTop?: boolean;
  /** Auto-detect clipboard files when opening float / on smart paste */
  smartPaste?: boolean;
  /** Close float window after successful save */
  closeFloatOnSave?: boolean;
  /**
   * Keep system tray icon always visible (recommended on Windows/Linux).
   * Tray provides: show app · quick capture · knowledge ingest · quit.
   */
  showTray?: boolean;
}

export type IngestJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface IngestJob {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status: IngestJobStatus;
  source: { kind?: string; path: string; name: string; size?: number };
  dest: { mode: "inbox" | "topic"; topicId?: string };
  progress?: number;
  result?: {
    targetPath?: string;
    title?: string;
    converter?: string;
    warnings?: string[];
    fallback?: boolean;
    originalArchivePath?: string;
  };
  error?: string;
}

/** Normalized tweet used by X connector UI / sync. */
export interface XTweet {
  id?: string;
  text: string;
  username: string;
  created_at?: string | null;
  url?: string;
  public_metrics?: unknown;
}

export type WritebackMode = 'auto' | 'confirm';
export type SidebarViewMode = 'stream' | 'category' | 'timeline' | 'tags' | 'kanban';

export interface AppSettings {
  theme: 'auto' | 'light' | 'dark';
  workspaceRoot: string;
  writebackMode: WritebackMode | string;
  workspaces: { recent: RecentWorkspace[] };
  window: { bounds: { width: number; height: number } | null; isMaximized: boolean };
  ai: {
    sourcePreference: string;
    defaultModel: string | null;
    /** Desktop Agent tools on by default; persists across restarts. */
    agentEnabled: boolean;
    /**
     * Skill-first mode: inject bundled topmind pack catalog into system prompt
     * and expose list_skills / load_skill tools (default true).
     */
    skillsEnabled?: boolean;
    /**
     * Auto-scan lifecycle/memory candidates into AI suggestion strip on open (default true).
     * May use AI when a provider is configured; never auto-applies high-impact writes.
     */
    autoPrepareSuggestions?: boolean;
    /**
     * Auto-run AI todo maintain from stream (extract / complete / update).
     * Default false — spends tokens; manual via Stream ✨ / Todo panel when off.
     */
    autoMaintainTodos?: boolean;
    /** null = all pack skills; otherwise allow-list of skill ids */
    enabledSkillIds?: string[] | null;
    /**
     * Extra skill pack roots (absolute dirs containing SKILL.md packages).
     * Merged with env topmind_SKILLS_EXTRA and managed skills-extra installs.
     */
    extraSkillsRoots?: string[];
    /** Multi-step agent loop cap (3–20). */
    maxAgentSteps?: number;
    manual: {
      openAiKey: string;
      anthropicKey: string;
      deepseekKey: string;
      googleKey: string;
      moonshotKey: string;
      zhipuKey: string;
      minimaxKey: string;
      xaiKey: string;
      customBaseUrl: string;
      customKey: string;
      /** Ollama local endpoint (default http://127.0.0.1:11434/v1) */
      ollamaBaseUrl: string;
    };
    modelCache: ModelCache | null;
  };
  weread: WereadSettings;
  x: XSettings;
  /**
   * Third-party Desktop plugins under `{desktopHome}/plugins/`.
   * `externalEnabled[id] === false` disables; missing key = enabled
   * (still respects manifest.enabled).
   */
  plugins?: {
    externalEnabled?: Record<string, boolean>;
  };
  /** Optional browser-extension clip bridge (off by default). */
  clipBridge?: ClipBridgeSettings;
  /** Knowledge document ingest pipeline. */
  ingest?: IngestSettings;
  /** Global / unified capture surface preferences. */
  capture?: CaptureSettings;
  editor: {
    fontSize: number;
    lineHeight: number;
    fontFamily: string;
    /** Debounced auto-save delay for the Markdown editor (ms). */
    autoSaveMs: number;
    /** Soft-wrap long lines. */
    wordWrap?: boolean;
    /**
     * multi = Chrome-style multi-tab (default); single = one unpinned file tab.
     * Also mirrored to view-store / localStorage for instant UI.
     */
    tabMode?: "multi" | "single";
    /**
     * Reading column width for Markdown edit/preview.
     * compact ~40rem · reading ~52rem · wide ~72rem · full = fill canvas
     */
    contentWidth?: "compact" | "reading" | "wide" | "full";
    /** Prose column padding: compact · comfortable · spacious */
    pagePadding?: "compact" | "comfortable" | "spacious";
    /** Edit/preview canvas paper tone (not global theme). */
    paper?: "default" | "soft" | "paper" | "sepia";
  };
  ui?: {
    sidebarWidth?: number;
    sidebarCollapsed?: boolean;
    aiPanelOpen?: boolean;
    aiPanelWidth?: number;
    /** Default sidebar view (tree / timeline / tags / kanban). */
    sidebarView?: SidebarViewMode | string;
    /**
     * Tree / list file visibility:
     * default = md+html+txt+office+pdf · markdown · all
     */
    fileFilter?: FileFilterMode | string;
    /**
     * Close window: ask (prompt once) · quit · hide (keep app in dock/taskbar)
     */
    closeBehavior?: CloseBehavior | string;
    /** UI locale: `auto` (follow OS) · `zh-CN` · `en-US`. */
    locale?: 'auto' | 'zh-CN' | 'en-US';
  };
  launchStatus?: LaunchStatus;
}

export interface LaunchStatus {
  ok: boolean;
  reason: string | null;
  requestedPath: string | null;
  errorMessage: string | null;
}

export interface RecentWorkspace { rootPath: string; lastOpenedAt: string; }

/* ── Todo ── */

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  source?: 'manual' | 'ai' | 'stream';
  sourcePeriod?: string;
  dueDate?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface TodoHealth {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  stale: number;
  oldCompleted: number;
  staleItems: string[];
}

/* ── Overlay ── */

export type OverlayKind =
  | 'none'
  | 'quick-capture'
  | 'settings'
  | 'command-palette'
  | 'search'
  | 'about'
  | 'loop-report'
  | (string & {});

/* Optional payload carried alongside an overlay. Lets one overlay component
   serve multiple intents — e.g. QuickCapture runs in 'capture' mode (→ Inbox)
   or 'memory' mode (→ append to a topic's Stable Memory) depending on intent. */
export type OverlayIntent = 'capture' | 'memory';
export interface OverlayContext {
  intent?: OverlayIntent;
  topicId?: string;
  /** Loop report payload when overlay kind is loop-report */
  loopReport?: LoopReportPayload;
}

/** Result of workspace.workspaceHealth for Loop overlay. */
export interface LoopReportPayload {
  ok?: boolean;
  summary?: {
    categoryCount?: number;
    topicCount?: number;
    looseNoteCount?: number;
    errorCount?: number;
    warningCount?: number;
  };
  issues?: { severity: string; code?: string; message: string; path?: string }[];
  ranAt?: string;
}

/* ── Writeback ── */

/** Path receipt returned by mutating workspace ops (save / delete / move / publish…). */
export interface WritebackEvidence {
  operation: string;
  targetPath: string;
  savedAt: string;
  writebackMode?: WritebackMode | string;
  affectedFiles?: string[];
  wroteFiles?: boolean;
  backupPath?: string;
  receiptPath?: string;
  revisionPath?: string;
  nextActions?: string[];
  /** Compat: many callers still check ok / path / newPath. */
  ok?: boolean;
  path?: string;
  newPath?: string;
}
