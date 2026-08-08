// ── Constants: view types, command IDs ─────────────────────────────────────

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

/** Default AI provider configs */
export const AI_PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-20250514" },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" },
  custom: { baseUrl: "", model: "" },
};
