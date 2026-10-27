/**
 * Obsidian chat tool surface lock — intentional gaps vs Desktop must stay explicit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE, buildAgentToolCatalog, normalizeAgentToolCall } from "../lib/agent-tool-catalog.mjs";

test("Obsidian catalog exposes its supported tools and preserves legacy calls", () => {
  const names = new Set(Object.keys(buildAgentToolCatalog({ host: "obsidian" })));
  assert.equal(normalizeAgentToolCall({ tool: "capture" }).tool, "capture_to_inbox");
  // Core discovery/read/write/lifecycle must be present.
  for (const n of [
    "search", "workspace_overview", "list_categories", "list_topics", "list_topic_files",
    "get_topic", "list_inbox", "list_outputs", "list_todos", "list_recent_memories",
    "list_recent_stream", "list_pending_writes",
    "list_files", "stat_path",
    "glob_files", "workspace_health", "web_search", "fetch_url", "capture_url", "list_skills", "load_skill",
    "read_file", "render_article", "save_file", "save_note", "edit_file", "capture_to_inbox",
    "add_todo", "toggle_todo", "update_todo", "set_todo_due", "delete_todo",
    "append_stream_entry",
    "delete_path", "rename_path",
    "create_topic", "move_to_topic", "publish_to_outputs",
  ]) {
    assert.ok(names.has(n), `Obsidian missing core tool ${n}`);
  }
  // Intentional gaps: memory write tools stay Suggest-gated on Obsidian.
  for (const n of [
    "append_core_memory", "update_core_memory", "retire_core_memory",
    "restore_core_memory", "compact_core_memory_history", "append_topic_memory",
  ]) {
    assert.ok(!names.has(n), `Obsidian must NOT register ${n} (Suggest-only)`);
  }
  // Desktop is the current execution superset; Obsidian has a reviewed proposal tool.
  assert.ok(names.has("propose_memory_change"));
  assert.equal(AI_TOOL_NAMES_READ.length, 24);
  assert.equal(AI_TOOL_NAMES_WRITE.length, 25);
});
