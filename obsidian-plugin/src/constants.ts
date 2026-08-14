// ── Constants: view types, command IDs, AI provider presets ────────────────

import { CURATED_DEFAULT_MODELS } from "../../lib/model-catalog.mjs";

/** ItemView type for the main Stream Workbench */
export const VIEW_TYPE_STREAM_WORKBENCH = "topmind-stream-workbench";

/** ItemView type for the sidebar dock */
export const VIEW_TYPE_SIDEBAR_DOCK = "topmind-sidebar-dock";

/** Command IDs */
export const CMD_QUICK_CAPTURE = "topmind-quick-capture";
export const CMD_OPEN_WORKBENCH = "topmind-open-workbench";
export const CMD_OPEN_SIDEBAR = "topmind-open-sidebar";
export const CMD_ORGANIZE_PERIOD = "topmind-organize-period";
export const CMD_REFRESH_SUGGESTIONS = "topmind-refresh-suggestions";
export const CMD_MAINTAIN_TODOS = "topmind-maintain-todos";
export const CMD_TOPIC_CLASSIFY = "topmind-topic-classify";
export const CMD_MEMORY_ORGANIZE = "topmind-memory-organize";
export const CMD_OPEN_PROFILE = "topmind-open-profile";
export const CMD_OPEN_INBOX = "topmind-open-inbox";

/**
 * AI provider metadata — aligned with Desktop's provider list.
 * Each entry includes: label, baseUrl, default model, help URL, group, and API type.
 *
 * Groups: "international" | "domestic" | "local"
 * API types: "openai-compat" | "anthropic" | "google"
 */
export interface AiProviderMeta {
  label: string;
  baseUrl: string;
  model: string;
  helpUrl: string;
  group: "international" | "domestic" | "local";
  apiType: "openai-compat" | "anthropic" | "google";
}

export const AI_PROVIDER_PRESETS: Record<string, AiProviderMeta> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    helpUrl: "https://platform.openai.com/api-keys",
    group: "international",
    apiType: "openai-compat",
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-20250514",
    helpUrl: "https://console.anthropic.com/settings/keys",
    group: "international",
    apiType: "anthropic",
  },
  google: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
    helpUrl: "https://aistudio.google.com/apikey",
    group: "international",
    apiType: "google",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    helpUrl: "https://platform.deepseek.com/api_keys",
    group: "domestic",
    apiType: "openai-compat",
  },
  moonshot: {
    label: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    helpUrl: "https://platform.moonshot.cn/console/api-keys",
    group: "domestic",
    apiType: "openai-compat",
  },
  zhipu: {
    label: "Zhipu / GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    helpUrl: "https://open.bigmodel.cn/console/apikey",
    group: "domestic",
    apiType: "openai-compat",
  },
  minimax: {
    label: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-Text-01",
    helpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    group: "domestic",
    apiType: "openai-compat",
  },
  xai: {
    label: "xAI / Grok",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3-mini",
    helpUrl: "https://console.x.ai",
    group: "international",
    apiType: "openai-compat",
  },
  ollama: {
    label: "Ollama (Local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    helpUrl: "https://ollama.com",
    group: "local",
    apiType: "openai-compat",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    model: "",
    helpUrl: "",
    group: "local",
    apiType: "openai-compat",
  },
};

/**
 * Provider list for settings UI, grouped by category.
 */
export const PROVIDER_GROUPS: { id: string; label: string; providers: string[] }[] = [
  {
    id: "international",
    label: "settings_ai_international",
    providers: ["openai", "anthropic", "google", "xai"],
  },
  {
    id: "domestic",
    label: "settings_ai_domestic",
    providers: ["deepseek", "moonshot", "zhipu", "minimax"],
  },
  {
    id: "local",
    label: "settings_ai_local",
    providers: ["ollama", "custom"],
  },
];

/**
 * Curated default model lists — fallback only.
 * Live source of truth is official list-models + models.dev (lib/model-catalog.mjs).
 */
export const PROVIDER_DEFAULT_MODELS: Record<string, { id: string; label: string }[]> =
  CURATED_DEFAULT_MODELS as Record<string, { id: string; label: string }[]>;
