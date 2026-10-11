/**
 * Obsidian chat tool surface lock — intentional gaps vs Desktop must stay explicit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "../topmind-desktop/electron/lib/ai-tool-names.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const obsSrc = path.join(root, "..", "topmind-obsidian", "src", "services", "kernel-workspace-ops.ts");

test("Obsidian KNOWN_TOOLS covers core surface; memory-write gap is intentional", (t) => {
  if (!existsSync(obsSrc)) {
    t.skip("topmind-obsidian not present");
    return;
  }
  const src = readFileSync(obsSrc, "utf8");
  const m = src.match(/const KNOWN_TOOLS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, "KNOWN_TOOLS set not found");
  const names = new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  // Core discovery/read/write/lifecycle must be present.
  for (const n of [
    "search", "workspace_overview", "list_categories", "list_topics", "list_topic_files",
    "get_topic", "list_inbox", "list_outputs", "list_todos", "list_recent_memories",
    "list_recent_stream", "list_pending_writes",
    "list_files", "stat_path",
    "glob_files", "workspace_health", "web_search", "fetch_url", "capture_url", "list_skills", "load_skill",
    "read_file", "save_file", "save_note", "edit_file", "capture", "capture_to_inbox",
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
  // Desktop catalog remains the superset source of truth.
  assert.equal(AI_TOOL_NAMES_READ.length, 22);
  assert.equal(AI_TOOL_NAMES_WRITE.length, 25);
});
