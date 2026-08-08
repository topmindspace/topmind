// ── en-US locale strings ───────────────────────────────────────────────────

import type { zhCN } from "./zh-CN";

export const enUS: typeof zhCN = {
  // ── Plugin ──
  plugin_name: "Topmind Stream",
  plugin_description: "Stream workbench + AI co-pilot for Obsidian",

  // ── Views ──
  stream_workbench_title: "Stream Workbench",
  sidebar_dock_title: "Topmind",

  // ── Quick Capture ──
  quick_capture_title: "Quick Note",
  quick_capture_placeholder: "Type here...",
  quick_capture_submit: "Submit",
  quick_capture_target: "Target",
  quick_capture_target_stream: "This Week",
  quick_capture_target_inbox: "Inbox",
  quick_capture_hint_enter: "⏎ Submit",
  quick_capture_hint_shift_enter: "⇧⏎ Newline",

  // ── Stream Workbench ──
  stream_this_week: "This Week",
  stream_switch_period: "Switch Period",
  stream_empty: "No entries yet. Quick capture ⚡",
  stream_organize: "Organize",

  // ── Suggestions ──
  suggestions_title: "AI Suggestions",
  suggestions_empty: "No suggestions",
  suggestions_confirm: "Confirm",
  suggestions_dismiss: "Dismiss",
  suggestion_topic: "Suggested Topic",
  suggestion_todo: "Todo Extract",
  suggestion_memory: "Write to Profile",
  suggestion_summary: "Period Summary",

  // ── Sidebar Dock ──
  sidebar_today_todos: "Today's Todos",
  sidebar_recent_stream: "Recent",
  sidebar_open_workbench: "Open Workbench",
  sidebar_no_todos: "No todos",
  sidebar_no_stream: "No entries",

  // ── Commands ──
  cmd_quick_capture: "Topmind: Quick Note",
  cmd_open_workbench: "Topmind: Open Stream Workbench",
  cmd_open_sidebar: "Topmind: Open Sidebar",
  cmd_organize_period: "Topmind: Organize This Week",
  cmd_refresh_suggestions: "Topmind: Refresh AI Suggestions",
  cmd_maintain_todos: "Topmind: AI Maintain Todos",

  // ── Settings ──
  settings_workspace: "Workspace & Contract",
  settings_stream: "Workbench",
  settings_ai: "AI Co-pilot & Writeback",
  settings_security: "Security & Archive",

  settings_auto_open: "Auto-open Workbench on Startup",
  settings_auto_open_desc: "Open stream workbench tab when Obsidian starts",
  settings_timeline_order: "Timeline Order",
  settings_timeline_order_desc: "Newest first or oldest first",
  settings_auto_tag: "Auto Tag Parsing",
  settings_auto_tag_desc: "Extract #tags automatically",

  settings_ai_provider: "AI Provider",
  settings_ai_provider_desc: "Choose AI provider (works without AI too)",
  settings_ai_key: "API Key",
  settings_ai_key_desc: "API key for the AI provider",
  settings_ai_base_url: "API Base URL",
  settings_ai_base_url_desc: "OpenAI-compatible API endpoint",
  settings_ai_model: "Model",
  settings_ai_model_desc: "Model name to use",
  settings_writeback_mode: "Writeback Mode",
  settings_writeback_mode_desc: "Auto-save or ask before save",
  settings_auto_suggest: "Auto-prepare AI Suggestions",
  settings_auto_suggest_desc: "Scan and generate suggestion cards on workspace ready",
  settings_auto_maintain_todos: "Auto-maintain Todos",
  settings_auto_maintain_todos_desc: "Auto-extract todos from stream (off by default, saves tokens)",

  settings_backup_keep: "Backup Keep Count",
  settings_backup_keep_desc: "Number of backups to keep for AI writes (0 = disabled)",
  settings_receipt_keep: "Receipt Keep Count",
  settings_receipt_keep_desc: "Number of write receipts to keep (old ones pruned automatically)",

  // ── Writeback notices ──
  notice_write_pending: "Write pending — please confirm in review",
  notice_written: "Saved",
  notice_write_failed: "Write failed",
  notice_executed: "Done",
  notice_execute_failed: "Execution failed",
  notice_organizing: "Organizing...",
  notice_organize_done: "Organized ✓",
  notice_workspace_not_ready: "Current vault is not a topmind workspace (topmind.yaml missing)",

  // ── Accessibility ──
  stream_expand_entry: "Click to expand/collapse entry",

  // ── URL detection ──
  notice_url_to_inbox: "URL detected — routed to Inbox",
  compose_url_hint: "URL detected — use Quick Capture to fetch content to Inbox",

  // ── General ──
  loading: "Loading...",
  error: "Error",
  saved: "Saved",
  init_workspace: "Initialize Workspace",
  init_workspace_desc: "Create topmind workspace structure in current vault",
  init_workspace_success: "Workspace initialized",
  init_workspace_failed: "Initialization failed",

  // ── Writeback modes ──
  writeback_auto: "Auto Save",
  writeback_confirm: "Ask Before Save",

  // ── Workspace modes ──
  // (removed workspaceMode — Kernel auto-detects)

  // ── Timeline order labels ──
  timeline_desc: "↓ Newest first",
  timeline_asc: "↑ Oldest first",

  // ── AI providers ──
  provider_none: "No AI",
  provider_openai: "OpenAI",
  provider_deepseek: "DeepSeek",
  provider_anthropic: "Anthropic",
  provider_ollama: "Ollama (Local)",
  provider_custom: "Custom (OpenAI-compatible)",

  // ── AI connection test ──
  settings_ai_test: "Test Connection",
  settings_ai_testing: "Testing...",
  settings_ai_test_success: "Connection successful ✓",
  settings_ai_test_failed: "Connection failed",
  settings_ai_test_no_key: "Please enter API Key first",

  // ── Security note ──
  settings_security_note: "API Key is stored in Obsidian plugin data.json (plaintext). Do not use in shared vaults.",
};
