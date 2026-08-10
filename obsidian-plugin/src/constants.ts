// ── Constants: view types, command IDs, AI provider presets ────────────────

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
 * Curated default model lists for providers without a live /models endpoint.
 * Used as fallback suggestions in the settings UI model dropdown.
 */
export const PROVIDER_DEFAULT_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-5-20250514", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  ],
  google: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat (V3)" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
  moonshot: [
    { id: "moonshot-v1-8k", label: "Moonshot V1 8K" },
    { id: "moonshot-v1-32k", label: "Moonshot V1 32K" },
    { id: "moonshot-v1-128k", label: "Moonshot V1 128K" },
  ],
  zhipu: [
    { id: "glm-4-flash", label: "GLM-4 Flash" },
    { id: "glm-4", label: "GLM-4" },
    { id: "glm-4-air", label: "GLM-4 Air" },
  ],
  minimax: [
    { id: "MiniMax-Text-01", label: "MiniMax Text 01" },
    { id: "abab6.5s-chat", label: "ABAB 6.5s Chat" },
  ],
  xai: [
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-3", label: "Grok 3" },
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2" },
    { id: "qwen2.5:7b", label: "Qwen 2.5 7B" },
    { id: "mistral", label: "Mistral" },
  ],
};
