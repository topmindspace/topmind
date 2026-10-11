/**
 * AI tool name constants — shared between ai-tools.mjs (tool builder) and
 * ai-prompts.mjs (system prompt builder).
 *
 * Extracted to a standalone module to avoid a transitive dependency chain:
 * ai-prompts → ai-tools → workspace-service → electron (unavailable in tests).
 */

export const AI_TOOL_NAMES_READ = [
  "list_skills",
  "load_skill",
  "load_skill_resource",
  "workspace_overview",
  "list_categories",
  "list_topics",
  "list_topic_files",
  "get_topic",
  "read_file",
  "search",
  "list_inbox",
  "list_outputs",
  "web_search",
  "fetch_url",
  "workspace_health",
  "list_todos",
  "list_recent_memories",
  "list_recent_stream",
  "list_pending_writes",
  "list_files",
  "glob_files",
  "stat_path",
];

export const AI_TOOL_NAMES_WRITE = [
  "capture_to_inbox",
  "capture_url",
  "save_note",
  "save_file",
  "edit_file",
  "create_topic",
  "append_stream_entry",
  "append_topic_memory",
  "append_core_memory",
  "retire_core_memory",
  "update_core_memory",
  "restore_core_memory",
  "compact_core_memory_history",
  "reconcile_week",
  "move_to_topic",
  "publish_to_outputs",
  "delete_path",
  "rename_path",
  "create_dir",
  "copy_file",
  "add_todo",
  "toggle_todo",
  "update_todo",
  "set_todo_due",
  "delete_todo",
];
