// ── en-US locale strings ───────────────────────────────────────────────────

import type { zhCN } from "./zh-CN";

export const enUS: typeof zhCN = {
  // ── Plugin ──
  plugin_name: "Topmind Stream",
  plugin_description: "Stream workbench + AI co-pilot for Obsidian",

  // ── Views ──
  stream_workbench_title: "Stream Workbench",

  // ── Quick Capture (product vocab: Note it / 记一下) ──
  quick_capture_title: "Note it",
  quick_capture_placeholder: "Type here...",
  quick_capture_submit: "Log it",
  quick_capture_target: "Target",
  quick_capture_target_stream: "This week's stream",
  quick_capture_target_inbox: "Inbox",
  quick_capture_hint_enter: "⏎ Log it",
  quick_capture_hint_shift_enter: "⇧⏎ Newline",
  quick_capture_tags: "Tags",
  quick_capture_tags_placeholder: "#tag1 #tag2",
  quick_capture_note_it: "Note it",
  quick_capture_log_it: "Log it",

  // ── Stream Workbench ──
  stream_this_week: "Stream",
  stream_switch_period: "Switch Period",
  stream_empty: "No entries yet",
  stream_empty_hint: "Type in the input above and press Enter to log",
  stream_organize: "Organize",
  stream_entry_count: "{{count}} entries",
  stream_open_in_editor: "Open in Editor",
  stream_loading: "Loading...",
  stream_day_today: "Today",
  stream_day_yesterday: "Yesterday",
  stream_period_label: "Period",

  // ── Suggestions ──
  suggestions_title: "AI Suggestions",
  suggestions_empty: "No suggestions",
  suggestions_empty_hint: "AI will show suggestions after organizing",
  suggestions_disabled: "AI suggestions disabled",
  suggestions_disabled_hint: "Enable \"Auto-prepare AI Suggestions\" in settings",
  suggestions_no_ai: "AI not configured",
  suggestions_no_ai_hint: "Configure an AI provider to enable suggestions",
  suggestions_confirm: "Confirm",
  suggestions_dismiss: "Dismiss",
  suggestions_loading: "AI is thinking...",
  suggestion_topic: "Suggested Topic",
  suggestion_todo: "Todo Extract",
  suggestion_memory: "Write to My profile",
  suggestion_summary: "Period Reflection",
  suggestion_impact_high: "High impact",
  suggestion_impact_medium: "Medium impact",
  suggestion_impact_low: "Low impact",

  // ── Sidebar Dock (AI Copilot Panel) ──
  sidebar_dock_title: "AI Copilot",
  sidebar_today_todos: "Today's Todos",
  sidebar_recent_stream: "Recent stream",
  sidebar_open_workbench: "Open Workbench",
  sidebar_no_todos: "No todos",
  sidebar_no_stream: "No stream entries",
  sidebar_ai_status: "AI Status",
  sidebar_ai_ready: "AI Ready",
  sidebar_ai_off: "Not configured",
  sidebar_view_all_todos: "View all",
  sidebar_todos_done: "done",
  sidebar_quick_capture: "Note it",
  sidebar_quick_organize: "Organize",
  sidebar_quick_classify: "Classify",

  // ── Sidebar Tabs ──
  sidebar_tab_todos: "Todos",
  sidebar_tab_suggestions: "Suggestions",
  sidebar_tab_chat: "Chat",
  sidebar_tab_stream: "Stream",

  // ── Todo ──
  todo_open_source: "Open source note",
  todo_open_file: "Open todo file",

  // ── Sidebar Header ──
  sidebar_model_label: "Model",
  sidebar_model_none: "None",
  sidebar_open_settings: "Settings",
  sidebar_open_sidebar: "Open Sidebar",
  sidebar_ai_operations: "AI Operations",
  sidebar_op_todo: "Maintain Todos",
  sidebar_op_memory: "Organize Memory",
  sidebar_op_classify: "Classify Topics",
  sidebar_op_suggestions: "Refresh Suggestions",

  // ── AI Chat ──
  chat_title: "AI Chat",
  chat_placeholder: "Ask something... (Enter to send, Shift+Enter for newline)",
  chat_send: "Send",
  chat_empty: "Chat with AI about your notes, todos and stream",
  chat_empty_hint: "AI answers based on your recent stream entries and todos",
  chat_no_ai: "AI not configured — chat unavailable",
  chat_no_ai_hint: "Please configure an AI provider in settings",
  chat_thinking: "Thinking...",
  chat_clear: "Clear chat",
  chat_error: "Chat error, please try again",
  chat_you: "You",
  chat_ai: "AI",
  chat_context_label: "Context",
  chat_context_stream: "Recent stream",
  chat_context_todos: "Current todos",
  chat_context_profile: "My profile",

  // ── AI Task Manager (multi-task progress) ──
  task_pending: "Queued",
  task_running: "Running",
  task_done: "Done",
  task_error: "Failed",
  task_aborted: "Aborted",
  task_abort: "Cancel",
  task_queue_empty: "No AI tasks",
  task_active_count: "{{count}} task(s) active",
  task_queued_count: "{{count}} queued",
  task_recent: "Recent tasks",
  task_clear_history: "Clear history",
  task_no_history: "No task history",
  task_result_ok: "Done ✓",
  task_result_failed: "Failed",

  // ── AI Operation Labels ──
  op_label_suggest: "Generate AI Suggestions",
  op_label_todo_maintain: "Maintain Todos",
  op_label_topic_classify: "Classify Topics",
  op_label_memory_organize: "Organize Memory",
  op_label_reconcile: "Reconcile Stream",
  op_label_chat: "AI Chat",

  // ── Model metadata ──
  model_context_limit: "Context {{limit}}",
  model_reasoning: "Reasoning model",
  model_cost: "Cost",
  model_no_data: "No metadata",
  model_select_hint: "Select model (or type custom)",
  model_custom_input: "Custom model ID",

  // ── Stream enhancements ──
  stream_today: "Today",
  stream_yesterday: "Yesterday",
  stream_this_period: "This period",
  stream_entries_total: "{{count}} total",
  stream_jump_to_latest: "Jump to latest",
  stream_no_periods: "No period notes",
  stream_collapse_all: "Collapse all",
  stream_expand_all: "Expand all",
  stream_card_copied: "Copied to clipboard",

  // ── Sidebar enhancements ──
  sidebar_action_label_show: "Show labels",
  sidebar_action_label_hide: "Hide labels",
  sidebar_no_suggestions: "No suggestions",
  sidebar_suggestions_count: "{{count}} suggestions",
  sidebar_chat_persisted: "Chat saved (within session)",
  sidebar_tab_history: "Task History",

  // ── Commands ──
  cmd_quick_capture: "Topmind: Note it",
  cmd_open_workbench: "Topmind: Open Stream Workbench",
  cmd_open_sidebar: "Topmind: Open Sidebar",
  cmd_organize_period: "Topmind: Organize This Week",
  cmd_refresh_suggestions: "Topmind: Refresh AI Suggestions",
  cmd_maintain_todos: "Topmind: AI Maintain Todos",
  cmd_topic_classify: "Topmind: Classify Topics",
  cmd_memory_organize: "Topmind: Organize Memory",
  cmd_open_profile: "Topmind: Open My Profile",
  cmd_open_inbox: "Topmind: Open Inbox",

  // ── Settings ──
  settings_workspace: "Workspace & Contract",
  settings_stream: "Workbench",
  settings_ai: "AI Co-pilot & Save",
  settings_security: "Security & Archive",

  settings_auto_open: "Auto-open Workbench on Startup",
  settings_auto_open_desc: "Open stream workbench tab when Obsidian starts",
  settings_timeline_order: "Timeline Order",
  settings_timeline_order_desc: "Newest first or oldest first",
  settings_auto_tag: "Auto Tag Parsing",
  settings_auto_tag_desc: "Extract #tags automatically",
  settings_locale_override: "Interface Language",
  settings_locale_override_desc: "Override Obsidian's auto-detected language (default: follow Obsidian)",

  // ── AI settings ──
  settings_ai_status: "AI Status",
  settings_ai_status_desc: "Shows current AI configuration status",
  settings_ai_ready: "Configured — AI features available",
  settings_ai_not_configured: "Not configured — basic features still work",
  settings_ai_preference: "Default Provider",
  settings_ai_preference_desc: "Choose preferred AI provider (empty = auto-select)",
  settings_ai_auto: "Auto (by configuration order)",
  settings_ai_model: "Model",
  settings_ai_model_desc: "Select model to use (empty = provider default)",
  settings_ai_model_default: "Provider default",
  settings_ai_import: "Import from Desktop",
  settings_ai_import_desc: "Attempt to import AI keys from topmind Desktop's app-settings.json",
  settings_ai_import_not_found: "Desktop settings file not found",
  settings_ai_import_encrypted: "Desktop keys are encrypted (safeStorage) — cannot import. Please configure manually.",
  settings_ai_import_success: "Imported {{count}} provider configurations",
  settings_ai_import_nothing: "No new configurations to import (already configured or not set in Desktop)",
  settings_ai_clear_key: "Clear key",
  settings_ai_international: "International Providers",
  settings_ai_domestic: "Domestic Providers",
  settings_ai_local: "Local / Compatible",

  settings_ai_provider: "AI Provider",
  settings_ai_provider_desc: "Choose AI provider (works without AI too)",
  settings_ai_key: "API Key",
  settings_ai_key_desc: "API key for the AI provider",
  settings_ai_base_url: "API Base URL",
  settings_ai_base_url_desc: "OpenAI-compatible API endpoint",
  settings_ai_model_field: "Model",
  settings_ai_model_field_desc: "Model name to use",
  settings_writeback_mode: "Save Mode",
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
  notice_load_failed: "Plugin load failed",
  notice_todo_running: "AI maintaining todos...",
  notice_todo_done: "Todos maintained ✓",
  notice_classify_running: "Classifying topics...",
  notice_classify_done: "Topics classified ✓",
  notice_memory_running: "Organizing memory...",
  notice_memory_done: "Memory organized ✓",
  notice_no_inbox: "Inbox directory not found",
  notice_new_note_created: "New note created",
  notice_new_note_failed: "Failed to create note",

  // ── Accessibility ──
  stream_expand_entry: "Click to expand/collapse entry",

  // ── URL detection ──
  notice_url_to_inbox: "URL detected — routed to Inbox",
  compose_url_hint: "URL detected — use Note it to fetch content to Inbox",

  // ── General ──
  loading: "Loading...",
  error: "Error",
  saved: "Saved",
  init_workspace: "Initialize Workspace",
  init_workspace_desc: "Create topmind workspace structure in current vault",
  init_workspace_success: "Workspace initialized",
  init_workspace_failed: "Initialization failed",

  // ── Workspace status ──
  workspace_status: "Workspace Status",
  workspace_ready: "Ready",
  workspace_not_ready: "Not initialized",
  workspace_categories_count: "{{count}} categories",
  workspace_contract_valid: "Contract Valid",
  workspace_contract_invalid: "Contract Invalid",
  workspace_contract_doctor: "Contract Doctor",
  workspace_contract_doctor_desc: "Check and repair workspace contract",
  workspace_contract_reseed: "Reseed Contract",
  workspace_contract_reseed_desc: "Backup bad file and rewrite default contract (content unaffected)",
  workspace_contract_doctor_ok: "Contract OK ✓",
  workspace_contract_doctor_fixed: "Contract repaired ✓",
  workspace_contract_doctor_failed: "Contract doctor failed",
  workspace_contract_reseed_ok: "Contract reseeded ✓",
  workspace_contract_reseed_failed: "Reseed failed",
  workspace_template: "Template",
  workspace_no_categories: "No category directories found",

  // ── Writeback modes ──
  writeback_auto: "Auto Save",
  writeback_confirm: "Ask Before Save",

  // ── Timeline order labels ──
  timeline_desc: "↓ Newest first",
  timeline_asc: "↑ Oldest first",

  // ── Locale ──
  locale_auto: "Auto (follow Obsidian)",

  // ── AI providers ──
  provider_none: "No AI",
  provider_openai: "OpenAI",
  provider_deepseek: "DeepSeek",
  provider_anthropic: "Anthropic",
  provider_google: "Google Gemini",
  provider_moonshot: "Moonshot / Kimi",
  provider_zhipu: "Zhipu / GLM",
  provider_minimax: "MiniMax",
  provider_xai: "xAI / Grok",
  provider_ollama: "Ollama (Local)",
  provider_custom: "Custom (OpenAI-compatible)",

  // ── AI connection test ──
  settings_ai_test: "Test Connection",
  settings_ai_testing: "Testing...",
  settings_ai_test_success: "Connection successful ✓",
  settings_ai_test_failed: "Connection failed",
  settings_ai_test_no_key: "Please configure at least one AI provider first",

  // ── Security note ──
  settings_security_note: "API Key is stored in Obsidian plugin data.json (plaintext). Do not use in shared vaults.",

  // ── Chat model switching ──
  chat_model: "Model",
  chat_model_select: "Select model",
  chat_provider_select: "Provider",
  chat_context_sources: "Context sources",
  chat_copy: "Copy",
  chat_copied: "Copied ✓",
  chat_regenerate: "Regenerate",
  chat_configure_ai: "Configure AI",
  chat_no_ai_action: "Click to configure AI provider",
  chat_send_failed: "Send failed, click to retry",
  chat_retry: "Retry",
  chat_context_empty: "No context (workspace may be empty)",
  chat_model_switch_hint: "Switching model does not affect current chat history",

  // ── AI availability ──
  ai_available: "AI Available",
  ai_unavailable: "AI Unavailable",
  ai_checking: "Checking...",
  ai_not_tested: "Configured (not tested)",
  ai_test_ok: "Connection OK ✓",
  ai_test_fail: "Connection failed",
  settings_ai_quick_test: "Quick Test",
  settings_ai_quick_test_desc: "Send a test request to verify AI connectivity",

  // ── Settings model fix ──
  settings_ai_model_for_provider: "{{provider}} Model",
  settings_ai_refresh_models: "Refresh models",
  settings_ai_refreshing_models: "Fetching...",

  // ── Empty state actions ──
  empty_action_configure: "Go to settings to configure AI",

  // ── Button labels (for clarity) ──
  toolbar_btn_sidebar: "Sidebar",
  toolbar_btn_settings: "Settings",
  toolbar_btn_inbox: "Inbox",
  toolbar_btn_new_note: "New Note",
  toolbar_btn_profile: "Profile",
  toolbar_btn_refresh: "Refresh",
  stream_btn_copy: "Copy",
  stream_btn_edit: "Edit",
  chat_btn_copy: "Copy",
  chat_btn_regenerate: "Regenerate",
  sidebar_btn_capture: "Note it",
  sidebar_btn_organize: "Organize",
  sidebar_btn_todo: "Todos",
  sidebar_btn_classify: "Classify",
  sidebar_btn_memory: "Memory",
  sidebar_btn_suggestions: "Suggest",
  sidebar_btn_workbench: "Workbench",

  // ── AI model switcher ──
  chat_model_current: "Current model",
  chat_model_switch: "Switch model",
  chat_provider_switch: "Switch provider",
  chat_no_models: "No models available",
  settings_ai_no_provider: "No AI provider configured",
  settings_ai_provider_configured: "Configured",
  settings_ai_provider_not_configured: "Not configured",
  settings_ai_model_custom: "Custom model",
  settings_ai_model_enter_custom: "Enter custom model ID",
  settings_ai_model_select_hint: "Please select an AI model",
  settings_ai_model_select_hint_desc: "An API key was detected but no model is selected. Please choose a model above, or leave empty to use the provider default.",
};
