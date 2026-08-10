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
  "fetch_url",
  "workspace_health",
];

export const AI_TOOL_NAMES_WRITE = [
  "capture_to_inbox",
  "save_note",
  "save_file",
  "edit_file",
  "create_topic",
  "append_topic_memory",
  "append_core_memory",
  "reconcile_week",
  "move_to_topic",
  "publish_to_outputs",
  "delete_path",
  "rename_path",
];
