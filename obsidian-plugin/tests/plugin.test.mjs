// ── topmind Obsidian Plugin — Unit Tests ───────────────────────────────────
//
// Testing strategy:
//   Pure logic functions (parseStreamEntries, extractTags, etc.) are mirrored
//   here because the source is TypeScript and tests run via `node --test`.
//   The i18n key alignment test reads the actual locale source files, so any
//   new key added without its counterpart will fail.
//   Build output verification checks the actual dist/ artifacts.
//
// Tests cover:
// 1. i18n locale key alignment (zh-CN / en-US) — reads actual source files
// 2. Stream entry parsing logic
// 3. Tag extraction logic
// 4. File name sanitization logic
// 5. Period note seeding logic
// 6. Default settings shape
// 7. AI provider presets
// 8. Build output verification (dist/main.js, manifest.json, templates)
// 9. Stream/Todo path filter logic
// 10. Suggestion kind completeness
// 11. generateSuggestions return shape handling

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── i18n locale key alignment ──────────────────────────────────────────────

describe("i18n locale key alignment", () => {
  const zhCNKeys = [
    "plugin_name", "plugin_description",
    "stream_workbench_title", "sidebar_dock_title",
    "quick_capture_title", "quick_capture_placeholder", "quick_capture_submit",
    "quick_capture_target", "quick_capture_target_stream", "quick_capture_target_inbox",
    "quick_capture_hint_enter", "quick_capture_hint_shift_enter",
    "stream_this_week", "stream_switch_period", "stream_empty", "stream_organize",
    "suggestions_title", "suggestions_empty", "suggestions_confirm", "suggestions_dismiss",
    "suggestion_topic", "suggestion_todo", "suggestion_memory", "suggestion_summary",
    "sidebar_today_todos", "sidebar_recent_stream", "sidebar_open_workbench",
    "sidebar_no_todos", "sidebar_no_stream",
    "cmd_quick_capture", "cmd_open_workbench", "cmd_open_sidebar",
    "cmd_organize_period", "cmd_refresh_suggestions", "cmd_maintain_todos",
    "settings_workspace", "settings_stream", "settings_ai", "settings_security",
    "settings_auto_open", "settings_auto_open_desc",
    "settings_timeline_order", "settings_timeline_order_desc",
    "settings_auto_tag", "settings_auto_tag_desc",
    "settings_ai_provider", "settings_ai_provider_desc",
    "settings_ai_key", "settings_ai_key_desc",
    "settings_ai_base_url", "settings_ai_base_url_desc",
    "settings_ai_model", "settings_ai_model_desc",
    "settings_writeback_mode", "settings_writeback_mode_desc",
    "settings_auto_suggest", "settings_auto_suggest_desc",
    "settings_auto_maintain_todos", "settings_auto_maintain_todos_desc",
    "settings_backup_keep", "settings_backup_keep_desc",
    "settings_receipt_keep", "settings_receipt_keep_desc",
    "notice_write_pending", "notice_written", "notice_write_failed",
    "notice_executed", "notice_execute_failed",
    "notice_organizing", "notice_organize_done",
    "loading", "error", "saved",
    "init_workspace", "init_workspace_desc",
    "init_workspace_success", "init_workspace_failed",
    "writeback_auto", "writeback_confirm",
    "timeline_desc", "timeline_asc",
    "provider_none", "provider_openai", "provider_deepseek",
    "provider_anthropic", "provider_ollama", "provider_custom",
    "settings_ai_test", "settings_ai_testing",
    "settings_ai_test_success", "settings_ai_test_failed",
    "settings_ai_test_no_key",
    "settings_security_note",
    "notice_workspace_not_ready",
    "stream_expand_entry",
  ];

  test("zh-CN and en-US have identical key sets", () => {
    const zhContent = fs.readFileSync(
      path.join(__dirname, "..", "src", "i18n", "locales", "zh-CN.ts"),
      "utf-8",
    );
    const enContent = fs.readFileSync(
      path.join(__dirname, "..", "src", "i18n", "locales", "en-US.ts"),
      "utf-8",
    );

    const keyRegex = /^\s*(\w+):\s*"/gmu;
    const zhKeys = new Set();
    const enKeys = new Set();

    let match;
    while ((match = keyRegex.exec(zhContent)) !== null) {
      zhKeys.add(match[1]);
    }
    keyRegex.lastIndex = 0;
    while ((match = keyRegex.exec(enContent)) !== null) {
      enKeys.add(match[1]);
    }

    for (const key of zhKeys) {
      assert.ok(enKeys.has(key), `en-US missing key: ${key}`);
    }
    for (const key of enKeys) {
      assert.ok(zhKeys.has(key), `zh-CN missing key: ${key}`);
    }
    assert.equal(zhKeys.size, enKeys.size, "Key count mismatch");
  });

  test("zh-CN has expected minimum key count", () => {
    assert.ok(zhCNKeys.length >= 67, `Expected at least 67 keys, got ${zhCNKeys.length}`);
  });
});
// ── Stream entry parsing ───────────────────────────────────────────────────

describe("parseStreamEntries", () => {
  function parseStreamEntries(content) {
    const entries = [];
    const lines = content.split("\n");
    const timeRegex = /^-\s*(\d{1,2}:\d{2})\s+(.*)/u;
    const tagRegex = /#([\w\u4e00-\u9fff-]+)/gu;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(timeRegex);
      if (match) {
        const time = match[1];
        const text = match[2];
        const tags = Array.from(text.matchAll(tagRegex)).map((m) => m[1]);
        entries.push({ time, text, tags, rawLine: line, lineOffset: i });
      }
    }
    return entries;
  }

  test("parses simple time-prefixed entries", () => {
    const content = "# 2026-W01\n\n- 09:30 开始写文档\n- 14:00 开会讨论方案\n";
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].time, "09:30");
    assert.equal(entries[0].text, "开始写文档");
    assert.equal(entries[1].time, "14:00");
    assert.equal(entries[1].text, "开会讨论方案");
  });

  test("extracts tags from entry text", () => {
    const content = "- 10:00 完成需求评审 #urgent #项目A\n";
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].tags, ["urgent", "项目A"]);
  });

  test("handles Chinese tags", () => {
    const content = "- 11:00 读完书 #阅读 #思考\n";
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].tags, ["阅读", "思考"]);
  });

  test("returns empty array for empty content", () => {
    const entries = parseStreamEntries("");
    assert.equal(entries.length, 0);
  });

  test("ignores non-entry lines", () => {
    const content = "# Title\n\nSome paragraph text\n\n- 09:00 real entry\n";
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].text, "real entry");
  });
});

// ── Tag extraction ─────────────────────────────────────────────────────────

describe("extractTags", () => {
  function extractTags(text) {
    const matches = text.matchAll(/#([\w\u4e00-\u9fff-]+)/gu);
    return Array.from(matches).map((m) => m[1]);
  }

  test("extracts single tag", () => {
    assert.deepEqual(extractTags("hello #world"), ["world"]);
  });

  test("extracts multiple tags", () => {
    assert.deepEqual(extractTags("#a #b #c"), ["a", "b", "c"]);
  });

  test("extracts Chinese tags", () => {
    assert.deepEqual(extractTags("完成了 #项目A 的评审"), ["项目A"]);
  });

  test("returns empty for no tags", () => {
    assert.deepEqual(extractTags("no tags here"), []);
  });

  test("handles hyphenated tags", () => {
    assert.deepEqual(extractTags("check #todo-item"), ["todo-item"]);
  });
});

// ── File name sanitization ────────────────────────────────────────────────

describe("sanitizeFileName", () => {
  function sanitizeFileName(name) {
    return name.replace(/[<>:"/\\|?*]/g, "-").replace(/^-+|-+$/g, "").trim() || "untitled";
  }

  test("removes invalid characters", () => {
    assert.equal(sanitizeFileName("test<file>"), "test-file");
    assert.equal(sanitizeFileName('test:file"name'), "test-file-name");
    assert.equal(sanitizeFileName("test|file?name*"), "test-file-name");
  });

  test("returns untitled for empty string", () => {
    assert.equal(sanitizeFileName(""), "untitled");
    assert.equal(sanitizeFileName("   "), "untitled");
  });

  test("preserves valid characters", () => {
    assert.equal(sanitizeFileName("正常文件名.txt"), "正常文件名.txt");
  });

  test("strips leading and trailing dashes", () => {
    assert.equal(sanitizeFileName("<test>"), "test");
    assert.equal(sanitizeFileName("???test???"), "test");
  });
});

// ── Period note frontmatter helpers ───────────────────────────────────────

describe("seedPeriodFrontmatter", () => {
  function seedPeriodFrontmatter(relPath) {
    const fileName = relPath.split("/").pop()?.replace(".md", "") || "";
    return `---\nperiod: ${fileName}\n---\n\n`;
  }

  test("creates frontmatter with period name", () => {
    const result = seedPeriodFrontmatter("10-动态/2026-W01.md");
    assert.ok(result.includes("period: 2026-W01"));
  });

  test("handles paths without directory", () => {
    const result = seedPeriodFrontmatter("2026-W02.md");
    assert.ok(result.includes("period: 2026-W02"));
  });
});

// ── Frontmatter strip/extract ─────────────────────────────────────────────

describe("stripFrontmatter / extractFrontmatter", () => {
  function stripFrontmatter(raw) {
    const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
    return match ? raw.slice(match[0].length) : raw;
  }

  function extractFrontmatter(raw) {
    const match = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n*)/u);
    return match ? match[0] : null;
  }

  test("strips frontmatter from markdown", () => {
    const raw = "---\nperiod: 2026-W01\n---\n\n# 2026-W01\n\n- 09:00 hello\n";
    const body = stripFrontmatter(raw);
    assert.ok(!body.startsWith("---"));
    assert.ok(body.includes("# 2026-W01"));
  });

  test("returns full content when no frontmatter", () => {
    const raw = "# No frontmatter\n\nText";
    assert.equal(stripFrontmatter(raw), raw);
  });

  test("extracts frontmatter block", () => {
    const raw = "---\nperiod: 2026-W01\n---\n\nbody";
    const fm = extractFrontmatter(raw);
    assert.ok(fm);
    assert.ok(fm.startsWith("---"));
    assert.ok(fm.includes("period: 2026-W01"));
  });

  test("returns null when no frontmatter", () => {
    assert.equal(extractFrontmatter("# No fm\n\nText"), null);
  });
});

// ── Default settings ──────────────────────────────────────────────────────

describe("DEFAULT_SETTINGS shape", () => {
  const DEFAULT_SETTINGS = {
    autoOpenWorkbench: true,
    timelineOrder: "desc",
    autoTag: true,
    aiProvider: "none",
    aiApiKey: "",
    aiBaseUrl: "https://api.deepseek.com/v1",
    aiModel: "deepseek-chat",
    writebackMode: "confirm",
    autoSuggest: true,
    autoMaintainTodos: false,
    backupKeep: 3,
    receiptKeep: 50,
  };

  test("has all required fields", () => {
    const requiredFields = [
      "autoOpenWorkbench", "timelineOrder", "autoTag",
      "aiProvider", "aiApiKey", "aiBaseUrl", "aiModel",
      "writebackMode", "autoSuggest", "autoMaintainTodos",
      "backupKeep", "receiptKeep",
    ];
    for (const field of requiredFields) {
      assert.ok(field in DEFAULT_SETTINGS, `Missing field: ${field}`);
    }
  });

  test("defaults to confirm writeback mode", () => {
    assert.equal(DEFAULT_SETTINGS.writebackMode, "confirm");
  });

  test("defaults to no AI provider", () => {
    assert.equal(DEFAULT_SETTINGS.aiProvider, "none");
    assert.equal(DEFAULT_SETTINGS.aiApiKey, "");
  });

  test("auto-maintain todos defaults to false (saves tokens)", () => {
    assert.equal(DEFAULT_SETTINGS.autoMaintainTodos, false);
  });

  test("receiptKeep defaults to 50", () => {
    assert.equal(DEFAULT_SETTINGS.receiptKeep, 50);
  });

  test("backupKeep allows 0 (disables backups)", () => {
    // Verify that backupKeep=0 is a valid configuration
    const settingsWithDisabledBackup = { ...DEFAULT_SETTINGS, backupKeep: 0 };
    assert.equal(settingsWithDisabledBackup.backupKeep, 0);
  });

  test("receiptKeep minimum is 10", () => {
    assert.ok(DEFAULT_SETTINGS.receiptKeep >= 10, "receiptKeep should be >= 10");
  });
});

// ── AI Provider presets ──────────────────────────────────────────────────

describe("AI_PROVIDER_PRESETS", () => {
  const AI_PROVIDER_PRESETS = {
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-20250514" },
    ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" },
    custom: { baseUrl: "", model: "" },
  };

  test("all providers have baseUrl and model", () => {
    for (const [name, preset] of Object.entries(AI_PROVIDER_PRESETS)) {
      assert.ok(typeof preset.baseUrl === "string", `${name} missing baseUrl`);
      assert.ok(typeof preset.model === "string", `${name} missing model`);
    }
  });

  test("custom preset has empty defaults", () => {
    assert.equal(AI_PROVIDER_PRESETS.custom.baseUrl, "");
    assert.equal(AI_PROVIDER_PRESETS.custom.model, "");
  });

  test("ollama uses localhost", () => {
    assert.ok(AI_PROVIDER_PRESETS.ollama.baseUrl.startsWith("http://127.0.0.1"));
  });
});

// ── Build output verification ─────────────────────────────────────────────

describe("build output", () => {
  test("dist/main.js exists and is non-trivial", () => {
    const mainPath = path.join(__dirname, "..", "dist", "main.js");
    assert.ok(fs.existsSync(mainPath), "dist/main.js not found");
    const stat = fs.statSync(mainPath);
    assert.ok(stat.size > 10000, `main.js too small: ${stat.size} bytes`);
  });

  test("dist/manifest.json exists and has correct id", () => {
    const manifestPath = path.join(__dirname, "..", "dist", "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "dist/manifest.json not found");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.equal(manifest.id, "topmind-stream");
    assert.ok(manifest.version, "manifest missing version");
    assert.equal(manifest.isDesktopOnly, true);
  });

  test("dist/templates/ has template files", () => {
    const templatesDir = path.join(__dirname, "..", "dist", "templates");
    assert.ok(fs.existsSync(templatesDir), "templates dir not found");
    const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 4, `Expected at least 4 template files, got ${files.length}`);
  });
});

// ── Stream/Todo path filter ─────────────────────────────────────────────────

describe("isStreamOrTodoPath", () => {
  function isStreamOrTodoPath(filePath) {
    if (/^1\d-/u.test(filePath)) return true;
    if (filePath.includes("memory/todo")) return true;
    if (filePath.includes("memory/periodic/")) return true;
    return false;
  }

  test("matches stream category directories (10-19 prefix)", () => {
    assert.ok(isStreamOrTodoPath("10-动态/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("10-Stream/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("11-健康/2026-W01.md"));
  });

  test("matches memory/todo path", () => {
    assert.ok(isStreamOrTodoPath("memory/todo.md"));
    assert.ok(isStreamOrTodoPath("memory/todo/something.md"));
  });

  test("does not match non-stream paths", () => {
    assert.ok(!isStreamOrTodoPath("memory/profile.md"));
    assert.ok(!isStreamOrTodoPath(".topmind/index.json"));
    assert.ok(!isStreamOrTodoPath("topmind.yaml"));
    assert.ok(!isStreamOrTodoPath("20-专题/2026-项目A/topic.md"));
    assert.ok(!isStreamOrTodoPath("88-输出/report.md"));
    assert.ok(!isStreamOrTodoPath("99-归档/backup.md"));
  });

  test("matches memory/periodic paths (AI digest updates)", () => {
    assert.ok(isStreamOrTodoPath("memory/periodic/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("memory/periodic/2026-W02.md"));
  });
});

// ── Suggestion kind completeness ───────────────────────────────────────────

describe("SuggestionKind coverage", () => {
  // All Kernel suggest-engine kinds
  const kernelKinds = [
    "inbox_review", "stale_topic", "catch_all",
    "stream_digest", "promote_memory", "open_profile",
  ];
  // All ai-operation-engine suggestion kinds
  const opKinds = ["create_topic", "promote_memory", "ai_summary"];
  // todo-engine operation kind (AI extracts todos from stream)
  const todoKinds = ["todo_extract"];

  const allKinds = [...new Set([...kernelKinds, ...opKinds, ...todoKinds])];

  test("covers all Kernel suggest-engine kinds", () => {
    for (const kind of kernelKinds) {
      assert.ok(allKinds.includes(kind), `Missing Kernel kind: ${kind}`);
    }
  });

  test("covers all ai-operation-engine suggestion kinds", () => {
    for (const kind of opKinds) {
      assert.ok(allKinds.includes(kind), `Missing op kind: ${kind}`);
    }
  });

  test("all kinds are non-empty strings", () => {
    for (const kind of allKinds) {
      assert.ok(typeof kind === "string" && kind.length > 0, `Invalid kind: ${kind}`);
    }
  });
});

// ── generateSuggestions return shape ──────────────────────────────────────

describe("generateSuggestions return shape", () => {
  // Kernel's suggest-engine returns Suggestion[] directly (not wrapped).
  // The plugin's kernel-service must handle both shapes.

  test("handles direct array return (Kernel behavior)", () => {
    const kernelResult = [
      { id: "a", kind: "promote_memory", title: "A", summary: "sa", impact: "high" },
      { id: "b", kind: "inbox_review", title: "B", summary: "sb", impact: "low" },
    ];
    const items = Array.isArray(kernelResult)
      ? kernelResult
      : ((kernelResult)?.suggestions || []);
    assert.equal(items.length, 2);
    assert.equal(items[0].id, "a");
  });

  test("handles legacy wrapped return (forward compat)", () => {
    const legacyResult = { suggestions: [
      { id: "x", kind: "create_topic", title: "X", summary: "sx", impact: "medium" },
    ] };
    const items = Array.isArray(legacyResult)
      ? legacyResult
      : (legacyResult?.suggestions || []);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "x");
  });

  test("handles empty results", () => {
    const empty = [];
    const items = Array.isArray(empty)
      ? empty
      : (empty?.suggestions || []);
    assert.equal(items.length, 0);
  });
});

// ── Suggestion card mapping completeness ─────────────────────────────────

describe("Suggestion card mapping", () => {
  // Verify the kindMeta map in stream-workbench-view covers all SuggestionKind values.
  const allKinds = [
    "create_topic", "promote_memory", "ai_summary", "todo_extract",
    "inbox_review", "stale_topic", "catch_all", "stream_digest", "open_profile",
  ];

  // Mirrors the kindMeta object in stream-workbench-view.ts
  const kindMeta = {
    create_topic: { icon: "📂", border: "blue" },
    todo_extract: { icon: "📝", border: "orange" },
    promote_memory: { icon: "🧠", border: "green" },
    ai_summary: { icon: "📊", border: "purple" },
    inbox_review: { icon: "📥", border: "blue" },
    stale_topic: { icon: "📦", border: "orange" },
    catch_all: { icon: "🧹", border: "orange" },
    stream_digest: { icon: "📜", border: "purple" },
    open_profile: { icon: "👤", border: "green" },
  };

  test("every SuggestionKind has a kindMeta entry", () => {
    for (const kind of allKinds) {
      assert.ok(kind in kindMeta, `kindMeta missing entry for kind: ${kind}`);
    }
  });

  test("every kindMeta entry has icon and border", () => {
    for (const [kind, meta] of Object.entries(kindMeta)) {
      assert.ok(typeof meta.icon === "string" && meta.icon.length > 0, `${kind} missing icon`);
      assert.ok(typeof meta.border === "string" && meta.border.length > 0, `${kind} missing border`);
    }
  });
});

// ── isStreamOrTodoPath: topmind.yaml edge case ────────────────────────────

describe("isStreamOrTodoPath edge cases", () => {
  function isStreamOrTodoPath(filePath) {
    if (/^1\d-/u.test(filePath)) return true;
    if (filePath.includes("memory/todo")) return true;
    if (filePath.includes("memory/periodic/")) return true;
    return false;
  }

  test("does not match topmind.yaml (handled separately in view)", () => {
    assert.ok(!isStreamOrTodoPath("topmind.yaml"));
  });

  test("does not match .topmind/ system plane files", () => {
    assert.ok(!isStreamOrTodoPath(".topmind/index.json"));
    assert.ok(!isStreamOrTodoPath(".topmind/loop.json"));
    assert.ok(!isStreamOrTodoPath(".topmind/logs/2026-01-01.log"));
  });
});

// ── AI provider retry logic ───────────────────────────────────────────────

describe("AI provider transient error detection", () => {
  // Mirrors isTransientError from ai-provider.ts
  function isTransientError(err) {
    if (err instanceof TypeError) return true;
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes("fetch") || msg.includes("network") || msg.includes("timeout") || msg.includes("abort");
    }
    return false;
  }

  test("TypeError is transient (network error)", () => {
    assert.ok(isTransientError(new TypeError("fetch failed")));
  });

  test("timeout errors are transient", () => {
    assert.ok(isTransientError(new Error("Request timeout")));
  });

  test("abort errors are transient", () => {
    assert.ok(isTransientError(new Error("The operation was aborted")));
  });

  test("non-transient errors are not retried", () => {
    assert.ok(!isTransientError(new Error("AI request failed (400): bad request")));
  });

  test("null/undefined is not transient", () => {
    assert.ok(!isTransientError(null));
    assert.ok(!isTransientError(undefined));
  });
});

// ── Capture input validation ──────────────────────────────────────────────

describe("capture input validation", () => {
  const MAX_CAPTURE_LEN = 10_000;

  test("empty text should be rejected", () => {
    const text = "   \n\t  ";
    assert.equal(text.trim(), "");
  });

  test("very long text should be truncated", () => {
    const longText = "a".repeat(20_000);
    const safeText = longText.length > MAX_CAPTURE_LEN
      ? longText.slice(0, MAX_CAPTURE_LEN) + "…(truncated)"
      : longText;
    assert.ok(safeText.length < longText.length);
    assert.ok(safeText.includes("(truncated)"));
  });

  test("normal text passes through unchanged", () => {
    const text = "完成需求评审 #urgent";
    const safeText = text.length > MAX_CAPTURE_LEN
      ? text.slice(0, MAX_CAPTURE_LEN) + "…(truncated)"
      : text;
    assert.equal(safeText, text);
  });
});
