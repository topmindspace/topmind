// ── Shared type definitions ────────────────────────────────────────────────

/**
 * AI provider identifiers — aligned with Desktop's provider IDs.
 * Adding providers here automatically makes them available in settings + AI adapter.
 */
export type AiProviderType =
  | "none"
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "xai"
  | "ollama"
  | "custom";

/** Writeback mode */
export type WritebackMode = "auto" | "confirm";

/** Timeline sort order */
export type TimelineOrder = "desc" | "asc";

/** Capture target */
export type CaptureTarget = "stream" | "inbox";

/**
 * Multi-provider API key storage — mirrors Desktop's `ai.manual` structure.
 * All keys are stored simultaneously; the user picks a `sourcePreference`.
 */
export interface AiManualKeys {
  openAiKey: string;
  anthropicKey: string;
  googleKey: string;
  deepseekKey: string;
  moonshotKey: string;
  zhipuKey: string;
  minimaxKey: string;
  xaiKey: string;
  customBaseUrl: string;
  customKey: string;
  ollamaBaseUrl: string;
}

/**
 * AI configuration block — aligned with Desktop's `ai` settings shape.
 * Supports multi-provider simultaneously (not one-at-a-time like the old model).
 */
export interface AiConfig {
  /** Preferred provider ID ("" = auto, picks first configured). */
  sourcePreference: string;
  /** Default model override (empty = provider default). */
  defaultModel: string;
  /** All provider keys — configure once, switch preference anytime. */
  manual: AiManualKeys;
}

/** Plugin settings */
export interface TopmindSettings {
  // ── Stream Workbench ──
  autoOpenWorkbench: boolean;
  timelineOrder: TimelineOrder;
  autoTag: boolean;
  /** "" = auto (follow Obsidian locale), "zh-CN" / "en-US" = override. */
  localeOverride: string;

  // ── AI (multi-provider, aligned with Desktop) ──
  ai: AiConfig;
  /** Legacy compat — migrated to ai.sourcePreference on load. Still read by old code paths. */
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

/** Empty multi-provider key store. */
export const EMPTY_AI_MANUAL: AiManualKeys = {
  openAiKey: "",
  anthropicKey: "",
  googleKey: "",
  deepseekKey: "",
  moonshotKey: "",
  zhipuKey: "",
  minimaxKey: "",
  xaiKey: "",
  customBaseUrl: "",
  customKey: "",
  ollamaBaseUrl: "",
};

/** Default settings */
export const DEFAULT_SETTINGS: TopmindSettings = {
  // Stream
  autoOpenWorkbench: true,
  timelineOrder: "desc",
  autoTag: true,
  localeOverride: "",

  // AI — multi-provider model (aligned with Desktop)
  ai: {
    sourcePreference: "",
    defaultModel: "",
    manual: { ...EMPTY_AI_MANUAL },
  },
  // Legacy compat fields (migrated on load; not used for new multi-provider path)
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

/**
 * Migrate old single-provider settings to the new multi-provider model.
 * Called during loadSettings — ensures seamless upgrade for existing users.
 *
 * Migration rules:
 * - If `ai.manual` already has keys → new model is active, keep legacy fields in sync.
 * - If old `aiProvider` !== "none" and has an `aiApiKey` → populate the matching
 *   key in `ai.manual` and set `sourcePreference`.
 * - Ollama (no key needed) → set `ollamaBaseUrl` from `aiBaseUrl`.
 * - Custom → set `customBaseUrl` + `customKey`.
 */
export function migrateSettings(raw: Record<string, unknown>): TopmindSettings {
  // Deep-clone DEFAULT_SETTINGS to avoid mutating the shared constant.
  // Object.assign only shallow-copies, so nested objects like `ai` would
  // be shared references — mutation in one call would corrupt all subsequent calls.
  const merged: TopmindSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    ai: {
      sourcePreference: "",
      defaultModel: "",
      manual: { ...EMPTY_AI_MANUAL },
    },
  } as TopmindSettings;

  // If raw has an ai object, merge its fields into our deep-cloned copy
  if (raw.ai && typeof raw.ai === "object") {
    const rawAi = raw.ai as Record<string, unknown>;
    merged.ai.sourcePreference = String(rawAi.sourcePreference || "");
    merged.ai.defaultModel = String(rawAi.defaultModel || "");
    if (rawAi.manual && typeof rawAi.manual === "object") {
      merged.ai.manual = { ...EMPTY_AI_MANUAL, ...(rawAi.manual as Partial<AiManualKeys>) };
    }
  }

  // Ensure manual has all keys (forward compat — new providers added later)
  merged.ai.manual = { ...EMPTY_AI_MANUAL, ...merged.ai.manual };

  // Migrate old single-provider fields if manual is empty and aiProvider is set
  const oldProvider = raw.aiProvider as string | undefined;
  const oldKey = raw.aiApiKey as string | undefined;
  const oldBaseUrl = raw.aiBaseUrl as string | undefined;
  const oldModel = raw.aiModel as string | undefined;

  const hasAnyNewKey = Object.values(merged.ai.manual).some((v) => v);

  if (!hasAnyNewKey && oldProvider && oldProvider !== "none") {
    const m = merged.ai.manual;
    switch (oldProvider) {
      case "openai":
        m.openAiKey = oldKey || "";
        break;
      case "anthropic":
        m.anthropicKey = oldKey || "";
        break;
      case "deepseek":
        m.deepseekKey = oldKey || "";
        break;
      case "ollama":
        m.ollamaBaseUrl = oldBaseUrl || "http://127.0.0.1:11434/v1";
        break;
      case "custom":
        m.customBaseUrl = oldBaseUrl || "";
        m.customKey = oldKey || "";
        break;
    }
    merged.ai.sourcePreference = oldProvider;
    merged.ai.defaultModel = oldModel || "";
  }

  // Sync legacy aiProvider from sourcePreference for backward compat
  if (merged.ai.sourcePreference) {
    merged.aiProvider = merged.ai.sourcePreference as AiProviderType;
  }

  return merged;
}

/**
 * Check if any provider is configured (has a key or URL).
 */
export function hasConfiguredProvider(ai: AiConfig): boolean {
  const m = ai.manual;
  return Boolean(
    m.openAiKey ||
      m.anthropicKey ||
      m.googleKey ||
      m.deepseekKey ||
      m.moonshotKey ||
      m.zhipuKey ||
      m.minimaxKey ||
      m.xaiKey ||
      (m.customBaseUrl && m.customKey) ||
      m.ollamaBaseUrl,
  );
}

/**
 * Get the key/URL for a specific provider from the manual keys.
 */
export function getProviderKey(provider: string, manual: AiManualKeys): string {
  switch (provider) {
    case "openai": return manual.openAiKey;
    case "anthropic": return manual.anthropicKey;
    case "google": return manual.googleKey;
    case "deepseek": return manual.deepseekKey;
    case "moonshot": return manual.moonshotKey;
    case "zhipu": return manual.zhipuKey;
    case "minimax": return manual.minimaxKey;
    case "xai": return manual.xaiKey;
    case "custom": return manual.customKey;
    case "ollama": return "ollama"; // sentinel — no real key needed
    default: return "";
  }
}

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
 * `kind` aligns with the Kernel suggest-engine kinds (single truth: the kinds
 * `generateSuggestions` / ai-operation-engine actually emit):
 * - suggest-engine rules: `inbox_review` | `inbox_organize` | `stale_topic` |
 *   `catch_all` | `stream_digest` | `promote_memory` | `open_profile`
 * - suggest-engine AI blocks: `ai_summary` (activity digest)
 * - ai-operation-engine ops: `create_topic` (topic_classify),
 *   `promote_memory`/`ai_summary` (memory_organize)
 *
 * `todo_extract` / `topic_classify` are operation ids, never card kinds —
 * they must not appear here (parity guarded by tests/suggest-surface-parity).
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
  | "inbox_organize"
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
  /** Period note where this todo was extracted from (e.g. "2026-W32"). */
  sourcePeriod?: string;
}
