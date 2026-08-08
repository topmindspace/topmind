// ── Shared type definitions ────────────────────────────────────────────────

/** AI provider type selection */
export type AiProviderType = "openai" | "deepseek" | "anthropic" | "ollama" | "custom" | "none";

/** Writeback mode */
export type WritebackMode = "auto" | "confirm";

/** Timeline sort order */
export type TimelineOrder = "desc" | "asc";

/** Capture target */
export type CaptureTarget = "stream" | "inbox";

/** Plugin settings */
export interface TopmindSettings {
  // ── Stream Workbench ──
  autoOpenWorkbench: boolean;
  timelineOrder: TimelineOrder;
  autoTag: boolean;

  // ── AI Co-pilot & Writeback ──
  aiProvider: AiProviderType;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  writebackMode: WritebackMode;
  autoSuggest: boolean;
  autoMaintainTodos: boolean;

  // ── Security & Archive ──
  backupKeep: number;
  receiptKeep: number;
}

/** Default settings */
export const DEFAULT_SETTINGS: TopmindSettings = {
  // Stream
  autoOpenWorkbench: true,
  timelineOrder: "desc",
  autoTag: true,

  // AI
  aiProvider: "none",
  aiApiKey: "",
  aiBaseUrl: "https://api.deepseek.com/v1",
  aiModel: "deepseek-chat",
  writebackMode: "confirm",
  autoSuggest: true,
  autoMaintainTodos: false,

  // Security
  backupKeep: 3,
  receiptKeep: 50,
};

/** Stream period info */
export interface StreamPeriod {
  period: string;
  relPath: string;
  title: string;
  entryCount: number;
  mtime: number;
}

/** Stream entry (parsed from period note) */
export interface StreamEntry {
  time: string;
  text: string;
  tags: string[];
  rawLine: string;
  lineOffset: number;
}

/**
 * Suggestion card data.
 *
 * `kind` aligns with both Kernel suggest-engine kinds and ai-operation-engine
 * suggestion kinds:
 * - From suggest-engine: `inbox_review` | `stale_topic` | `catch_all` |
 *   `stream_digest` | `promote_memory` | `open_profile`
 * - From ai-operation-engine: `create_topic` | `promote_memory` |
 *   `ai_summary` (periodic digest)
 * - From todo-engine (ai-operation): `todo_extract` (AI extracts todos from stream)
 */
export interface SuggestionCard {
  id: string;
  kind: SuggestionKind;
  title: string;
  summary: string;
  impact: ImpactLevel;
  payload?: Record<string, unknown>;
  targetPath?: string;
}

/** All suggestion kinds the Kernel may produce. */
export type SuggestionKind =
  | "create_topic"
  | "promote_memory"
  | "ai_summary"
  | "todo_extract"
  | "inbox_review"
  | "stale_topic"
  | "catch_all"
  | "stream_digest"
  | "open_profile";

/** Impact level (matches Kernel suggest-engine). */
export type ImpactLevel = "high" | "medium" | "low";

/**
 * Todo item — field names align with Kernel todo-engine TodoItem (`done`, not `completed`).
 */
export interface TodoItem {
  id: string;
  text: string;
  /** Completion status (Kernel field name is `done`). */
  done: boolean;
  dueDate?: string;
  createdAt?: string;
  completedAt?: string;
  source?: string;
}
